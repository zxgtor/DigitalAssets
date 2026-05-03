import { app, shell, BrowserWindow, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc'

// Register `media:` as a privileged scheme so the renderer can load
// keyframe thumbnails and analyzed videos (which live in temp dirs)
// without disabling webSecurity.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  }
])

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.videotoprompt')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // media://<absolute-path-with-forward-slashes> -> file on disk.
  // The renderer encodes the absolute path into the URL host+path; we
  // decode it back and stream the file via Chromium's net module.
  protocol.handle('media', (request) => {
    // Reconstruct: drop the leading "media://" scheme, decode percent-escapes.
    let raw = decodeURIComponent(request.url.slice('media://'.length))
    // Strip a leading slash that comes from an empty host on Windows
    // (media:///D:/foo -> /D:/foo). Path objects on Windows hate that.
    if (/^\/[A-Za-z]:/.test(raw)) raw = raw.slice(1)
    const fileUrl = pathToFileURL(raw).toString()
    return net.fetch(fileUrl)
  })

  registerIpcHandlers()

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
