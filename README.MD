```
amazon-image-scraper/
├── manifest.json          # Extension configuration
├── src/
│   ├── popup/
│   │   ├── popup.html    # UI cho user input
│   │   ├── popup.js      # Logic xử lý popup
│   │   └── popup.css     # Styling
│   ├── background/
│   │   └── service-worker.js  # Background script (MV3)
│   ├── content/
│   │   ├── content-script.js  # Main content script
│   │   ├── image-parser.js    # Logic parse images
│   │   ├── ui-injector.js     # Inject selection UI
│   │   └── styles.css         # Injected styles
│   ├── shared/
│   │   ├── constants.js       # Shared constants
│   │   ├── utils.js           # Helper functions
│   │   └── api-client.js      # Webhook communication
│   └── assets/
│       └── icons/             # Extension icons
├── tests/                     # Unit tests
├── docs/                      # Documentation
└── README.md
```
New Update Structure
amazon-image-scraper/
├── manifest.json
├── src/
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── background/
│   │   └── service-worker.js
│   ├── content/
│   │   ├── content-bundle.js  ← File gộp tất cả content scripts
│   │   └── styles.css
│   ├── shared/
│   │   ├── constants.js
│   │   └── utils.js
│   └── assets/
│       └── icons/
│           ├── icon-16.png
│           ├── icon-48.png
│           └── icon-128.png