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
    statusSection: document.getElementById('status'),
    webhookStatus: document.getElementById('webhookStatus'),
    webhookFailures: document.getElementById('webhookFailures'),
    failedList: document.getElementById('failedList'),
    clearFailedBtn: document.getElementById('clearFailedBtn'),
    darkModeToggle: document.getElementById('darkModeToggle'),
    exportBtn: document.getElementById('exportBtn'),
    exportFormat: document.getElementById('exportFormat'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),
    processedCount: document.getElementById('processedCount')
};

// State
let isProcessing = false;
let currentSession = null;
let darkMode = false;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    await checkCurrentSession();
    await checkWebhookStatus();
    await updateProcessedCount();
    await loadDarkModePreference();
    
    // Event listeners
    elements.startBtn.addEventListener('click', handleStart);
    elements.stopBtn.addEventListener('click', handleStop);
    elements.clearFailedBtn.addEventListener('click', handleClearFailed);
    elements.darkModeToggle.addEventListener('click', toggleDarkMode);
    elements.exportBtn.addEventListener('click', handleExport);
    elements.clearHistoryBtn.addEventListener('click', handleClearHistory);
    
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

// Load dark mode preference
async function loadDarkModePreference() {
    const result = await chrome.storage.local.get(['darkMode']);
    darkMode = result.darkMode || false;
    updateDarkMode();
}

// Toggle dark mode
async function toggleDarkMode() {
    darkMode = !darkMode;
    await chrome.storage.local.set({ darkMode });
    updateDarkMode();
}

// Update dark mode UI
function updateDarkMode() {
    if (darkMode) {
        document.body.classList.add('dark-mode');
        elements.darkModeToggle.textContent = '☀️';
    } else {
        document.body.classList.remove('dark-mode');
        elements.darkModeToggle.textContent = '🌙';
    }
}

// Update processed ASINs count
async function updateProcessedCount() {
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'getProcessedASINs'
        });
        
        if (response && response.asins) {
            const count = response.asins.length;
            elements.processedCount.textContent = `${count} ASINs processed`;
            elements.exportBtn.disabled = count === 0;
        }
    } catch (error) {
        console.error('Failed to get processed count:', error);
    }
}

// Handle export
async function handleExport() {
    try {
        const format = elements.exportFormat.value;
        const response = await chrome.runtime.sendMessage({
            action: 'exportResults',
            format: format
        });
        
        if (response.success) {
            showSuccess(`Exported to ${response.filename}`);
        } else {
            showError(response.error || 'Export failed');
        }
    } catch (error) {
        showError('Failed to export results');
    }
}

// Handle clear history
async function handleClearHistory() {
    if (!confirm('Clear all processed ASINs history?')) return;
    
    try {
        await chrome.runtime.sendMessage({
            action: 'clearProcessedASINs'
        });
        
        await updateProcessedCount();
        showSuccess('History cleared');
    } catch (error) {
        showError('Failed to clear history');
    }
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

// Check webhook status
async function checkWebhookStatus() {
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'getWebhookStatus'
        });
        
        if (response) {
            updateWebhookStatus(response);
        }
    } catch (error) {
        console.error('Failed to get webhook status:', error);
    }
}

// Update webhook status display
function updateWebhookStatus(status) {
    // Show failed webhooks if any
    if (status.failedCount > 0) {
        elements.webhookFailures.style.display = 'block';
        elements.failedList.innerHTML = '';
        
        status.failedWebhooks.forEach(webhook => {
            const item = document.createElement('div');
            item.className = 'failed-item';
            item.innerHTML = `
                <div class="failed-info">
                    <span class="failed-time">${new Date(webhook.timestamp).toLocaleTimeString()}</span>
                    <span class="failed-error">${webhook.error}</span>
                </div>
                <button class="retry-btn" data-id="${webhook.id}">Retry</button>
            `;
            
            // Add retry handler
            item.querySelector('.retry-btn').addEventListener('click', (e) => {
                handleRetryWebhook(parseInt(e.target.dataset.id));
            });
            
            elements.failedList.appendChild(item);
        });
    } else {
        elements.webhookFailures.style.display = 'none';
    }
    
    // Show queue status if processing
    if (status.queueLength > 0 || status.isProcessing) {
        showWebhookIndicator('processing', `Queue: ${status.queueLength} webhooks`);
    }
}

// Show webhook indicator
function showWebhookIndicator(type, message) {
    elements.webhookStatus.style.display = 'flex';
    elements.webhookStatus.className = `webhook-status ${type}`;
    elements.webhookStatus.querySelector('.webhook-text').textContent = message;
}

// Hide webhook indicator
function hideWebhookIndicator() {
    elements.webhookStatus.style.display = 'none';
}

// Handle retry webhook
async function handleRetryWebhook(webhookId) {
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'retryFailedWebhook',
            webhookId: webhookId
        });
        
        if (response.success) {
            showWebhookIndicator('success', 'Webhook retry successful!');
            setTimeout(() => {
                hideWebhookIndicator();
                checkWebhookStatus();
            }, 2000);
        } else {
            showWebhookIndicator('error', `Retry failed: ${response.error}`);
            setTimeout(hideWebhookIndicator, 3000);
        }
    } catch (error) {
        showError('Failed to retry webhook');
    }
}

// Handle clear failed webhooks
async function handleClearFailed() {
    try {
        await chrome.runtime.sendMessage({
            action: 'clearFailedWebhooks'
        });
        
        elements.webhookFailures.style.display = 'none';
        showSuccess('Cleared failed webhooks');
    } catch (error) {
        showError('Failed to clear webhooks');
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
            let statusMsg = `Processing ${response.totalASINs} ASINs...`;
            if (response.skippedASINs > 0) {
                statusMsg += ` (${response.skippedASINs} already processed)`;
            }
            updateStatus(statusMsg, 0);
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
    
    // Update processed count after completion
    setTimeout(updateProcessedCount, 500);
}

// Listen for updates from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'progressUpdate' && message.sessionId === currentSession) {
        const progress = (message.completed / message.total) * 100;
        updateStatus(
            `Processing ASIN ${message.completed + 1} of ${message.total}...`,
            progress
        );
    } else if (message.type === 'sessionComplete' && message.sessionId === currentSession) {
        showSuccess(`Completed! Processed ${message.successful || message.total} ASINs successfully`);
        resetUI();
        // Check webhook status after completion
        setTimeout(checkWebhookStatus, 1000);
    } else if (message.type === 'sessionError' && message.sessionId === currentSession) {
        showError(message.error);
        resetUI();
    } else if (message.type === 'webhookSuccess') {
        showWebhookIndicator('success', message.message);
        setTimeout(() => {
            hideWebhookIndicator();
            checkWebhookStatus();
        }, 2000);
    } else if (message.type === 'webhookError') {
        showWebhookIndicator('error', `Webhook failed: ${message.message}`);
        setTimeout(() => {
            hideWebhookIndicator();
            checkWebhookStatus();
        }, 3000);
    }
});

// Add download permission request
chrome.permissions.contains({
    permissions: ['downloads']
}, (result) => {
    if (!result) {
        // Request download permission when needed
        elements.exportBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            chrome.permissions.request({
                permissions: ['downloads']
            }, (granted) => {
                if (granted) {
                    handleExport();
                } else {
                    showError('Download permission required for export');
                }
            });
        });
    }
});
