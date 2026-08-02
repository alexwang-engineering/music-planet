const { app, BrowserWindow, shell, nativeTheme } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')
const {
  LOOPBACK_HOST,
  buildRendererQuery,
  reserveLoopbackPort,
} = require('./api-runtime')

let mainWindow = null
let apiProcess = null
let apiPort = null

function sanitizeApiLog(chunk) {
  return chunk
    .toString()
    .split(/\r?\n/)
    .map(line => line.replace(/([?&]cookie=).*/i, '$1[redacted]'))
    .filter(Boolean)
    .join('\n')
}

// ── Start the NetEase API server ─────────────────────────────────────
function startApiServer(port) {
  // Dev: node_modules next to main.js.
  // Packaged: a standalone production install (predist stages api-staging/node_modules,
  // extraResources ships it as Resources/api-runtime/node_modules). The package must sit
  // inside a real node_modules dir so its own deps (axios, express…) resolve by walk-up.
  const apiEntry = app.isPackaged
    ? path.join(process.resourcesPath, 'api-runtime', 'node_modules', 'NeteaseCloudMusicApi', 'app.js')
    : path.join(__dirname, 'node_modules', 'NeteaseCloudMusicApi', 'app.js')

  const child = spawn(process.execPath, [apiEntry], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: LOOPBACK_HOST,
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: 'pipe',
  })
  apiProcess = child

  child.stdout?.on('data', d => {
    const msg = sanitizeApiLog(d).trim()
    if (msg) console.log('[API]', msg)
  })
  child.stderr?.on('data', d => {
    const msg = sanitizeApiLog(d).trim()
    if (msg) console.error('[API ERR]', msg)
  })
  child.on('error', err => console.error('[API spawn error]', err))
  child.on('exit', (code, signal) => {
    if (apiProcess === child) apiProcess = null
    if (code && signal == null) console.error(`[API] exited with code ${code}`)
  })
}

// ── Wait for API to respond ──────────────────────────────────────────
function waitForApi(port, retries = 40, delay = 400) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(`http://${LOOPBACK_HOST}:${port}/search?keywords=test&limit=1`, res => {
        res.resume()
        resolve()
      }).on('error', () => {
        if (retries-- <= 0) return reject(new Error('API did not start'))
        setTimeout(attempt, delay)
      })
      request.setTimeout(1200, () => request.destroy(new Error('API readiness timeout')))
    }
    attempt()
  })
}

// ── Create the main window (fixed proportions — per user request, do not
// switch to work-area-percentage sizing or persisted bounds) ─────────────
function createWindow(port) {
  nativeTheme.themeSource = 'dark'

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 1100,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',   // macOS traffic lights, no visible title bar
    backgroundColor: '#050510',
    vibrancy: 'under-window',       // macOS native blur behind window
    visualEffectState: 'active',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  })

  const query = buildRendererQuery(port, {
    performanceDebug: process.env.NEBULA_PERF_DEBUG === '1',
  })
  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'), { query })

  // Open external links in system browser, not in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ── App lifecycle ────────────────────────────────────────────────────
app.whenReady().then(async () => {
  apiPort = await reserveLoopbackPort()
  startApiServer(apiPort)

  try {
    await waitForApi(apiPort)
    console.log(`[App] API ready on :${apiPort}`)
  } catch (e) {
    // Not fatal — app shows "start API" message itself
    console.warn('[App] API did not respond in time; opening anyway')
  }

  createWindow(apiPort)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(apiPort)
  })
}).catch(error => {
  console.error('[App] failed to start', error)
  app.quit()
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
