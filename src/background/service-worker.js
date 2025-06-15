// service-worker.js - Background script for Chrome Extension Manifest V3

// Import shared modules
importScripts('../shared/constants.js', '../shared/utils.js');

// Session management
const sessions = new Map();
const tabToSession = new Map(); // Map tab IDs to session IDs

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request, sender)
        .then(sendResponse)
        .catch(error => sendResponse({ success: false, error: error.message }));
    
    return true; // Keep message channel open for async response
});

// Handle different message types
async function handleMessage(request, sender) {
    switch (request.action) {
        case 'startScraping':
            return await startScrapingSession(request.data);
            
        case 'stopScraping':
            return await stopScrapingSession(request.sessionId);
            
        case 'checkSession':
            return checkActiveSession();
            
        case 'checkTabStatus':
            return checkTabStatus(sender.tab?.id, request.asin);
            
        case 'productDataExtracted':
            return await handleExtractedData(sender.tab?.id, request.asin, request.data);
            
        default:
            throw new Error(`Unknown action: ${request.action}`);
    }
}

// Start a new scraping session
async function startScrapingSession(data) {
    const sessionId = generateSessionId();
    const session = {
        id: sessionId,
        asins: data.asins,
        settings: data.settings,
        status: 'active',
        processed: 0,
        results: [],
        tabs: new Map(), // Map ASIN to tab ID
        startTime: Date.now()
    };
    
    sessions.set(sessionId, session);
    
    // Start processing ASINs
    processASINs(sessionId);
    
    return { success: true, sessionId };
}

// Process ASINs sequentially
async function processASINs(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || session.status !== 'active') return;
    
    try {
        for (let i = 0; i < session.asins.length; i++) {
            if (session.status !== 'active') break;
            
            const asin = session.asins[i];
            
            // Update progress
            await sendProgressUpdate(sessionId, i, session.asins.length);
            
            // Open Amazon tab and extract data
            const result = await processASIN(sessionId, asin, session.settings);
            
            if (result.success) {
                session.results.push(result.data);
            }
            
            // Wait for specified delay before next ASIN
            if (i < session.asins.length - 1) {
                await delay(session.settings.delayTime);
            }
            
            // Update processed count
            session.processed++;
        }
        
        // Send all results to webhook
        if (session.results.length > 0) {
            await sendToWebhook(session);
        }
        
        // Session complete
        await completeSession(sessionId);
        
    } catch (error) {
        console.error('Error processing ASINs:', error);
        await failSession(sessionId, error.message);
    }
}

// Process single ASIN
async function processASIN(sessionId, asin, settings) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    
    try {
        // Open Amazon tab
        const url = `https://www.amazon.com/dp/${asin}?zip=${settings.zipCode}`;
        const tab = await chrome.tabs.create({
            url: url,
            active: false
        });
        
        // Map tab to session and ASIN
        session.tabs.set(asin, tab.id);
        tabToSession.set(tab.id, { sessionId, asin });
        
        // Wait for tab to load and content script to initialize
        await waitForTabReady(tab.id);
        
        // Request image extraction
        const extractResult = await chrome.tabs.sendMessage(tab.id, {
            action: 'extractImages'
        });
        
        if (!extractResult.success) {
            throw new Error(extractResult.error || 'Extraction failed');
        }
        
        // Close tab after extraction
        await chrome.tabs.remove(tab.id);
        session.tabs.delete(asin);
        tabToSession.delete(tab.id);
        
        return {
            success: true,
            data: extractResult.data
        };
        
    } catch (error) {
        console.error(`Error processing ASIN ${asin}:`, error);
        
        // Clean up tab if it exists
        const tabId = session.tabs.get(asin);
        if (tabId) {
            try {
                await chrome.tabs.remove(tabId);
            } catch (e) {
                // Tab might already be closed
            }
            session.tabs.delete(asin);
            tabToSession.delete(tabId);
        }
        
        return {
            success: false,
            error: error.message
        };
    }
}

// Wait for tab to be ready (content script loaded)
async function waitForTabReady(tabId, maxWait = 30000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
        try {
            // Check if content script is ready
            const response = await chrome.tabs.sendMessage(tabId, {
                action: 'getStatus'
            });
            
            if (response && response.ready) {
                return true;
            }
        } catch (error) {
            // Content script not ready yet
        }
        
        await delay(500);
    }
    
    throw new Error('Timeout waiting for page to load');
}

// Check if a tab should auto-extract
function checkTabStatus(tabId, asin) {
    const tabInfo = tabToSession.get(tabId);
    
    if (tabInfo && tabInfo.asin === asin) {
        return { shouldExtract: true };
    }
    
    return { shouldExtract: false };
}

// Handle extracted data from content script
async function handleExtractedData(tabId, asin, data) {
    const tabInfo = tabToSession.get(tabId);
    
    if (!tabInfo) {
        return { success: false, error: 'Tab not associated with any session' };
    }
    
    const session = sessions.get(tabInfo.sessionId);
    if (!session) {
        return { success: false, error: 'Session not found' };
    }
    
    // Store the extracted data
    const resultData = {
        ...data,
        asin: asin,
        extractedAt: new Date().toISOString()
    };
    
    // Find and update the result for this ASIN
    const existingIndex = session.results.findIndex(r => r.asin === asin);
    if (existingIndex >= 0) {
        session.results[existingIndex] = resultData;
    } else {
        session.results.push(resultData);
    }
    
    return { success: true };
}

// Send results to webhook
async function sendToWebhook(session) {
    if (!session.settings.webhookUrl) {
        console.warn('No webhook URL configured');
        return;
    }
    
    const payload = {
        sessionId: session.id,
        timestamp: new Date().toISOString(),
        duration: Date.now() - session.startTime,
        totalASINs: session.asins.length,
        successfulExtractions: session.results.length,
        products: session.results
    };
    
    try {
        const response = await fetch(session.settings.webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            throw new Error(`Webhook returned ${response.status}`);
        }
        
        console.log('Successfully sent data to webhook');
        
    } catch (error) {
        console.error('Failed to send to webhook:', error);
        // Store failed webhook data for retry
        await chrome.storage.local.set({
            [`webhook_failed_${session.id}`]: payload
        });
    }
}

// Stop scraping session
async function stopScrapingSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
        throw new Error('Session not found');
    }
    
    session.status = 'stopped';
    
    // Close all tabs
    for (const [asin, tabId] of session.tabs) {
        try {
            await chrome.tabs.remove(tabId);
            tabToSession.delete(tabId);
        } catch (e) {
            // Tab might already be closed
        }
    }
    
    sessions.delete(sessionId);
    
    return { success: true };
}

// Check if there's an active session
function checkActiveSession() {
    for (const [sessionId, session] of sessions) {
        if (session.status === 'active') {
            return { active: true, sessionId };
        }
    }
    return { active: false };
}

// Send progress update to popup
async function sendProgressUpdate(sessionId, completed, total) {
    try {
        await chrome.runtime.sendMessage({
            type: 'progressUpdate',
            sessionId: sessionId,
            completed: completed,
            total: total
        });
    } catch (error) {
        // Popup might be closed, ignore error
    }
}

// Complete session
async function completeSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;
    
    session.status = 'complete';
    
    // Send completion message
    try {
        await chrome.runtime.sendMessage({
            type: 'sessionComplete',
            sessionId: sessionId,
            total: session.processed,
            successful: session.results.length
        });
    } catch (error) {
        // Popup might be closed
    }
    
    // Clean up
    for (const [asin, tabId] of session.tabs) {
        tabToSession.delete(tabId);
    }
    
    sessions.delete(sessionId);
}

// Fail session
async function failSession(sessionId, error) {
    const session = sessions.get(sessionId);
    if (!session) return;
    
    session.status = 'failed';
    
    // Send error message
    try {
        await chrome.runtime.sendMessage({
            type: 'sessionError',
            sessionId: sessionId,
            error: error
        });
    } catch (err) {
        // Popup might be closed
    }
    
    // Clean up tabs
    for (const [asin, tabId] of session.tabs) {
        try {
            await chrome.tabs.remove(tabId);
            tabToSession.delete(tabId);
        } catch (e) {
            // Tab might already be closed
        }
    }
    
    sessions.delete(sessionId);
}

// Chrome extension lifecycle events
chrome.runtime.onInstalled.addListener((details) => {
    console.log('Extension installed:', details.reason);
    
    // Set default settings on install
    if (details.reason === 'install') {
        chrome.storage.local.set({
            settings: {
                zipCode: '10016',
                delayTime: 3000,
                webhookUrl: ''
            }
        });
    }
});

// Clean up on browser startup
chrome.runtime.onStartup.addListener(() => {
    sessions.clear();
    tabToSession.clear();
});

// Clean up when tab is closed manually
chrome.tabs.onRemoved.addListener((tabId) => {
    const tabInfo = tabToSession.get(tabId);
    if (tabInfo) {
        const session = sessions.get(tabInfo.sessionId);
        if (session) {
            session.tabs.delete(tabInfo.asin);
        }
        tabToSession.delete(tabId);
    }
});