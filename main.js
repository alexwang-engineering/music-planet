const { app, BrowserWindow, shell, nativeTheme } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')

let mainWindow = null
let apiProcess = null
const API_PORT = 3000

function sanitizeApiLog(chunk) {
  return chunk
    .toString()
    .split(/\r?\n/)
    .map(line => line.replace(/([?&]cookie=).*/i, '$1[redacted]'))
    .filter(Boolean)
    .join('\n')
}

// ── Start the NetEase API server ─────────────────────────────────────
function startApiServer() {
  const os = require('os')
  // Dev: node_modules next to main.js
  // Packaged: project stays at ~/music-player-app (personal-use app)
  const apiEntry = app.isPackaged
    ? path.join(os.homedir(), 'music-player-app', 'node_modules', 'NeteaseCloudMusicApi', 'app.js')
    : path.join(__dirname, 'node_modules', 'NeteaseCloudMusicApi', 'app.js')

  apiProcess = spawn(process.execPath, [apiEntry], {
    env: { ...process.env, PORT: String(API_PORT), ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'pipe',
  })

  apiProcess.stdout?.on('data', d => {
    const msg = sanitizeApiLog(d).trim()
    if (msg) console.log('[API]', msg)
  })
  apiProcess.stderr?.on('data', d => {
    const msg = sanitizeApiLog(d).trim()
    if (msg) console.error('[API ERR]', msg)
  })
  apiProcess.on('error', err => console.error('[API spawn error]', err))
}

// ── Wait for API to respond ──────────────────────────────────────────
function waitForApi(retries = 20, delay = 300) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http.get(`http://localhost:${API_PORT}/search?keywords=test&limit=1`, res => {
        res.resume()
        resolve()
      }).on('error', () => {
        if (retries-- <= 0) return reject(new Error('API did not start'))
        setTimeout(attempt, delay)
      })
    }
    attempt()
  })
}

// ── Create the main window ───────────────────────────────────────────
function createWindow() {
  nativeTheme.themeSource = 'dark'

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',   // macOS traffic lights, no visible title bar
    backgroundColor: '#050510',
    vibrancy: 'under-window',       // macOS native blur behind window
    visualEffectState: 'active',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,           // allow file:// → localhost:3000 fetch
      allowRunningInsecureContent: true,
    },
  })

  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'))

  // Open external links in system browser, not in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ── App lifecycle ────────────────────────────────────────────────────
app.whenReady().then(async () => {
  startApiServer()

  try {
    await waitForApi()
    console.log(`[App] API ready on :${API_PORT}`)
  } catch (e) {
    // Not fatal — app shows "start API" message itself
    console.warn('[App] API did not respond in time; opening anyway')
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  if (apiProcess) {
    apiProcess.kill('SIGTERM')
    apiProcess = null
  }
})
