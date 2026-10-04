// Run with: pnpm exec electron scripts/smoke-release.mjs [release/linux-unpacked/resources/app.asar]
// Loads the actual built entry, preload and renderer. All maps and user data are temporary.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import { app, BrowserWindow, dialog } from 'electron'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appRoot = resolve(process.argv[2] ?? projectRoot)
const expectedVersion = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version
const mainPath = join(appRoot, 'out/main/index.js')
const requireApp = createRequire(pathToFileURL(mainPath))
const temporary = mkdtempSync(join(tmpdir(), 'mapper-release-smoke-'))
const world = join(temporary, 'world')
const userData = join(temporary, 'userData')
mkdirSync(world)
mkdirSync(userData)
app.setPath('userData', userData)
app.setPath('sessionData', userData)
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [world] })

// Build a real PNG synchronously so app readiness cannot precede main's protocol registration.
function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}

function chunk(name, bytes) {
  const kind = Buffer.from(name)
  const length = Buffer.alloc(4)
  const crc = Buffer.alloc(4)
  length.writeUInt32BE(bytes.length)
  crc.writeUInt32BE(crc32(Buffer.concat([kind, bytes])))
  return Buffer.concat([length, kind, bytes, crc])
}

const header = Buffer.alloc(13)
header.writeUInt32BE(64, 0)
header.writeUInt32BE(32, 4)
header[8] = 8
header[9] = 2
const pixels = Buffer.alloc((64 * 3 + 1) * 32)
for (let y = 0; y < 32; y += 1) {
  for (let x = 0; x < 64; x += 1) {
    const offset = y * (64 * 3 + 1) + 1 + x * 3
    pixels.set([128, 192, 160], offset)
  }
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
])
writeFileSync(join(world, '首版地图.png'), png)
writeFileSync(join(world, 'portrait.png'), png)

let firstWindow
const runtimeErrors = []
app.on('browser-window-created', (_event, window) => {
  firstWindow ??= window
  window.webContents.on('preload-error', (_preloadEvent, path, error) => runtimeErrors.push(`preload ${path}: ${error.message}`))
  window.webContents.on('render-process-gone', (_goneEvent, details) => runtimeErrors.push(`renderer: ${details.reason}`))
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') runtimeErrors.push(event.message)
  })
})

const deadline = setTimeout(() => {
  console.error('Release smoke timed out.')
  app.exit(1)
}, 90_000)

function unwrap(result) {
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.value
}

async function waitFor(check, label) {
  const started = Date.now()
  while (Date.now() - started < 30_000) {
    if (await check()) return
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function run() {
  const packagedVersion = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).version
  assert.equal(typeof expectedVersion, 'string')
  assert.equal(packagedVersion, expectedVersion, 'Packaged version must match project version')
  assert.ok(requireApp('sharp').versions.vips, 'Packaged sharp/libvips must load')
  await import(pathToFileURL(mainPath).href)
  await app.whenReady()
  await waitFor(() => firstWindow && !firstWindow.webContents.isLoading(), 'application window')
  const contents = firstWindow.webContents
  const evaluate = (code) => contents.executeJavaScript(code)
  await waitFor(() => evaluate("Boolean(window.mapper && document.querySelector('button') && document.body.innerText.includes('选择世界观目录'))"), 'React renderer and sandbox preload')
  const preferences = contents.getLastWebPreferences()
  assert.equal(preferences.sandbox, true)
  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(preferences.webSecurity, true)
  assert.deepEqual(await evaluate('({ require: typeof window.require, process: typeof window.process, ipcRenderer: typeof window.ipcRenderer })'), {
    require: 'undefined', process: 'undefined', ipcRenderer: 'undefined',
  })

  // Exercise the real React directory action and automatic map selection.
  await evaluate("Array.from(document.querySelectorAll('button')).find(button => button.innerText.includes('选择世界观目录')).click()")
  await waitFor(() => evaluate("Boolean(document.querySelector('canvas') && document.body.innerText.includes('首版地图.png'))"), 'selected map canvas')
  const maps = unwrap(await evaluate('window.mapper.listMaps()'))
  assert.deepEqual(maps.map((map) => map.name), ['首版地图.png'])
  const mapId = maps[0].id
  const call = (method, value) => evaluate(`window.mapper.${method}(${JSON.stringify(value)})`)
  const loaded = unwrap(await call('loadMap', mapId))
  assert.equal(loaded.image.width, 64)
  assert.equal(loaded.image.height, 32)
  const manifest = unwrap(await call('prepareTiles', mapId))
  const preview = await evaluate(`(async () => {
    const url = ${JSON.stringify(manifest.previewUrl)};
    const response = await fetch(url);
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return { status: response.status, type: response.headers.get('content-type'), width: image.width, height: image.height, pixel: Array.from(context.getImageData(0, 0, 1, 1).data) };
  })()`)
  assert.equal(preview.status, 200)
  assert.equal(preview.type, 'image/webp')
  assert.equal(preview.width, 64)
  assert.equal(preview.height, 32)
  assert.ok(preview.pixel[3] === 255, 'Image must be readable from an untainted canvas')
  const tileUrl = manifest.tileUrlTemplate.replace('{level}', '0').replace('{x}', '0').replace('{y}', '0')
  assert.equal(await evaluate(`fetch(${JSON.stringify(tileUrl)}).then(response => response.status)`), 200)
  assert.equal(await evaluate(`fetch(${JSON.stringify(manifest.previewUrl + '?outside=true')}).then(response => response.status)`), 404)

  const invalidMap = await call('loadMap', '../outside.png')
  assert.equal(invalidMap.ok, false)
  assert.equal(invalidMap.error.code, 'INVALID_ARGUMENT')
  const invalidFeature = await call('readFeature', { mapId, feature: '../../outside' })
  assert.equal(invalidFeature.ok, false)
  assert.equal(invalidFeature.error.code, 'INVALID_ARGUMENT')
  const config = { ...loaded.features.config.document, metersPerPixel: 250 }
  const saved = unwrap(await call('saveFeature', { mapId, feature: 'config', document: config, expectedRevision: null }))
  const timestamp = new Date().toISOString()
  const line = {
    version: 1, image: loaded.image, measurements: [{
      id: 'smoke-line', name: '首版验证线', createdAt: timestamp, updatedAt: timestamp,
      geometry: { kind: 'straight', nodes: [{ point: { x: 0, y: 0 } }, { point: { x: 20, y: 0 } }] },
    }],
  }
  unwrap(await call('saveFeature', { mapId, feature: 'lines', document: line, expectedRevision: null }))
  unwrap(await evaluate('window.mapper.flushSaves()'))
  const reopened = unwrap(await call('loadMap', mapId))
  assert.equal(reopened.features.config.document.metersPerPixel, 250)
  assert.equal(reopened.features.config.revision, saved.revision)
  assert.deepEqual(reopened.features.lines.document.measurements, line.measurements)
  const savedOnDisk = JSON.parse(readFileSync(join(world, '首版地图.png_data', 'LineMeasurements.json'), 'utf8'))
  assert.deepEqual(savedOnDisk.measurements, line.measurements)

  // A second window with the same renderer/preload cannot invoke main-window IPC.
  const other = new BrowserWindow({ show: false, webPreferences: {
    preload: join(appRoot, 'out/preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false,
  } })
  await other.loadURL(contents.getURL())
  const forbidden = await other.webContents.executeJavaScript('window.mapper.listMaps()')
  assert.equal(forbidden.ok, false)
  assert.equal(forbidden.error.code, 'FORBIDDEN')
  other.destroy()
  assert.deepEqual(runtimeErrors, [])
  console.log(JSON.stringify({
    result: 'passed', appRoot, version: packagedVersion, electron: process.versions.electron,
    // This script is the host app's entry; its getVersion() belongs to that host.
    smokeHostVersion: app.getVersion(),
    checks: [`version ${expectedVersion}`, 'packaged sharp/libvips', 'React renderer', 'sandbox preload', 'map filename filter', 'native directory IPC', 'WebP preview and tile protocol', 'untainted canvas', 'argument validation', 'atomic save/reload', 'foreign-window IPC denied'],
  }, null, 2))
}

run().then(() => {
  clearTimeout(deadline)
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  rmSync(temporary, { recursive: true, force: true })
  app.exit(0)
}).catch((error) => {
  clearTimeout(deadline)
  console.error(error)
  console.error('Renderer errors:', runtimeErrors)
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  rmSync(temporary, { recursive: true, force: true })
  app.exit(1)
})
