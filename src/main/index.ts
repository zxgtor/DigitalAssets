import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc'
import { startMediaServer } from './services/mediaServer'

// ─── Agent deep-link protocol ─────────────────────────────────────────────────
// Supports: digitalassets://gallery
//           digitalassets://analyze?file=/abs/path/to/file
//           digitalassets://generate
// Can also be triggered by CLI arg on launch:  --url=digitalassets://gallery
// ─────────────────────────────────────────────────────────────────────────────

const PROTOCOL = 'digitalassets'

/** Parse a deep-link URL into a navigate payload and broadcast to renderer. */
function handleDeepLink(url: string): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return

  try {
    const parsed = new URL(url)
    const page = parsed.hostname // e.g. "gallery", "analyze", "generate"
    const file = parsed.searchParams.get('file') ?? undefined

    win.webContents.send('app:navigate', { page, file })
    win.show()
    win.focus()
  } catch {
    console.warn('[deeplink] could not parse:', url)
  }
}

/** Extract a digitalassets:// URL from process.argv if present. */
function deepLinkFromArgs(argv: string[]): string | null {
  return argv.find((a) => a.startsWith(`${PROTOCOL}://`)) ?? null
}

// Register as default handler for digitalassets:// URLs
if (!is.dev) {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

// Single-instance lock — forward deep-link URLs to the running instance
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const url = deepLinkFromArgs(argv)
    if (url) handleDeepLink(url)
    // Bring window to front
    const win = BrowserWindow.getAllWindows()[0]
    if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  })
}

// macOS: handle protocol URL via open-url event
app.on('open-url', (_event, url) => {
  handleDeepLink(url)
})

// ─── Window ──────────────────────────────────────────────────────────────────

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    frame: true,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    if (is.dev) {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }

    // Handle deep-link passed on launch (Windows / Linux pass it in argv)
    const url = deepLinkFromArgs(process.argv)
    if (url) handleDeepLink(url)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.digitalassets')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await startMediaServer()
  registerIpcHandlers()

  // Allow renderer to request navigation (for agent HTTP integration)
  ipcMain.handle('app:navigate', (_event, payload: { page: string; file?: string }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send('app:navigate', payload)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
