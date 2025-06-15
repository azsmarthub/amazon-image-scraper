// content-bundle.js - All content scripts bundled together for Chrome Extension

// ==================== CONSTANTS ====================
const CONSTANTS = {
    // Amazon URLs
    AMAZON_DOMAINS: [
        'amazon.com',
        'www.amazon.com',
        'smile.amazon.com'
    ],
    
    // Timing
    DEFAULT_DELAY: 3000,
    MIN_DELAY: 1000,
    MAX_DELAY: 10000,
    TAB_LOAD_TIMEOUT: 30000,
    
    // Limits
    MAX_CONCURRENT_TABS: 5,
    MAX_ASINS_PER_SESSION: 50,
    
    // Storage keys
    STORAGE_KEYS: {
        SETTINGS: 'settings',
        SESSIONS: 'sessions',
        RESULTS: 'results'
    },
    
    // Status
    SESSION_STATUS: {
        IDLE: 'idle',
        ACTIVE: 'active',
        PAUSED: 'paused',
        COMPLETE: 'complete',
        FAILED: 'failed',
        STOPPED: 'stopped'
    },
    
    // Messages
    MESSAGE_TYPES: {
        START_SCRAPING: 'startScraping',
        STOP_SCRAPING: 'stopScraping',
        CHECK_SESSION: 'checkSession',
        PROGRESS_UPDATE: 'progressUpdate',
        SESSION_COMPLETE: 'sessionComplete',
        SESSION_ERROR: 'sessionError',
        TAB_READY: 'tabReady',
        EXTRACT_IMAGES: 'extractImages',
        IMAGES_EXTRACTED: 'imagesExtracted'
    },
    
    // Patterns
    ASIN_PATTERN: /^[A-Z0-9]{10}$/,
    
    // Image URL patterns
    IMAGE_PATTERNS: {
        THUMBNAIL: /_AC_[A-Z]{2}[0-9]+_/,
        FULL_SIZE: '_AC_SL1500_'
    }
};

// ==================== UTILS ====================
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

// ==================== IMAGE PARSER ====================
// Main extraction function that tries multiple strategies
async function extractProductImages() {
    console.log('[Image Parser] Starting image extraction');
    
    const strategies = [
        { name: 'ImageBlockATF', fn: extractFromImageBlockATF },
        { name: 'ColorImages', fn: extractFromColorImages },
        { name: 'ImageBlockData', fn: extractFromImageBlockData },
        { name: 'DOM Images', fn: extractFromDOMImages },
        { name: 'Thumbnails', fn: extractFromThumbnails }
    ];
    
    let allImages = new Set();
    
    // Try each strategy
    for (const strategy of strategies) {
        try {
            console.log(`[Image Parser] Trying strategy: ${strategy.name}`);
            const images = await strategy.fn();
            
            if (images && images.length > 0) {
                console.log(`[Image Parser] ${strategy.name} found ${images.length} images`);
                images.forEach(img => allImages.add(img));
            }
        } catch (error) {
            console.error(`[Image Parser] ${strategy.name} failed:`, error);
        }
    }
    
    // Convert Set to Array and process
    let finalImages = Array.from(allImages);
    
    // Transform to high-res versions
    finalImages = finalImages.map(url => transformToHighRes(url));
    
    // Remove duplicates after transformation
    finalImages = [...new Set(finalImages)];
    
    // Sort by relevance (main images first)
    finalImages = sortImagesByRelevance(finalImages);
    
    console.log(`[Image Parser] Total unique images found: ${finalImages.length}`);
    return finalImages;
}

// Strategy 1: Extract from window.ImageBlockATF JSON
function extractFromImageBlockATF() {
    if (!window.ImageBlockATF || !window.ImageBlockATF.data) {
        return [];
    }
    
    const images = [];
    const data = window.ImageBlockATF.data;
    
    // Check for colorImages
    if (data.colorImages) {
        Object.values(data.colorImages).forEach(colorData => {
            if (Array.isArray(colorData)) {
                colorData.forEach(img => {
                    if (img.large) images.push(img.large);
                    if (img.hiRes) images.push(img.hiRes);
                });
            }
        });
    }
    
    // Check for main image
    if (data.mainImage) {
        if (data.mainImage.large) images.push(data.mainImage.large);
        if (data.mainImage.hiRes) images.push(data.mainImage.hiRes);
    }
    
    return images;
}

// Strategy 2: Extract from colorImages/imageGalleryData
function extractFromColorImages() {
    const images = [];
    
    // Try window.colorImages
    if (window.colorImages) {
        Object.values(window.colorImages).forEach(colorData => {
            if (Array.isArray(colorData)) {
                colorData.forEach(img => {
                    if (img.large) images.push(img.large);
                    if (img.hiRes) images.push(img.hiRes);
                });
            }
        });
    }
    
    // Try data-a-dynamic-image attribute
    const dynamicImages = document.querySelectorAll('[data-a-dynamic-image]');
    dynamicImages.forEach(img => {
        try {
            const data = JSON.parse(img.getAttribute('data-a-dynamic-image'));
            if (data) {
                Object.keys(data).forEach(url => images.push(url));
            }
        } catch (e) {
            // Invalid JSON
        }
    });
    
    return images;
}

// Strategy 3: Extract from inline script tags
function extractFromImageBlockData() {
    const images = [];
    const scripts = document.querySelectorAll('script');
    
    scripts.forEach(script => {
        const content = script.textContent;
        
        // Look for P.when("A").register patterns
        if (content.includes('ImageBlockATF') || content.includes('colorImages')) {
            // Extract URLs using regex
            const urlPattern = /https:\/\/[^"\s]+\.(?:jpg|jpeg|png|webp)/gi;
            const matches = content.match(urlPattern);
            
            if (matches) {
                matches.forEach(url => {
                    // Filter out tiny thumbnails
                    if (!url.includes('_SS40_') && !url.includes('_US40_')) {
                        images.push(url);
                    }
                });
            }
        }
    });
    
    return images;
}

// Strategy 4: Extract from DOM image elements
function extractFromDOMImages() {
    const images = [];
    
    // Main image container selectors
    const selectors = [
        '#imageBlock img',
        '#main-image-container img',
        '.image-wrapper img',
        '.imgTagWrapper img',
        '#altImages img',
        '.a-button-thumbnail img'
    ];
    
    selectors.forEach(selector => {
        const imgs = document.querySelectorAll(selector);
        imgs.forEach(img => {
            // Get various image sources
            const sources = [
                img.src,
                img.getAttribute('data-old-hires'),
                img.getAttribute('data-a-hires'),
                img.getAttribute('data-src')
            ];
            
            sources.forEach(src => {
                if (src && src.startsWith('http') && !src.includes('blank.gif')) {
                    images.push(src);
                }
            });
        });
    });
    
    return images;
}

// Strategy 5: Extract from thumbnail list
function extractFromThumbnails() {
    const images = [];
    
    // Find thumbnail container
    const thumbContainer = document.querySelector('#altImages, .a-button-list');
    if (!thumbContainer) return images;
    
    // Get all thumbnail items
    const thumbs = thumbContainer.querySelectorAll('.item, .a-button-thumbnail, li');
    
    thumbs.forEach(thumb => {
        // Try to find associated high-res image
        const img = thumb.querySelector('img');
        if (!img) return;
        
        // Extract from various attributes
        const possibleUrls = [
            img.src,
            thumb.getAttribute('data-old-hires'),
            thumb.getAttribute('data-a-hires')
        ];
        
        // Also check for hover data
        const hoverData = thumb.querySelector('.a-button-text img');
        if (hoverData) {
            possibleUrls.push(hoverData.getAttribute('src'));
        }
        
        possibleUrls.forEach(url => {
            if (url && url.startsWith('http')) {
                images.push(url);
            }
        });
    });
    
    return images;
}

// Transform image URL to highest resolution
function transformToHighRes(url) {
    if (!url) return url;
    
    // Already high-res
    if (url.includes('_SL1500_') || url.includes('_SX1500_')) {
        return url;
    }
    
    // Common transformations
    const transformations = [
        // Size patterns
        { pattern: /_S[XY]\d+_/, replacement: '_SL1500_' },
        { pattern: /_SL\d+_/, replacement: '_SL1500_' },
        { pattern: /_AC_U[LSF]\d+_/, replacement: '_AC_SL1500_' },
        { pattern: /_SS\d+_/, replacement: '_SL1500_' },
        { pattern: /_US\d+_/, replacement: '_SL1500_' },
        // Quality patterns
        { pattern: /\._[A-Z]{2}_\./, replacement: '.' },
        { pattern: /_AC_[A-Z]{2}\d+_/, replacement: '_AC_SL1500_' }
    ];
    
    let transformed = url;
    
    transformations.forEach(({ pattern, replacement }) => {
        if (pattern.test(transformed)) {
            transformed = transformed.replace(pattern, replacement);
        }
    });
    
    // If no pattern matched, try appending before extension
    if (transformed === url && url.match(/\.(jpg|jpeg|png|webp)/i)) {
        transformed = url.replace(/(\.[^.]+)$/, '_SL1500_$1');
    }
    
    return transformed;
}

// Sort images by relevance
function sortImagesByRelevance(images) {
    return images.sort((a, b) => {
        // Prioritize images without "CR" (customer review) in URL
        const aIsReview = a.includes('_CR');
        const bIsReview = b.includes('_CR');
        if (aIsReview && !bIsReview) return 1;
        if (!aIsReview && bIsReview) return -1;
        
        // Prioritize high-res images
        const aIsHighRes = a.includes('_SL1500_') || a.includes('_SX1500_');
        const bIsHighRes = b.includes('_SL1500_') || b.includes('_SX1500_');
        if (aIsHighRes && !bIsHighRes) return -1;
        if (!aIsHighRes && bIsHighRes) return 1;
        
        // Keep original order for others
        return 0;
    });
}

// Debug function to analyze page structure
function debugImageStructure() {
    console.group('[Image Parser Debug]');
    
    console.log('Window objects:', {
        hasImageBlockATF: !!window.ImageBlockATF,
        hasColorImages: !!window.colorImages,
        hasImageGalleryData: !!window.imageGalleryData
    });
    
    const imageElements = {
        mainImages: document.querySelectorAll('#imageBlock img').length,
        altImages: document.querySelectorAll('#altImages img').length,
        dynamicImages: document.querySelectorAll('[data-a-dynamic-image]').length
    };
    
    console.log('DOM elements:', imageElements);
    
    // Sample image URLs
    const sampleImg = document.querySelector('#landingImage, #imgBlkFront');
    if (sampleImg) {
        console.log('Sample image URL:', sampleImg.src);
        console.log('High-res version:', transformToHighRes(sampleImg.src));
    }
    
    console.groupEnd();
}

// ==================== UI INJECTOR ====================
// UI State
let uiState = {
    isVisible: false,
    container: null,
    statusElement: null
};

// Create and inject the main UI container
function createUIContainer() {
    if (uiState.container) return uiState.container;
    
    const container = document.createElement('div');
    container.id = 'amazon-scraper-ui';
    container.className = 'scraper-ui-container';
    
    container.innerHTML = `
        <div class="scraper-ui-header">
            <h3>Amazon Image Scraper</h3>
            <button class="scraper-ui-close" title="Close">×</button>
        </div>
        <div class="scraper-ui-content">
            <div class="scraper-ui-status">
                <span class="status-icon">⏳</span>
                <span class="status-text">Ready to extract images...</span>
            </div>
            <div class="scraper-ui-actions">
                <button class="scraper-btn scraper-btn-primary" id="extractBtn">
                    Extract Images
                </button>
                <button class="scraper-btn scraper-btn-secondary" id="debugBtn">
                    Debug Info
                </button>
            </div>
            <div class="scraper-ui-results" style="display: none;">
                <h4>Extracted Images: <span class="image-count">0</span></h4>
                <div class="image-preview-container"></div>
            </div>
        </div>
    `;
    
    document.body.appendChild(container);
    
    // Add event listeners
    setupUIEventListeners(container);
    
    uiState.container = container;
    return container;
}

// Setup event listeners for UI
function setupUIEventListeners(container) {
    // Close button
    const closeBtn = container.querySelector('.scraper-ui-close');
    closeBtn.addEventListener('click', hideUI);
    
    // Extract button
    const extractBtn = container.querySelector('#extractBtn');
    extractBtn.addEventListener('click', handleExtractClick);
    
    // Debug button
    const debugBtn = container.querySelector('#debugBtn');
    debugBtn.addEventListener('click', handleDebugClick);
}

// Show UI
function showUI() {
    const container = createUIContainer();
    container.classList.add('visible');
    uiState.isVisible = true;
}

// Hide UI
function hideUI() {
    if (uiState.container) {
        uiState.container.classList.remove('visible');
        uiState.isVisible = false;
    }
}

// Toggle UI visibility
function toggleUI() {
    if (uiState.isVisible) {
        hideUI();
    } else {
        showUI();
    }
}

// Handle extract button click
async function handleExtractClick() {
    updateUIStatus('extracting', 'Extracting images...');
    
    const extractBtn = document.querySelector('#extractBtn');
    extractBtn.disabled = true;
    
    try {
        // Extract images
        const images = await extractProductImages();
        
        if (images.length > 0) {
            updateUIStatus('success', `Found ${images.length} images!`);
            showImagePreviews(images);
            
            // Send to background
            chrome.runtime.sendMessage({
                action: 'productDataExtracted',
                asin: currentASIN,
                data: {
                    images: images,
                    title: document.querySelector('#productTitle')?.textContent.trim() || '',
                    url: window.location.href
                }
            });
        } else {
            updateUIStatus('error', 'No images found');
        }
    } catch (error) {
        updateUIStatus('error', `Error: ${error.message}`);
    } finally {
        extractBtn.disabled = false;
    }
}

// Handle debug button click
function handleDebugClick() {
    debugImageStructure();
    updateUIStatus('info', 'Debug info logged to console');
}

// Update UI status
function updateUIStatus(type, message) {
    const statusEl = document.querySelector('.scraper-ui-status');
    if (!statusEl) return;
    
    const iconMap = {
        ready: '⏳',
        extracting: '🔄',
        success: '✅',
        error: '❌',
        info: 'ℹ️'
    };
    
    statusEl.className = `scraper-ui-status status-${type}`;
    statusEl.querySelector('.status-icon').textContent = iconMap[type] || '⏳';
    statusEl.querySelector('.status-text').textContent = message;
}

// Show image previews (basic version for Phase 2)
function showImagePreviews(images) {
    const resultsEl = document.querySelector('.scraper-ui-results');
    const containerEl = document.querySelector('.image-preview-container');
    const countEl = document.querySelector('.image-count');
    
    if (!resultsEl || !containerEl) return;
    
    // Update count
    countEl.textContent = images.length;
    
    // Clear existing previews
    containerEl.innerHTML = '';
    
    // Show first 6 images as preview
    const previewImages = images.slice(0, 6);
    
    previewImages.forEach((url, index) => {
        const preview = document.createElement('div');
        preview.className = 'image-preview-item';
        preview.innerHTML = `
            <img src="${url}" alt="Product image ${index + 1}" loading="lazy">
            <span class="image-number">${index + 1}</span>
        `;
        containerEl.appendChild(preview);
    });
    
    // Show results section
    resultsEl.style.display = 'block';
}

// Create floating action button
function createFloatingButton() {
    const button = document.createElement('button');
    button.id = 'scraper-floating-btn';
    button.className = 'scraper-floating-button';
    button.innerHTML = '🖼️';
    button.title = 'Amazon Image Scraper';
    
    button.addEventListener('click', toggleUI);
    
    document.body.appendChild(button);
    return button;
}

// Initialize UI when needed
function initializeUI() {
    // Create floating button
    createFloatingButton();
    
    // Listen for keyboard shortcut (Ctrl+Shift+I)
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'I') {
            e.preventDefault();
            toggleUI();
        }
    });
}

// ==================== MAIN CONTENT SCRIPT ====================
// State
let currentASIN = null;
let extractedData = null;
let isProcessing = false;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

function initialize() {
    console.log('[Amazon Scraper] Content script initialized');
    
    // Check if this is a product page
    if (!isProductPage()) {
        console.log('[Amazon Scraper] Not a product page, skipping');
        return;
    }
    
    // Extract ASIN from URL
    currentASIN = extractASINFromCurrentPage();
    if (!currentASIN) {
        console.error('[Amazon Scraper] Could not extract ASIN from page');
        return;
    }
    
    console.log('[Amazon Scraper] Found ASIN:', currentASIN);
    
    // Initialize UI
    initializeUI();
    
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener(handleMessage);
    
    // Auto-extract if page was opened by extension
    checkAndAutoExtract();
}

// Check if current page is an Amazon product page
function isProductPage() {
    const url = window.location.href;
    return url.includes('/dp/') || url.includes('/gp/product/');
}

// Extract ASIN from current page
function extractASINFromCurrentPage() {
    // Try URL first
    const urlASIN = extractASINFromUrl(window.location.href);
    if (urlASIN) return urlASIN;
    
    // Try page elements
    const asinElement = document.querySelector('[data-asin]');
    if (asinElement) return asinElement.getAttribute('data-asin');
    
    // Try canonical URL
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
        const canonicalASIN = extractASINFromUrl(canonical.href);
        if (canonicalASIN) return canonicalASIN;
    }
    
    return null;
}

// Handle messages from background script
async function handleMessage(request, sender, sendResponse) {
    console.log('[Amazon Scraper] Received message:', request.action);
    
    switch (request.action) {
        case 'extractImages':
            if (!isProcessing) {
                isProcessing = true;
                const result = await extractProductData();
                isProcessing = false;
                sendResponse(result);
            } else {
                sendResponse({ success: false, error: 'Already processing' });
            }
            break;
            
        case 'getStatus':
            sendResponse({
                ready: !isProcessing,
                asin: currentASIN,
                hasData: !!extractedData
            });
            break;
            
        default:
            sendResponse({ success: false, error: 'Unknown action' });
    }
    
    return true; // Keep message channel open
}

// Check if we should auto-extract (when opened by extension)
async function checkAndAutoExtract() {
    // Check if tab was opened by our extension
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'checkTabStatus',
            asin: currentASIN
        });
        
        if (response && response.shouldExtract) {
            console.log('[Amazon Scraper] Auto-extracting for ASIN:', currentASIN);
            // Small delay to ensure page is fully loaded
            setTimeout(() => {
                extractAndSend();
            }, 1000);
        }
    } catch (error) {
        // Extension might not be expecting this tab
        console.log('[Amazon Scraper] Tab not managed by extension');
    }
}

// Extract product data and send to background
async function extractAndSend() {
    if (isProcessing) return;
    
    isProcessing = true;
    const result = await extractProductData();
    isProcessing = false;
    
    if (result.success) {
        // Send to background script
        try {
            await chrome.runtime.sendMessage({
                action: 'productDataExtracted',
                asin: currentASIN,
                data: result.data
            });
            
            // Show success indicator
            showExtractionStatus('success', `Extracted ${result.data.images.length} images`);
        } catch (error) {
            console.error('[Amazon Scraper] Failed to send data:', error);
            showExtractionStatus('error', 'Failed to send data');
        }
    } else {
        showExtractionStatus('error', result.error || 'Extraction failed');
    }
}

// Main extraction function
async function extractProductData() {
    try {
        console.log('[Amazon Scraper] Starting extraction for ASIN:', currentASIN);
        
        // Wait a bit for dynamic content
        await waitForContent();
        
        // Extract basic product info
        const productInfo = extractProductInfo();
        
        // Extract images using parser
        const images = await extractAllImages();
        
        if (images.length === 0) {
            throw new Error('No images found');
        }
        
        // Prepare data
        extractedData = {
            asin: currentASIN,
            title: productInfo.title,
            url: window.location.href,
            images: images,
            mainImage: images[0] || null,
            timestamp: new Date().toISOString(),
            metadata: {
                price: productInfo.price,
                brand: productInfo.brand,
                category: productInfo.category,
                imageCount: images.length
            }
        };
        
        console.log('[Amazon Scraper] Extraction complete:', extractedData);
        
        return {
            success: true,
            data: extractedData
        };
        
    } catch (error) {
        console.error('[Amazon Scraper] Extraction failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Extract basic product information
function extractProductInfo() {
    const info = {
        title: '',
        price: '',
        brand: '',
        category: ''
    };
    
    // Title
    const titleElement = document.querySelector('#productTitle, h1.a-size-large');
    if (titleElement) {
        info.title = titleElement.textContent.trim();
    }
    
    // Price
    const priceElement = document.querySelector('.a-price-whole, #priceblock_dealprice, #priceblock_ourprice');
    if (priceElement) {
        info.price = priceElement.textContent.trim();
    }
    
    // Brand
    const brandElement = document.querySelector('#bylineInfo, .po-brand .po-break-word');
    if (brandElement) {
        info.brand = brandElement.textContent.replace('Brand:', '').replace('Visit the', '').trim();
    }
    
    // Category
    const categoryElement = document.querySelector('#wayfinding-breadcrumbs_feature_div .a-list-item:last-child');
    if (categoryElement) {
        info.category = categoryElement.textContent.trim();
    }
    
    return info;
}

// Wait for dynamic content to load
async function waitForContent() {
    // Wait for main image container
    const maxWait = 5000; // 5 seconds max
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
        const hasImages = document.querySelector('#imageBlock, #main-image-container, .imgTagWrapper');
        const hasJSON = window.ImageBlockATF || window.colorImages;
        
        if (hasImages || hasJSON) {
            console.log('[Amazon Scraper] Content ready');
            return;
        }
        
        await delay(100);
    }
    
    console.warn('[Amazon Scraper] Timeout waiting for content');
}

// Show extraction status on page
function showExtractionStatus(type, message) {
    // Remove any existing status
    const existing = document.querySelector('.scraper-status');
    if (existing) existing.remove();
    
    // Create status element
    const status = document.createElement('div');
    status.className = `scraper-status scraper-status-${type}`;
    status.textContent = `Amazon Scraper: ${message}`;
    
    document.body.appendChild(status);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        status.remove();
    }, 3000);
}

// Utility: Extract all images
async function extractAllImages() {
    // This will use the image-parser.js functions
    return await extractProductImages();
}