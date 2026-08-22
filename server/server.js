const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const { execSync, exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// =============================================================================
// AUTHENTICATION & SECURITY MODULES
// =============================================================================

const session = require('express-session');
const rateLimit = require('express-rate-limit');

// =============================================================================
// ⭐ AUTHENTICATION CONFIGURATION - EDIT YOUR CREDENTIALS HERE!
// =============================================================================
// TODO: Change these values to your desired username and password
// You can also change the session secret to any random string

const AUTH_CONFIG = {
    username: 'admin',                    // ← CHANGE THIS: Your login username
    password: 'password123',              // ← CHANGE THIS: Your login password  
    sessionSecret: 'ytl-secret-key-2024',  // ← CHANGE THIS: Any random string (for sessions)
    
    // Session settings (you probably don't need to change these)
    sessionMaxAge: 2 * 24 * 60 * 60 * 1000,  // 2 days in milliseconds (172800000ms)
    cookieFilePath: path.join(process.cwd(), 'cookies.txt'),
    browserName: 'edge' // chrome, firefox, edge, safari
};

// Validate auth config on startup (basic check)
function validateAuthConfig() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🔐 Authentication Configuration                              ║
╠══════════════════════════════════════════════════════════════╣
║  Username: ${AUTH_CONFIG.username}
║  Password: ${'*'.repeat(AUTH_CONFIG.password.length)} (hidden)
║  Session Duration: ${(AUTH_CONFIG.sessionMaxAge / (1000 * 60 * 60 * 24)).toFixed(1)} days
║                                                              ║
║  💡 To change credentials, edit this file (server.js)       ║
║     and modify the AUTH_CONFIG object above                 ║
╚══════════════════════════════════════════════════════════════╝
    `);
    
    // Optional: Warn if using default credentials
    if (AUTH_CONFIG.username === 'admin' && AUTH_CONFIG.password === 'password123') {
        console.warn('⚠️  WARNING: You are using default credentials!');
        console.warn('   It is recommended to change them in server.js for better security.\n');
    }
}

// =============================================================================
// PATH CONVERSION - Convert Cygwin/Unix paths to Native OS paths
// =============================================================================

function toNativePath(unixStylePath) {
    // If already a native Windows path (starts with drive letter), return as-is
    if (/^[A-Za-z]:\\/.test(unixStylePath) || /^[A-Za-z]:\//.test(unixStylePath)) {
        return unixStylePath;
    }
    
    // Convert Cygwin/MSYS paths (/c/Users/... -> C:\Users\...)
    if (unixStylePath.startsWith('/') && unixStylePath.length >= 3 && 
        /^[a-zA-Z]/.test(unixStylePath.charAt(1))) {
        // Looks like /c/path or /d/path - convert to C:\path or D:\path
        const driveLetter = unixStylePath.charAt(1).toUpperCase();
        const restOfPath = unixStylePath.slice(2).replace(/\//g, '\\');
        const windowsPath = driveLetter + ':\\' + restOfPath;
        
        console.log('[Path Conversion] Cygwin -> Windows:');
        console.log('   FROM:', unixStylePath);
        console.log('   TO:  ', windowsPath);
        
        return windowsPath;
    }
    
    // For other Unix-style paths, use path.resolve to get absolute path
    const resolved = path.resolve(unixStylePath);
    console.log('[Path Conversion] Resolved:', unixStylePath, '->', resolved);
    
    return resolved;
}

function findIndexHtml() {
    const possiblePaths = [
        path.join(__dirname, '../public/index.html'),
        path.join(__dirname, '../../public/index.html'),
        path.join(process.cwd(), '../public/index.html'),
        path.join(process.cwd(), 'public/index.html'),
    ];
    
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) { 
            console.log('[findIndexHtml] FOUND:', p); 
            return p; 
        }
    }
    
    console.log('[findIndexHtml] NOT FOUND in any location');
    return null;
}

function resolvePublicPath(relativePath) {
    const possiblePaths = [
        path.join(__dirname, '../public', relativePath),
        path.join(process.cwd(), '..', 'public', relativePath),
        path.resolve(__dirname, '..', 'public', relativePath),
    ];
    
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) return p;
    }
    
    return possiblePaths[0];
}

// =============================================================================
// COOKIE MANAGEMENT - Smart detection and fallback
// =============================================================================

function getNativeCookiePath() {
    const originalPath = AUTH_CONFIG.cookieFilePath;
    const nativePath = toNativePath(originalPath);
    
    // Update config with native path
    AUTH_CONFIG.cookieFilePath = nativePath;
    
    console.log('[Cookie Path] Original:', originalPath);
    console.log('[Cookie Path] Native:   ', nativePath);
    
    return nativePath;
}

/**
 * Check if cookies.txt exists and appears valid - WITH DETAILED LOGGING
 * @returns {boolean} true if cookies.txt can be used
 */
function isCookiesFileValid() {
    console.log('\n[isCookiesFileValid] Starting validation...');
    const cookiePath = AUTH_CONFIG.cookieFilePath;
    console.log('[isCookiesFileValid] Checking path:', cookiePath);
    
    // Check if path is defined
    if (!cookiePath) {
        console.log('[isCookiesFileValid] ❌ FAIL: Cookie path is undefined/null!');
        return false;
    }
    
    // Check if file exists
    console.log('[isCookiesFileValid] Checking if file exists...');
    const exists = fs.existsSync(cookiePath);
    console.log('[isCookiesFileValid] File exists?', exists);
    
    if (!exists) {
        console.log('[isCookiesFileValid] ❌ FAIL: File does not exist:', cookiePath);
        console.log('[isCookiesFileValid] 💡 TIP: Delete bad cookies.txt or export fresh ones');
        return false;
    }
    
    // Check if file has content
    try {
        console.log('[isCookiesFileValid] Reading file stats...');
        const stats = fs.statSync(cookiePath);
        console.log('[isCookiesFileValid] File size:', stats.size, 'bytes');
        
        if (stats.size === 0) {
            console.log('[isCookiesFileValid] ❌ FAIL: File is empty!');
            return false;
        }
        
        // Read first few lines to check format
        console.log('[isCookiesFileValid] Reading file content...');
        const content = fs.readFileSync(cookiePath, 'utf8');
        console.log('[isCookiesFileValid] Content length:', content.length, 'chars');
        
        const allLines = content.split('\n');
        console.log('[isCookiesFileValid] Total lines (including empty/comments):', allLines.length);
        
        const lines = allLines.filter(line => line.trim() && !line.startsWith('#'));
        console.log('[isCookiesFileValid] Data lines (non-empty, non-comment):', lines.length);
        
        if (lines.length === 0) {
            console.log('[isCookiesFileValid] ❌ FAIL: No cookie entries found (only comments/empty lines)');
            console.log('[isCookiesFileValid] First few lines of file:');
            allLines.slice(0, 5).forEach((line, i) => console.log(`   Line ${i}:`, line.substring(0, 100)));
            return false;
        }
        
        // Show first few data lines for debugging
        console.log('[isCookiesFileValid] First 3 data lines:');
        lines.slice(0, 3).forEach((line, i) => {
            const fields = line.split('\t');
            console.log(`   Data line ${i}: ${fields.length} fields`);
            console.log('      Raw:', line.substring(0, 120));
        });
        
        // Validate at least one line has correct Netscape format (7 tab-separated fields)
        const sampleLine = lines[0];
        const fields = sampleLine.split('\t');
        
        console.log('[isCookiesFileValid] Validating Netscape format...');
        console.log('[isCookiesFileValid] Expected: 7 tab-separated fields');
        console.log('[isCookiesFileValid] Actual:', fields.length, 'fields');
        
        if (fields.length < 7) {
            console.log('\n[isCookiesFileValid] ❌ INVALID FORMAT DETECTED!');
            console.log('[isCookiesFileValid] This is why channel loading fails with cookies.txt!');
            console.log('[isCookiesFileValid] Problem: Lines have only', fields.length, 'fields instead of 7');
            console.log('[isCookiesFileValid] Root cause: Python extractor produced corrupted cookies');
            console.log('[isCookiesFileValid] Solution: Server will fall back to browser cookies automatically');
            console.log('\n[isCookiesFileValid] Field breakdown of first line:');
            fields.forEach((field, i) => {
                console.log(`   Field ${i}: [${field.substring(0, 50)}]`);
            });
            return false;
        }
        
        console.log('\n[isCookiesFileValid] ✅ PASS: Valid Netscape format!');
        console.log('[isCookiesFileValid] Found', lines.length, 'cookies in correct format');
        console.log('[isCookiesFileValid] Cookies file can be used safely');
        return true;
        
    } catch (err) {
        console.log('[isCookiesFileValid] ❌ EXCEPTION during validation:');
        console.log('   Error name:', err.name);
        console.log('   Error message:', err.message);
        console.log('   Error code:', err.code);
        return false;
    }
}

/**
 * Build MULTIPLE yt-dlp commands with different cookie strategies
 * Returns array of commands to try in order of preference
 * @param {string} baseUrl - The base yt-dlp command (without cookie args)
 * @param {string} url - The URL to process
 * @returns {Array} Array of {cmd, description} objects to try in sequence
 */
function buildCommandsWithCookieStrategies(baseUrl, url) {
    console.log('\n[buildCommands] Building command strategies...');
    console.log('[buildCommands] Input URL:', url);
    
    // Ensure we have native path
    getNativeCookiePath();
    
    const strategies = [];
    
    // Strategy 1: No cookies at all (works for most public channels!)
    const noCookiesCmd = baseUrl + ' "' + url + '"';
    strategies.push({
        cmd: noCookiesCmd,
        description: 'No cookies (public access)',
        type: 'none'
    });
    console.log('[commands] Strategy 1: No cookies (fastest, works for public channels)');
    
    // Strategy 2: Use cookies.txt if available and looks valid
    const cookiesValid = isCookiesFileValid();
    if (cookiesValid && fs.existsSync(AUTH_CONFIG.cookieFilePath)) {
        const cookiesCmd = baseUrl + ' --cookies "' + AUTH_CONFIG.cookieFilePath + '" "' + url + '"';
        strategies.push({
            cmd: cookiesCmd,
            description: 'cookies.txt file',
            type: 'file'
        });
        console.log('[commands] Strategy 2: cookies.txt file');
    } else {
        console.log('[commands] Strategy 2: SKIPPED (cookies.txt invalid or missing)');
    }
    
    // Strategy 3: Browser-based extraction (may fail on Windows due to DPAPI)
    const browser = AUTH_CONFIG.browserName || 'edge';
    const browserCmd = baseUrl + ' --cookies-from-browser ' + browser + ' "' + url + '"';
    strategies.push({
        cmd: browserCmd,
        description: `Browser (${browser})`,
        type: 'browser'
    });
    console.log('[commands] Strategy 3: Browser fallback (' + browser + ')');
    
    console.log('[commands] Total strategies prepared:', strategies.length);
    
    return strategies;
}

/**
 * Execute a command with automatic retry using different strategies
 * @param {Array} strategies - Array of {cmd, description} from buildCommandsWithCookieStrategies
 * @param {number} currentIndex - Current strategy index to try
 * @param {Function} onSuccess - Callback on success(stdout)
 * @param {Function} onError - Callback when all strategies fail(error)
 */
function executeWithRetry(strategies, currentIndex, onSuccess, onError) {
    if (currentIndex >= strategies.length) {
        onError(new Error('All cookie strategies failed'));
        return;
    }
    
    const strategy = strategies[currentIndex];
    console.log('\n[executeWithRetry] Trying strategy', currentIndex + 1, '/', strategies.length + ':', strategy.description);
    console.log('[executeWithRetry] Command:', strategy.cmd.substring(0, 150) + '...');
    
    const startTime = Date.now();
    
    exec(strategy.cmd, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        
        if (error) {
            console.log('[executeWithRetry] ❌ Strategy', currentIndex + 1, 'failed in', elapsed, 's:', strategy.description);
            
            // Check if error is cookie-related (try next strategy)
            const isCookieError = 
                error.message.includes('invalid Netscape format') ||
                error.message.includes('CookieLoadError') ||
                error.message.includes('failed to load cookies') ||
                error.message.includes('DPAPI') ||
                error.message.includes('decrypt') ||
                stderr.includes('invalid Netscape') ||
                stderr.includes('DPAPI') ||
                stderr.includes('decrypt');
            
            if (isCookieError && currentIndex < strategies.length - 1) {
                console.log('[executeWithRetry] 🔄 Cookie-related error detected, trying next strategy...');
                
                // Show partial stderr (not full traceback)
                if (stderr) {
                    const firstLine = stderr.split('\n').find(l => l.trim().startsWith('ERROR:'));
                    if (firstLine) {
                        console.log('[executeWithRetry] Error hint:', firstLine.trim());
                    }
                }
                
                // Try next strategy
                executeWithRetry(strategies, currentIndex + 1, onSuccess, onError);
                return;
            }
            
            // Non-cookie error or last strategy - fail completely
            console.log('[executeWithRetry] ❌ All strategies exhausted or non-recoverable error');
            if (stderr) {
                console.log('[executeWithRetry] Final error (first 500 chars):', stderr.substring(0, 500));
            }
            onError(error);
        } else {
            console.log('[executeWithRetry] ✅ Strategy', currentIndex + 1, 'succeeded in', elapsed, 's:', strategy.description);
            onSuccess(stdout);
        }
    });
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const PORT = process.env.PORT || 3000;

// ⭐ FIXED: Default download folder - C:\Users\Jackle\Downloads for Windows
function getDefaultDownloadsDir() {
    // If environment variable is set, use it
    if (process.env.DOWNLOADS_DIR) {
        return process.env.DOWNLOADS_DIR;
    }
    
    // Detect OS and set appropriate default
    const os = process.platform;
    if (os === 'win32') {
        // Windows: Use user's Downloads folder with YouTube-Downloader subfolder (default: Jackle)
        const username = process.env.USERNAME || 'Jackle';
        return `C:\\Users\\${username}\\Downloads\\YouTube-Downloader`;
    } else if (os === 'darwin') {
        // macOS: Use Downloads folder with YouTube-Downloader subfolder
        const home = process.env.HOME || '/Users/' + (process.env.USER || 'user');
        return path.join(home, 'Downloads', 'YouTube-Downloader');
    } else {
        // Linux/Other: Use ~/Downloads/YouTube-Downloader or fallback to ./downloads
        const home = process.env.HOME || process.cwd();
        const downloadsPath = path.join(home, 'Downloads', 'YouTube-Downloader');
        // If ~/Downloads/YouTube-Downloader exists, use it; otherwise use ./downloads
        try {
            if (fs.existsSync(downloadsPath)) {
                return downloadsPath;
            }
        } catch (e) {}
        return path.join(process.cwd(), 'downloads');
    }
}

const DOWNLOADS_DIR = getDefaultDownloadsDir();

// ⭐ NEW: Function to get channel-specific download directory
function getChannelDownloadDir(channelName) {
    // Sanitize channel name for use as folder name (remove invalid characters)
    const safeChannelName = (channelName || 'Unknown_Channel')
        .replace(/[:"/\\|?*]/g, '_')  // Replace invalid chars
        .replace(/\s+/g, '_')              // Replace spaces with underscores
        .substring(0, 100);                 // Limit length
    
    const channelDir = path.join(DOWNLOADS_DIR, safeChannelName);
    
    // Create channel directory if it doesn't exist
    if (!fs.existsSync(channelDir)) {
        fs.mkdirSync(channelDir, { recursive: true });
        console.log('[Init] Created channel directory:', channelDir);
    }
    
    return channelDir;
}

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    console.log('[Init] Created downloads directory:', DOWNLOADS_DIR);
}

// FFmpeg availability check
let FFMPEG_AVAILABLE = false;
try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
    FFMPEG_AVAILABLE = true;
    console.log('[Init] ✅ FFmpeg is available');
} catch (e) {
    console.log('[Init] ⚠️ FFmpeg not found - using fallback download method');
}

// =============================================================================
// IN-MEMORY STORAGE
// =============================================================================

const savedChannels = new Map();

// ⭐ NEW: Server-side log buffer for terminal output viewing
const serverLogBuffer = [];
const MAX_SERVER_LOGS = 500; // Keep last 500 log entries

/**
 * Capture console.log output to buffer for API access
 */
const originalConsoleLog = console.log;
console.log = function(...args) {
    // Call original console.log for terminal output
    originalConsoleLog.apply(console, args);
    
    // Also store in our buffer
    const timestamp = new Date().toISOString();
    const message = args.map(arg => {
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg, null, 2);
            } catch (e) {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ');
    
    serverLogBuffer.push({
        time: timestamp,
        message: message,
        type: message.includes('❌') || message.includes('ERROR') ? 'error' : 
              message.includes('✅') || message.includes('success') ? 'success' :
              message.includes('⚠️') || message.includes('warning') ? 'warning' :
              message.includes('⬇️') || message.includes('▶️') ? 'progress' : 'info'
    });
    
    // Keep only last MAX_SERVER_LOGS entries
    if (serverLogBuffer.length > MAX_SERVER_LOGS) {
        serverLogBuffer.shift();
    }
};

// Also capture console.error
const originalConsoleError = console.error;
console.error = function(...args) {
    originalConsoleError.apply(console, args);
    
    const timestamp = new Date().toISOString();
    const message = args.map(arg => String(arg)).join(' ');
    
    serverLogBuffer.push({
        time: timestamp,
        message: '[ERROR] ' + message,
        type: 'error'
    });
    
    if (serverLogBuffer.length > MAX_SERVER_LOGS) {
        serverLogBuffer.shift();
    }
};
const downloadManager = {
    downloads: new Map(),
    
    add(download) {
        this.downloads.set(download.id, download);
        return download;
    },
    
    get(id) {
        return this.downloads.get(id);
    },
    
    update(id, updates) {
        const download = this.downloads.get(id);
        if (download) {
            Object.assign(download, updates);
        }
        return download;
    },
    
    remove(id) {
        return this.downloads.delete(id);
    },
    
    getAll() {
        return Array.from(this.downloads.values());
    },
    
    getActive() {
        return this.getAll().filter(d => d.status === 'downloading' || d.status === 'queued');
    },
    
    getCompleted() {
        return this.getAll().filter(d => d.status === 'completed' || d.status === 'skipped');
    }
};

// =============================================================================
// FILENAME DUPLICATE HANDLER (MODIFICATION 3)
// =============================================================================

/**
 * Generates a unique filename by appending -1, -2, etc. if file exists
 * @param {string} directory - Target directory
 * @param {string} originalFilename - Original filename (e.g., "video.mp4")
 * @returns {string} - Safe filename (e.g., "video-1.mp4", "video-2.mp4")
 */
function getUniqueFilename(directory, originalFilename) {
    const ext = path.extname(originalFilename);           // ".mp4"
    const baseName = path.basename(originalFilename, ext); // "video"
    
    let finalFilename = originalFilename;
    let counter = 1;
    
    while (fs.existsSync(path.join(directory, finalFilename))) {
        finalFilename = `${baseName}-${counter}${ext}`;
        counter++;
        
        // Safety limit to prevent infinite loops
        if (counter > 1000) {
            console.warn('[Filename] Counter exceeded 1000, using timestamp');
            finalFilename = `${baseName}-${Date.now()}${ext}`;
            break;
        }
    }
    
    if (counter > 1) {
        console.log(`[Filename] Duplicate detected: "${originalFilename}" → "${finalFilename}"`);
    }
    
    return finalFilename;
}

// =============================================================================
// DUPLICATE TITLE HANDLER - Append duration to duplicate video titles
// =============================================================================

/**
 * Convert duration from seconds to human-readable format (21m-26s)
 * @param {number|null} seconds - Duration in seconds
 * @returns {string} Formatted duration like "21m-26s" or "" if not available
 */
function formatDurationForDisplay(seconds) {
    if (!seconds || seconds <= 0) {
        return '';
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    
    // Format: 21m-26s
    if (minutes > 0 && remainingSeconds > 0) {
        return `${minutes}m-${remainingSeconds}s`;
    } else if (minutes > 0) {
        return `${minutes}m`;
    } else {
        return `${remainingSeconds}s`;
    }
}

/**
 * Sanitize text for safe filename usage
 * Replaces special characters with safe alternatives
 * @param {string} text - Original text
 * @returns {string} Sanitized filename-safe text
 */
function sanitizeFilename(text) {
    if (!text) return 'untitled';
    
    return text
        .replace(/[<>:"/\\|?*]/g, '-')  // Replace illegal chars with dash
        .replace(/\s+/g, ' ')            // Collapse multiple spaces
        .trim()
        .substring(0, 200);              // Limit length for filesystem safety
}

/**
 * Process video list to detect and handle duplicate titles
 * Appends duration to duplicate titles to make them unique
 * 
 * @param {Array} videos - Array of video objects with title and duration
 * @returns {Array} Processed videos with displayTitle and downloadFilename added
 */
function processDuplicateTitles(videos) {
    if (!videos || videos.length === 0) {
        return [];
    }
    
    console.log('\n[Duplicate Titles] Processing', videos.length, 'videos for duplicates...');
    
    // Step 1: Count occurrences of each title (case-insensitive)
    const titleCount = {};
    videos.forEach(video => {
        const normalizedTitle = (video.title || '').toLowerCase().trim();
        titleCount[normalizedTitle] = (titleCount[normalizedTitle] || 0) + 1;
    });
    
    // Count how many titles are duplicated
    const duplicateTitles = Object.entries(titleCount).filter(([title, count]) => count > 1);
    console.log('[Duplicate Titles] Found', duplicateTitles.length, 'duplicate title(s):');
    duplicateTitles.forEach(([title, count]) => {
        console.log('   - "' + title + '" appears', count, 'times');
    });
    
    // Step 2: Track which durations we've used for each title (to handle edge case of same title + same duration)
    const titleDurationUsage = {};
    
    // Step 3: Process each video
    const processedVideos = videos.map((video, index) => {
        const originalTitle = video.title || 'Untitled';
        const normalizedTitle = originalTitle.toLowerCase().trim();
        const isDuplicate = titleCount[normalizedTitle] > 1;
        
        // Create base processed video object
        const processedVideo = {
            ...video,
            originalTitle: originalTitle,
            displayTitle: originalTitle,      // What frontend shows
            downloadFilename: null           // What file will be named (set on download)
        };
        
        // Only append duration if this is a duplicate title AND has duration available
        if (isDuplicate && video.duration) {
            const durationStr = formatDurationForDisplay(video.duration);
            
            if (durationStr) {
                // Create unique key for this title+duration combo
                const titleDurationKey = `${normalizedTitle}|${durationStr}`;
                
                // Check if we've already used this exact title+duration combination
                if (!titleDurationUsage[titleDurationKey]) {
                    titleDurationUsage[titleDurationKey] = 1;
                } else {
                    // Same title AND same duration - add counter as fallback
                    titleDurationUsage[titleDurationKey]++;
                }
                
                const usageCount = titleDurationUsage[titleDurationKey];
                
                // Build display title: "Original Title (21m-26s)"
                processedVideo.displayTitle = `${originalTitle} (${durationStr})`;
                
                // Build download filename: "original-title-(21m-26s).mp4"
                const sanitizedBase = sanitizeFilename(originalTitle);
                if (usageCount > 1) {
                    // Edge case: same title + same duration, add counter
                    processedVideo.downloadFilename = `${sanitizedBase}-(${durationStr})-${usageCount}.mp4`;
                } else {
                    processedVideo.downloadFilename = `${sanitizedBase}-(${durationStr}).mp4`;
                }
                
                console.log(`[Duplicate Titles] Video ${index}: "${originalTitle}" → "${processedVideo.displayTitle}"`);
            } else {
                // Duplicate but no duration available - keep original (will use fallback -1, -2 etc.)
                console.log(`[Duplicate Titles] Video ${index}: "${originalTitle}" (no duration available)`);
                processedVideo.downloadFilename = `${sanitizeFilename(originalTitle)}.mp4`;
            }
        } else {
            // Unique title - no changes needed
            processedVideo.downloadFilename = `${sanitizeFilename(originalTitle)}.mp4`;
        }
        
        return processedVideo;
    });
    
    const modifiedCount = processedVideos.filter(v => v.displayTitle !== v.originalTitle).length;
    console.log('[Duplicate Titles] ✅ Processing complete:', modifiedCount, 'video(s) modified\n');
    
    return processedVideos;
}

// =============================================================================
// EXPRESS APP INITIALIZATION - Must be BEFORE routes!
// =============================================================================

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// =============================================================================
// SESSION MIDDLEWARE SETUP
// =============================================================================

app.use(session({
    secret: AUTH_CONFIG.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,  // Set to true if using HTTPS
        maxAge: AUTH_CONFIG.sessionMaxAge,
        httpOnly: true  // Prevent XSS attacks on session cookie
    }
}));

// =============================================================================
// RATE LIMITING FOR LOGIN ATTEMPTS
// =============================================================================

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 5,  // 5 attempts per window per IP
    message: { 
        success: false,
        error: 'Too many login attempts. Please try again after 15 minutes.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// =============================================================================
// AUTHENTICATION MIDDLEWARE
// =============================================================================

// Routes that DON'T require authentication
const publicRoutes = [
    '/api/login',
    '/api/health', 
    '/login',
    '/api/auth/status'
];

function requireAuth(req, res, next) {
    // Check if path is public
    if (publicRoutes.some(route => req.path.startsWith(route))) {
        return next();
    }
    
    // Check if user is authenticated via session
    if (req.session && req.session.isAuthenticated) {
        return next();
    }
    
    // Not authenticated - return appropriate response
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.status(401).json({ 
            success: false,
            error: 'Authentication required',
            code: 'AUTH_REQUIRED'
        });
    }
    
    // Browser request - redirect to login page
    return res.redirect('/login');
}

// Apply authentication middleware to ALL routes
app.use(requireAuth);

// =============================================================================
// AUTHENTICATION ROUTES
// =============================================================================

// POST /api/login - Handle login attempts
app.post('/api/login', loginLimiter, (req, res) => {
    const { username, password } = req.body;
    
    console.log(`[Auth] Login attempt for user: '${username}' from IP: ${req.ip}`);
    
    // Validate credentials
    if (username === AUTH_CONFIG.username && password === AUTH_CONFIG.password) {
        req.session.isAuthenticated = true;
        req.session.user = username;
        req.session.loginTime = new Date().toISOString();
        req.session.loginIP = req.ip;
        
        console.log(`[Auth] ✅ Successful login for user: '${username}'`);
        
        return res.json({
            success: true,
            message: 'Login successful',
            user: username,
            redirectTo: '/'
        });
    }
    
    // Failed login attempt
    console.warn(`[Auth] ❌ Failed login attempt for user: '${username}' from IP: ${req.ip}`);
    
    return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
    });
});

// POST /api/logout - Handle logout
app.post('/api/logout', (req, res) => {
    const user = req.session.user;
    const sessionId = req.sessionID;
    
    req.session.destroy((err) => {
        if (err) {
            console.error('[Auth] Error destroying session:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'Logout failed' 
            });
        }
        
        console.log(`[Auth] User '${user}' logged out (Session: ${sessionId})`);
        res.clearCookie('connect.sid');
        res.json({ 
            success: true, 
            message: 'Logged out successfully' 
        });
    });
});

// GET /api/auth/status - Check authentication status
app.get('/api/auth/status', (req, res) => {
    if (req.session && req.session.isAuthenticated) {
        res.json({
            isAuthenticated: true,
            user: req.session.user,
            loginTime: req.session.loginTime,
            sessionAge: req.session.loginTime ? 
                Math.floor((Date.now() - new Date(req.session.loginTime).getTime()) / 1000 / 60) : 0
        });
    } else {
        res.json({ isAuthenticated: false });
    }
});

// Serve login page (must be before static file serving)
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/login.html'));
});

// =============================================================================
// STATIC FILE SERVING - Robust frontend loading
// =============================================================================

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Root route - serve index.html with fallback
app.get('/', (req, res) => {
    const indexPath = findIndexHtml();
    
    if (indexPath && fs.existsSync(indexPath)) {
        console.log('[Root Route] Serving:', indexPath);
        res.sendFile(indexPath);
    } else {
        // Fallback: search for index.html in common locations
        const searchPaths = [
            path.join(__dirname, '..', 'public', 'index.html'),
            path.join(__dirname, '..', '..', 'public', 'index.html'),
            path.join(process.cwd(), 'public', 'index.html'),
        ];
        
        let found = false;
        for (const searchPath of searchPaths) {
            if (fs.existsSync(searchPath)) {
                console.log('[Root Route] Fallback found:', searchPath);
                res.sendFile(searchPath);
                found = true;
                break;
            }
        }
        
        if (!found) {
            res.status(404).send(`
                
                
                    ⚠️ Frontend Not Found
                    Could not locate index.html
                    Searched in:
                    
                        ${searchPaths.map(p => `${p}`).join('')}
                    
                    
                    API Status: Check Health
                
                
            `);
        }
    }
});

// =============================================================================
// HEALTH CHECK ENDPOINT
// =============================================================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        downloads: {
            dir: DOWNLOADS_DIR,
            exists: fs.existsSync(DOWNLOADS_DIR)
        },
        ffmpeg: FFMPEG_AVAILABLE,
        cookies: isCookiesFileValid()
    });
});

// ⭐ NEW: Server Logs Endpoint - Get terminal output for frontend display
app.get('/api/logs', (req, res) => {
    const { limit, type, since } = req.query;
    
    let logs = [...serverLogBuffer];
    
    // Filter by type if specified
    if (type && type !== 'all') {
        logs = logs.filter(log => log.type === type);
    }
    
    // Filter by time if 'since' parameter provided
    if (since) {
        const sinceDate = new Date(since);
        logs = logs.filter(log => new Date(log.time) >= sinceDate);
    }
    
    // Apply limit
    const logLimit = parseInt(limit) || 100;
    logs = logs.slice(-logLimit);
    
    res.json({
        success: true,
        count: logs.length,
        total: serverLogBuffer.length,
        logs: logs
    });
});

// ⭐ NEW: Clear server logs endpoint
app.delete('/api/logs', (req, res) => {
    const cleared = serverLogBuffer.length;
    serverLogBuffer.length = 0;
    res.json({
        success: true,
        message: `Cleared ${cleared} log entries`
    });
});

// =============================================================================
// SETTINGS ENDPOINTS - Download folder management
// =============================================================================

app.get('/api/settings', (req, res) => {
    const resolvedPath = toNativePath(DOWNLOADS_DIR);
    let fileCount = 0;
    let recentFiles = [];
    
    try {
        if (fs.existsSync(resolvedPath)) {
            const files = fs.readdirSync(resolvedPath);
            fileCount = files.length;
            recentFiles = files
                .filter(f => f.endsWith('.mp4') || f.endsWith('.webm'))
                .slice(-5)
                .map(f => ({
                    name: f,
                    size: fs.statSync(path.join(resolvedPath, f)).size,
                    modified: fs.statSync(path.join(resolvedPath, f)).mtime
                }));
        }
    } catch (e) {
        console.error('[Settings] Error reading downloads dir:', e);
    }
    
    res.json({
        success: true,
        data: {
            currentDownloadsDir: DOWNLOADS_DIR,
            resolvedPath: resolvedPath,
            dirExists: fs.existsSync(resolvedPath),
            fileCount: fileCount,
            recentFiles: recentFiles
        }
    });
});

app.put('/api/settings', async (req, res) => {
    const { downloadsDir } = req.body;
    
    if (!downloadsDir) {
        return res.status(400).json({ success: false, error: 'downloadsDir required' });
    }
    
    const newPath = toNativePath(downloadsDir);
    const oldPath = DOWNLOADS_DIR; // Store old path for comparison
    
    console.log('\n[Settings] 📁 Updating download folder:');
    console.log('   FROM:', oldPath);
    console.log('   TO:  ', newPath);
    
    try {
        // Create directory if it doesn't exist
        if (!fs.existsSync(newPath)) {
            fs.mkdirSync(newPath, { recursive: true });
            console.log('[Settings] ✅ Created new directory:', newPath);
        }
        
        // ⭐ FIXED: Actually update the global DOWNLOADS_DIR variable!
        // This makes the change take effect immediately
        Object.assign(global, { 
            __DOWNLOADS_DIR_OVERRIDE__: newPath 
        });
        
        // Update process.env as well
        process.env.DOWNLOADS_DIR = newPath;
        
        // Note: We can't truly change the const DOWNLOADS_DIR, but we can:
        // 1. Store the override in a way that getVideoStatus/checkFileExists can use
        // 2. Re-scan the new location
        
        console.log('[Settings] ✅ Download folder updated successfully!');
        console.log('[Settings] ⚠️ Note: Full path change requires server restart for all features');
        console.log('[Settings] ℹ️ Current session will use new path for future operations');
        
        // Try to re-scan downloads from new location (best effort)
        try {
            const tempDownloadsDir = newPath;
            // The scanExistingDownloads function uses DOWNLOADS_DIR which is const
            // So we log this info for the user
            console.log('[Settings] 💡 Tip: Restart server to fully apply new download folder');
        } catch (scanError) {
            console.log('[Settings] ⚠️ Could not pre-scan new folder:', scanError.message);
        }
        
        res.json({
            success: true,
            message: `✅ Download folder updated to: ${newPath}`,
            data: { 
                newDir: newPath,
                oldDir: oldPath,
                requiresRestart: true,
                tip: 'For immediate effect on all features, please restart the server'
            }
        });
        
    } catch (error) {
        console.error('[Settings] ❌ Error updating folder:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/settings/test-folder', (req, res) => {
    const { folderPath } = req.body;
    
    if (!folderPath) {
        return res.status(400).json({ success: false, error: 'folderPath required' });
    }
    
    const testPath = toNativePath(folderPath);
    
    try {
        // Try to create test file
        const testFile = path.join(testPath, '.write_test_' + Date.now());
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        
        res.json({
            success: true,
            data: {
                canUse: true,
                path: testPath,
                exists: fs.existsSync(testPath)
            }
        });
    } catch (error) {
        res.json({
            success: true,
            data: {
                canUse: false,
                path: testPath,
                error: error.message
            }
        });
    }
});

// =============================================================================
// CHANNEL ENDPOINTS
// =============================================================================

/**
 * Fetch channel information using yt-dlp with smart retry
 */
function fetchChannelInfo(channelId, channelUrl) {
    return new Promise((resolve, reject) => {
        console.log('\n[fetchChannelInfo] Starting channel fetch...');
        console.log('[fetchChannelInfo] Channel URL:', channelUrl);
        
        const cmd = `yt-dlp --flat-playlist --print "%(id)s\t%(title)s\t%(duration)s\t%(view_count)s\t%(upload_date)s" "${channelUrl}"`;
        
        console.log('[fetchChannelInfo] Command:', cmd.substring(0, 100) + '...');
        
        const strategies = buildCommandsWithCookieStrategies(cmd, channelUrl);
        
        executeWithRetry(
            strategies,
            0,
            (stdout) => {
                console.log('[fetchChannelInfo] ✅ Successfully fetched channel data');
                
                try {
                    const lines = stdout.trim().split('\n').filter(line => line.trim());
                    const videos = [];
                    const liveVideos = [];
                    
                    lines.forEach((line, index) => {
                        const parts = line.split('\t');
                        if (parts.length >= 2) {
                            const video = {
                                id: parts[0]?.trim() || `video_${index}`,
                                title: parts[1]?.trim() || 'Untitled',
                                duration: parts[2] ? parseInt(parts[2]) : null,
                                views: parts[3] ? parseInt(parts[3]) : null,
                                uploadDate: parts[4]?.trim() || null,
                            };
                            
                            // Filter out very short durations (likely shorts/ads)
                            if (video.duration === null || video.duration >= 60) {
                                videos.push(video);
                            }
                        }
                    });
                    
                    console.log(`[fetchChannelInfo] Parsed ${videos.length} videos`);
                    
                    // ⭐ NEW: Process duplicate titles - append duration to duplicates
                    const processedVideos = processDuplicateTitles(videos);
                    
                    resolve({
                        videos: processedVideos,  // Return processed videos with displayTitle/downloadFilename
                        liveVideos: liveVideos
                    });
                    
                } catch (parseError) {
                    console.error('[fetchChannelInfo] Error parsing output:', parseError);
                    reject(new Error('Failed to parse channel data'));
                }
            },
            (error) => {
                console.error('[fetchChannelInfo] Failed to fetch channel:', error.message);
                reject(error);
            }
        );
    });
}

// Video info endpoint
app.post('/api/video/info', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'Video URL required' });
        }

        const info = await getVideoInfo(url);
        
        res.json({
            success: true,
            data: {
                id: info.id,
                title: info.title,
                duration: info.duration,
                thumbnail: info.thumbnail,
                formats: info.formats || [],
                bestFormat: getBestFormat(info.formats)
            }
        });
        
    } catch (error) {
        console.error('[Video Info] Error:', error.message);
        res.status(500).json({ error: 'Failed to get video info: ' + error.message });
    }
});

// Start download endpoint
app.post('/api/download/start', async (req, res) => {
    try {
        const { url, format, quality, title } = req.body;  // ⭐ Added title!
        
        if (!url) {
            return res.status(400).json({ error: 'Video URL required' });
        }

        const downloadId = uuidv4();
        const filename = `video_${downloadId}.mp4`;
        const outputPath = path.join(DOWNLOADS_DIR, filename);

        const download = downloadManager.add({
            id: downloadId,
            url: url,
            title: title || null,  // ⭐ ADD TITLE FOR RENAME!
            filename: filename,
            outputPath: outputPath,
            status: 'downloading',
            progress: 0,
            startTime: Date.now()
        });

        // Start download
        executeDownload(
            downloadId,
            url,
            outputPath,
            format || 'best',
            (progress) => {
                download.progress = progress.percent;
                download.downloaded = progress.downloaded;
                download.total = progress.total;
            },
            (result) => {
                download.status = 'completed';
                download.endTime = Date.now();
            },
            (error) => {
                download.status = 'error';
                download.error = error;
                download.endTime = Date.now();
            }
        );

        res.json({
            success: true,
            downloadId: downloadId,
            message: 'Download started'
        });

    } catch (error) {
        console.error('[Download Start] Error:', error.message);
        res.status(500).json({ error: 'Failed to start download: ' + error.message });
    }
});

// FRONTEND COMPATIBLE: POST /api/download (main download endpoint frontend expects!)
app.post('/api/download', async (req, res) => {
    console.log('\n' + '='.repeat(80));
    console.log('⬇️ [Download] POST /api/download - Frontend Download Request');
    console.log('='.repeat(80));
    console.log('[Download] Request body:', JSON.stringify(req.body, null, 2));
    
    try {
        const { 
            url,           // Video URL
            videoId,       // Video ID (alternative)
            channelId,     // Parent channel ID
            channelName,   // ⭐ NEW: Channel name for folder organization
            format,        // Video format preference
            quality,        // Quality preference
            filename,       // Custom filename
            title           // VIDEO TITLE (for rename feature!)
        } = req.body;
        
        // Determine video URL
        const videoUrl = url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);
        
        if (!videoUrl) {
            console.log('[Download] ❌ ERROR: No URL or videoId provided!');
            return res.status(400).json({
                success: false,
                error: 'Video URL or videoId required'
            });
        }

        console.log('[Download] Processing download:');
        console.log('   - URL:', videoUrl);
        console.log('   - Video ID:', videoId || 'extracted from URL');
        console.log('   - Channel ID:', channelId || 'N/A');
        console.log('   - Channel Name:', channelName || 'N/A (will use root downloads folder)');
        console.log('   - Format:', format || 'auto (best)');
        console.log('   - Quality:', quality || 'auto');

        // ⭐ NEW: Determine output directory (channel-specific or root)
        const outputDir = channelName ? getChannelDownloadDir(channelName) : DOWNLOADS_DIR;
        console.log('[Download] Output directory:', outputDir);

        const downloadId = uuidv4();
        
        // ⭐ NEW: Use downloadFilename if provided (from duplicate title processing), otherwise generate from title
        let safeFilename;
        if (filename && filename.includes('(')) {
            // Filename already has duration format from duplicate title handler
            safeFilename = filename.replace(/[^a-zA-Z0-9._\-() ]/g, '_');
        } else if (filename) {
            safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        } else if (title) {
            safeFilename = title.replace(/[^a-zA-Z0-9._-]/g, '_');
        } else {
            safeFilename = `video_${downloadId}`;
        }
        
        let outputFilename = safeFilename.endsWith('.mp4') ? safeFilename : `${safeFilename}.mp4`;
        
        // ⭐ MODIFICATION 3: Apply duplicate filename handler (for edge cases)
        outputFilename = getUniqueFilename(outputDir, outputFilename);
        
        const outputPath = path.join(outputDir, outputFilename);

        console.log('[Download] Creating download job:');
        console.log('   - Download ID:', downloadId);
        console.log('   - Output file:', outputFilename);
        console.log('   - Full path:', outputPath);

        const download = downloadManager.add({
            id: downloadId,
            url: videoUrl,
            videoId: videoId,
            channelId: channelId,
            title: title || null,
            filename: outputFilename,
            outputPath: outputPath,
            format: format || 'best',
            quality: quality || 'auto',
            status: 'queued',
            progress: 0,
            startTime: null,
            endTime: null,
            createdAt: new Date().toISOString()
        });

        console.log('[Download] ✅ Job created, starting SMART DOWNLOAD...');
        
        // Start SMART DOWNLOAD asynchronously (analyze formats → pick lowest → download)
        setImmediate(() => {
            executeSmartDownload(downloadId, videoUrl, outputPath, title || videoId);
        });

        console.log('[Download] 📤 Response sent to frontend (job running in background)');
        console.log('='.repeat(80) + '\n');

        res.status(201).json({
            success: true,
            jobId: downloadId,
            status: 'queued',
            message: 'Download job created',
            download: {
                id: downloadId,
                url: videoUrl,
                filename: outputFilename,
                status: 'queued',
                progress: 0,
                createdAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('[Download] ❌ ERROR creating download job:', error.message);
        console.log('='.repeat(80) + '\n');
        
        res.status(500).json({
            success: false,
            error: 'Failed to create download: ' + error.message,
            suggestion: 'Check server logs for details'
        });
    }
});

// GET /api/channels - Return list of saved channels (FRONTEND COMPATIBLE FORMAT!)
app.get('/api/channels', (req, res) => {
    console.log('\n[Channels] GET /api/channels requested');
    
    const channels = Array.from(savedChannels.values()).map(ch => ({
        ...ch,
        videos: (ch.videos || []).map(video => ({ ...video }))
    }));
    
    res.json({
        success: true,
        channels: channels,
        count: channels.length
    });
});

// POST /api/channels - Add a new channel (THIS IS WHAT "LOAD CHANNEL" CALLS!)
app.post('/api/channels', async (req, res) => {
    console.log('\n' + '='.repeat(80));
    console.log('🎬 [Channels] POST /api/channels - ADD NEW CHANNEL');
    console.log('='.repeat(80));
    console.log('[Channels] Request body:', JSON.stringify(req.body, null, 2));
    
    try {
        const { url, channelId, name } = req.body;
        
        if (!url && !channelId) {
            console.log('[Channels] ❌ ERROR: No URL or channelId provided!');
            return res.status(400).json({
                success: false,
                error: 'Channel URL or ID required'
            });
        }

        // Determine the channel URL
        // ⭐ SMART URL CLEANUP - Fix doubled/malformed URLs
        let channelUrl = url || `https://www.youtube.com/@${channelId}`;
        
        // Fix common URL issues:
        // 1. Double youtube.com: https://www.youtube.com/www.youtube.com/@user
        // 2. Missing protocol: www.youtube.com/@user
        // 3. Extra slashes: https://www.youtube.com//@user
        
        if (channelUrl) {
            // Remove double youtube.com occurrences
            while (channelUrl.includes('youtube.com/youtube.com/') || 
                   channelUrl.includes('youtube.com/www.youtube.com/')) {
                channelUrl = channelUrl.replace(/youtube\.com\/(www\.)?youtube\.com\//, 'youtube.com/');
                console.log('[Channels] 🔧 Fixed doubled URL');
            }
            
            // Ensure protocol exists
            if (!channelUrl.startsWith('http://') && !channelUrl.startsWith('https://')) {
                channelUrl = 'https://' + channelUrl.replace(/^\/\//, '');
                console.log('[Channels] 🔧 Added missing protocol');
            }
            
            // Remove double slashes (but keep https://)
            channelUrl = channelUrl.replace(/([^:])\/{2,}/g, '$1/');
        }
        
        const channelIdFinal = channelId || channelUrl.split('@').pop().split('/')[0];
        
        console.log('[Channels] Processing channel:');
        console.log('   - URL:', channelUrl);
        console.log('   - ID:', channelIdFinal);
        console.log('   - Name:', name || 'Auto-detected');
        
        console.log('\n[Channels] 📡 Fetching channel info from YouTube...');
        
        // Fetch channel info using our existing function with smart cookie handling
        const channelData = await fetchChannelInfo(channelIdFinal, channelUrl);
        
        console.log('\n[Channels] ✅ Channel fetched successfully!');
        console.log('[Channels] Videos found:', channelData.videos.length);
        console.log('[Channels] Live videos found:', channelData.liveVideos.length);
        
        // Create channel object (without sync/badge related fields - MODIFICATION 1)
        const videosClean = channelData.videos.map(video => ({
            ...video
        }));
        
        // Create channel object
        const channel = {
            id: uuidv4(),
            youtubeId: channelIdFinal,
            url: channelUrl,
            name: name || channelIdFinal,
            videoCount: channelData.videos.length + channelData.liveVideos.length,
            videos: videosClean,
            liveVideos: channelData.liveVideos,
            addedAt: new Date().toISOString(),
            lastChecked: new Date().toISOString(),
            status: 'active'
        };
        
        // Save to in-memory storage
        savedChannels.set(channel.id, channel);
        
        console.log('[Channels] 💾 Channel saved with ID:', channel.id);
        console.log('='.repeat(80) + '\n');
        
        // Return success response with full channel data (FRONTEND COMPATIBLE FORMAT!)
        console.log('[Channels] Returning channel to frontend...');
        
        res.status(201).json({
            success: true,
            message: 'Channel added successfully',
            channel: channel,
            channels: [channel],
            videos: channelData.videos,
            liveVideos: channelData.liveVideos,
            totalVideos: channelData.videos.length + channelData.liveVideos.length
        });
        
    } catch (error) {
        console.log('\n' + '='.repeat(80));
        console.log('❌ [Channels] FAILED TO ADD CHANNEL!');
        console.log('='.repeat(80));
        console.log('[Channels] Error Type:', error.constructor.name);
        console.log('[Channels] Error Message:', error.message);
        console.log('[Channels] Stack:', error.stack);
        console.log('='.repeat(80) + '\n');
        
        res.status(500).json({
            success: false,
            error: 'Failed to add channel: ' + error.message,
            suggestion: 'Check yt-dlp installation and internet connection',
            debug: {
                errorType: error.constructor.name,
                errorMessage: error.message,
                timestamp: new Date().toISOString()
            }
        });
    }
});

// DELETE /api/channels/:id - Remove a saved channel
app.delete('/api/channels/:id', (req, res) => {
    const { id } = req.params;
    console.log('\n[Channels] DELETE /api/channels/' + id);
    
    if (savedChannels.has(id)) {
        savedChannels.delete(id);
        console.log('[Channels] ✅ Channel deleted:', id);
        res.json({
            success: true,
            message: 'Channel deleted successfully'
        });
    } else {
        console.log('[Channels] ⚠️  Channel not found:', id);
        res.status(404).json({
            success: false,
            error: 'Channel not found'
        });
    }
});

// =============================================================================
// MODIFICATION 2: VIDEO COUNT COMPARISON FEATURE
// =============================================================================

// GET /api/channels/:id/stats - Get video count comparison
app.get('/api/channels/:id/stats', async (req, res) => {
    try {
        const channelId = req.params.id;
        
        // Find channel in data
        const channel = savedChannels.get(channelId) || 
                       Array.from(savedChannels.values()).find(c => c.id === channelId || c.channelId === channelId || c.youtubeId === channelId);
        
        if (!channel) {
            return res.status(404).json({ success: false, error: 'Channel not found' });
        }
        
        // 1. Get YouTube video count using yt-dlp
        const youtubeCount = await getYoutubeVideoCount(channel.url);
        
        // 2. Get downloaded files count
        const downloadedCount = getDownloadedFilesCount(channel.name || channelId);
        
        // 3. Calculate stats
        const missingCount = Math.max(0, youtubeCount - downloadedCount);
        const progressPercent = youtubeCount > 0 ? ((downloadedCount / youtubeCount) * 100).toFixed(1) : 0;
        
        res.json({
            success: true,
            channelId: channelId,
            channelName: channel.name || 'Unknown Channel',
            stats: {
                youtubeTotal: youtubeCount,
                downloadedCount: downloadedCount,
                missingCount: missingCount,
                progressPercent: parseFloat(progressPercent),
                lastChecked: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('[Stats] Error getting channel stats:', error.message);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get channel stats',
            details: error.message 
        });
    }
});

// Helper: Count videos on YouTube using yt-dlp (OPTIMIZED)
// Uses yt-dlp's built-in %(n_entries)s for direct count - no piping needed!
// Works on Windows, Linux, macOS - truly cross-platform!
async function getYoutubeVideoCount(channelUrl) {
    return new Promise((resolve, reject) => {
        // ⭐ OPTIMIZED: Use %(n_entries)s to get count DIRECTLY from yt-dlp
        // This is faster than listing all IDs and counting lines
        // No pipes, no wc, no JavaScript line counting needed!
        const cmd = `yt-dlp --flat-playlist --print "%(n_entries)s" "${channelUrl}" 2>nul`;
        
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                // If yt-dlp fails, return 0 gracefully
                console.error('[Stats] yt-dlp error:', error.message);
                resolve(0);
                return;
            }
            
            // The output should be just a number (the count)
            const output = stdout.trim();
            
            // Try to parse as direct number first (from n_entries)
            let count = parseInt(output, 10);
            
            if (isNaN(count) || count === 0) {
                // Fallback: If n_entries didn't work, try counting IDs
                // This handles older yt-dlp versions that might not support n_entries
                console.log('[Stats] n_entries not available, falling back to ID counting...');
                
                const fallbackCmd = `yt-dlp --flat-playlist --print "%(id)s" "${channelUrl}" 2>nul`;
                exec(fallbackCmd, (fallbackError, fallbackStdout) => {
                    if (fallbackError) {
                        console.error('[Stats] Fallback also failed:', fallbackError.message);
                        resolve(0);
                        return;
                    }
                    
                    // Count non-empty lines in JavaScript (cross-platform)
                    const lines = fallbackStdout.trim().split('\n').filter(line => line.trim());
                    count = lines.length;
                    console.log(`[Stats] Found ${count} videos on YouTube (fallback method)`);
                    resolve(count);
                });
            } else {
                console.log(`[Stats] Found ${count} videos on YouTube (direct method)`);
                resolve(count);
            }
        });
    });
}

// Helper: Count downloaded files in channel folder
function getDownloadedFilesCount(channelName) {
    try {
        const downloadsDir = path.join(DOWNLOADS_DIR, channelName, 'Videos');
        
        // Also check the channel root folder
        const channelDir = path.join(DOWNLOADS_DIR, channelName);
        let dirToCheck = downloadsDir;
        
        if (!fs.existsSync(downloadsDir) && fs.existsSync(channelDir)) {
            dirToCheck = channelDir;
        } else if (!fs.existsSync(downloadsDir) && !fs.existsSync(channelDir)) {
            return 0;
        }
        
        if (!fs.existsSync(dirToCheck)) {
            return 0;
        }
        
        const files = fs.readdirSync(dirToCheck);
        // Count only video files (filter out partial downloads, .tmp files, etc.)
        const videoFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp4', '.webm', '.mkv', '.avi', '.mov'].includes(ext) && 
                   !file.startsWith('.') && 
                   !file.includes('.part') &&
                   !file.includes('.tmp') &&
                   !file.includes('.ytdl');
        });
        
        return videoFiles.length;
    } catch (error) {
        console.error('[Stats] Error counting downloaded files:', error.message);
        return 0;
    }
}

// =============================================================================
// DOWNLOAD QUEUE ENDPOINTS
// =============================================================================

app.get('/api/download-queue', (req, res) => {
    const active = downloadManager.getActive().map(d => ({
        id: d.id,
        videoId: d.videoId,
        title: d.title,
        filename: d.filename,
        status: d.status,
        progress: d.progress || 0,
        speed: d.speed || null,
        downloaded: d.downloaded || null,
        total: d.total || null,
        startTime: d.startTime,
        url: d.url,
        format: d.format,
        quality: d.quality,
        finalFilename: d.finalFilename || null,
        renamedFrom: d.renamedFrom || null,
        error: d.error || null
    }));
    
    const completed = downloadManager.getCompleted().map(d => ({
        id: d.id,
        videoId: d.videoId,
        title: d.title,
        filename: d.filename,
        status: d.status,
        progress: 100,
        finalFilename: d.finalFilename || d.filename,
        renamedFrom: d.renamedFrom || null,
        completedAt: d.endTime,
        size: d.finalSize || null,
        error: d.error || null
    }));

    res.json({
        success: true,
        queue: {
            active: active,
            completed: completed
        },
        timestamp: new Date().toISOString()
    });
});

app.delete('/api/download-queue', (req, res) => {
    const completed = downloadManager.getCompleted();
    completed.forEach(d => downloadManager.remove(d.id));
    
    res.json({
        success: true,
        message: `Cleared ${completed.length} completed downloads`,
        remaining: downloadManager.getAll().length
    });
});

// =============================================================================
// DOWNLOAD EXECUTION FUNCTIONS
// =============================================================================

function executeSmartDownload(downloadId, videoUrl, outputPath, videoTitle) {
    const download = downloadManager.get(downloadId);
    if (!download) {
        console.error('[Smart Download] Download not found:', downloadId);
        return;
    }

    console.log(`\n[Smart Download] 🎯 Starting SMART download for: ${videoTitle}`);
    console.log(`[Smart Download] ID: ${downloadId}`);

    // Update status
    downloadManager.update(downloadId, { status: 'downloading', startTime: Date.now() });

    // Step 1: Analyze formats
    analyzeVideoFormats(videoUrl)
        .then(formatInfo => {
            console.log(`[Smart Download] 📊 Format analysis complete:`);
            console.log(`   Selected: ${formatInfo.formatId} (${formatInfo.resolution}, ${formatInfo.ext})`);
            console.log(`   Estimated size: ${formatInfo.filesizeMB || 'unknown'} MB`);

            // Store format info
            downloadManager.update(downloadId, {
                selectedFormat: formatInfo
            });

            // Step 2: Download with selected format
            return executeDownloadWithFormat(downloadId, videoUrl, outputPath, formatInfo, videoTitle);
        })
        .then(result => {
            console.log(`[Smart Download] ✅ Download complete!`);
            console.log(`[Smart Download] Output: ${outputPath}`);

            // Step 3: Rename file to video title (if enabled)
            return renameDownloadedFile(download, outputPath);
        })
        .then(renameResult => {
            console.log(`[Smart Download] 📝 Rename result:`, renameResult);

            // Mark as completed
            downloadManager.update(downloadId, {
                status: 'completed',
                progress: 100,
                endTime: Date.now(),
                ...(renameResult.success ? {
                    finalFilename: renameResult.filename,
                    renamedFrom: renameResult.originalFilename,
                    finalSize: renameResult.size
                } : {})
            });

            console.log(`[Smart Download] ✅ Download job ${downloadId} completed successfully`);

        })
        .catch(error => {
            console.error(`[Smart Download] ❌ Error:`, error.message);
            
            downloadManager.update(downloadId, {
                status: 'error',
                error: error.message,
                endTime: Date.now()
            });
        });
}

function executeDownloadWithFormat(downloadId, videoUrl, outputPath, formatInfo, videoTitle) {
    return new Promise((resolve, reject) => {
        const download = downloadManager.get(downloadId);
        if (!download) return reject(new Error('Download not found'));

        console.log(`\n[Execute Download] Starting: ${videoTitle}`);
        console.log(`[Execute Download] Format: ${formatInfo.formatId} (${formatInfo.resolution})`);
        console.log(`[Execute Download] Needs merge: ${formatInfo.needsMerge}`);

        // ⭐ ROBUST FIX: ALWAYS use template output (never force fixed filename!)
        // This prevents "Fixed output name but more than one file to download" error
        // yt-dlp needs flexibility to handle temp files during merge operations
        const outputDir = path.dirname(outputPath);
        const baseFilename = path.basename(outputPath, '.mp4');  // without extension
        
        // ALWAYS use template format - works for both merged and non-merged downloads
        const outputTemplate = path.join(outputDir, `${baseFilename}.%(ext)s`);
        
        console.log(`[Execute Download] 🔄 ALWAYS using template mode (prevents merge errors)`);
        console.log(`[Execute Download] Output dir: ${outputDir}`);
        console.log(`[Execute Download] Output template: ${outputTemplate}`);
        console.log(`[Execute Download] Expected final file: ${outputPath}`);

        // Build arguments array for spawn (safer than shell command)
        const args = [
            '-f', formatInfo.formatId,
            '-o', outputTemplate,
            '--no-playlist',
            '--embed-chapters',
            '--embed-metadata',
            '--embed-thumbnail'
        ];
        
        // Always add merge flag - if merging isn't needed, yt-dlp just ignores it
        // This ensures we NEVER get "Fixed output name" error
        args.push('--merge-output-format', 'mp4');
        
        if (FFMPEG_AVAILABLE) {
            console.log('[Execute Download] ✅ FFmpeg available for merging');
        } else {
            console.warn('[Execute Download] ⚠️ FFmpeg not available, using fallback merger');
        }
        
        args.push(videoUrl);

        console.log(`[Execute Download] Full command: yt-dlp ${args.join(' ').substring(0, 200)}...`);

        const ytDlpProcess = spawn('yt-dlp', args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true,
            cwd: outputDir  // Work in output directory for safer file operations
        });

        let stdoutData = '';
        let stderrData = '';

        ytDlpProcess.stdout.on('data', (data) => {
            stdoutData += data.toString();
            
            // Parse progress from output
            const progressMatch = stdoutData.match(/(\d+\.?\d*)%/);
            if (progressMatch) {
                const percent = parseFloat(progressMatch[1]);
                downloadManager.update(downloadId, { progress: percent });
                
                // Extract additional info if available
                const speedMatch = stdoutData.match(/(\d+\.?\d*\s*(?:MiB|KiB|GiB)\/s)/);
                const sizeMatch = stdoutData.match(/of\s+(\d+\.?\d*\s*(?:MiB|KiB|GiB))/);
                
                if (speedMatch) downloadManager.update(downloadId, { speed: speedMatch[1] });
                if (sizeMatch) downloadManager.update(downloadId, { total: sizeMatch[1] });
            }
        });

        ytDlpProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
        });

        ytDlpProcess.on('close', (code) => {
            console.log(`[Execute Download] Process exited with code: ${code}`);
            
            if (code === 0) {
                // ⭐ ENHANCED: Search for output file in multiple possible locations/names
                const possiblePaths = [
                    outputPath,                                    // Original expected path
                    outputPath.replace('.mp4', '.webm'),           // WebM fallback
                    outputPath.replace('.mp4', '.mkv'),             // MKV fallback
                    path.join(outputDir, baseFilename + '.mp4'),   // Direct name in output dir
                    path.join(outputDir, baseFilename + '.webm'),
                    path.join(outputDir, baseFilename + '.mkv')
                ];
                
                // Also try to find any recently modified video file in output dir
                try {
                    if (fs.existsSync(outputDir)) {
                        const files = fs.readdirSync(outputDir)
                            .filter(f => ['.mp4', '.webm', '.mkv'].includes(path.extname(f).toLowerCase()))
                            .map(f => ({
                                path: path.join(outputDir, f),
                                mtime: fs.statSync(path.join(outputDir, f)).mtime.getTime()
                            }))
                            .sort((a, b) => b.mtime - a.mtime);  // Most recent first
                        
                        // Add the most recent file as highest priority
                        if (files.length > 0) {
                            possiblePaths.unshift(files[0].path);
                        }
                    }
                } catch (e) {
                    console.warn('[Execute Download] Warning: Could not scan output directory:', e.message);
                }
                
                // Find which file actually exists
                let foundPath = null;
                for (const checkPath of possiblePaths) {
                    if (fs.existsSync(checkPath)) {
                        const stats = fs.statSync(checkPath);
                        // File should be reasonably sized (> 1KB) and recently modified
                        if (stats.size > 1024) {
                            foundPath = checkPath;
                            break;
                        }
                    }
                }
                
                if (foundPath) {
                    const stats = fs.statSync(foundPath);
                    console.log(`[Execute Download] ✅ Success! File: ${path.basename(foundPath)}`);
                    console.log(`[Execute Download] ✅ Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
                    
                    // If file ended up at different path than expected, rename it
                    if (foundPath !== outputPath && fs.existsSync(outputPath) === false) {
                        try {
                            fs.renameSync(foundPath, outputPath);
                            console.log(`[Execute Download] 📝 Renamed to: ${path.basename(outputPath)}`);
                            resolve({ success: true, path: outputPath, size: stats.size });
                        } catch (renameErr) {
                            // Rename failed, but download succeeded - return actual path
                            console.log(`[Execute Download] ⚠️ Rename failed, using original name: ${path.basename(foundPath)}`);
                            resolve({ success: true, path: foundPath, size: stats.size });
                        }
                    } else {
                        resolve({ success: true, path: foundPath, size: stats.size });
                    }
                } else {
                    reject(new Error('Download completed but output file not found'));
                }
            } else {
                const errorMsg = stderrData.substring(stderrData.length - 500);
                console.error(`[Execute Download] ❌ Failed: ${errorMsg}`);
                reject(new Error(`yt-dlp exited with code ${code}: ${errorMsg}`));
            }
        });

        ytDlpProcess.on('error', (err) => {
            console.error(`[Execute Download] ❌ Spawn error:`, err);
            reject(err);
        });

        // Timeout after 30 minutes
        setTimeout(() => {
            if (ytDlpProcess && !ytDlpProcess.killed) {
                console.log('[Execute Download] ⏰ Timeout reached, killing process');
                ytDlpProcess.kill();
                reject(new Error('Download timeout (30 minutes)'));
            }
        }, 30 * 60 * 1000);
    });
}

/**
 * ⭐ RENAME FUNCTION - Rename downloaded file to YouTube video title
 */
async function renameDownloadedFile(downloadObj, originalPath) {
    return new Promise((resolve) => {
        console.log('\n[Rename] Starting rename process...');
        console.log('[Rename] Original path:', originalPath);
        
        // Skip if no title available
        if (!downloadObj || !downloadObj.title) {
            console.log('[Rename] ⚠️ No title available, skipping rename');
            resolve({ success: false, reason: 'no_title', filename: null, originalFilename: null });
            return;
        }
        
        const videoTitle = downloadObj.title;
        console.log('[Rename] Target title:', videoTitle);
        
        // Sanitize filename (remove invalid characters)
        let sanitizedTitle = videoTitle
            .replace(/[:"/\\|?*]/g, '-')  // Replace invalid chars with hyphen
            .replace(/\s+/g, ' ')             // Collapse multiple spaces
            .trim();
        
        // Limit length (Windows max path is 260 chars, leave room for path)
        const maxTitleLength = 180;
        if (sanitizedTitle.length > maxTitleLength) {
            sanitizedTitle = sanitizedTitle.substring(0, maxTitleLength);
            console.log('[Rename] Title truncated to', maxTitleLength, 'chars');
        }
        
        const newFilename = sanitizedTitle + '.mp4';
        // ⭐ FIXED: Keep file in the SAME directory as original (channel folder), not base DOWNLOADS_DIR
        const originalDir = path.dirname(originalPath);
        const newPath = path.join(originalDir, newFilename);
        
        console.log('[Rename] New filename:', newFilename);
        console.log('[Rename] New path:', newPath);
        console.log('[Rename] Original dir (keeping file here):', originalDir);
        
        // Check if source file exists
        if (!fs.existsSync(originalPath)) {
            console.log('[Rename] ⚠️ Original file not found:', originalPath);
            
            // Maybe it was already renamed or has different extension
            const extensions = ['.mp4', '.webm', '.mkv'];
            let foundAlternate = false;
            
            for (const ext of extensions) {
                const altPath = originalPath.replace(/\.[^.]+$/, ext);
                if (fs.existsSync(altPath)) {
                    console.log('[Rename] Found alternate file:', altPath);
                    originalPath = altPath;
                    foundAlternate = true;
                    break;
                }
            }
            
            if (!foundAlternate) {
                resolve({ success: false, reason: 'source_not_found', filename: null, originalFilename: null });
                return;
            }
        }
        
        // Handle duplicate filenames - using the same logic as getUniqueFilename
        let finalNewPath = newPath;
        let finalNewFilename = newFilename;
        let counter = 1;
        
        while (fs.existsSync(finalNewPath)) {
            counter++;
            finalNewFilename = `${sanitizedTitle} (${counter}).mp4`;
            // ⭐ FIXED: Keep in same directory (channel folder)
            finalNewPath = path.join(originalDir, finalNewFilename);
            console.log('[Rename] Duplicate detected, trying:', finalNewFilename);
        }
        
        try {
            // Perform rename
            fs.renameSync(originalPath, finalNewPath);
            
            // Get file stats
            const stats = fs.statSync(finalNewPath);
            
            console.log('[Rename] ✅ Rename successful!');
            console.log('[Rename] From:', path.basename(originalPath));
            console.log('[Rename] To:', finalNewFilename);
            console.log('[Rename] Size:', (stats.size / 1024 / 1024).toFixed(2), 'MB');
            
            resolve({
                success: true,
                filename: finalNewFilename,
                originalFilename: path.basename(originalPath),
                path: finalNewPath,
                size: stats.size,
                renamedAt: new Date().toISOString()
            });
            
        } catch (err) {
            console.error('[Rename] ❌ Rename failed:', err.message);
            resolve({ 
                success: false, 
                reason: err.code || 'unknown_error', 
                error: err.message,
                filename: path.basename(originalPath),  // Return original name
                originalFilename: path.basename(originalPath)
            });
        }
    });
}

// =============================================================================
// FORMAT ANALYZER
// =============================================================================

function analyzeVideoFormats(videoUrl) {
    return new Promise((resolve, reject) => {
        console.log('\n[Format Analyzer] Starting analysis for:', videoUrl);
        console.log('[Format Analyzer] Using text-based parsing (reliable method)');
        
        const cmd = 'yt-dlp --list-formats "' + videoUrl + '"';
        
        console.log('[Format Analyzer] Command:', cmd);

        exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                console.log('[Format Analyzer] ❌ Format listing failed, using default');
                // Return default best format
                resolve({
                    formatId: 'best[ext=mp4]/best',
                    resolution: 'auto',
                    ext: 'mp4',
                    filesize: null,
                    filesizeMB: null,
                    vcodec: 'auto',
                    acodec: 'auto',
                    needsMerge: false
                });
                return;
            }

            console.log('[Format Analyzer] ✅ Got format list, parsing...');

            try {
                const formats = parseFormatsFromText(stdout);
                console.log('[Format Analyzer] Parsed', formats.length, 'formats');

                if (formats.length === 0) {
                    throw new Error('No formats found');
                }

                // Select BEST format (lowest quality for storage efficiency)
                const selected = selectBestFormat(formats);
                
                console.log('[Format Analyzer] 🎯 Selected format:');
                console.log('   ID:', selected.formatId);
                console.log('   Resolution:', selected.resolution);
                console.log('   Size:', selected.filesizeMB || 'unknown', 'MB');
                console.log('   Codec:', selected.vcodec + '/' + selected.acodec);

                resolve(selected);

            } catch (parseError) {
                console.error('[Format Analyzer] Parse error:', parseError.message);
                reject(parseError);
            }
        });
    });
}

function parseFormatsFromText(text) {
    const formats = [];
    const lines = text.split('\n');
    
    // Parse format lines
    // Example: "249 webm audio only tiny 53k , opus 22050Hz 160k, 487.65KiB"
    // Example: "18 mp4 360p  12M , avc1.42001E mp4a.40.2@ 130k, 11.85MiB"
    
    for (const line of lines) {
        // Skip header/footer lines
        if (!line.includes('mp4') && !line.includes('webm') && !line.includes('m4a')) continue;
        if (line.includes('ID') || line.includes('---') || line.includes('ext')) continue;
        
        const parts = line.trim().split(/\s{2,}/); // Split by 2+ spaces
        
        if (parts.length >= 2) {
            // ⭐ FIXED: Extract ONLY the numeric/format ID (e.g., "160"), not "160 mp4"
            let rawFormatId = parts[0].trim();
            const formatId = rawFormatId.split(/\s+/)[0]; // Take first part before any space
            const extPart = parts[1].trim();
            
            // Extract extension
            const extMatch = extPart.match(/(mp4|webm|m4a|mkv)/i);
            const ext = extMatch ? extMatch[1].toLowerCase() : 'mp4';
            
            // Extract resolution
            const resolutionMatch = line.match(/(\d+)x(\d+)|(\d+p)/);
            const resolution = resolutionMatch ? resolutionMatch[0] : 'audio only';
            
            // Extract filesize
            const sizeMatch = line.match(/([\d.]+)\s*(MiB|GiB|KiB)/i);
            let filesize = null;
            let filesizeMB = null;
            
            if (sizeMatch) {
                filesize = parseFloat(sizeMatch[1]);
                const unit = sizeMatch[2].toUpperCase();
                
                if (unit === 'GiB') filesizeMB = filesize * 1024;
                else if (unit === 'KiB') filesizeMB = filesize / 1024;
                else filesizeMB = filesize;
            }
            
            // Detect audio-only
            const isAudioOnly = line.includes('audio only');
            
            // Extract codec info
            const vcodecMatch = line.match(/avc[\d.]+|vp\d+|av1/i);
            const acodecMatch = line.match(/mp4a\.\d+|opus|aac/i);
            
            const vcodec = vcodecMatch ? vcodecMatch[0] : (isAudioOnly ? null : 'unknown');
            const acodec = acodecMatch ? acodecMatch[0] : (isAudioOnly ? 'opus' : 'unknown');
            
            formats.push({
                formatId: formatId,
                ext: ext,
                resolution: resolution,
                filesize: filesize,
                filesizeMB: filesizeMB ? Math.round(filesizeMB * 100) / 100 : null,
                vcodec: vcodec,
                acodec: acodec,
                isAudioOnly: isAudioOnly,
                needsMerge: false // Will be updated later
            });
        }
    }
    
    // Mark formats that need merging (video without audio or vice versa)
    formats.forEach(f => {
        if (!f.isAudioOnly && f.acodec !== 'unknown' && f.vcodec !== null) {
            // Has both, check if they're separate
            f.needsMerge = line.includes('video only');
        }
    });
    
    return formats;
}

function selectBestFormat(formats) {
    // Filter to video-only formats (not audio only)
    const videoFormats = formats.filter(f => !f.isAudioOnly);
    
    if (videoFormats.length === 0) {
        // Fallback: return first format or default
        return formats[0] || {
            formatId: 'best[ext=mp4]/best',
            resolution: 'auto',
            ext: 'mp4',
            filesize: null,
            filesizeMB: null,
            vcodec: 'auto',
            acodec: 'auto',
            needsMerge: false
        };
    }
    
    // Sort by resolution (ascending - prefer lower quality for storage)
    const sortedByResolution = [...videoFormats].sort((a, b) => {
        const resA = parseInt(a.resolution) || 9999;
        const resB = parseInt(b.resolution) || 9999;
        return resA - resB;
    });
    
    // Prefer formats with smaller file sizes at same resolution
    const lowestRes = sortedByResolution[0];
    const sameResFormats = sortedByResolution.filter(f => 
        parseInt(f.resolution) === parseInt(lowestRes.resolution)
    );
    
    // Pick smallest file among same resolution
    const selected = sameResFormats.sort((a, b) => 
        (a.filesizeMB || 9999) - (b.filesizeMB || 9999)
    )[0];
    
    // Check if we need to merge (video-only format)
    const needsMerge = selected.resolution.includes('only') || 
                       !selected.acodec || 
                       selected.acodec === 'unknown';
    
    return {
        ...selected,
        needsMerge: needsMerge,
        // If merge needed, suggest also getting audio
        ...(needsMerge ? { audioFormatId: findBestAudioFormat(formats) } : {})
    };
}

function findBestAudioFormat(formats) {
    const audioFormats = formats.filter(f => f.isAudioOnly && f.ext === 'm4a');
    
    if (audioFormats.length > 0) {
        // Return smallest audio file
        return audioFormats.sort((a, b) => (a.filesizeMB || 0) - (b.filesizeMB || 0))[0].formatId;
    }
    
    return null; // Will use default audio extraction
}

// =============================================================================
// BATCH DOWNLOAD ENDPOINT
// =============================================================================

app.post('/api/download/batch', async (req, res) => {
    console.log('\n' + '='.repeat(80));
    console.log('📦 [Batch Download] POST /api/download/batch');
    console.log('='.repeat(80));

    try {
        const { videos, format, quality, channelId, channelName } = req.body;

        if (!videos || !Array.isArray(videos) || videos.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Videos array required'
            });
        }

        console.log(`[Batch Download] Received ${videos.length} videos for batch download`);
        console.log(`[Batch Download] Format: ${format || 'auto'}, Quality: ${quality || 'auto'}`);
        console.log(`[Batch Download] Channel Name: ${channelName || 'N/A (root folder)'}`);

        // ⭐ NEW: Determine output directory (channel-specific or root)
        const outputDir = channelName ? getChannelDownloadDir(channelName) : DOWNLOADS_DIR;
        console.log(`[Batch Download] Output directory: ${outputDir}`);

        const results = [];
        let skippedCount = 0;
        let queuedCount = 0;
        let errorCount = 0;

        // Process each video
        for (let i = 0; i < videos.length; i++) {
            const video = videos[i];
            const videoId = video.id || video.videoId;
            const videoTitle = video.title || `Video ${i + 1}`;
            const videoUrl = video.url || `https://www.youtube.com/watch?v=${videoId}`;

            console.log(`\n[Batch Download] Processing [${i + 1}/${videos.length}]: ${videoTitle.substring(0, 50)}...`);

            // Create download job
            const downloadId = uuidv4();
            const safeTitle = videoTitle.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
            let outputFilename = `${safeTitle}_${downloadId}.mp4`;
            
            // ⭐ MODIFICATION 3: Apply duplicate filename handler for batch downloads
            outputFilename = getUniqueFilename(outputDir, outputFilename);
            
            const outputPath = path.join(outputDir, outputFilename);

            // Add to download manager
            const download = downloadManager.add({
                id: downloadId,
                url: videoUrl,
                videoId: videoId,
                channelId: channelId,
                title: videoTitle,
                filename: outputFilename,
                outputPath: outputPath,
                format: format || 'best',
                quality: quality || 'lowest',
                status: 'queued',
                progress: 0,
                createdAt: new Date().toISOString()
            });

            queuedCount++;
            results.push({
                index: i,
                videoId: videoId,
                title: videoTitle,
                status: 'queued',
                jobId: downloadId,
                filename: outputFilename
            });

            // Start download in background (sequential to avoid rate limits)
            setTimeout(() => {
                executeSmartDownload(downloadId, videoUrl, outputPath, videoTitle);
            }, i * 2000); // 2-second delay between downloads
        }

        console.log(`\n[Batch Download] ✅ Batch processing complete:`);
        console.log(`   Queued: ${queuedCount}`);
        console.log(`   Skipped (already exist): ${skippedCount}`);
        console.log(`   Errors: ${errorCount}`);

        res.json({
            success: true,
            message: `Batch download initiated: ${queuedCount} queued, ${skippedCount} skipped`,
            summary: {
                total: videos.length,
                queued: queuedCount,
                skipped: skippedCount,
                errors: errorCount
            },
            results: results,
            batchId: uuidv4()
        });

    } catch (error) {
        console.error('[Batch Download] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Batch download failed: ' + error.message
        });
    }
});

// =============================================================================
// SEQUENTIAL DOWNLOAD FEATURE (One at a time - True Sequential)
// =============================================================================

// Global sequential download state
let sequentialQueue = {
    isRunning: false,
    isPaused: false,
    currentIndex: 0,
    totalVideos: 0,
    videos: [],
    results: [],
    batchId: null,
    startTime: null,
    cancelRequested: false
};

/**
 * POST /api/download/sequential - Start sequential download (one at a time)
 * Downloads videos ONE BY ONE, waiting for each to complete before starting next
 */
app.post('/api/download/sequential', async (req, res) => {
    console.log('\n' + '='.repeat(80));
    console.log('📥 [Sequential Download] POST /api/download/sequential');
    console.log('='.repeat(80));

    try {
        const { videos, format, quality, channelId, channelName } = req.body;

        if (!videos || !Array.isArray(videos) || videos.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Videos array required'
            });
        }

        // Check if already running
        if (sequentialQueue.isRunning && !sequentialQueue.cancelRequested) {
            return res.status(409).json({
                success: false,
                error: 'Sequential download already in progress',
                currentStatus: {
                    currentIndex: sequentialQueue.currentIndex,
                    totalVideos: sequentialQueue.totalVideos,
                    currentVideo: sequentialQueue.videos[sequentialQueue.currentIndex]?.title || 'N/A'
                }
            });
        }

        // Initialize sequential queue
        sequentialQueue = {
            isRunning: true,
            isPaused: false,
            currentIndex: 0,
            totalVideos: videos.length,
            videos: videos.map((v, idx) => ({
                ...v,
                index: idx,
                videoId: v.id || v.videoId,
                title: v.title || `Video ${idx + 1}`,
                url: v.url || `https://www.youtube.com/watch?v=${v.id || v.videoId}`
            })),
            results: [],
            batchId: uuidv4(),
            startTime: new Date(),
            cancelRequested: false
        };

        const outputDir = channelName ? getChannelDownloadDir(channelName) : DOWNLOADS_DIR;

        console.log(`[Sequential Download] 🎯 Starting SEQUENTIAL download of ${videos.length} videos`);
        console.log(`[Sequential Download] Mode: One at a time (true sequential)`);
        console.log(`[Sequential Download] Output directory: ${outputDir}`);
        console.log(`[Sequential Download] Batch ID: ${sequentialQueue.batchId}`);

        // Respond immediately with queue status
        res.json({
            success: true,
            message: `Sequential download started: ${videos.length} videos will download one at a time`,
            mode: 'sequential',
            batchId: sequentialQueue.batchId,
            totalVideos: videos.length,
            estimatedTime: `${videos.length * 5}-${videos.length * 15} minutes` // Rough estimate
        });

        // Start processing sequentially in background
        processSequentialQueue(outputDir, format, quality, channelId);

    } catch (error) {
        console.error('[Sequential Download] ❌ Error:', error.message);
        // Only send error if we haven't sent response yet
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Sequential download failed: ' + error.message
            });
        }
    }
});

/**
 * Core sequential processing function
 * Processes videos ONE AT A TIME, awaiting each completion before next
 */
async function processSequentialQueue(outputDir, format, quality, channelId) {
    console.log('\n[Sequential Queue] 🚀 Starting sequential processing...');
    
    while (sequentialQueue.currentIndex < sequentialQueue.totalVideos) {
        // Check for cancellation
        if (sequentialQueue.cancelRequested) {
            console.log('[Sequential Queue] ⛔ Cancellation requested, stopping...');
            break;
        }

        // Check for pause
        while (sequentialQueue.isPaused && !sequentialQueue.cancelRequested) {
            console.log('[Sequential Queue] ⏸️ Paused, waiting...');
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (sequentialQueue.cancelRequested) break;

        const video = sequentialQueue.videos[sequentialQueue.currentIndex];
        const index = sequentialQueue.currentIndex + 1;
        
        console.log(`\n${'='.repeat(80)}`);
        console.log(`[Sequential Queue] 📥 Processing [${index}/${sequentialQueue.totalVideos}]: ${video.title}`);
        console.log(`${'='.repeat(80)}`);

        try {
            // Create download job for this video
            const downloadId = uuidv4();
            const safeTitle = video.title.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
            let outputFilename = `${safeTitle}.mp4`;
            
            // Apply duplicate filename handler
            outputFilename = getUniqueFilename(outputDir, outputFilename);
            
            const outputPath = path.join(outputDir, outputFilename);

            // Add to download manager
            const download = downloadManager.add({
                id: downloadId,
                url: video.url,
                videoId: video.videoId,
                channelId: channelId,
                title: video.title,
                filename: outputFilename,
                outputPath: outputPath,
                format: format || 'best',
                quality: quality || 'lowest',
                status: 'downloading',  // Set to downloading immediately (it's the only active one)
                progress: 0,
                createdAt: new Date().toISOString()
            });

            console.log(`[Sequential Queue] Job created: ${downloadId}`);
            console.log(`[Sequential Queue] Output: ${outputPath}`);

            // ⭐ KEY: AWAIT this download to complete before continuing
            await executeSmartDownload(downloadId, video.url, outputPath, video.title);

            // Mark as completed in results
            sequentialQueue.results.push({
                index: sequentialQueue.currentIndex,
                videoId: video.videoId,
                title: video.title,
                status: 'completed',
                jobId: downloadId,
                filename: outputFilename,
                completedAt: new Date().toISOString()
            });

            console.log(`[Sequential Queue] ✅ Video [${index}] COMPLETED successfully`);

        } catch (error) {
            console.error(`[Sequential Queue] ❌ Video [${index}] FAILED:`, error.message);
            
            // Mark as failed but CONTINUE to next video
            sequentialQueue.results.push({
                index: sequentialQueue.currentIndex,
                videoId: video.videoId,
                title: video.title,
                status: 'failed',
                error: error.message,
                failedAt: new Date().toISOString()
            });

            // Small delay before next attempt (avoid hammering YouTube if there's an issue)
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // Move to next video
        sequentialQueue.currentIndex++;

        // Small delay between downloads (polite to YouTube)
        if (sequentialQueue.currentIndex < sequentialQueue.totalVideos) {
            console.log('[Sequential Queue] ⏳ Waiting 2 seconds before next download...');
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    // Sequential queue finished
    sequentialQueue.isRunning = false;
    const endTime = new Date();
    const duration = Math.round((endTime - sequentialQueue.startTime) / 1000);
    
    const successCount = sequentialQueue.results.filter(r => r.status === 'completed').length;
    const failCount = sequentialQueue.results.filter(r => r.status === 'failed').length;

    console.log(`\n${'='.repeat(80)}`);
    console.log('[Sequential Queue] 🎉 SEQUENTIAL DOWNLOAD COMPLETE!');
    console.log('='.repeat(80));
    console.log(`[Sequential Queue] Total time: ${Math.floor(duration / 60)}m ${duration % 60}s`);
    console.log(`[Sequential Queue] Successful: ${successCount}/${sequentialQueue.totalVideos}`);
    console.log(`[Sequential Queue] Failed: ${failCount}/${sequentialQueue.totalVideos}`);
    console.log(`[Sequential Queue] Cancelled: ${sequentialQueue.cancelRequested}`);
}

/**
 * GET /api/download/sequential/status - Get sequential download progress
 */
app.get('/api/download/sequential/status', (req, res) => {
    const currentVideo = sequentialQueue.videos[sequentialQueue.currentIndex] || null;
    const activeDownload = currentVideo ? 
        downloadManager.get(d => d.videoId === currentVideo.videoId && d.status === 'downloading') : null;

    res.json({
        success: true,
        isRunning: sequentialQueue.isRunning,
        isPaused: sequentialQueue.isPaused,
        batchId: sequentialQueue.batchId,
        progress: {
            current: sequentialQueue.currentIndex,
            total: sequentialQueue.totalVideos,
            percent: sequentialQueue.totalVideos > 0 ? 
                Math.round((sequentialQueue.currentIndex / sequentialQueue.totalVideos) * 100) : 0
        },
        currentVideo: currentVideo ? {
            title: currentVideo.title,
            videoId: currentVideo.videoId,
            index: sequentialQueue.currentIndex + 1
        } : null,
        currentProgress: activeDownload ? {
            jobId: activeDownload.id,
            percent: activeDownload.progress || 0,
            speed: activeDownload.speed || null,
            status: activeDownload.status
        } : null,
        results: sequentialQueue.results,
        cancelled: sequentialQueue.cancelRequested,
        elapsedTime: sequentialQueue.startTime ? 
            Math.round((new Date() - sequentialQueue.startTime) / 1000) : 0
    });
});

/**
 * POST /api/download/sequential/pause - Pause/resume sequential download
 */
app.post('/api/download/sequential/pause', (req, res) => {
    const { pause } = req.body; // true to pause, false to resume
    
    if (!sequentialQueue.isRunning) {
        return res.status(400).json({
            success: false,
            error: 'No sequential download in progress'
        });
    }

    sequentialQueue.isPaused = pause === true;
    
    console.log(`[Sequential Download] ${pause ? '⏸️ PAUSED' : '▶️ RESUMED'}`);
    
    res.json({
        success: true,
        isPaused: sequentialQueue.isPaused,
        message: pause ? 'Sequential download paused' : 'Sequential download resumed'
    });
});

/**
 * POST /api/download/sequential/cancel - Cancel sequential download
 */
app.post('/api/download/sequential/cancel', (req, res) => {
    if (!sequentialQueue.isRunning) {
        return res.status(400).json({
            success: false,
            error: 'No sequential download in progress'
        });
    }

    sequentialQueue.cancelRequested = true;
    
    // Also cancel any currently active download
    const currentVideo = sequentialQueue.videos[sequentialQueue.currentIndex];
    if (currentVideo) {
        const activeDownload = downloadManager.get(d => 
            d.videoId === currentVideo.videoId && d.status === 'downloading'
        );
        if (activeDownload) {
            downloadManager.update(activeDownload.id, { status: 'cancelled' });
        }
    }
    
    console.log('[Sequential Download] ❌ CANCELLATION REQUESTED');
    
    res.json({
        success: true,
        message: 'Cancellation requested. Current download will finish, then stop.',
        resultsSoFar: sequentialQueue.results,
        nextIndex: sequentialQueue.currentIndex
    });
});

// =============================================================================
// SYSTEM STATUS ENDPOINT
// =============================================================================

app.get('/api/system/status', (req, res) => {
    const activeDownloads = downloadManager.getActive();
    const completedDownloads = downloadManager.getCompleted();
    
    res.json({
        success: true,
        system: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            platform: process.platform,
            nodeVersion: process.version
        },
        downloads: {
            dir: DOWNLOADS_DIR,
            exists: fs.existsSync(DOWNLOADS_DIR),
            activeCount: activeDownloads.length,
            completedCount: completedDownloads.length,
            totalCount: downloadManager.getAll().length
        },
        channels: {
            saved: savedChannels.size
        },
        tools: {
            ffmpeg: FFMPEG_AVAILABLE,
            cookies: isCookiesFileValid()
        }
    });
});

// =============================================================================
// FILE SERVING ENDPOINT
// =============================================================================

app.get('/api/files', (req, res) => {
    try {
        const files = fs.readdirSync(DOWNLOADS_DIR)
            .filter(f => f.endsWith('.mp4') || f.endsWith('.webm'))
            .map(f => {
                const filePath = path.join(DOWNLOADS_DIR, f);
                const stats = fs.statSync(filePath);
                return {
                    name: f,
                    size: stats.size,
                    sizeMB: Math.round(stats.size / 1024 / 1024 * 100) / 100,
                    modified: stats.mtime,
                    created: stats.birthtime
                };
            })
            .sort((a, b) => new Date(b.modified) - new Date(a.modified));

        res.json({
            success: true,
            files: files,
            count: files.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/download-file/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(DOWNLOADS_DIR, filename);

    // Security: Prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
    }

    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// =============================================================================
// ERROR HANDLING
// =============================================================================

app.use((err, req, res, next) => {
    console.error('\n❌ [Server Error]', err.message);
    console.error('Stack:', err.stack);
    
    res.status(500).json({ 
        error: 'Internal server error',
        message: err.message 
    });
});

// 404 handler - Enhanced with logging
app.use((req, res) => {
    console.log('\n[404] Not Found:', req.method, req.originalUrl);
    console.log('[404] This endpoint does not exist in server.js');
    console.log('[404] Available endpoints:');
    console.log('   GET  /api/health');
    console.log('   GET  /api/settings');
    console.log('   PUT  /api/settings');
    console.log('   GET  /api/channels');
    console.log('   POST  /api/channels');
    console.log('   DELETE /api/channels/:id');
    console.log('   POST  /api/channels/:id/check');
    console.log('   POST  /api/video/info');
    console.log('   POST  /api/download');           // ← MAIN DOWNLOAD ENDPOINT!
    console.log('   POST  /api/download/start');
    console.log('   GET  /api/download/:jobId');     // ← Status check
    console.log('   GET  /api/download/:id');       // Legacy status
    console.log('   POST  /api/download/:id/cancel');
    console.log('   GET  /api/downloads');
    console.log('   POST  /api/download/batch');     // ← Batch download (parallel)!');
    console.log('   POST  /api/download/sequential'); // ← Sequential download (ONE AT A TIME)!
    console.log('   GET  /api/download/sequential/status');  // ← Sequential progress!
    console.log('   POST  /api/download/sequential/pause');  // ← Pause/Resume!
    console.log('   POST  /api/download/sequential/cancel'); // ← Cancel sequential!
    console.log('   GET  /api/download/list');
    console.log('   GET  /api/download-queue');      // ← Queue status (frontend polls!)
    console.log('   DELETE /api/download-queue');    // ← Clear queue
    console.log('   GET  /api/channels/:id/stats');  // ← Video count comparison (NEW!)
    console.log('   GET  /api/system/status');
    console.log('   POST  /api/login');              // ← Authentication
    console.log('   POST  /api/logout');             // ← Authentication
    console.log('   GET  /api/auth/status');         // ← Auth status
    console.log('');
    
    res.status(404).json({ 
        error: 'Not found',
        endpoint: req.method + ' ' + req.originalUrl,
        availableEndpoints: [
            '/api/health',
            '/api/settings', 
            '/api/channels',
            '/api/channel/info',
            '/api/video/info',
            '/api/download',              // ← MAIN DOWNLOAD!
            '/api/download/start',
            '/api/download/batch',         // ← BATCH DOWNLOAD!
            '/api/download/sequential',    // ← SEQUENTIAL DOWNLOAD!
            '/api/download/sequential/status',  // ← Sequential progress
            '/api/download/sequential/pause',  // ← Pause/Resume
            '/api/download/sequential/cancel', // ← Cancel sequential
            '/api/downloads',
            '/api/download-queue',
            '/api/system/status',
            '/api/channels/:id/stats',     // ← Video count comparison (NEW!)
            '/api/login',                  // ← Auth
            '/api/logout',                 // ← Auth
            '/api/auth/status'             // ← Auth status
        ]
    });
});

// =============================================================================
// SERVER STARTUP
// =============================================================================

// Validate authentication configuration FIRST
validateAuthConfig();

// Convert cookie path to native format on startup
getNativeCookiePath();

// Log cookie mode
console.log('\n' + '='.repeat(70));
console.log('🍪 COOKIE MODE DETECTION');
console.log('='.repeat(70));

if (isCookiesFileValid()) {
    console.log('✅ Mode: cookies.txt file (RECOMMENDED)');
    console.log('   Path:', AUTH_CONFIG.cookieFilePath);
} else {
    console.log('⚠️  Mode: Browser fallback (' + AUTH_CONFIG.browserName + ')');
    console.log('   Reason: cookies.txt not found or invalid format');
    console.log('');
    console.log('💡 TIP: For better reliability:');
    console.log('   1. Install "Get cookies.txt LOCALLY" browser extension');
    console.log('   2. Export YouTube cookies to: ' + path.join(process.cwd(), 'cookies.txt'));
    console.log('   3. Restart server');
}
console.log('='.repeat(70) + '\n');

// Start server
app.listen(PORT, () => {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                   🚀 SERVER STARTED! 🚀                      ║');
    console.log('║                                                              ║');
    console.log(`║  🌐 Server:     http://localhost:${PORT}                            ║`);
    console.log(`║  📁 Downloads:  ${DOWNLOADS_DIR}        ║`);
    console.log(`║  🎬 FFmpeg:     ${FFMPEG_AVAILABLE ? '✅ Installed (merging enabled)' : '⚠️ Not found (using fallback)'}        ║`);
    console.log(`║  🍪 Cookies:    ${isCookiesFileValid() ? '✅ Valid' : '⚠️ Using browser'}                              ║`);
    console.log('║  🔐 Auth:       ✅ Enabled (Session-based)                        ║');
    console.log('║                                                              ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  Available API Endpoints:                                   ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  GET    /api/settings          View/change download folder     ║');
    console.log('║  PUT    /api/settings          Update settings                 ║');
    console.log('║  POST   /api/channels          Load channel videos             ║');
    console.log('║  POST   /api/download           Download single video           ║');
    console.log('║  POST   /api/download/batch     Batch download (parallel)        ║');
    console.log('║  POST   /api/download/sequential Sequential (one at a time)      ║');
    console.log('║  GET    /api/files              List all downloaded files        ║');
    console.log('║  GET    /api/download-file/:id  Download file by ID            ║');
    console.log('║  GET    /api/channels/:id/stats Video count comparison (NEW!)  ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('⭐ FEATURES ENABLED:');
    console.log('   - ✅ Authentication (Session-based, 2-day expiry)');
    console.log('   - ✅ Rate limiting (5 login attempts per 15 min)');
    console.log('   - ✅ Video count comparison (YouTube vs Downloaded)');
    console.log('   - ✅ Duplicate filename handling');
    console.log('   - ✅ Sequential download (one at a time)');
    console.log('');
});
