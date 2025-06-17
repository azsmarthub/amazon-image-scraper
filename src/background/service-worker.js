// service-worker.js - Background script for Chrome Extension Manifest V3

// Import shared modules
importScripts('../shared/constants.js', '../shared/utils.js', '../shared/api-client.js');

// Initialize webhook client
const webhookClient = new WebhookClient();

// Session management
const sessions = new Map();
const tabToSession = new Map(); // Map tab IDs to session IDs
const processedASINs = new Set(); // Track processed ASINs

// Simple webhook queue
const webhookQueue = [];
let isProcessingQueue = false;

// Batch processing configuration
const BATCH_SIZE = 5; // Process 5 tabs concurrently
const BATCH_DELAY = 2000; // Delay between batches

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
            
        case 'sendSelectedImages':
            return await handleSelectedImages(request.asin, request.data);
            
        case 'getWebhookStatus':
            return await getWebhookStatus();
            
        case 'retryFailedWebhook':
            return await retryFailedWebhook(request.webhookId);
            
        case 'clearFailedWebhooks':
            return await clearFailedWebhooks();
            
        case 'exportResults':
            return await exportResults(request.format);
            
        case 'getProcessedASINs':
            return { asins: Array.from(processedASINs) };
            
        case 'clearProcessedASINs':
            processedASINs.clear();
            await chrome.storage.local.set({ processedASINs: [] });
            return { success: true };
            
        default:
            throw new Error(`Unknown action: ${request.action}`);
    }
}

// Start a new scraping session with batch processing
async function startScrapingSession(data) {
    const sessionId = generateSessionId();
    
    // Filter out already processed ASINs
    const newASINs = data.asins.filter(asin => !processedASINs.has(asin));
    const skippedCount = data.asins.length - newASINs.length;
    
    if (newASINs.length === 0) {
        return { 
            success: false, 
            error: 'All ASINs have been processed already. Clear history to reprocess.' 
        };
    }
    
    if (skippedCount > 0) {
        console.log(`[Session] Skipping ${skippedCount} already processed ASINs`);
    }
    
    const session = {
        id: sessionId,
        asins: newASINs,
        settings: data.settings,
        status: 'active',
        processed: 0,
        results: [],
        tabs: new Map(),
        startTime: Date.now(),
        batchMode: newASINs.length > BATCH_SIZE
    };
    
    sessions.set(sessionId, session);
    
    // Start processing ASINs in batches
    if (session.batchMode) {
        processBatches(sessionId);
    } else {
        processASINs(sessionId);
    }
    
    return { 
        success: true, 
        sessionId,
        totalASINs: newASINs.length,
        skippedASINs: skippedCount
    };
}

// Process ASINs in batches
async function processBatches(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || session.status !== 'active') return;
    
    try {
        const batches = chunkArray(session.asins, BATCH_SIZE);
        
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            if (session.status !== 'active') break;
            
            const batch = batches[batchIndex];
            const batchStartIndex = batchIndex * BATCH_SIZE;
            
            console.log(`[Batch] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} ASINs)`);
            
            // Process batch in parallel
            const batchPromises = batch.map((asin, index) => 
                processASIN(sessionId, asin, session.settings, batchStartIndex + index)
            );
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            // Collect successful results
            batchResults.forEach((result, index) => {
                if (result.status === 'fulfilled' && result.value.success) {
                    session.results.push(result.value.data);
                    processedASINs.add(batch[index]);
                }
                session.processed++;
            });
            
            // Update progress
            await sendProgressUpdate(sessionId, session.processed, session.asins.length);
            
            // Delay before next batch
            if (batchIndex < batches.length - 1) {
                await delay(BATCH_DELAY);
            }
        }
        
        // Save processed ASINs
        await saveProcessedASINs();
        
        // Send results to webhook
        if (session.results.length > 0 && session.settings.webhookUrl) {
            await queueWebhook(session.settings.webhookUrl, {
                sessionId: session.id,
                timestamp: new Date().toISOString(),
                duration: Date.now() - session.startTime,
                totalASINs: session.asins.length,
                successfulExtractions: session.results.length,
                batchMode: true,
                products: session.results
            });
        }
        
        await completeSession(sessionId);
        
    } catch (error) {
        console.error('Error processing batches:', error);
        await failSession(sessionId, error.message);
    }
}

// Process ASINs sequentially (for small batches)
async function processASINs(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || session.status !== 'active') return;
    
    try {
        for (let i = 0; i < session.asins.length; i++) {
            if (session.status !== 'active') break;
            
            const asin = session.asins[i];
            
            // Update progress
            await sendProgressUpdate(sessionId, i, session.asins.length);
            
            // Process ASIN
            const result = await processASIN(sessionId, asin, session.settings, i);
            
            if (result.success) {
                session.results.push(result.data);
                processedASINs.add(asin);
            }
            
            // Wait for specified delay before next ASIN
            if (i < session.asins.length - 1) {
                await delay(session.settings.delayTime);
            }
            
            session.processed++;
        }
        
        // Save processed ASINs
        await saveProcessedASINs();
        
        // Send results to webhook
        if (session.results.length > 0 && session.settings.webhookUrl) {
            await queueWebhook(session.settings.webhookUrl, {
                sessionId: session.id,
                timestamp: new Date().toISOString(),
                duration: Date.now() - session.startTime,
                totalASINs: session.asins.length,
                successfulExtractions: session.results.length,
                products: session.results
            });
        }
        
        await completeSession(sessionId);
        
    } catch (error) {
        console.error('Error processing ASINs:', error);
        await failSession(sessionId, error.message);
    }
}

// Process single ASIN
async function processASIN(sessionId, asin, settings, index) {
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

// Save processed ASINs to storage
async function saveProcessedASINs() {
    try {
        const asinArray = Array.from(processedASINs);
        await chrome.storage.local.set({ processedASINs: asinArray });
    } catch (error) {
        console.error('Failed to save processed ASINs:', error);
    }
}

// Load processed ASINs from storage
async function loadProcessedASINs() {
    try {
        const data = await chrome.storage.local.get(['processedASINs']);
        if (data.processedASINs && Array.isArray(data.processedASINs)) {
            data.processedASINs.forEach(asin => processedASINs.add(asin));
        }
    } catch (error) {
        console.error('Failed to load processed ASINs:', error);
    }
}

// Export results in different formats
async function exportResults(format = 'csv') {
    try {
        // Get all sessions from today
        const allResults = [];
        
        for (const [sessionId, session] of sessions) {
            if (session.results && session.results.length > 0) {
                allResults.push(...session.results);
            }
        }
        
        if (allResults.length === 0) {
            return { success: false, error: 'No results to export' };
        }
        
        let content = '';
        let filename = `amazon-images-${new Date().toISOString().split('T')[0]}`;
        
        if (format === 'csv') {
            // Create CSV content
            content = 'ASIN,Title,URL,Image Count,Main Image,All Images\n';
            allResults.forEach(product => {
                const row = [
                    product.asin,
                    `"${product.title.replace(/"/g, '""')}"`,
                    product.url,
                    product.images.length,
                    product.mainImage || '',
                    `"${product.images.join(', ')}"`
                ];
                content += row.join(',') + '\n';
            });
            filename += '.csv';
        } else if (format === 'json') {
            // Create JSON content
            content = JSON.stringify(allResults, null, 2);
            filename += '.json';
        }
        
        // Create blob and download
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        await chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: true
        });
        
        return { success: true, filename };
        
    } catch (error) {
        console.error('Export failed:', error);
        return { success: false, error: error.message };
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

// Handle selected images from content script
async function handleSelectedImages(asin, data) {
    try {
        // Get webhook URL from settings
        const settings = await chrome.storage.local.get(['settings']);
        const webhookUrl = settings.settings?.webhookUrl;
        
        if (!webhookUrl) {
            return { success: false, error: 'No webhook URL configured' };
        }
        
        // Prepare payload
        const payload = {
            sessionId: `manual-${Date.now()}`,
            timestamp: new Date().toISOString(),
            asin: asin,
            selectedImages: true,
            totalImages: data.totalCount,
            selectedCount: data.selectedCount,
            products: [{
                asin: asin,
                title: data.title,
                url: data.url,
                images: data.images,
                imageCount: data.images.length
            }]
        };
        
        // Queue webhook with priority (manual selections have priority)
        await queueWebhook(webhookUrl, payload, true);
        
        return { success: true, message: 'Webhook queued for sending' };
        
    } catch (error) {
        console.error('Failed to queue selected images:', error);
        return { success: false, error: error.message };
    }
}

// Queue webhook for sending
async function queueWebhook(webhookUrl, payload, priority = false) {
    const webhookItem = {
        id: Date.now(),
        webhookUrl,
        payload,
        priority,
        queued: new Date().toISOString()
    };
    
    if (priority) {
        // Add to front of queue
        webhookQueue.unshift(webhookItem);
    } else {
        // Add to end of queue
        webhookQueue.push(webhookItem);
    }
    
    // Start processing queue if not already processing
    if (!isProcessingQueue) {
        processWebhookQueue();
    }
}

// Process webhook queue
async function processWebhookQueue() {
    if (isProcessingQueue || webhookQueue.length === 0) return;
    
    isProcessingQueue = true;
    
    while (webhookQueue.length > 0) {
        const webhook = webhookQueue.shift();
        
        try {
            console.log(`[Queue] Processing webhook ${webhook.id}`);
            const result = await webhookClient.send(webhook.webhookUrl, webhook.payload);
            
            if (result.success) {
                // Notify popup of success
                chrome.runtime.sendMessage({
                    type: 'webhookSuccess',
                    message: 'Webhook sent successfully'
                }).catch(() => {}); // Popup might be closed
            } else {
                // Notify popup of failure
                chrome.runtime.sendMessage({
                    type: 'webhookError',
                    message: result.error
                }).catch(() => {});
            }
            
        } catch (error) {
            console.error('[Queue] Webhook processing error:', error);
        }
        
        // Small delay between webhooks
        if (webhookQueue.length > 0) {
            await delay(500);
        }
    }
    
    isProcessingQueue = false;
}

// Get webhook status
async function getWebhookStatus() {
    const failedWebhooks = await webhookClient.getFailedWebhooks();
    return {
        queueLength: webhookQueue.length,
        isProcessing: isProcessingQueue,
        failedCount: failedWebhooks.length,
        failedWebhooks: failedWebhooks
    };
}

// Retry failed webhook
async function retryFailedWebhook(webhookId) {
    try {
        const result = await webhookClient.retryFailedWebhook(webhookId);
        
        if (result.success) {
            chrome.runtime.sendMessage({
                type: 'webhookSuccess',
                message: 'Webhook retry successful'
            }).catch(() => {});
        } else {
            chrome.runtime.sendMessage({
                type: 'webhookError',
                message: result.error
            }).catch(() => {});
        }
        
        return result;
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Clear failed webhooks
async function clearFailedWebhooks() {
    await webhookClient.clearFailedWebhooks();
    return { success: true };
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

// Load processed ASINs on startup
chrome.runtime.onStartup.addListener(() => {
    sessions.clear();
    tabToSession.clear();
    loadProcessedASINs();
});

// Load processed ASINs when service worker starts
loadProcessedASINs();

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
