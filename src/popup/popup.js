// popup.js - Main popup logic

// DOM Elements
const elements = {
    asinInput: document.getElementById('asinInput'),
    zipCode: document.getElementById('zipCode'),
    delayTime: document.getElementById('delayTime'),
    webhookUrl: document.getElementById('webhookUrl'),
    startBtn: document.getElementById('startBtn'),
    stopBtn: document.getElementById('stopBtn'),
    statusText: document.getElementById('statusText'),
    progressBar: document.getElementById('progressBar'),
    progressFill: document.getElementById('progressFill'),
    statusSection: document.getElementById('status')
};

// State
let isProcessing = false;
let currentSession = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    await checkCurrentSession();
    
    // Event listeners
    elements.startBtn.addEventListener('click', handleStart);
    elements.stopBtn.addEventListener('click', handleStop);
    
    // Save settings on change
    elements.zipCode.addEventListener('change', saveSettings);
    elements.delayTime.addEventListener('change', saveSettings);
    elements.webhookUrl.addEventListener('change', saveSettings);
});

// Load saved settings
async function loadSettings() {
    const settings = await chrome.storage.local.get(['settings']);
    if (settings.settings) {
        elements.zipCode.value = settings.settings.zipCode || '10016';
        elements.delayTime.value = settings.settings.delayTime || 3000;
        elements.webhookUrl.value = settings.settings.webhookUrl || '';
    }
}

// Save settings
async function saveSettings() {
    const settings = {
        zipCode: elements.zipCode.value,
        delayTime: parseInt(elements.delayTime.value),
        webhookUrl: elements.webhookUrl.value
    };
    await chrome.storage.local.set({ settings });
}

// Check if there's an active session
async function checkCurrentSession() {
    const response = await chrome.runtime.sendMessage({ 
        action: 'checkSession' 
    });
    
    if (response && response.active) {
        currentSession = response.sessionId;
        updateUIForActiveSession();
    }
}

// Start scraping
async function handleStart() {
    // Validate inputs
    const asins = elements.asinInput.value
        .split('\n')
        .map(asin => asin.trim())
        .filter(asin => asin.length > 0);
    
    if (asins.length === 0) {
        showError('Please enter at least one ASIN');
        return;
    }
    
    if (!elements.webhookUrl.value) {
        showError('Please enter a webhook URL');
        return;
    }
    
    // Update UI
    isProcessing = true;
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
    elements.asinInput.disabled = true;
    updateStatus('Starting...', 0);
    
    // Send message to background script
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'startScraping',
            data: {
                asins: asins,
                settings: {
                    zipCode: elements.zipCode.value,
                    delayTime: parseInt(elements.delayTime.value),
                    webhookUrl: elements.webhookUrl.value
                }
            }
        });
        
        if (response.success) {
            currentSession = response.sessionId;
            updateStatus(`Processing ${asins.length} ASINs...`, 0);
        } else {
            throw new Error(response.error || 'Failed to start');
        }
    } catch (error) {
        showError(error.message);
        resetUI();
    }
}

// Stop scraping
async function handleStop() {
    if (!currentSession) return;
    
    try {
        await chrome.runtime.sendMessage({
            action: 'stopScraping',
            sessionId: currentSession
        });
        
        updateStatus('Stopped by user', -1);
        resetUI();
    } catch (error) {
        showError(error.message);
    }
}

// Update UI for active session
function updateUIForActiveSession() {
    isProcessing = true;
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
    elements.asinInput.disabled = true;
    updateStatus('Session in progress...', -1);
}

// Update status display
function updateStatus(message, progress) {
    elements.statusText.textContent = message;
    elements.statusSection.className = 'status-section';
    
    if (progress >= 0 && progress <= 100) {
        elements.progressFill.style.width = `${progress}%`;
    }
}

// Show error
function showError(message) {
    elements.statusText.textContent = `Error: ${message}`;
    elements.statusSection.className = 'status-section error';
    elements.progressFill.style.width = '0%';
}

// Show success
function showSuccess(message) {
    elements.statusText.textContent = message;
    elements.statusSection.className = 'status-section success';
    elements.progressFill.style.width = '100%';
}

// Reset UI
function resetUI() {
    isProcessing = false;
    currentSession = null;
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
    elements.asinInput.disabled = false;
}

// Listen for updates from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'progressUpdate' && message.sessionId === currentSession) {
        const progress = (message.completed / message.total) * 100;
        updateStatus(
            `Processing ASIN ${message.completed} of ${message.total}...`,
            progress
        );
    } else if (message.type === 'sessionComplete' && message.sessionId === currentSession) {
        showSuccess(`Completed! Processed ${message.total} ASINs`);
        resetUI();
    } else if (message.type === 'sessionError' && message.sessionId === currentSession) {
        showError(message.error);
        resetUI();
    }
});