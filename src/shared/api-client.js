// api-client.js - Webhook client with retry logic

class WebhookClient {
    constructor() {
        this.maxRetries = 3;
        this.retryDelay = 1000; // Start with 1 second
    }
    
    // Send data to webhook with retry
    async send(webhookUrl, payload) {
        let lastError = null;
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`[Webhook] Attempt ${attempt}/${this.maxRetries}`);
                
                const response = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Extension': 'Amazon-Image-Scraper',
                        'X-Attempt': attempt.toString()
                    },
                    body: JSON.stringify(payload)
                });
                
                if (response.ok) {
                    console.log('[Webhook] Success!');
                    return {
                        success: true,
                        status: response.status,
                        attempt: attempt
                    };
                }
                
                // HTTP error
                lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
                
                // Don't retry on client errors (4xx)
                if (response.status >= 400 && response.status < 500) {
                    console.error('[Webhook] Client error, not retrying:', lastError);
                    break;
                }
                
            } catch (error) {
                // Network error
                lastError = error;
                console.error(`[Webhook] Attempt ${attempt} failed:`, error);
            }
            
            // Wait before retry (exponential backoff)
            if (attempt < this.maxRetries) {
                const delay = this.retryDelay * Math.pow(2, attempt - 1);
                console.log(`[Webhook] Waiting ${delay}ms before retry...`);
                await this.delay(delay);
            }
        }
        
        // All attempts failed
        console.error('[Webhook] All attempts failed:', lastError);
        
        // Store failed webhook for manual retry
        await this.storeFailedWebhook(webhookUrl, payload, lastError);
        
        return {
            success: false,
            error: lastError.message,
            attempts: this.maxRetries
        };
    }
    
    // Store failed webhook data
    async storeFailedWebhook(webhookUrl, payload, error) {
        try {
            const failedWebhooks = await this.getFailedWebhooks();
            
            // Add new failed webhook
            failedWebhooks.push({
                id: Date.now(),
                timestamp: new Date().toISOString(),
                webhookUrl: webhookUrl,
                payload: payload,
                error: error.message
            });
            
            // Keep only last 10 failed webhooks
            if (failedWebhooks.length > 10) {
                failedWebhooks.shift();
            }
            
            await chrome.storage.local.set({ failedWebhooks });
            console.log('[Webhook] Stored failed webhook for retry');
            
        } catch (err) {
            console.error('[Webhook] Failed to store webhook data:', err);
        }
    }
    
    // Get failed webhooks
    async getFailedWebhooks() {
        const data = await chrome.storage.local.get(['failedWebhooks']);
        return data.failedWebhooks || [];
    }
    
    // Retry a failed webhook
    async retryFailedWebhook(webhookId) {
        const failedWebhooks = await this.getFailedWebhooks();
        const webhook = failedWebhooks.find(w => w.id === webhookId);
        
        if (!webhook) {
            throw new Error('Webhook not found');
        }
        
        // Retry with original data
        const result = await this.send(webhook.webhookUrl, webhook.payload);
        
        if (result.success) {
            // Remove from failed list
            const updatedWebhooks = failedWebhooks.filter(w => w.id !== webhookId);
            await chrome.storage.local.set({ failedWebhooks: updatedWebhooks });
        }
        
        return result;
    }
    
    // Clear all failed webhooks
    async clearFailedWebhooks() {
        await chrome.storage.local.set({ failedWebhooks: [] });
    }
    
    // Utility: delay function
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export for use in service worker
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebhookClient;
}
