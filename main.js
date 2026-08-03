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
let splashWindow = null
let apiProcess = null
let apiPort = null

const SPLASH_MIN_VISIBLE_MS = 1050
const SPLASH_REDUCED_MIN_VISIBLE_MS = 240
const SPLASH_CROSSFADE_MS = 360
const SPLASH_REDUCED_CROSSFADE_MS = 80

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))
}

function createReadyPromise(window, { waitForPaint = true } = {}) {
  return new Promise(resolve => {
    const readyEmitter = waitForPaint ? window : window.webContents
    readyEmitter.once(waitForPaint ? 'ready-to-show' : 'did-finish-load', resolve)
    window.once('closed', resolve)
    window.webContents.once('did-fail-load', resolve)
  })
}

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

// ── Lightweight cold-start window ───────────────────────────────────
function createSplashWindow() {
  const window = new BrowserWindow({
    width: 520,
    height: 340,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  })

  splashWindow = window
  window.nebulaReady = createReadyPromise(window)
  window.setIgnoreMouseEvents(true)
  window.loadFile(path.join(__dirname, 'app', 'splash.html')).catch(error => {
    console.error('[App] splash failed to load', error)
  })
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show()
  })
  window.on('closed', () => {
    if (splashWindow === window) splashWindow = null
  })
  return window
}

async function usesReducedMotion(window) {
  if (!window || window.isDestroyed()) return false
  try {
    return Boolean(await window.webContents.executeJavaScript(
      "window.matchMedia('(prefers-reduced-motion: reduce)').matches",
      true,
    ))
  } catch (_) {
    return false
  }
}

function crossfadeToMain(window, splash, durationMs) {
  if (!window || window.isDestroyed()) return Promise.resolve()
  if (!splash || splash.isDestroyed() || durationMs <= 0) {
    window.setOpacity(1)
    window.show()
    window.focus()
    return Promise.resolve()
  }

  window.setOpacity(0)
  window.showInactive()
  splash.setAlwaysOnTop(true, 'floating')
  const startedAt = Date.now()

  return new Promise(resolve => {
    const tick = () => {
      if (window.isDestroyed()) {
        if (!splash.isDestroyed()) splash.destroy()
        resolve()
        return
      }

      const progress = Math.min((Date.now() - startedAt) / durationMs, 1)
      const eased = progress * progress * (3 - 2 * progress)
      window.setOpacity(eased)
      if (!splash.isDestroyed()) splash.setOpacity(1 - eased)

      if (progress < 1) {
        setTimeout(tick, 16)
        return
      }

      window.setOpacity(1)
      if (!splash.isDestroyed()) splash.destroy()
      window.show()
      window.focus()
      resolve()
    }
    tick()
  })
}

// ── Create the main window (fixed proportions — per user request, do not
// switch to work-area-percentage sizing or persisted bounds) ─────────────
function createWindow(port, { deferShow = false } = {}) {
  nativeTheme.themeSource = 'dark'

  const window = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 1100,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',   // macOS traffic lights, no visible title bar
    backgroundColor: '#050510',
    vibrancy: 'under-window',       // macOS native blur behind window
    visualEffectState: 'active',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  })
  mainWindow = window
  // The main renderer deliberately pauses WebGL while hidden. Waiting for
  // ready-to-show would therefore wait on a hidden first paint; the completed
  // document load is the correct handoff signal and the crossfade owns paint.
  window.nebulaReady = createReadyPromise(window, { waitForPaint: false })

  const query = buildRendererQuery(port, {
    performanceDebug: process.env.NEBULA_PERF_DEBUG === '1',
  })
  window.loadFile(path.join(__dirname, 'app', 'index.html'), { query }).catch(error => {
    console.error('[App] main window failed to load', error)
  })
  if (!deferShow) {
    window.nebulaReady.then(() => {
      if (!window.isDestroyed()) window.show()
    })
  }

  // Open external links in system browser, not in Electron
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  return window
}

// ── App lifecycle ────────────────────────────────────────────────────
app.whenReady().then(async () => {
  const splashStartedAt = Date.now()
  const splash = createSplashWindow()
  apiPort = await reserveLoopbackPort()
  startApiServer(apiPort)
  const window = createWindow(apiPort, { deferShow: true })

  const apiReady = waitForApi(apiPort).then(() => {
    console.log(`[App] API ready on :${apiPort}`)
  }).catch(() => {
    // Not fatal — app shows "start API" message itself
    console.warn('[App] API did not respond in time; opening anyway')
  })

  await Promise.all([splash.nebulaReady, window.nebulaReady, apiReady])
  const reducedMotion = await usesReducedMotion(splash)
  const minimumVisible = process.env.NEBULA_SPLASH_DEBUG === '1'
    ? 5000
    : reducedMotion
      ? SPLASH_REDUCED_MIN_VISIBLE_MS
      : SPLASH_MIN_VISIBLE_MS
  await delay(minimumVisible - (Date.now() - splashStartedAt))
  await crossfadeToMain(
    window,
    splash,
    reducedMotion ? SPLASH_REDUCED_CROSSFADE_MS : SPLASH_CROSSFADE_MS,
  )

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
