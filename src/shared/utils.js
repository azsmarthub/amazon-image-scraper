// utils.js - Shared utility functions

// Generate unique session ID
function generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Delay function
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Validate ASIN format
function isValidASIN(asin) {
    return /^[A-Z0-9]{10}$/.test(asin);
}

// Parse ASINs from text input
function parseASINs(text) {
    return text
        .split(/[\n,;]+/)
        .map(asin => asin.trim().toUpperCase())
        .filter(asin => isValidASIN(asin));
}

// Format bytes to human readable
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Get current timestamp
function getTimestamp() {
    return new Date().toISOString();
}

// Deep clone object
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// Chunk array into smaller arrays
function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

// Retry function with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (i < maxRetries - 1) {
                const delay = baseDelay * Math.pow(2, i);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw lastError;
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Safe JSON parse
function safeJsonParse(str, defaultValue = null) {
    try {
        return JSON.parse(str);
    } catch (error) {
        return defaultValue;
    }
}

// Create Amazon product URL
function createAmazonUrl(asin, domain = 'amazon.com', zipCode = null) {
    let url = `https://www.${domain}/dp/${asin}`;
    if (zipCode) {
        url += `?zip=${zipCode}`;
    }
    return url;
}

// Extract ASIN from Amazon URL
function extractASINFromUrl(url) {
    const patterns = [
        /\/dp\/([A-Z0-9]{10})/,
        /\/gp\/product\/([A-Z0-9]{10})/,
        /\/ASIN\/([A-Z0-9]{10})/
    ];
    
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    
    return null;
}

// Make utilities available globally
if (typeof window === 'undefined') {
    // In service worker context
    self.generateSessionId = generateSessionId;
    self.delay = delay;
    self.isValidASIN = isValidASIN;
    self.parseASINs = parseASINs;
    self.formatBytes = formatBytes;
    self.getTimestamp = getTimestamp;
    self.deepClone = deepClone;
    self.chunkArray = chunkArray;
    self.retryWithBackoff = retryWithBackoff;
    self.debounce = debounce;
    self.safeJsonParse = safeJsonParse;
    self.createAmazonUrl = createAmazonUrl;
    self.extractASINFromUrl = extractASINFromUrl;
}