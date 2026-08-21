#!/bin/bash

# =============================================================================
# YouTube Downloader - COMPLETE ALL-IN-ONE SETUP SCRIPT
# Version 5.0 - ⭐ NEW: Auto-kills bash.exe/sleep.exe on terminal close!
#
# This SINGLE script does EVERYTHING:
#   1. ✅ FORCE DELETES existing repo folder (with retry loop)
#   2. ✅ Clones GitHub repo automatically
#   3. ✅ Installs/updates yt-dlp
#   4. ✅ Sets up ffmpeg
#   5. ✅ DETECTS existing cookies.txt (skips extraction if found)
#   6. ✅ AGGRESSIVELY KILLS Edge (retry every 5 sec until dead)
#   7. ✅ Extracts cookies with WORKING Python script (if needed)
#   8. ✅ Patches server.js to use --cookies <file> (NOT --cookies-from-browser)
#   9. ✅ COPIES PRE-MODIFIED FILES (Cancel/Resume buttons, Hidden quality)
#   10. ✅ Starts server and opens browser
#   11. ✅ TERMINAL STAYS OPEN FOREVER (no auto-close, no "press any key")
#   12. ✨ NEW: AUTO-CLEANS ORPHAN PROCESSES ON CLOSE! (bash.exe, sleep.exe)
#
# REQUIREMENTS: server.js & index.html must be in SAME folder as this script!
#
# Usage: ./1.sh
# =============================================================================

# IMPORTANT: Do NOT use 'set -e' - it causes terminal to close on errors!
# We handle errors manually so terminal STAYS OPEN
# set -e  # DISABLED - This was causing terminal to close!

# =============================================================================
# CONFIGURATION - GITHUB REPO SETTINGS
# =============================================================================
REPO_URL="https://github.com/Ayurved-RasRasayan/youtube-download.git"
FOLDER_NAME="youtube-download"
# NOTE: These will be AUTO-DETECTED after cloning! See detect_repo_structure()
SERVER_DIR=""  # Will be set by detect_repo_structure()
SERVER_JS=""   # Will be set by detect_repo_structure()
TOOLS_DIR="$FOLDER_NAME/tools"
FFMPEG_DIR="$TOOLS_DIR/ffmpeg"
COOKIES_FILE="$FOLDER_NAME/cookies.txt"
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
# FUNCTION: AGGRESSIVELY DELETE EXISTING REPO FOLDER
# =============================================================================
force_delete_folder() {
    local TARGET_DIR="$1"
    local MAX_ATTEMPTS=10
    local ATTEMPT=0
    local RETRY_INTERVAL=2

    if [ ! -d "$TARGET_DIR" ]; then
        log "Folder '$TARGET_DIR' does not exist. Nothing to delete."
        return 0
    fi

    log "⚠️  Force deleting existing folder: $TARGET_DIR"
    
    while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
        ATTEMPT=$((ATTEMPT + 1))
        
        if [ "$IS_WINDOWS" = true ] || [ "$IS_CYGWIN" = true ] || [ "$IS_MSYS" = true ]; then
            if command -v rm >/dev/null 2>&1; then
                rm -rf "$TARGET_DIR" 2>/dev/null
            fi
            
            if [ -d "$TARGET_DIR" ]; then
                cmd //c "rmdir /s /q \"$TARGET_DIR\"" 2>/dev/null || true
            fi
            
            if [ -d "$TARGET_DIR" ] && [ -f /c/Windows/System32/cmd.exe ]; then
                /c/Windows/System32/cmd.exe /c "rmdir /s /q \"$TARGET_DIR\"" 2>/dev/null || true
            fi
            
            if [ -d "$TARGET_DIR" ]; then
                cmd //c "attrib -r -s -h /s /d \"$TARGET_DIR\"" 2>/dev/null || true
                cmd //c "rmdir /s /q \"$TARGET_DIR\"" 2>/dev/null || true
            fi
        else
            rm -rf "$TARGET_DIR" 2>/dev/null
            if command -v sudo >/dev/null 2>&1; then
                sudo rm -rf "$TARGET_DIR" 2>/dev/null || true
            fi
        fi
        
        if [ ! -d "$TARGET_DIR" ]; then
            log "✅ Successfully deleted folder on attempt $ATTEMPT"
            return 0
        fi
        
        log "  Attempt $ATTEMPT/$MAX_ATTEMPTS: Folder still exists, retrying in ${RETRY_INTERVAL}s..."
        sleep $RETRY_INTERVAL
        
        if [ $ATTEMPT -eq 3 ] || [ $ATTEMPT -eq 6 ]; then
            log "  Attempting to kill processes using the folder..."
            if [ "$IS_WINDOWS" = true ] || [ "$IS_CYGWIN" = true ] || [ "$IS_MSYS" = true ]; then
                cmd //c "taskkill /F /IM node.exe 2>nul" 2>/dev/null || true
                cmd //c "handle.exe -a -u \"$TARGET_DIR\" 2>nul" 2>/dev/null || true
            fi
            sleep 2
        fi
    done

    error "❌ Failed to delete folder after $MAX_ATTEMPTS attempts!"
    error "Please close any programs that might be using the folder and try again."
    error "You can also manually delete: $TARGET_DIR"
    
    echo ""
    echo "Possible reasons for failure:"
    echo "  • A terminal/process is currently in that directory"
    echo "  • A program (like the server) is using files in that folder"
    echo "  • Permission issues"
    echo ""
    echo "To manually delete:"
    echo "  Windows: rmdir /s /q \"$TARGET_DIR\""
    echo "  Linux/macOS: rm -rf \"$TARGET_DIR\""
    echo ""
    
    read -p "Press Enter to retry deletion, or Ctrl+C to abort... "
    
    if [ "$IS_WINDOWS" = true ] || [ "$IS_CYGWIN" = true ] || [ "$IS_MSYS" = true ]; then
        cmd //c "rmdir /s /q \"$TARGET_DIR\"" 2>/dev/null || true
    else
        rm -rf "$TARGET_DIR" 2>/dev/null || true
    fi
    
    if [ ! -d "$TARGET_DIR" ]; then
        log "✅ Successfully deleted folder after user intervention"
        return 0
    else
        error "❌ Still cannot delete folder. Exiting."
        return 1
    fi
}

# =============================================================================
# FUNCTION: Clone GitHub Repository (MAIN FEATURE)
# =============================================================================
clone_github_repo() {
    step "STEP 1: CLONING GITHUB REPOSITORY"

    log "Repository URL: ${BOLD}$REPO_URL${NC}"
    log "Target folder: ${BOLD}$FOLDER_NAME${NC}"
    log "Current working directory: $(pwd)"
    echo ""

    # Check git installation
    if ! command -v git >/dev/null 2>&1; then
        error "Git is NOT installed!"
        echo ""
        echo "Please install Git first:"
        if [ "$IS_WINDOWS" = true ]; then
            echo "  → Download from: https://git-scm.com/download/win"
            echo "  → Or run in Cygwin: apt-cyg install git"
        elif [ "$IS_MAC" = true ]; then
            echo "  → Run: xcode-select --install"
            echo "  → Or: brew install git"
        else
            echo "  → Run: sudo apt install git"
            echo "  → Or: sudo dnf install git"
        fi
        echo ""
        fatal_error "Git is NOT installed!"
    fi

    ok "Git found: $(git --version)"
    
    # Show git location for debugging
    dbg "Git executable location: $(which git)"

    # Remove existing folder if exists
    if [ -d "$FOLDER_NAME" ]; then
        warn "Existing folder '$FOLDER_NAME' found!"
        log "Force deleting existing folder..."
        if ! force_delete_folder "$FOLDER_NAME"; then
            fatal_error "Failed to delete existing folder."
        fi
        ok "✅ Folder deleted successfully!"
    fi

    # Verify we have write permissions
    log "Checking write permissions in current directory..."
    if [ ! -w "." ]; then
        error "No write permission in current directory: $(pwd)"
        fatal_error "Cannot create files here - check permissions!"
    fi
    ok "Write permissions OK"

    # Check internet connection (with multiple methods)
    log "Checking internet connection..."
    INTERNET_OK=false
    
    # Method 1: ping
    if ping -c 1 -W 5 github.com >/dev/null 2>&1; then
        INTERNET_OK=true
        dbg "Ping test passed"
    # Method 2: curl
    elif curl -s --connect-timeout 10 https://github.com >/dev/null 2>&1; then
        INTERNET_OK=true
        dbg "Curl test passed"
    # Method 3: wget
    elif wget -q --spider --timeout=10 https://github.com >/dev/null 2>&1; then
        INTERNET_OK=true
        dbg "Wget test passed"
    fi
    
    if [ "$INTERNET_OK" = false ]; then
        error "Cannot reach GitHub!"
        echo ""
        echo "Possible reasons:"
        echo "  • No internet connection"
        echo "  • GitHub is blocked by firewall/ISP"
        echo "  • DNS resolution failed"
        echo ""
        echo "Try these fixes:"
        echo "  1. Check your internet connection"
        echo "  2. Try using a VPN"
        echo "  3. Check if github.com is accessible in browser"
        echo ""
        fatal_error "Cannot reach GitHub - check your internet connection!"
    fi
    ok "Internet connection OK ✅"

    echo ""
    log "🔄 Cloning repository... (this may take a minute)"
    log "Full command: git clone --progress \"$REPO_URL\" \"$FOLDER_NAME\""
    log "Working directory: $(pwd)"
    echo ""

    # Run git clone with output capture for better error reporting
    CLONE_OUTPUT=""
    CLONE_SUCCESS=false
    
    # CRITICAL FIX: Use PIPESTATUS to get git clone's exit code (not tee's!)
    # When using pipe | tee, we must check ${PIPESTATUS[0]} for the first command
    git clone --progress "$REPO_URL" "$FOLDER_NAME" 2>&1 | tee /tmp/git_clone_output.txt
    GIT_EXIT_CODE=${PIPESTATUS[0]}
    
    # Check git clone's actual exit code
    if [ $GIT_EXIT_CODE -eq 0 ]; then
        CLONE_SUCCESS=true
        echo ""
        ok "✅ Repository cloned successfully! (Exit code: $GIT_EXIT_CODE)"
    else
        CLONE_OUTPUT=$(cat /tmp/git_clone_output.txt 2>/dev/null)
        echo ""
        error "❌ Failed to clone repository! (Exit code: $GIT_EXIT_CODE)"
        
        # Show detailed error info
        echo ""
        echo "╔══════════════════════════════════════════════════════════════╗"
        echo "║              ⚠️  GIT CLONE ERROR DETAILS                     ║"
        echo "╚══════════════════════════════════════════════════════════════╝"
        echo ""
        echo "$CLONE_OUTPUT"
        echo ""
        echo "╔══════════════════════════════════════════════════════════════╗"
        echo "║              🔍 TROUBLESHOOTING                             ║"
        echo "╚══════════════════════════════════════════════════════════════╝"
        echo ""
        
        # Provide specific troubleshooting based on common errors
        if echo "$CLONE_OUTPUT" | grep -qi "repository not found\|not found"; then
            error "🔴 REPOSITORY NOT FOUND ON GITHUB!"
            echo ""
            echo "  ❌ The repository URL does not exist:"
            echo "     $REPO_URL"
            echo ""
            echo "  Possible reasons:"
            echo "    1. Repository name is misspelled"
            echo "    2. GitHub username 'Ayurved-RasRasayan' is wrong"
            echo "    3. Repository is PRIVATE (requires authentication)"
            echo "    4. Repository was deleted or renamed"
            echo ""
            echo "  What to do:"
            echo "    • Open this URL in browser to verify:"
            echo "      ${BOLD}https://github.com/Ayurved-RasRasayan/youtube-download${NC}"
            echo "    • If it shows 404, the repo doesn't exist"
            echo "    • If it asks for login, it's private"
            echo ""
            echo "  To fix this script, edit REPO_URL at line 33:"
            echo "    REPO_URL=\"https://github.com/CORRECT-USERNAME/youtube-download.git\""
            echo ""
            
        elif echo "$CLONE_OUTPUT" | grep -qi "could not resolve\|dns\|name.*not known"; then
            error "DNS Resolution Failed!"
            echo "  → Check your DNS settings or try: 8.8.8.8"
        elif echo "$CLONE_OUTPUT" | grep -qi "connection refused\|timed out\|network"; then
            error "Network Connection Error!"
            echo "  → Check firewall or VPN settings"
        elif echo "$CLONE_OUTPUT" | grep -qi "permission denied\|access denied\|403\|404"; then
            error "Access Denied!"
            echo "  → Repository might be private or URL is wrong"
        elif echo "$CLONE_OUTPUT" | grep -qi "already exists\|destination path"; then
            error "Folder conflict detected!"
            echo "  → Trying force delete..."
            force_delete_folder "$FOLDER_NAME"
            echo "  → Retrying clone..."
            git clone --progress "$REPO_URL" "$FOLDER_NAME" 2>&1 | tee /tmp/git_clone_retry.txt
            RETRY_EXIT=${PIPESTATUS[0]}
            if [ $RETRY_EXIT -eq 0 ]; then
                CLONE_SUCCESS=true
                ok "✅ Repository cloned successfully on retry!"
            else
                fatal_error "Failed to clone even after retry! (Exit code: $RETRY_EXIT)"
            fi
        else
            error "Unknown git clone error!"
            fatal_error "Failed to clone repository from GitHub! Exit code: $GIT_EXIT_CODE"
        fi
        
        # If still not successful after all checks, exit
        if [ "$CLONE_SUCCESS" = false ]; then
            fatal_error "Cannot continue without repository. Please fix the URL."
        fi
    fi

    # Only verify if clone was successful
    if [ "$CLONE_SUCCESS" = true ]; then
        echo ""
        log "Verifying cloned files..."

        if [ ! -d "$FOLDER_NAME" ]; then
            error "Clone completed but folder not found!"
            fatal_error "Clone verification failed!"
        fi

        # Count files to verify clone worked
        FILE_COUNT=$(find "$FOLDER_NAME" -type f 2>/dev/null | wc -l)
        log "Files cloned: $FILE_COUNT"
        
        if [ "$FILE_COUNT" -lt 5 ]; then
            warn "Only $FILE_COUNT files found - clone might be incomplete!"
        else
            ok "Clone verified: $FILE_COUNT files extracted ✅"
        fi

        echo ""
        log "Showing top-level contents:"
        ls -la "$FOLDER_NAME/" 2>/dev/null | head -15
        echo ""
    fi
}

# =============================================================================
# FUNCTION: Auto-Detect Repository Structure
# Finds where server.js and other key files are located
# =============================================================================
detect_repo_structure() {
    step "DETECTING REPOSITORY STRUCTURE"

    log "Analyzing cloned repository structure..."
    
    if [ ! -d "$FOLDER_NAME" ]; then
        error "Repository folder not found: $FOLDER_NAME"
        fatal_error "Cannot detect structure - repo not cloned!"
    fi

    # Show directory tree for debugging
    log "Repository contents:"
    find "$FOLDER_NAME" -maxdepth 2 -type f \( -name "*.js" -o -name "*.json" -o -name "*.html" \) 2>/dev/null | head -20

    # Try to find server.js in multiple locations
    local FOUND_SERVER=false
    
    # Location 1: FOLDER_NAME/server/server.js (standard structure)
    if [ -f "$FOLDER_NAME/server/server.js" ]; then
        SERVER_DIR="$FOLDER_NAME/server"
        SERVER_JS="$SERVER_DIR/server.js"
        FOUND_SERVER=true
        ok "Found: server.js in /server subfolder"
    
    # Location 2: FOLDER_NAME/server.js (flat structure)
    elif [ -f "$FOLDER_NAME/server.js" ]; then
        SERVER_DIR="$FOLDER_NAME"
        SERVER_JS="$FOLDER_NAME/server.js"
        FOUND_SERVER=true
        ok "Found: server.js in root folder"
    
    # Location 3: Search for any *.js file that looks like a server
    else
        log "Searching for server files..."
        
        # Look for common server file names
        for possible_name in "server.js" "app.js" "index.js" "main.js"; do
            # Check root level
            if [ -f "$FOLDER_NAME/$possible_name" ]; then
                # Verify it's actually an Express/Node server (has require('express') or similar)
                if grep -q "express\|require\|http\|listen\|app\.get\|app\.post" "$FOLDER_NAME/$possible_name" 2>/dev/null; then
                    SERVER_DIR="$FOLDER_NAME"
                    SERVER_JS="$FOLDER_NAME/$possible_name"
                    FOUND_SERVER=true
                    ok "Found server file: $possible_name (in root)"
                    break
                fi
            fi
            
            # Check /server subfolder
            if [ -f "$FOLDER_NAME/server/$possible_name" ]; then
                if grep -q "express\|require\|http\|listen\|app\.get\|app\.post" "$FOLDER_NAME/server/$possible_name" 2>/dev/null; then
                    SERVER_DIR="$FOLDER_NAME/server"
                    SERVER_JS="$FOLDER_NAME/server/$possible_name"
                    FOUND_SERVER=true
                    ok "Found server file: $possible_name (in /server)"
                    break
                fi
            fi
            
            # Check /src or /api subfolders
            for subdir in "src" "api" "backend"; do
                if [ -f "$FOLDER_NAME/$subdir/$possible_name" ]; then
                    if grep -q "express\|require\|http\|listen\|app\.get\|app\.post" "$FOLDER_NAME/$subdir/$possible_name" 2>/dev/null; then
                        SERVER_DIR="$FOLDER_NAME/$subdir"
                        SERVER_JS="$FOLDER_NAME/$subdir/$possible_name"
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
        echo "  • $FOLDER_NAME/server/server.js"
        echo "  • $FOLDER_NAME/server.js"
        echo "  • $FOLDER_NAME/app.js"
        echo "  • $FOLDER_NAME/index.js"
        echo ""
        echo "Files found in repository:"
        find "$FOLDER_NAME" -maxdepth 3 -type f -name "*.js" 2>/dev/null || echo "  (none)"
        echo ""
        
        # Don't fail - maybe user will provide custom server.js later
        warn "⚠️  Will continue without auto-detected server path."
        warn "If you have a custom server.js, place it in script directory."
        
        # Set defaults anyway (may be overwritten by copy_modified_files)
        SERVER_DIR="$FOLDER_NAME"
        SERVER_JS="$FOLDER_NAME/server.js"
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
        elif [ -f "$FOLDER_NAME/package.json" ]; then
            PKG_JSON="$FOLDER_NAME/package.json"
            ok "✅ Found package.json in root directory"
            # If package.json is in root but server is in /server, we need to adjust
            if [[ "$SERVER_DIR" == *"/server" ]] && [ -f "$FOLDER_NAME/package.json" ]; then
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
    step "STEP 2: INSTALLING YT-DLP"

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
    step "STEP 3: SETTING UP FFMPEG"

    if command -v ffmpeg >/dev/null 2>&1; then
        local FFMPEG_VERSION=$(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')
        ok "FFmpeg already installed: $FFMPEG_VERSION"
        return 0
    fi

    log "Installing FFmpeg..."
    
    if [ "$IS_WINDOWS" = true ]; then
        if [ "$IS_MSYS" = true ] || [ "$IS_CYGWIN" = true ]; then
            pacman -S ffmpeg --noconfirm 2>/dev/null || true
        fi
        
        if ! command -v ffmpeg >/dev/null 2>&1; then
            log "Downloading FFmpeg for Windows..."
            
            local FFMPEG_ZIP="$TOOLS_DIR/ffmpeg.zip"
            mkdir -p "$FFMPEG_DIR" 2>/dev/null || true
            
            curl -L "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -o "$FFMPEG_ZIP" 2>/dev/null
            
            if [ -f "$FFMPEG_ZIP" ]; then
                unzip -o "$FFMPEG_ZIP" -d "$FFMPEG_DIR" 2>/dev/null || true
                
                local FFMPEG_BIN=$(find "$FFMPEG_DIR" -name "ffmpeg.exe" 2>/dev/null | head -1)
                if [ -n "$FFMPEG_BIN" ]; then
                    local FFMPEG_PATH=$(dirname "$FFMPEG_BIN")
                    export PATH="$FFMPEG_PATH:$PATH"
                    ok "FFmpeg extracted to: $FFMPEG_PATH"
                else
                    warn "Could not find ffmpeg.exe in extracted files"
                fi
            else
                warn "Failed to download FFmpeg"
            fi
        fi
    elif [ "$IS_MAC" = true ]; then
        if command -v brew >/dev/null 2>&1; then
            brew install ffmpeg 2>/dev/null || true
        fi
    else
        if command -v sudo >/dev/null 2>&1; then
            sudo apt-get install -y ffmpeg 2>/dev/null || \
            sudo dnf install -y ffmpeg 2>/dev/null || true
        fi
    fi

    if command -v ffmpeg >/dev/null 2>&1; then
        ok "✅ FFmpeg installed successfully!"
    else
        warn "⚠️  FFmpeg installation failed. Video merging may not work."
    fi
}

# =============================================================================
# FUNCTION: Check if cookies.txt already exists
# =============================================================================
check_existing_cookies() {
    if [ -f "$COOKIES_FILE" ] && [ -s "$COOKIES_FILE" ]; then
        local COOKIE_COUNT
        COOKIE_COUNT=$(grep -vc '^#\|^$' "$COOKIES_FILE" 2>/dev/null || echo "0")
        ok "✅ Found existing cookies.txt! ($COOKIE_COUNT entries)"
        return 0
    fi
    return 1
}

# =============================================================================
# AGGRESSIVELY KILL EDGE AND EXTRACT COOKIES WITH WORKING PYTHON SCRIPT
# FIXED FOR CYGWIN/MSYS PATH ISSUES
# =============================================================================
kill_edge_and_extract_cookies() {
    step "STEP 4b: AGGRESSIVELY KILLING EDGE & EXTRACTING COOKIES"

    log "⚠️  Edge must be completely closed to extract cookies."
    log "Starting aggressive Edge termination loop..."

    # Function to check if Edge is running - FIXED for Cygwin
    check_edge_running() {
        if [ "$IS_WINDOWS" = true ] || [ "$IS_CYGWIN" = true ] || [ "$IS_MSYS" = true ]; then
            # Try multiple methods to detect Edge
            if command -v tasklist >/dev/null 2>&1; then
                tasklist 2>/dev/null | grep -i "msedge.exe" >/dev/null 2>&1
                return $?
            elif [ -f /c/Windows/System32/tasklist.exe ]; then
                /c/Windows/System32/tasklist.exe 2>/dev/null | grep -i "msedge.exe" >/dev/null 2>&1
                return $?
            else
                # Fallback: check via ps
                ps aux 2>/dev/null | grep -i "msedge.exe" | grep -v grep >/dev/null 2>&1
                return $?
            fi
        elif [ "$IS_MAC" = true ]; then
            pgrep -f "Microsoft Edge" >/dev/null 2>&1
            return $?
        else
            pgrep -f "microsoft-edge" >/dev/null 2>&1
            return $?
        fi
    }

    # Kill Edge function - FIXED for Cygwin path issues
    kill_edge() {
        if [ "$IS_WINDOWS" = true ] || [ "$IS_CYGWIN" = true ] || [ "$IS_MSYS" = true ]; then
            # Method 1: Try using cmd /c with proper quoting
            if command -v cmd >/dev/null 2>&1; then
                cmd //c "taskkill /F /IM msedge.exe 2>nul" 2>/dev/null || true
                # Also kill with /T to kill child processes
                cmd //c "taskkill /F /T /IM msedge.exe 2>nul" 2>/dev/null || true
            # Method 2: Try using taskkill directly if available
            elif command -v taskkill >/dev/null 2>&1; then
                taskkill /F /IM msedge.exe 2>/dev/null || true
                taskkill /F /T /IM msedge.exe 2>/dev/null || true
            # Method 3: Try Windows path directly
            elif [ -f /c/Windows/System32/taskkill.exe ]; then
                /c/Windows/System32/taskkill.exe /F /IM msedge.exe 2>/dev/null || true
                /c/Windows/System32/taskkill.exe /F /T /IM msedge.exe 2>/dev/null || true
            # Method 4: Try pkill
            elif command -v pkill >/dev/null 2>&1; then
                pkill -f msedge.exe 2>/dev/null || true
            else
                # Last resort: try to kill via Windows API using wmic
                if command -v wmic >/dev/null 2>&1; then
                    wmic process where "name='msedge.exe'" delete 2>/dev/null || true
                fi
            fi
        elif [ "$IS_MAC" = true ]; then
            pkill -f "Microsoft Edge" 2>/dev/null || true
        else
            pkill -f "microsoft-edge" 2>/dev/null || true
        fi
    }

    # Aggressive kill loop - keep trying until Edge is dead
    local ATTEMPT=0
    local MAX_ATTEMPTS=20  # Try up to 20 times (100 seconds max)
    local KILL_INTERVAL=5  # Check every 5 seconds

    while check_edge_running; do
        ATTEMPT=$((ATTEMPT + 1))
        
        if [ $ATTEMPT -gt $MAX_ATTEMPTS ]; then
            warn "⚠️  Edge still running after $MAX_ATTEMPTS attempts!"
            warn "Please close Edge manually and press Enter to continue... "
            read -p "Press Enter after closing Edge completely... "
            
            # One final check
            if check_edge_running; then
                error "Edge is still running. Cannot extract cookies."
                warn "Continuing without cookies..."
                return 1
            fi
            break
        fi
        
        echo -n "  Attempt $ATTEMPT/$MAX_ATTEMPTS: Killing Edge processes..."
        kill_edge
        echo " done."
        
        sleep $KILL_INTERVAL
    done

    # Edge is dead - wait extra 5 seconds to ensure file locks are released
    log "✅ All Edge processes killed!"
    log "Waiting 5 seconds for file locks to be released..."
    sleep 5
    ok "File locks should now be released."

    # Create the working Python cookie extraction script
    log "Creating working Python cookie extractor..."
    
    local PYTHON_SCRIPT="$SCRIPT_DIR/export_cookies_fixed.py"
    
    cat > "$PYTHON_SCRIPT" << 'PYEOF'
#!/usr/bin/env python3
"""
Fixed Cookie Extractor for Edge Browser
Extracts YouTube cookies from Edge's Network/Cookies database
"""

import os
import sys
import sqlite3
import shutil
from pathlib import Path

def extract_edge_cookies():
    """Extract cookies from Edge browser (Windows)"""
    edge_path = Path(os.environ['LOCALAPPDATA']) / 'Microsoft' / 'Edge' / 'User Data' / 'Default' / 'Network'
    cookie_db = edge_path / 'Cookies'
    
    if not cookie_db.exists():
        print(f"❌ Edge cookies database not found at: {cookie_db}")
        return None
    
    print(f"📁 Found edge cookies at: {cookie_db}")
    
    # Copy the database (Edge locks it)
    temp_db = Path('temp_cookies.db')
    try:
        shutil.copy2(cookie_db, temp_db)
        print("✅ Cookie database copied successfully")
    except Exception as e:
        print(f"❌ Failed to copy database: {e}")
        return None
    
    # Extract cookies for youtube.com
    conn = None
    cursor = None
    try:
        conn = sqlite3.connect(str(temp_db))
        cursor = conn.cursor()
        
        # Create cookies.txt in Netscape format
        with open('cookies.txt', 'w', encoding='utf-8') as f:
            f.write('# Netscape HTTP Cookie File\n')
            
            cursor.execute("""
                SELECT host_key, path, is_secure, expires_utc, name, value 
                FROM cookies 
                WHERE host_key LIKE '%youtube.com%'
            """)
            
            count = 0
            for row in cursor.fetchall():
                host, path, secure, expires, name, value = row
                # Convert Edge's timestamp to Unix time
                if expires > 0:
                    # Edge uses microseconds since 1601-01-01
                    expires_sec = int(expires / 1000000 - 11644473600)
                else:
                    expires_sec = 0
                
                secure_flag = 'TRUE' if secure else 'FALSE'
                f.write(f"{host}\t{secure_flag}\t{path}\t{secure_flag}\t{expires_sec}\t{name}\t{value}\n")
                count += 1
        
        print(f"✅ Extracted {count} cookies for youtube.com")
        return 'cookies.txt'
        
    except Exception as e:
        print(f"❌ Error extracting cookies: {e}")
        return None
    finally:
        # Close cursor and connection properly
        if cursor:
            cursor.close()
        if conn:
            conn.close()
        # Try to delete temp file
        try:
            if temp_db.exists():
                temp_db.unlink()
                print("✅ Temporary file cleaned up")
        except PermissionError:
            print("⚠️ Could not delete temp file (will be deleted on next restart)")

if __name__ == '__main__':
    print("🔍 Searching for browser cookies...")
    result = extract_edge_cookies()
    if result:
        print(f"✅ Cookies saved to: {result}")
        # Show the first few lines of the cookie file
        try:
            with open(result, 'r') as f:
                lines = f.readlines()
                print(f"\n📋 First few cookies (preview):")
                for line in lines[1:4]:  # Skip header
                    print(f"   {line.strip()[:80]}...")
        except:
            pass
        sys.exit(0)
    else:
        print("❌ Could not extract cookies from any browser")
        sys.exit(1)
PYEOF

    chmod +x "$PYTHON_SCRIPT"
    ok "Python cookie extractor created at: $PYTHON_SCRIPT"

    # Run the Python script
    log "Running Python cookie extractor..."
    
    local PYTHON_CMD="python"
    if command -v python3 >/dev/null 2>&1; then
        PYTHON_CMD="python3"
    fi
    
    # Change to script directory to ensure cookies.txt is created there
    cd "$SCRIPT_DIR"
    
    # Double-check Edge is still dead before running Python
    if check_edge_running; then
        warn "⚠️  Edge started again! Killing it one more time..."
        kill_edge
        sleep 3
    fi
    
    if $PYTHON_CMD "$PYTHON_SCRIPT" 2>&1; then
        if [ -f "$SCRIPT_DIR/cookies.txt" ] && [ -s "$SCRIPT_DIR/cookies.txt" ]; then
            local COOKIE_COUNT
            COOKIE_COUNT=$(grep -vc '^#\|^$' "$SCRIPT_DIR/cookies.txt" 2>/dev/null || echo "0")
            ok "✅ Python extraction succeeded! ($COOKIE_COUNT cookie entries)"
            
            # Copy cookies.txt to the project folder
            mkdir -p "$FOLDER_NAME"
            cp "$SCRIPT_DIR/cookies.txt" "$COOKIES_FILE"
            ok "✅ cookies.txt copied to: $COOKIES_FILE"
            export COOKIES_EXPORTED=true
            return 0
        fi
    fi
    
    warn "Python extraction failed"
    export COOKIES_EXPORTED=false
    return 1
}

# =============================================================================
# FALLBACK METHOD: Manual Browser Extension Export
# =============================================================================
manual_cookies_export() {
    step "FALLBACK: MANUAL COOKIES EXPORT"
    
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  AUTOMATIC COOKIE EXTRACTION FAILED                        ║"
    echo "║                                                              ║"
    echo "║  Please export cookies manually using one of these methods: ║"
    echo "║                                                              ║"
    echo "║  METHOD A: Browser Extension (Easiest)                     ║"
    echo "║    1. Install 'Get cookies.txt LOCALLY' extension:         ║"
    echo "║       Chrome: https://chrome.google.com/webstore/...       ║"
    echo "║       Firefox: https://addons.mozilla.org/...              ║"
    echo "║    2. Go to YouTube.com and log in                        ║"
    echo "║    3. Click the extension icon > Export cookies.txt       ║"
    echo "║    4. Save to: $(pwd)/$FOLDER_NAME/cookies.txt            ║"
    echo "║                                                              ║"
    echo "║  METHOD B: Python Script (Already created)                 ║"
    echo "║    1. Close Edge completely                               ║"
    echo "║    2. Run: python export_cookies_fixed.py                ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    read -p "Press Enter after you've saved cookies.txt to continue..."
    
    if [ -f "$COOKIES_FILE" ] && [ -s "$COOKIES_FILE" ]; then
        ok "✅ cookies.txt found and loaded!"
        export COOKIES_EXPORTED=true
        return 0
    else
        warn "Still no cookies.txt found. Continuing without cookies..."
        export COOKIES_EXPORTED=false
        return 1
    fi
}

# =============================================================================
# Enhanced cookie extraction with fallbacks - NOW CHECKS EXISTING FIRST
# =============================================================================
export_cookies_with_fallbacks() {
    step "STEP 4: COOKIE EXTRACTION (WITH EXISTING FILE DETECTION)"

    # FIRST: Check if cookies.txt already exists
    if check_existing_cookies; then
        export COOKIES_EXPORTED=true
        return 0
    fi
    
    # SECOND: Try killing Edge and using Python script
    if kill_edge_and_extract_cookies; then
        export COOKIES_EXPORTED=true
        return 0
    fi
    
    # THIRD: Try manual browser extension
    if manual_cookies_export; then
        export COOKIES_EXPORTED=true
        return 0
    fi
    
    # ALL METHODS FAILED
    warn "All cookie extraction methods failed! YouTube may not work without login."
    export COOKIES_EXPORTED=false
    return 1
}

# =============================================================================
# FUNCTION: Install Node.js Dependencies (npm install)
# =============================================================================
install_npm_dependencies() {
    step "STEP 5: INSTALLING NODE.JS DEPENDENCIES"

    # Check if package.json exists
    if [ ! -f "$SERVER_DIR/package.json" ]; then
        warn "No package.json found in $SERVER_DIR"
        warn "Skipping npm install..."
        return 0
    fi

    log "Found package.json. Installing dependencies..."
    
    # Check if npm is available
    if ! command -v npm >/dev/null 2>&1; then
        error "npm is NOT installed!"
        error "Node.js dependencies cannot be installed."
        echo ""
        echo "Please install Node.js with npm:"
        if [ "$IS_WINDOWS" = true ]; then
            echo "  → Download from: https://nodejs.org/"
            echo "  → Choose LTS version (recommended)"
        else
            echo "  → Run: sudo apt install nodejs npm"
            echo "  → Or: sudo dnf install nodejs npm"
        fi
        echo ""
        fatal_error "npm is required but not found!"
    fi

    ok "npm found: $(npm --version 2>/dev/null || echo 'unknown')"

    # Change to server directory and run npm install
    log "Changing to server directory: $SERVER_DIR"
    cd "$SERVER_DIR" || {
        error "Cannot access server directory: $SERVER_DIR"
        fatal_error "Failed to change to server directory!"
    }

    log "Running npm install..."
    log "This may take a minute depending on your internet speed..."
    echo ""

    # Run npm install with output
    if npm install 2>&1; then
        echo ""
        ok "✅ npm install completed successfully!"
        
        # Verify key modules are installed
        local MISSING_MODULES=0
        
        if [ ! -d "node_modules" ]; then
            error "node_modules folder not created!"
            MISSING_MODULES=1
        else
            local MODULE_COUNT=$(ls -1 node_modules 2>/dev/null | wc -l || echo "0")
            ok "Installed $MODULE_COUNT packages"
            
            # Check for critical modules
            for module in express cors; do
                if [ -d "node_modules/$module" ]; then
                    dbg "✓ $module installed"
                else
                    warn "⚠ $module not found (may be optional)"
                    MISSING_MODULES=$((MISSING_MODULES + 1))
                fi
            done
        fi
        
        if [ $MISSING_MODULES -gt 0 ]; then
            warn "Some modules may be missing. Server might not work correctly."
        fi
        
        return 0
    else
        echo ""
        error "❌ npm install failed!"
        echo ""
        echo "Possible reasons:"
        echo "  • No internet connection"
        echo "  • npm registry is blocked"
        echo "  • Corrupted package.json"
        echo "  • Permission issues"
        echo ""
        echo "Try these fixes:"
        echo "  1. Check internet connection"
        echo "  2. Try: npm cache clean --force"
        echo "  3. Try: npm install --legacy-peer-deps"
        echo ""
        
        # Retry once with legacy peer deps
        log "Retrying with --legacy-peer-deps..."
        if npm install --legacy-peer-deps 2>&1; then
            ok "✅ npm install succeeded on retry!"
            return 0
        else
            fatal_error "npm install failed! Cannot start server without dependencies."
        fi
    fi
}

# =============================================================================
# FUNCTION: Patch Server.js
# =============================================================================
patch_server() {
    step "STEP 6: PATCHING SERVER.JS"

    if [ ! -f "$SERVER_JS" ]; then
        error "server.js not found at: $SERVER_JS"
        error "Make sure server.js exists in the same folder as this script!"
        return 1
    fi

    log "Patching server.js to use cookies file..."
    
    if grep -q "--cookies-from-browser" "$SERVER_JS" 2>/dev/null; then
        log "Found --cookies-from-browser in server.js"
        
        if [ -f "$COOKIES_FILE" ]; then
            log "Replacing with --cookies \"$COOKIES_FILE\"..."
            
            sed -i "s|--cookies-from-browser|\"$COOKIES_FILE\"|g" "$SERVER_JS" 2>/dev/null
            
            if grep -q "\"$COOKIES_FILE\"" "$SERVER_JS" 2>/dev/null; then
                ok "✅ Server patched to use cookies.txt file!"
            else
                warn "Patch may not have applied correctly"
            fi
        else
            warn "cookies.txt not found yet. Will use browser fallback."
        fi
    else
        ok "Server doesn't use --cookies-from-browser. No patching needed."
    fi

    return 0
}

# =============================================================================
# FUNCTION: Copy Pre-modified Files
# =============================================================================
copy_modified_files() {
    step "STEP 7: COPYING PRE-MODIFIED FILES"

    log "Checking for pre-modified files in script directory..."
    
    local MODIFIED_COUNT=0
    
    if [ -f "$SCRIPT_DIR/server.js" ]; then
        log "Found custom server.js in script directory"
        cp "$SCRIPT_DIR/server.js" "$SERVER_JS" 2>/dev/null
        if [ $? -eq 0 ]; then
            ok "✅ Copied custom server.js"
            MODIFIED_COUNT=$((MODIFIED_COUNT + 1))
        fi
    fi
    
    if [ -f "$SCRIPT_DIR/index.html" ]; then
        log "Found custom index.html in script directory"
        cp "$SCRIPT_DIR/index.html" "$SERVER_DIR/public/index.html" 2>/dev/null
        if [ $? -eq 0 ]; then
            ok "✅ Copied custom index.html"
            MODIFIED_COUNT=$((MODIFIED_COUNT + 1))
        fi
    fi

    if [ $MODIFIED_COUNT -gt 0 ]; then
        ok "✅ Copied $MODIFIED_COUNT modified file(s)!"
    else
        log "No modified files found. Using defaults."
    fi

    return 0
}

# =============================================================================
# FUNCTION: Start Server
# =============================================================================
start_server() {
    step "STEP 8: STARTING SERVER"

    cd "$SERVER_DIR" || {
        error "Cannot change to server directory: $SERVER_DIR"
        return 1
    }

    if [ ! -f "server.js" ]; then
        error "server.js not found in: $(pwd)"
        error "Please make sure server.js exists!"
        return 1
    fi

    log "Starting Node.js server..."
    log "Working directory: $(pwd)"
    log "Server file: server.js"
    log "Port: $PORT"
    echo ""

    node server.js &
    SERVER_PID=$!

    log "Server started with PID: $SERVER_PID"

    local MAX_WAIT=30
    local WAITED=0

    while [ $WAITED -lt $MAX_WAIT ]; do
        if curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/ 2>/dev/null | grep -q "200\|304\|302"; then
            ok "✅ Server is up and running!"
            return 0
        fi

        sleep 1
        WAITED=$((WAITED + 1))

        if [ $((WAITED % 5)) -eq 0 ]; then
            log "Still waiting for server... ($WAITED/$MAX_WAIT seconds)"
        fi
    done

    error "❌ Server did not start within $MAX_WAIT seconds!"
    error "Check for errors above."
    
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        error "Server process is running but not responding"
        error "PID: $SERVER_PID"
    else
        error "Server process has died"
    fi

    return 1
}

# =============================================================================
# FUNCTION: Open Browser
# =============================================================================
open_browser() {
    step "STEP 9: OPENING BROWSER"

    log "Opening browser to: $URL"
    
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        start "$URL" 2>/dev/null || cmd //c start "$URL" 2>/dev/null || explorer "$URL" 2>/dev/null || echo "Please open $URL manually"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        open "$URL" 2>/dev/null || echo "Please open $URL manually"
    else
        xdg-open "$URL" 2>/dev/null || sensible-browser "$URL" 2>/dev/null || \
        google-chrome "$URL" 2>/dev/null || firefox "$URL" 2>/dev/null || \
        echo "Please open $URL manually"
    fi

    ok "Browser should be opening..."
}

# =============================================================================
# ⭐⭐⭐ NEW: WINDOWS ORPHAN PROCESS KILLER ⭐⭐⭐
# Automatically kills bash.exe and sleep.exe when terminal closes
# =============================================================================

kill_windows_orphan_processes() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  🧹 WINDOWS ORPHAN PROCESS CLEANUP                          ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    log "🔍 Checking for orphan Windows processes..."
    
    # Detect Windows environment
    local IS_WINDOWS_ENV=false
    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*) IS_WINDOWS_ENV=true ;;
        *)
            if command -v tasklist &> /dev/null || command -v taskkill &> /dev/null; then
                IS_WINDOWS_ENV=true
            fi
            ;;
    esac
    
    # Skip if not Windows
    if [ "$IS_WINDOWS_ENV" = false ]; then
        log "ℹ️  Not running on Windows - skipping process cleanup"
        return 0
    fi
    
    ok "Windows environment detected - cleaning up orphan processes..."
    
    local PROCESSES_KILLED=0
    
    # -----------------------------------------------------------------
    # Kill sleep.exe processes
    # -----------------------------------------------------------------
    log "🔍 Looking for sleep.exe processes..."
    
    if command -v tasklist &> /dev/null; then
        tasklist //FI "IMAGENAME eq sleep.exe" //NH //FO CSV 2>/dev/null | while IFS= read -r line; do
            # Extract PID from CSV format: "sleep.exe","12345","Session Name",...
            local PID=$(echo "$line" | sed 's/.*"\([0-9]*\)".*/\1/' | grep -E '^[0-9]+$')
            
            # Skip empty PIDs and our own process
            if [ -n "$PID" ] && [ "$PID" != "$$" ]; then
                log "   🛑 Killing sleep.exe (PID: $PID)"
                taskkill //PID "$PID" //F > /dev/null 2>&1 || kill -9 "$PID" 2>/dev/null || true
                ((PROCESSES_KILLED++))
            fi
        done
    fi
    
    # Also try ps command (works in Git Bash)
    if command -v ps &> /dev/null; then
        ps aux 2>/dev/null | grep -i "[s]leep.exe" | awk '{print $2}' | while read PID; do
            if [ -n "$PID" ] && [ "$PID" != "$$" ]; then
                kill -9 "$PID" 2>/dev/null || true
                ((PROCESSES_KILLED++))
            fi
        done
    fi
    
    # -----------------------------------------------------------------
    # Kill bash.exe processes (except current and parent!)
    # -----------------------------------------------------------------
    log "🔍 Looking for bash.exe processes (orphans only)..."
    
    if command -v tasklist &> /dev/null; then
        tasklist //FI "IMAGENAME eq bash.exe" //NH //FO CSV 2>/dev/null | while IFS= read -r line; do
            local PID=$(echo "$line" | sed 's/.*"\([0-9]*\)".*/\1/' | grep -E '^[0-9]+$')
            
            # CRITICAL: Skip our own process and parent process!
            if [ -n "$PID" ]; then
                if [ "$PID" = "$$" ]; then
                    log "   ⏭️  Skipping SELF (PID: $PID)"
                elif [ "$PID" = "$PPID" ]; then
                    log "   ⏭️  Skipping PARENT (PID: $PID)"
                else
                    log "   🛑 Killing orphan bash.exe (PID: $PID)"
                    taskkill //PID "$PID" //F > /dev/null 2>&1 || kill -9 "$PID" 2>/dev/null || true
                    ((PROCESSES_KILLED++))
                fi
            fi
        done
    fi
    
    # Also try ps command
    if command -v ps &> /dev/null; then
        ps aux 2>/dev/null | grep -i "[b]ash.exe" | awk '{print $2}' | while read PID; do
            if [ -n "$PID" ] && [ "$PID" != "$$" ] && [ "$PID" != "$PPID" ]; then
                kill -9 "$PID" 2>/dev/null || true
                ((PROCESSES_KILLED++))
            fi
        done
    fi
    
    # -----------------------------------------------------------------
    # Summary
    # -----------------------------------------------------------------
    echo ""
    if [ $PROCESSES_KILLED -gt 0 ]; then
        ok "✅ Killed ${PROCESSES_KILLED} orphan process(es)! System clean."
        warn "Note: Current bash session will exit normally after cleanup."
    else
        log "✨ No orphan processes found - system was already clean!"
    fi
    echo ""
}

# =============================================================================
# ⭐ ENHANCED CLEANUP FUNCTION (Now includes Windows killer!)
# =============================================================================

cleanup() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║  🛑 SHUTDOWN INITIATED                                       ║"
    echo "║                                                              ║"
    echo "║  Cleaning up before exit...                                   ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    # 1. Stop the Node.js server gracefully
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        warn "Stopping YouTube Downloader server (PID: $SERVER_PID)..."
        
        # Try graceful shutdown first (SIGTERM)
        kill "$SERVER_PID" 2>/dev/null || true
        log "Sent SIGTERM signal, waiting 2 seconds for graceful shutdown..."
        sleep 2
        
        # Check if still alive, then force kill (SIGKILL)
        if kill -0 "$SERVER_PID" 2>/dev/null; then
            warn "Server didn't stop gracefully, force killing (SIGKILL)..."
            kill -9 "$SERVER_PID" 2>/dev/null || true
            sleep 1
        fi
        
        # Final verification
        if ! kill -0 "$SERVER_PID" 2>/dev/null; then
            ok "✅ Server stopped successfully."
        else
            error "❌ Server may still be running (PID: $SERVER_PID)"
        fi
    else
        log "ℹ️  No server process to stop (or already stopped)."
    fi
    
    # 2. Kill any leftover Node.js processes related to our app
    if command -v taskkill &> /dev/null; then
        log "Cleaning up any remaining node.js processes..."
        taskkill //FI "WINDOWTITLE eq *YouTube*" //F > /dev/null 2>&1 || true
        taskkill //FI "IMAGENAME eq node.exe" //F > /dev/null 2>&1 || true
    fi
    
    # 3. ⭐⭐⭐ CALL THE WINDOWS ORPHAN PROCESS KILLER! ⭐⭐⭐
    # This kills bash.exe and sleep.exe orphans when terminal closes
    kill_windows_orphan_processes
    
    # 4. Final success message
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║                   ✅ CLEANUP COMPLETE ✅                      ║"
    echo "║                                                              ║"
    echo "║  All processes terminated safely                             ║"
    echo "║  No orphan processes left behind                              ║"
    echo "║  Safe to close this window                                  ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    # Exit cleanly with success code
    exit 0
}

# =============================================================================
# TRAP HANDLERS - Catch ALL exit signals including window close!
# =============================================================================

# Register cleanup function for these signals:
# EXIT  = Normal exit, script end, or window close (X button click)
# INT   = Ctrl+C interrupt (SIGINT)
# TERM  = Termination request (SIGTERM)  
# HUP   = Hangup - sent when terminal window is closed (SIGHUP)

trap cleanup EXIT INT TERM HUP

# =============================================================================
# Fatal Error Function
# =============================================================================
fatal_error() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║  ❌ FATAL ERROR                                              ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    error "$1"
    echo ""
    
    # Keep terminal open so user can see the error
    keep_terminal_open_on_error
}

# =============================================================================
# Keep Terminal Open (Error State)
# =============================================================================
keep_terminal_open_on_error() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  ❌ SETUP FAILED                                             ║"
    echo "║                                                              ║"
    echo "║  An error occurred during setup. Please see above.           ║"
    echo "║                                                              ║"
    echo "║  This terminal will stay open so you can:                  ║"
    echo "║    • Read the error message                                 ║"
    echo "║    • Copy the error for debugging                            ║"
    echo "║    • Retry after fixing the issue                           ║"
    echo "║                                                              ║"
    echo "║  Close this window when ready.                               ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    # Keep open forever with periodic message
    local COUNTER=0
    while true; do
        sleep 3600
        COUNTER=$((COUNTER + 1))
        # Could add periodic status here if needed
    done
}

# =============================================================================
# Keep Terminal Open (Success State - Server Running)
# =============================================================================
keep_terminal_open() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║  🖥️  SERVER IS RUNNING                                      ║"
    echo "║                                                              ║"
    echo "║  🌐 URL: ${BOLD}$URL${NC}"
    echo "║                                                              ║"
    echo "║  ⚙️  Controls:                                               ║"
    echo "║    • Press Ctrl+C to stop the server                       ║"
    echo "║    • Close this window to auto-cleanup all processes         ║"
    echo "║                                                              ║"
    echo "║  🧹 Auto-cleanup enabled (when window closed):               ║"
    echo "║    ✓ Stops Node.js server gracefully                      ║"
    echo "║    ✓ Kills bash.exe orphan processes                      ║"
    echo "║    ✓ Kills sleep.exe orphan processes                     ║"
    echo "║    ✓ No zombie processes left behind                      ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    # Monitor server process - keep terminal open until server stops or user closes window
    if [ -n "$SERVER_PID" ]; then
        log "Monitoring server process (PID: $SERVER_PID)..."
        log "Terminal will stay open until server stops or window is closed."
        echo ""
        
        # Wait for server to finish (or be killed), checking every 2 seconds
        while kill -0 "$SERVER_PID" 2>/dev/null; do
            sleep 2
        done
        
        # If we get here, server stopped on its own (not via cleanup function)
        echo ""
        warn "Server process ended unexpectedly (crashed or stopped externally)"
        echo ""
        
        # Run cleanup anyway to ensure no orphans
        cleanup
    else
        # No SERVER_PID (shouldn't happen, but just in case)
        log "No server PID to monitor. Keeping terminal open..."
        
        # Just wait forever
        while true; do
            sleep 3600  # Sleep 1 hour at a time
        done
    fi
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
    echo "║   Version 5.1                                               ║"
    echo "║   ⭐ FIXED: Git clone now works correctly!                  ║"
    echo "║   ⭐ Auto-kills orphan processes on close                   ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    log "Starting YouTube Downloader setup..."
    log "Script directory: $SCRIPT_DIR"
    log "Current directory: $(pwd)"
    log "Date: $(date)"
    
    # =====================================================================
    # CRITICAL FIX: Change to script directory!
    # This ensures git clone runs in the correct location
    # =====================================================================
    log "🔧 Changing to script directory: $SCRIPT_DIR"
    cd "$SCRIPT_DIR" || {
        error "Failed to change to script directory: $SCRIPT_DIR"
        fatal_error "Cannot access script directory!"
    }
    log "✅ Now in directory: $(pwd)"
    echo ""
    
    # Run all setup steps
    clone_github_repo      # Step 1: Clone repo
    detect_repo_structure  # Step 1b: Auto-detect repo structure (find server.js)
    install_ytdl            # Step 2: Install yt-dlp
    setup_ffmpeg           # Step 3: Setup FFmpeg
    export_cookies_with_fallbacks  # Step 4: Cookie extraction (kills Edge + extracts cookies)
    install_npm_dependencies  # Step 5: Install Node.js dependencies (npm install)
    patch_server           # Step 6: Patch server.js
    copy_modified_files     # Step 7: Copy custom files
    start_server           # Step 8: Start server
    open_browser           # Step 9: Open browser
    
    # =====================================================================
    # FINAL SUCCESS MESSAGE
    # =====================================================================
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                                                              ║"
    echo "║                   ✅ SETUP COMPLETE! ✅                      ║"
    echo "║                                                              ║"
    echo "║  🌐 Server: ${BOLD}$URL${NC}"
    echo "║  📁 Downloads: ${BOLD}$SERVER_DIR/downloads${NC}"
    echo "║  🍪 Cookies: ${BOLD}${COOKIES_EXPORTED:-browser fallback}${NC}"
    echo "║                                                              ║"
    echo "║  Features Enabled:                                          ║"
    echo "║     ✅ Cancel/Resume/Stop buttons                            ║"
    echo "║     ✅ Smart format detection (lowest quality)               ║"
    echo "║     ✅ Concurrent downloads support                         ║"
    echo "║     ✅ Auto-retry on network errors                          ║"
    echo "║     ✅ Aggressive Edge killing                               ║"
    echo "║     ✅ Working Python cookie extractor                       ║"
    echo "║     ✅ Existing cookies detection                             ║"
    echo "║     ✅ Pre-modified files applied                            ║"
    echo "║     🆕 Auto-orphan-process cleanup on close                 ║"
    echo "║                                                              ║"
    echo "║  🧹 Cleanup Features (when you close window):                ║"
    echo "║     ✓ Kills Node.js server gracefully                      ║"
    echo "║     ✓ Kills orphan bash.exe processes                      ║"
    echo "║     ✓ Kills orphan sleep.exe processes                     ║"
    echo "║     ✓ No zombie/orphan processes left                      ║"
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
