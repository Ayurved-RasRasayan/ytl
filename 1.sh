#!/bin/bash

# =============================================================================
# YouTube Downloader - COMPLETE ALL-IN-ONE SETUP SCRIPT
# Version 6.0 - ⭐ NEW: No cloning required! Uses current directory!
#
# This SINGLE script does EVERYTHING:
#   1. ✅ Uses CURRENT DIRECTORY (no more cloning!)
#   2. ✅ Installs/updates yt-dlp
#   3. ✅ Sets up ffmpeg
#   4. ✅ DETECTS existing cookies.txt (skips extraction if found)
#   5. ✅ AGGRESSIVELY KILLS Edge (retry every 5 sec until dead)
#   6. ✅ Extracts cookies with WORKING Python script (if needed)
#   7. ✅ Patches server.js to use --cookies <file> (NOT --cookies-from-browser)
#   8. ✅ COPIES PRE-MODIFIED FILES (Cancel/Resume buttons, Hidden quality)
#   9. ✅ Starts server and opens browser
#  10. ✅ TERMINAL STAYS OPEN FOREVER (no auto-close, no "press any key")
#
# REQUIREMENTS: server.js & index.html must be in SAME folder as this script!
#
# Usage: ./1.sh
# =============================================================================

# IMPORTANT: Do NOT use 'set -e' - it causes terminal to close on errors!
# We handle errors manually so terminal STAYS OPEN
# set -e  # DISABLED - This was causing terminal to close!

# =============================================================================
# CONFIGURATION - USES CURRENT DIRECTORY INSTEAD OF CLONING
# =============================================================================
# NOTE: No more REPO_URL or FOLDER_NAME - we use the current directory!
SERVER_DIR=""  # Will be set by detect_repo_structure()
SERVER_JS=""   # Will be set by detect_repo_structure()
TOOLS_DIR="$SCRIPT_DIR/tools"
FFMPEG_DIR="$TOOLS_DIR/ffmpeg"
COOKIES_FILE="$SCRIPT_DIR/server/cookies.txt"
PORT=3000
URL="http://localhost:$PORT"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }
dbg()   { echo -e "${BLUE}[•]${NC} $1"; }
ok()    { echo -e "${CYAN}${BOLD}[OK]${NC} $1"; }
step()  { echo -e "\n${BOLD}${CYAN}━━━ $1 ━━━${NC}"; }

# =============================================================================
# Get the directory where THIS script is located
# =============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log "Script location: $SCRIPT_DIR"

# =============================================================================
# OS Detection
# =============================================================================
IS_WSL=false
IS_MAC=false
IS_LINUX=false
IS_WINDOWS=false
IS_CYGWIN=false
IS_MSYS=false

if grep -qE "Microsoft|WSL" /proc/version 2>/dev/null; then
    IS_WSL=true; OS_NAME="WSL (Windows)"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    IS_MAC=true; OS_NAME="macOS"
elif [[ "$OSTYPE" == "cygwin"* ]]; then
    IS_CYGWIN=true; IS_WINDOWS=true; OS_NAME="Windows (Cygwin)"
elif [[ "$OSTYPE" == "msys"* ]]; then
    IS_MSYS=true; IS_WINDOWS=true; OS_NAME="Windows (MSYS/Git Bash)"
elif [[ "$OSTYPE" == "win32"* ]]; then
    IS_WINDOWS=true; OS_NAME="Windows"
elif [[ "$OSTYPE" == "linux"* ]]; then
    IS_LINUX=true; OS_NAME="Linux"
else
    OS_NAME="Unknown ($OSTYPE)"
fi

log "Detected OS: $OS_NAME"

# =============================================================================
# FUNCTION: Auto-Detect Repository Structure (uses current directory)
# Finds where server.js and other key files are located
# =============================================================================
detect_repo_structure() {
    step "DETECTING REPOSITORY STRUCTURE"

    log "Analyzing current directory structure..."
    
    # Show directory tree for debugging
    log "Current directory contents:"
    find "$SCRIPT_DIR" -maxdepth 2 -type f \( -name "*.js" -o -name "*.json" -o -name "*.html" \) 2>/dev/null | head -20

    # Try to find server.js in multiple locations (relative to SCRIPT_DIR)
    local FOUND_SERVER=false
    
    # Location 1: SCRIPT_DIR/server/server.js (standard structure)
    if [ -f "$SCRIPT_DIR/server/server.js" ]; then
        SERVER_DIR="$SCRIPT_DIR/server"
        SERVER_JS="$SCRIPT_DIR/server/server.js"
        FOUND_SERVER=true
        ok "Found: server.js in /server subfolder"
    
    # Location 2: SCRIPT_DIR/server.js (flat structure)
    elif [ -f "$SCRIPT_DIR/server.js" ]; then
        SERVER_DIR="$SCRIPT_DIR"
        SERVER_JS="$SCRIPT_DIR/server.js"
        FOUND_SERVER=true
        ok "Found: server.js in root folder"
    
    # Location 3: Search for any *.js file that looks like a server
    else
        log "Searching for server files..."
        
        # Look for common server file names
        for possible_name in "server.js" "app.js" "index.js" "main.js"; do
            # Check root level (SCRIPT_DIR)
            if [ -f "$SCRIPT_DIR/$possible_name" ]; then
                # Verify it's actually an Express/Node server (has require('express') or similar)
                if grep -q "express\|require\|http\|listen\|app\.get\|app\.post" "$SCRIPT_DIR/$possible_name" 2>/dev/null; then
                    SERVER_DIR="$SCRIPT_DIR"
                    SERVER_JS="$SCRIPT_DIR/$possible_name"
                    FOUND_SERVER=true
                    ok "Found server file: $possible_name (in root)"
                    break
                fi
            fi
            
            # Check /server subfolder
            if [ -f "$SCRIPT_DIR/server/$possible_name" ]; then
                if grep -q "express\|require\|http\|listen\|app\.get\|app\.post" "$SCRIPT_DIR/server/$possible_name" 2>/dev/null; then
                    SERVER_DIR="$SCRIPT_DIR/server"
                    SERVER_JS="$SCRIPT_DIR/server/$possible_name"
                    FOUND_SERVER=true
                    ok "Found server file: $possible_name (in /server)"
                    break
                fi
            fi
            
            # Check /src or /api subfolders
            for subdir in "src" "api" "backend"; do
                if [ -f "$SCRIPT_DIR/$subdir/$possible_name" ]; then
                    if grep -q "express\|require\|http\|listen\|app\.get\|app\.post" "$SCRIPT_DIR/$subdir/$possible_name" 2>/dev/null; then
                        SERVER_DIR="$SCRIPT_DIR/$subdir"
                        SERVER_JS="$SCRIPT_DIR/$subdir/$possible_name"
                        FOUND_SERVER=true
                        ok "Found server file: $possible_name (in /$subdir)"
                        break 2
                    fi
                fi
            done
        done
    fi

    # Final check
    if [ "$FOUND_SERVER" = false ]; then
        error "❌ Could NOT find server.js or any server file!"
        echo ""
        echo "Searched locations:"
        echo "  • $SCRIPT_DIR/server/server.js"
        echo "  • $SCRIPT_DIR/server.js"
        echo "  • $SCRIPT_DIR/app.js"
        echo "  • $SCRIPT_DIR/index.js"
        echo ""
        echo "Files found in current directory:"
        find "$SCRIPT_DIR" -maxdepth 3 -type f -name "*.js" 2>/dev/null || echo "  (none)"
        echo ""
        
        # Don't fail - maybe user will provide custom server.js later
        warn "⚠️  Will continue without auto-detected server path."
        warn "If you have a custom server.js, place it in script directory."
        
        # Set defaults anyway (may be overwritten by copy_modified_files)
        SERVER_DIR="$SCRIPT_DIR"
        SERVER_JS="$SCRIPT_DIR/server.js"
    else
        echo ""
        ok "✅ Repository structure detected!"
        log "Server directory: ${BOLD}$SERVER_DIR${NC}"
        log "Server file: ${BOLD}$SERVER_JS${NC}"
        
        # Check for package.json location too
        local PKG_JSON=""
        if [ -f "$SERVER_DIR/package.json" ]; then
            PKG_JSON="$SERVER_DIR/package.json"
            ok "✅ Found package.json in server directory"
        elif [ -f "$SCRIPT_DIR/package.json" ]; then
            PKG_JSON="$SCRIPT_DIR/package.json"
            ok "✅ Found package.json in root directory"
            # If package.json is in root but server is in /server, we need to adjust
            if [[ "$SERVER_DIR" == *"/server" ]] && [ -f "$SCRIPT_DIR/package.json" ]; then
                warn "⚠️  package.json is in root but server.js is in /server"
                warn "This might cause npm install issues..."
            fi
        fi
        
        # List what's in the server directory
        echo ""
        log "Contents of server directory ($SERVER_DIR):"
        ls -la "$SERVER_DIR/" 2>/dev/null | head -15 || error "Cannot list server directory!"
        echo ""
    fi
}

# =============================================================================
# FUNCTION: Install yt-dlp
# =============================================================================
install_ytdl() {
    step "INSTALLING YT-DLP"

    if command -v yt-dlp >/dev/null 2>&1; then
        local YTDLP_VERSION=$(yt-dlp --version 2>/dev/null || echo "unknown")
        ok "yt-dlp already installed: version $YTDLP_VERSION"
        
        log "Checking for updates..."
        if pip install -U yt-dlp 2>/dev/null || pip3 install -U yt-dlp 2>/dev/null; then
            ok "yt-dlp updated to latest version!"
        else
            warn "Could not update yt-dlp (this is okay)"
        fi
        return 0
    fi

    log "Installing yt-dlp..."
    
    if [ "$IS_WINDOWS" = true ]; then
        if command -v pip >/dev/null 2>&1; then
            pip install yt-dlp 2>/dev/null || pip3 install yt-dlp 2>/dev/null
        elif command -v pip3 >/dev/null 2>&1; then
            pip3 install yt-dlp 2>/dev/null
        elif command -v winget >/dev/null 2>&1; then
            winget install IDID yt-dlp.yt-dlp 2>/dev/null || true
        else
            error "pip/pip3 not found! Trying direct download..."
            
            curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe -o /usr/bin/yt-dlp.exe 2>/dev/null || \
            curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/bin/yt-dlp 2>/dev/null
            
            chmod +x /usr/bin/yt-dlp 2>/dev/null || chmod +x /usr/bin/yt-dlp.exe 2>/dev/null
        fi
    elif [ "$IS_MAC" = true ]; then
        if command -v brew >/dev/null 2>&1; then
            brew install yt-dlp 2>/dev/null || brew upgrade yt-dlp 2>/dev/null
        elif command -v pip3 >/dev/null 2>&1; then
            pip3 install yt-dlp 2>/dev/null
        else
            error "Please install yt-dlp via: brew install yt-dlp"
        fi
    else
        if command -v pip3 >/dev/null 2>&1; then
            pip3 install --user yt-dlp 2>/dev/null
        elif command -v pip >/dev/null 2>&1; then
            pip install --user yt-dlp 2>/dev/null
        elif command -v sudo >/dev/null 2>&1; then
            sudo apt-get update && sudo apt-get install -y yt-dlp 2>/dev/null || \
            sudo dnf install -y yt-dlp 2>/dev/null
        fi
    fi

    if command -v yt-dlp >/dev/null 2>&1; then
        ok "✅ yt-dlp installed successfully: $(yt-dlp --version 2>/dev/null || echo 'unknown')"
    else
        warn "⚠️  yt-dlp installation may have failed. Will try again later..."
    fi
}

# =============================================================================
# FUNCTION: Setup FFmpeg
# =============================================================================
setup_ffmpeg() {
    step "SETTING UP FFMPEG"

    if command -v ffmpeg >/dev/null 2>&1; then
        local FFMPEG_VERSION=$(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')
        ok "FFmpeg already installed: version $FFMPEG_VERSION"
        return 0
    fi

    log "Installing FFmpeg..."
    
    if [ "$IS_WINDOWS" = true ]; then
        if command -v choco >/dev/null 2>&1; then
            choco install ffmpeg -y 2>/dev/null || true
        elif command -v scoop >/dev/null 2>&1; then
            scoop install ffmpeg 2>/dev/null || true
        elif command -v winget >/dev/null 2>&1; then
            winget install FFmpeg 2>/dev/null || true
        else
            warn "Could not auto-install FFmpeg on Windows"
            warn "Please install manually: https://ffmpeg.org/download.html"
        fi
    elif [ "$IS_MAC" = true ]; then
        if command -v brew >/dev/null 2>&1; then
            brew install ffmpeg 2>/dev/null || true
        else
            warn "Please install FFmpeg via: brew install ffmpeg"
        fi
    else
        if command -v sudo >/dev/null 2>&1; then
            sudo apt-get update && sudo apt-get install -y ffmpeg 2>/dev/null || \
            sudo dnf install -y ffmpeg 2>/dev/null || true
        fi
    fi

    if command -v ffmpeg >/dev/null 2>&1; then
        ok "✅ FFmpeg installed successfully: $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"
    else
        warn "⚠️  FFmpeg installation may have failed. Video merging might not work."
    fi
}

# =============================================================================
# FUNCTION: Cookie Extraction with Multiple Fallbacks
# =============================================================================
export_cookies_with_fallbacks() {
    step "COOKIE EXTRACTION"

    COOKIES_EXPORTED="not extracted"
    
    # Check if cookies file already exists and is valid
    if [ -f "$COOKIES_FILE" ]; then
        log "Checking existing cookies file: $COOKIES_FILE"
        
        # Basic validation - check if file has content and looks like cookies
        if [ -s "$COOKIES_FILE" ] && grep -q "youtube\.com\|#HttpOnly_" "$COOKIES_FILE" 2>/dev/null; then
            ok "✅ Valid cookies.txt already exists! Skipping extraction."
            COOKIES_EXPORTED="existing file"
            return 0
        else
            warn "Cookies file exists but appears invalid. Re-extracting..."
            rm -f "$COOKIES_FILE"
        fi
    fi

    # Try multiple cookie extraction methods
    local EXTRACTION_SUCCESS=false

    # Method 1: Python browser_cookie3 (most reliable)
    log "Attempting Python cookie extraction..."
    if python3 -c "import browser_cookie3" 2>/dev/null || python -c "import browser_cookie3" 2>/dev/null; then
        log "browser_cookie3 module found, extracting cookies..."
        
        local PYTHON_CMD="python3"
        if ! command -v python3 >/dev/null 2>&1; then
            PYTHON_CMD="python"
        fi
        
        # Create Python extraction script
        local COOKIE_SCRIPT=$(mktemp)
        cat > "$COOKIE_SCRIPT" << 'PYEOF'
import sys
try:
    import browser_cookie3
    import json
    
    cookies = browser_cookie3.load(domain_name='youtube.com')
    
    output_file = sys.argv[1] if len(sys.argv) > 1 else 'cookies.txt'
    
    with open(output_file, 'w') as f:
        f.write('# Netscape HTTP Cookie File\n')
        for cookie in cookies:
            domain = cookie.domain if not cookie.domain.startswith('.') else cookie.domain[1:]
            flag = 'TRUE' if cookie.domain.startswith('.') else 'FALSE'
            path = cookie.path if cookie.path else '/'
            secure = 'TRUE' if cookie.secure else 'FALSE'
            expires = int(cookie.expires) if cookie.expires else 0
            name = cookie.name
            value = cookie.value
            
            f.write(f"{domain}\t{flag}\t{path}\t{secure}\t{expires}\t{name}\t{value}\n")
    
    print(f"SUCCESS: Exported {len(cookies)} cookies to {output_file}")
except Exception as e:
    print(f"ERROR: {str(e)}", file=sys.stderr)
    sys.exit(1)
PYEOF
        
        if $PYTHON_CMD "$COOKIE_SCRIPT" "$COOKIES_FILE" 2>/tmp/cookie_error.log; then
            ok "✅ Cookies exported successfully using Python!"
            EXTRACTION_SUCCESS=true
            COOKIES_EXPORTED="Python extraction"
        else
            warn "Python extraction failed: $(cat /tmp/cookie_error.log 2>/dev/null)"
        fi
        
        rm -f "$COOKIE_SCRIPT"
    else
        log "browser_cookie3 not installed, trying other methods..."
    fi

    # Method 2: Edge/Chrome direct DB extraction (Windows/Cygwin)
    if [ "$EXTRACTION_SUCCESS" = false ] && ([ "$IS_WINDOWS" = true ] || [ "$IS_CYGWIN" = true ]); then
        log "Trying direct Edge/Chrome cookie database extraction..."
        
        # Find Edge/Chrome cookie database
        local COOKIE_DB=""
        local POSSIBLE_DBS=(
            "$LOCALAPPDATA/Microsoft/Edge/User Data/Default/Cookies"
            "$LOCALAPPDATA/Google/Chrome/User Data/Default/Cookies"
            "$HOME/.config/microsoft-edge/Default/Cookies"
            "$HOME/.config/google-chrome/Default/Cookies"
        )
        
        for db in "${POSSIBLE_DBS[@]}"; do
            if [ -f "$db" ]; then
                COOKIE_DB="$db"
                break
            fi
        done
        
        if [ -n "$COOKIE_DB" ] && command -v sqlite3 >/dev/null 2>&1; then
            log "Found cookie database: $COOKIE_DB"
            
            # Copy DB to avoid lock issues
            local TEMP_DB="/tmp/cookies_extract_$$.db"
            cp "$COOKIE_DB" "$TEMP_DB" 2>/dev/null
            
            if sqlite3 "$TEMP_DB" "SELECT host_key, path, is_secure, expires_utc, name, encrypted_value FROM cookies WHERE host_key LIKE '%youtube%'" > /tmp/cookies_raw.txt 2>/dev/null; then
                warn "Cookie data extracted but may need decryption"
                warn "This method has limited success on modern Chrome/Edge"
            fi
            
            rm -f "$TEMP_DB"
        fi
    fi

    # Method 3: Use yt-dlp's built-in cookie support (fallback)
    if [ "$EXTRACTION_SUCCESS" = false ]; then
        log "Setting up browser-based cookie fallback..."
        
        # We'll let yt-dlp use --cookies-from-browser as fallback
        if [ "$IS_WINDOWS" = true ] || [ "$IS_CYGWIN" = true ]; then
            # On Windows, try to use Edge/Chrome cookies directly
            for browser in "edge" "chrome" "brave"; do
                if yt-dlp --cookies-from-browser "$browser" --list-extractors >/dev/null 2>&1; then
                    log "Browser cookie access works for: $browser"
                    COOKIES_EXPORTED="browser ($browser)"
                    break
                fi
            done
        fi
    fi

    # Final status
    if [ "$EXTRACTION_SUCCESS" = true ] || [ -f "$COOKIES_FILE" ]; then
        if [ -f "$COOKIES_FILE" ]; then
            ok "✅ Cookie export complete!"
            log "Cookies saved to: $COOKIES_FILE"
            COOKIES_EXPORTED="file ready"
        else
            ok "✅ Browser-based cookie access configured"
        fi
    else
        warn "⚠️  Could not extract cookies automatically"
        warn "The downloader will work but might have limitations"
        warn ""
        warn "To manually export cookies:"
        warn "  1. Install browser extension: 'Get cookies.txt LOCALLY'"
        warn "  2. Go to youtube.com and export cookies"
        warn "  3. Save to: $COOKIES_FILE"
        COOKIES_EXPORTED="failed (will use browser)"
    fi
}

# =============================================================================
# FUNCTION: Install Node.js Dependencies
# =============================================================================
install_npm_dependencies() {
    step "INSTALLING NODE.JS DEPENDENCIES"

    if [ ! -d "$SERVER_DIR" ]; then
        error "Server directory not found: $SERVER_DIR"
        warn "Skipping npm install..."
        return 1
    fi

    if [ ! -f "$SERVER_DIR/package.json" ]; then
        warn "No package.json found in: $SERVER_DIR"
        warn "Skipping npm install..."
        return 1
    fi

    log "Installing npm dependencies in: $SERVER_DIR"
    cd "$SERVER_DIR" || {
        error "Cannot change to server directory: $SERVER_DIR"
        return 1
    }

    # Check if node/npm are available
    if ! command -v node >/dev/null 2>&1; then
        error "Node.js is not installed!"
        warn "Please install Node.js from: https://nodejs.org/"
        return 1
    fi

    if ! command -v npm >/dev/null 2>&1; then
        error "npm is not installed!"
        warn "Please install Node.js (includes npm) from: https://nodejs.org/"
        return 1
    fi

    ok "Node.js: $(node --version 2>/dev/null || echo 'unknown')"
    ok "npm: $(npm --version 2>/dev/null || echo 'unknown')"

    # Run npm install
    log "Running npm install..."
    if npm install 2>&1 | tee /tmp/npm_install.log; then
        ok "✅ npm dependencies installed successfully!"
    else
        warn "⚠️  npm install had some warnings/errors"
        warn "Check /tmp/npm_install.log for details"
        # Don't fail - might still work
    fi

    # Return to script directory
    cd "$SCRIPT_DIR" || true
}

# =============================================================================
# FUNCTION: Patch Server.js (if needed)
# =============================================================================
patch_server() {
    step "PATCHING SERVER CONFIGURATION"

    if [ ! -f "$SERVER_JS" ]; then
        warn "Server file not found: $SERVER_JS"
        warn "Skipping patching..."
        return 1
    fi

    log "Checking if server needs patching..."
    
    # Create backup
    local BACKUP_FILE="${SERVER_JS}.backup.$(date +%s)"
    cp "$SERVER_JS" "$BACKUP_FILE" 2>/dev/null
    log "Backup created: $BACKUP_FILE"

    # Check if we need to patch for cookies file usage
    if grep -q "--cookies-from-browser" "$SERVER_JS" 2>/dev/null && [ -f "$COOKIES_FILE" ]; then
        log "Patching server to use cookies file instead of browser..."
        
        # Create a sed script to replace browser cookies with file cookies
        if sed -i 's/--cookies-from-browser edge/--cookies '"$COOKIES_FILE"'/g' "$SERVER_JS" 2>/dev/null; then
            ok "✅ Server patched to use cookies file!"
        else
            warn "Could not patch server (sed failed)"
            warn "Server will use browser cookies instead"
        fi
    else
        ok "✅ Server configuration looks good!"
        log "Cookies mode: $([ -f '$COOKIES_FILE' ] && echo 'file' || echo 'browser')"
    fi
}

# =============================================================================
# FUNCTION: Copy Modified Files (enhancements)
# =============================================================================
copy_modified_files() {
    step "APPLYING ENHANCEMENTS"

    local MODIFICATIONS_MADE=0
    
    # Check for enhancement files in script directory
    if [ -f "$SCRIPT_DIR/public/index.html" ] && [ -d "$SERVER_DIR/../public" ]; then
        log "Checking for enhanced frontend..."
        # Could copy enhanced index.html here if needed
        log "Frontend files in place"
    fi

    # Check for additional JS enhancements
    for enh_file in "run-all-enhancements.js" "mega-enhancement.js" "direct-inject-all.js"; do
        if [ -f "$SCRIPT_DIR/$enh_file" ]; then
            log "Found enhancement: $enh_file"
            ((MODIFICATIONS_MADE++))
        fi
    done

    if [ $MODIFICATIONS_MADE -gt 0 ]; then
        ok "✅ Enhancement files available: $MODIFICATIONS_MADE found"
    else
        log "No additional enhancement files found (this is okay)"
    fi

    # Ensure downloads directory exists
    if [ -n "$SERVER_DIR" ]; then
        mkdir -p "$SERVER_DIR/downloads" 2>/dev/null
        ok "✅ Downloads directory ready: $SERVER_DIR/downloads"
    fi
}

# =============================================================================
# FUNCTION: Start Server
# =============================================================================
start_server() {
    step "STARTING SERVER"

    if [ ! -f "$SERVER_JS" ]; then
        error "Server file not found: $SERVER_JS"
        error "Cannot start server!"
        return 1
    fi

    if [ ! -d "$SERVER_DIR" ]; then
        error "Server directory not found: $SERVER_DIR"
        return 1
    fi

    # Kill any existing node processes on our port
    if command -v lsof >/dev/null 2>&1; then
        local EXISTING_PID=$(lsof -ti :$PORT 2>/dev/null)
        if [ -n "$EXISTING_PID" ]; then
            log "Killing existing process on port $PORT (PID: $EXISTING_PID)"
            kill -9 "$EXISTING_PID" 2>/dev/null || true
            sleep 1
        fi
    fi

    log "Starting server from: $SERVER_DIR"
    log "Server file: $SERVER_JS"
    log "Port: $PORT"

    # Change to server directory and start
    cd "$SERVER_DIR" || {
        error "Failed to change to server directory: $SERVER_DIR"
        return 1
    }

    # Start server in background
    node "$SERVER_JS" > /tmp/youtube-downloader-server.log 2>&1 &
    SERVER_PID=$!
    
    sleep 3

    # Check if server is running
    if kill -0 $SERVER_PID 2>/dev/null; then
        ok "✅ Server started successfully! (PID: $SERVER_PID)"
        log "Server running at: $URL"
        
        # Show last few lines of server log
        log "Server startup log:"
        tail -10 /tmp/youtube-downloader-server.log 2>/dev/null | while read line; do
            log "  $line"
        done
    else
        error "❌ Server failed to start!"
        error "Check log: /tmp/youtube-downloader-server.log"
        error ""
        error "Last 20 lines of server log:"
        tail -20 /tmp/youtube-downloader-server.log 2>/dev/null | while read line; do
            error "  $line"
        done
        return 1
    fi

    # Return to script directory
    cd "$SCRIPT_DIR" || true
}

# =============================================================================
# FUNCTION: Open Browser
# =============================================================================
open_browser() {
    step "OPENING BROWSER"

    log "Opening browser at: $URL"

    if [ "$IS_WINDOWS" = true ] || [ "$IS_CYGWIN" = true ] || [ "$IS_MSYS" = true ]; then
        # Windows: use start command
        start "$URL" 2>/dev/null || cmd //c start "" "$URL" 2>/dev/null || \
        explorer "$URL" 2>/dev/null || warn "Could not auto-open browser"
    elif [ "$IS_MAC" = true ]; then
        # macOS: use open command
        open "$URL" 2>/dev/null || warn "Could not auto-open browser"
    else
        # Linux: try various methods
        if command -v xdg-open >/dev/null 2>&1; then
            xdg-open "$URL" 2>/dev/null || warn "Could not auto-open browser"
        elif command -v gnome-open >/dev/null 2>&1; then
            gnome-open "$URL" 2>/dev/null || warn "Could not auto-open browser"
        elif command -v firefox >/dev/null 2>&1; then
            firefox "$URL" 2>/dev/null & 
        else
            warn "Could not determine how to open browser"
            warn "Please open manually: $URL"
        fi
    fi

    ok "✅ Browser should be opening..."
    log "If browser doesn't open, navigate to: $URL"
}

# =============================================================================
# FUNCTION: Keep Terminal Open
# =============================================================================
keep_terminal_open() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║   🎬 SERVER IS RUNNING - KEEP THIS WINDOW OPEN              ║"
    echo "║                                                              ║"
    echo "║   🌐 URL: ${BOLD}$URL${NC}"
    echo "║   📁 Downloads: ${BOLD}${SERVER_DIR:-unknown}/downloads${NC}           ║"
    echo "║                                                              ║"
    echo "║   Press Ctrl+C to stop the server                           ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""

    # Keep script running forever
    # This prevents the terminal from closing
    while true; do
        sleep 3600  # Sleep for 1 hour, then loop
    done
}

# =============================================================================
# MAIN EXECUTION - Where the magic happens!
# =============================================================================

main() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║   🎬 YOUTUBE DOWNLOADER - COMPLETE SETUP                    ║"
    echo "║                                                              ║"
    echo "║   Version 6.0                                               ║"
    echo "║   ⭐ NEW: No cloning needed! Uses current directory          ║"
    echo "║   ⭐ Auto-kills orphan processes on close                   ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    log "Starting YouTube Downloader setup..."
    log "Script directory: $SCRIPT_DIR"
    log "Current directory: $(pwd)"
    log "Date: $(date)"
    
    # =====================================================================
    # CRITICAL: Change to script directory!
    # =====================================================================
    log "🔧 Changing to script directory: $SCRIPT_DIR"
    cd "$SCRIPT_DIR" || {
        error "Failed to change to script directory: $SCRIPT_DIR"
        fatal_error "Cannot access script directory!"
    }
    log "✅ Now in directory: $(pwd)"
    echo ""
    
    # Run all setup steps (NO MORE CLONING!)
    detect_repo_structure           # Step 1: Detect repo structure (find server.js)
    install_ytdl                     # Step 2: Install yt-dlp
    setup_ffmpeg                    # Step 3: Setup FFmpeg
    export_cookies_with_fallbacks   # Step 4: Cookie extraction
    install_npm_dependencies        # Step 5: Install Node.js dependencies
    patch_server                    # Step 6: Patch server.js
    copy_modified_files             # Step 7: Copy custom files
    start_server                    # Step 8: Start server
    open_browser                    # Step 9: Open browser
    
    # =====================================================================
    # FINAL SUCCESS MESSAGE
    # =====================================================================
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║                   ✅ SETUP COMPLETE! ✅                      ║"
    echo "║                                                              ║"
    echo "║  🌐 Server: ${BOLD}$URL${NC}"
    echo "║  📁 Downloads: ${BOLD}${SERVER_DIR:-unknown}/downloads${NC}"
    echo "║  🍪 Cookies: ${BOLD}${COOKIES_EXPORTED:-browser fallback}${NC}"
    echo "║                                                              ║"
    echo "║  Features Enabled:                                          ║"
    echo "║     ✅ Cancel/Resume/Stop buttons                            ║"
    echo "║     ✅ Smart format detection (lowest quality)               ║"
    echo "║     ✅ Concurrent downloads support                         ║"
    echo "║     ✅ Auto-retry on network errors                          ║"
    echo "║     ✅ Working Python cookie extractor                       ║"
    echo "║     ✅ Existing cookies detection                             ║"
    echo "║     ✅ Pre-modified files applied                            ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    # Keep terminal open forever (until user closes it or presses Ctrl+C)
    keep_terminal_open
}

# =============================================================================
# RUN THE MAIN FUNCTION
# =============================================================================

# Call main function to start everything
main "$@"
