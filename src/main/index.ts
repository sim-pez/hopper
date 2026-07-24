import { app, BrowserWindow, nativeImage, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { registerIpc } from './ipc'
import { shutdownAll } from './db/pool'

// resources/ sits next to out/ when unpackaged; packaged builds get it in resourcesPath.
function resource(name: string): string {
  const dev = join(__dirname, '../../resources', name)
  return existsSync(dev) ? dev : join(process.resourcesPath, name)
}

const appIcon = nativeImage.createFromPath(resource('icon.png'))

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#1e1e2e',
    title: 'DB Manager',
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // electron-vite injects the dev server URL via this env var.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Unpackaged macOS runs show the generic Electron dock icon unless set explicitly.
  if (process.platform === 'darwin' && !appIcon.isEmpty()) app.dock?.setIcon(appIcon)
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await shutdownAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async (e) => {
  // Ensure port-forward processes are reaped before exit.
  e.preventDefault()
  await shutdownAll()
  app.exit(0)
})
