import { app, BrowserWindow, dialog, net, protocol, session } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CHANNELS, RESOURCE_SCHEME } from '../shared/channels'
import { MapCatalog } from './catalog'
import { registerIpc } from './ipc'
import { FeatureStore } from './storage'
import { TileCache } from './tiles'
import { MapperService } from './service'
import { backendError } from './errors'

protocol.registerSchemesAsPrivileged([{
  scheme: RESOURCE_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}])

let window: BrowserWindow | null = null
let allowClose = false
let removeIpc: (() => void) | null = null
let backend: MapperService | null = null

async function createWindow(): Promise<void> {
  const html = join(import.meta.dirname, '../renderer/index.html')
  const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
  if (!devUrl && !existsSync(html)) {
    console.info('后端构建完成。前端尚未交付：需要 src/renderer/index.html 后才能启动工作区。')
    app.quit()
    return
  }
  const rendererUrl = new URL(devUrl ?? pathToFileURL(html).href).href
  allowClose = false
  window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  const currentWindow = window
  let rendererUnavailable = false
  let nativeClosePending = false
  currentWindow.webContents.on('render-process-gone', () => { rendererUnavailable = true })
  currentWindow.on('unresponsive', () => { rendererUnavailable = true })
  currentWindow.on('responsive', () => { rendererUnavailable = false })
  currentWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  currentWindow.webContents.on('will-navigate', (event, target) => {
    if (target !== rendererUrl) event.preventDefault()
  })
  currentWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())
  const catalog = new MapCatalog()
  const storage = new FeatureStore()
  const tiles = new TileCache(join(app.getPath('userData'), 'cache', 'tiles'), catalog, (progress) => {
    if (!currentWindow.isDestroyed()) currentWindow.webContents.send(CHANNELS.tileProgress, progress)
  })
  const service = new MapperService(catalog, storage, tiles, async () => {
    const response = await dialog.showOpenDialog(currentWindow, { properties: ['openDirectory'] })
    return response.canceled ? null : response.filePaths[0] ?? null
  })
  backend = service
  protocol.handle(RESOURCE_SCHEME, async (request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    try {
      const path = await tiles.resolveResource(request.url)
      const response = await net.fetch(pathToFileURL(path).href)
      const headers = new Headers(response.headers)
      headers.set('Access-Control-Allow-Origin', new URL(rendererUrl).origin)
      headers.set('Content-Type', 'image/webp')
      return new Response(response.body, { status: response.status, headers })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
  removeIpc = registerIpc(currentWindow, rendererUrl, service, () => {
    allowClose = true
    currentWindow.close()
  })
  const closeWithoutRenderer = async (): Promise<void> => {
    if (nativeClosePending) return
    nativeClosePending = true
    try {
      while (!currentWindow.isDestroyed()) {
        try {
          await service.prepareClose()
          allowClose = true
          currentWindow.close()
          return
        } catch (error) {
          const response = await dialog.showMessageBox(currentWindow, {
            type: 'error',
            message: '保存失败，应用尚未关闭。',
            detail: backendError(error).message,
            buttons: ['重试', '取消'],
            defaultId: 0,
            cancelId: 1,
          })
          if (response.response === 1) return
        }
      }
    } finally {
      nativeClosePending = false
    }
  }
  currentWindow.on('close', (event) => {
    if (allowClose) return
    event.preventDefault()
    if (rendererUnavailable) void closeWithoutRenderer()
    else currentWindow.webContents.send(CHANNELS.closeRequested)
  })
  currentWindow.on('closed', () => {
    removeIpc?.()
    removeIpc = null
    protocol.unhandle(RESOURCE_SCHEME)
    window = null
    backend = null
  })
  currentWindow.once('ready-to-show', () => currentWindow.show())
  await currentWindow.loadURL(rendererUrl)
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
}).catch((error: unknown) => {
  console.error('应用启动失败：', error)
  app.exit(1)
})

app.on('before-quit', (event) => {
  if (window && !allowClose) {
    event.preventDefault()
    window.close()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
