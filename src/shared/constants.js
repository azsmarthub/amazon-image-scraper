// constants.js - Shared constants across the extension

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

// Make available globally for service worker
if (typeof window === 'undefined') {
    // In service worker context
    self.CONSTANTS = CONSTANTS;
}