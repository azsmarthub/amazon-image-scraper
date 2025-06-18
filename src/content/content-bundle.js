// content-bundle.js - All content scripts bundled together for Chrome Extension (Part 1/2)

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
        IMAGES_EXTRACTED: 'imagesExtracted',
        SEND_SELECTED_IMAGES: 'sendSelectedImages'
    },
    
    // Patterns
    ASIN_PATTERN: /^[A-Z0-9]{10}$/,
    
    // Image URL patterns
    IMAGE_PATTERNS: {
        THUMBNAIL: /_AC_[A-Z]{2}[0-9]+_/,
        FULL_SIZE: '_AC_SL1500_',
        HIGH_RES: /_S[LX]1[0-9]{3}_/
    },
    
    // Image sizes
    IMAGE_SIZE: {
        LARGE_MIN_WIDTH: 1000,
        LARGE_MIN_HEIGHT: 1000
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

// Copy text to clipboard
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        // Fallback method
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        return true;
    }
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
