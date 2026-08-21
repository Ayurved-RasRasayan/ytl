const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        downloads: DOWNLOADS_DIR
    });
});

// Get video info
app.post('/api/info', (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    const cmd = `/home/z/.local/bin/yt-dlp --js-runtimes "deno:/home/z/.deno/bin/deno" --dump-json --no-playlist "${url}"`;
    
    exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
            console.error('Error getting info:', error.message);
            return res.status(500).json({ error: 'Failed to get video info', details: stderr });
        }
        
        try {
            const data = JSON.parse(stdout);
            res.json({
                id: data.id,
                title: data.title,
                duration: data.duration,
                thumbnail: data.thumbnail,
                channel: data.channel,
                formats: data.formats?.map(f => ({
                    format_id: f.format_id,
                    ext: f.ext,
                    resolution: f.resolution,
                    vcodec: f.vcodec,
                    acodec: f.acodec
                }))
            });
        } catch (e) {
            res.status(500).json({ error: 'Failed to parse video info' });
        }
    });
});

// Download video
app.post('/api/download', (req, res) => {
    const { url, format, quality } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    const outputFile = `${Date.now()}_%(title)s.%(ext)s`;
    let formatStr = 'best[height<=720]';
    
    if (format === 'audio') {
        formatStr = 'bestaudio[ext=m4a]/bestaudio';
    } else if (quality) {
        formatStr = `best[height<=${quality}]+bestaudio/best[height<=${quality}]`;
    }

    const cmd = `/home/z/.local/bin/yt-dlp --js-runtimes "deno:/home/z/.deno/bin/deno" -f "${formatStr}" -o "${DOWNLOADS_DIR}/${outputFile}" --no-playlist --merge-output-format mp4 "${url}"`;
    
    console.log('[Download] Starting:', url);
    console.log('[Download] Format:', formatStr);
    
    const downloadProcess = exec(cmd, { timeout: 300000 }, (error, stdout, stderr) => {
        if (error) {
            console.error('[Download] Error:', error.message);
            return;
        }
        console.log('[Download] Complete:', stdout);
    });

    // Stream progress output
    let jobId = Date.now().toString();
    
    downloadProcess.stdout.on('data', (data) => {
        console.log('[Download Progress]', data.toString());
    });

    downloadProcess.stderr.on('data', (data) => {
        const output = data.toString();
        // Parse progress from yt-dlp output
        const progressMatch = output.match(/(\d+\.?\d*)%/);
        if (progressMatch) {
            // Could emit via WebSocket or SSE for real-time updates
            console.log('[Progress]', progressMatch[1] + '%');
        }
    });

    res.json({ 
        success: true, 
        jobId,
        message: 'Download started',
        url 
    });
});

// List downloaded files
app.get('/api/files', (req, res) => {
    try {
        const files = fs.readdirSync(DOWNLOADS_DIR)
            .filter(f => !f.startsWith('.'))
            .map(f => {
                const filePath = path.join(DOWNLOADS_DIR, f);
                const stat = fs.statSync(filePath);
                return {
                    name: f,
                    size: stat.size,
                    modified: stat.mtime,
                    sizeFormatted: (stat.size / (1024 * 1024)).toFixed(2) + ' MB'
                };
            });
        res.json({ files });
    } catch (e) {
        res.status(500).json({ error: 'Failed to list files' });
    }
});

// Download file by name
app.get('/api/download-file/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(DOWNLOADS_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    
    res.download(filePath);
});

// Serve index.html for root route
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>YouTube Downloader</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; background: #1a1a1a; color: #fff; }
                    h1 { color: #ff0000; }
                    input[type="text"] { width: 70%; padding: 10px; border: 1px solid #333; border-radius: 5px; background: #2a2a2a; color: #fff; }
                    button { padding: 10px 20px; background: #ff0000; color: white; border: none; border-radius: 5px; cursor: pointer; margin-left: 10px; }
                    button:hover { background: #cc0000; }
                    .result { margin-top: 20px; padding: 15px; background: #2a2a2a; border-radius: 5px; }
                    .file-list { margin-top: 20px; }
                    .file-item { padding: 10px; margin: 5px 0; background: #333; border-radius: 5px; display: flex; justify-content: space-between; }
                    a { color: #4af; text-decoration: none; }
                </style>
            </head>
            <body>
                <h1>🎬 YouTube Downloader</h1>
                <div>
                    <input type="text" id="url" placeholder="Paste YouTube URL here..." value="https://www.youtube.com/watch?v=dQw4w9WgXcQ">
                    <button onclick="getInfo()">Get Info</button>
                    <button onclick="downloadVideo()" style="background:#28a745">⬇️ Download Video</button>
                    <button onclick="downloadAudio()" style="background:#17a2b8">🎵 Download Audio</button>
                </div>
                <div id="result" class="result" style="display:none"></div>
                <div class="file-list" id="files"></div>
                
                <script>
                    async function getInfo() {
                        const url = document.getElementById('url').value;
                        const res = await fetch('/api/info', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({url})
                        });
                        const data = await res.json();
                        document.getElementById('result').style.display = 'block';
                        document.getElementById('result').innerHTML = \`
                            <h3>\${data.title}</h3>
                            <p>Channel: \${data.channel}</p>
                            <p>Duration: \${Math.floor(data.duration/60)}:\${(data.duration%60).toString().padStart(2,'0')}</p>
                            <img src="\${data.thumbnail}" width="200">
                        \`;
                    }
                    
                    async function downloadVideo() {
                        const url = document.getElementById('url').value;
                        const res = await fetch('/api/download', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({url, format: 'video', quality: '720'})
                        });
                        const data = await res.json();
                        alert(data.message + '\\nJob ID: ' + data.jobId);
                        loadFiles();
                    }
                    
                    async function downloadAudio() {
                        const url = document.getElementById('url').value;
                        const res = await fetch('/api/download', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({url, format: 'audio'})
                        });
                        const data = await res.json();
                        alert(data.message + '\\nJob ID: ' + data.jobId);
                        loadFiles();
                    }
                    
                    async function loadFiles() {
                        const res = await fetch('/api/files');
                        const data = await res.json();
                        document.getElementById('files').innerHTML = '<h3>📁 Downloaded Files:</h3>' + 
                            data.files.map(f => \`
                                <div class="file-item">
                                    <span>\${f.name} (\${f.sizeFormatted})</span>
                                    <a href="/api/download-file/\${encodeURIComponent(f.name)}">⬇️ Download</a>
                                </div>
                            \`).join('');
                    }
                    
                    loadFiles();
                </script>
            </body>
            </html>
        `);
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║   🚀 YouTube Downloader Server          ║
║                                         ║
║   🌐 http://localhost:${PORT}             ║
║   📁 Downloads: ${DOWNLOADS_DIR}     ║
╚══════════════════════════════════════════╝
    `);
});
