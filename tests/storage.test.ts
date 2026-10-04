import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, writeFile, mkdir, chmod, symlink, truncate, stat, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConfigDocument, ImageIdentity, SaveRequest } from '../src/shared/types'
import { FeatureStore, MAX_DOCUMENT_BYTES } from '../src/main/storage'

const image: ImageIdentity = { sha256: 'a'.repeat(64), width: 100, height: 80 }
const changedImage: ImageIdentity = { sha256: 'b'.repeat(64), width: 120, height: 80 }

function config(metersPerPixel: number | null = null, identity = image): ConfigDocument {
  return {
    version: 1,
    image: { ...identity },
    metersPerPixel,
    settings: { showSegmentLengths: true, brushDiameter: 24 }
  }
}

function request(document: ConfigDocument, expectedRevision: string | null = null): SaveRequest {
  return { mapId: 'map', feature: 'config', document, expectedRevision }
}

describe('FeatureStore', () => {
  let root: string
  let map: string
  let store: FeatureStore

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mapper-storage-'))
    map = join(root, 'map.png')
    await writeFile(map, 'image')
    store = new FeatureStore()
  })

  afterEach(async () => {
    await chmod(root, 0o700)
    await chmod(`${map}_data`, 0o700).catch(() => undefined)
    await chmod(join(`${map}_data`, 'Config.json'), 0o600).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  })

  it('returns defaults without creating a directory and keeps extensions distinct', async () => {
    const missing = await store.read(map, image, 'config')
    expect(missing).toMatchObject({ status: 'missing', revision: null, backupAvailable: false })
    expect((missing.document as ConfigDocument).metersPerPixel).toBeNull()
    expect(await readdir(root)).toEqual(['map.png'])
    const otherMap = join(root, 'map.jpg')
    await writeFile(otherMap, 'image')
    await store.save(map, image, request(config(250)))
    await store.save(otherMap, image, request(config(8000)))
    const reopened = new FeatureStore()
    expect((await reopened.read(map, image, 'config')).document).toEqual(config(250))
    expect((await reopened.read(otherMap, image, 'config')).document).toEqual(config(8000))
    expect(await readdir(root)).toEqual(expect.arrayContaining(['map.png_data', 'map.jpg_data']))
  })

  it.skipIf(process.platform !== 'win32')('shares saves, backups and recovery between Windows short and long directory names', async (context) => {
    const longRoot = await realpath(root)
    const { stdout } = await promisify(execFile)(process.env.ComSpec ?? 'cmd.exe', [
      '/d', '/c', 'for %I in ("%MAPPER_TEST_DIRECTORY%") do @echo %~sI'
    ], {
      encoding: 'utf8',
      windowsHide: true,
      windowsVerbatimArguments: true,
      env: { ...process.env, MAPPER_TEST_DIRECTORY: longRoot }
    })
    const shortRoot = stdout.trim()
    expect(isAbsolute(shortRoot)).toBe(true)
    expect(await realpath(shortRoot)).toBe(longRoot)
    if (shortRoot.toLowerCase() === longRoot.toLowerCase()) {
      context.skip('The test volume does not provide distinct Windows 8.3 directory names.')
    }
    const longMap = join(longRoot, 'map.png')
    const shortMap = join(shortRoot, 'map.png')
    expect(await store.read(shortMap, image, 'config')).toMatchObject({
      status: 'missing', revision: null, document: config()
    })
    expect(await store.read(longMap, image, 'config')).toMatchObject({
      status: 'missing', revision: null, document: config()
    })

    const first = await store.save(shortMap, image, request(config(250)))
    await store.save(longMap, image, request(config(8000), first.revision))
    expect((await store.read(shortMap, image, 'config')).document).toEqual(config(8000))
    expect((await new FeatureStore().read(longMap, image, 'config')).document).toEqual(config(8000))
    const directory = `${longMap}_data`
    const file = join(directory, 'Config.json')
    expect(JSON.parse(await readFile(`${file}.bak`, 'utf8'))).toEqual(config(250))
    const corrupt = '{ corrupt document must survive alias recovery'
    await writeFile(file, corrupt)
    expect(await store.read(shortMap, image, 'config')).toMatchObject({
      status: 'corrupt', backupAvailable: true
    })
    const restored = await store.recover(shortMap, image, 'config')
    expect(restored.document).toEqual(config(250))
    expect((await store.read(longMap, image, 'config')).document).toEqual(config(250))
    const preserved = (await readdir(directory)).find((name) => name.startsWith('Config.json.corrupt-'))
    expect(preserved).toBeDefined()
    expect(await readFile(join(directory, preserved!), 'utf8')).toBe(corrupt)

    const candidates = [config(500), config(700)]
    const results = await Promise.allSettled([
      store.save(shortMap, image, request(candidates[0], restored.revision)),
      store.save(longMap, image, request(candidates[1], restored.revision))
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'CONFLICT' }) })
    ])
    const winner = results.findIndex((result) => result.status === 'fulfilled')
    const latest = await store.read(longMap, image, 'config')
    expect(latest.document).toEqual(candidates[winner])
    expect(await store.read(shortMap, image, 'config')).toEqual(latest)
    await expect(store.flush()).rejects.toMatchObject({ code: 'CONFLICT' })
    await store.save(shortMap, image, request(config(900), latest.revision))
    await expect(store.flush()).resolves.toBeUndefined()
  })

  it('backs up the prior valid document and explicitly restores it while preserving corrupt bytes', async () => {
    const first = await store.save(map, image, request(config(250)))
    await store.save(map, image, request(config(8000), first.revision))
    const dataDirectory = `${map}_data`
    const file = join(dataDirectory, 'Config.json')
    const corrupted = '{ broken json, original must survive'
    await writeFile(file, corrupted)
    const broken = await store.read(map, image, 'config')
    expect(broken).toMatchObject({ status: 'corrupt', document: null, backupAvailable: true })
    await expect(store.save(map, image, request(config(300), broken.revision))).rejects.toMatchObject({ code: 'CORRUPT_DATA' })
    expect(await readFile(file, 'utf8')).toBe(corrupted)
    await expect(store.flush()).rejects.toMatchObject({ code: 'CORRUPT_DATA' })
    const recovered = await store.recover(map, image, 'config')
    expect(recovered.document).toEqual(config(250))
    const preserved = (await readdir(dataDirectory)).find((name) => name.startsWith('Config.json.corrupt-'))
    expect(preserved).toBeDefined()
    expect(await readFile(join(dataDirectory, preserved!), 'utf8')).toBe(corrupted)
    await expect(store.flush()).resolves.toBeUndefined()
  })

  it('treats structurally invalid and oversized documents as corrupt', async () => {
    await mkdir(`${map}_data`)
    const file = join(`${map}_data`, 'Config.json')
    await writeFile(file, JSON.stringify({ ...config(), version: 99 }))
    expect((await store.read(map, image, 'config')).status).toBe('corrupt')
    await truncate(file, MAX_DOCUMENT_BYTES + 1)
    expect((await store.read(map, image, 'config')).status).toBe('corrupt')
    await expect(store.save(map, image, request(config()))).rejects.toMatchObject({ code: 'CORRUPT_DATA' })
  })

  it('rejects invalid UTF-8 without silently replacing saved measurement names', async () => {
    await mkdir(`${map}_data`)
    const raw = Buffer.from(JSON.stringify({
      version: 1, image,
      measurements: [{
        id: 'line', name: 'x', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
        geometry: { kind: 'straight', nodes: [{ point: { x: 0, y: 0 } }, { point: { x: 10, y: 0 } }] }
      }]
    }))
    raw[raw.indexOf('"name":"x"') + 8] = 0xff
    const file = join(`${map}_data`, 'LineMeasurements.json')
    await writeFile(file, raw)
    expect((await store.read(map, image, 'lines')).status).toBe('corrupt')
    expect(await readFile(file)).toEqual(raw)
  })

  it('rejects recovery with no valid backup and preserves the damaged primary', async () => {
    await mkdir(`${map}_data`)
    const file = join(`${map}_data`, 'Config.json')
    await writeFile(file, '{bad')
    await writeFile(`${file}.bak`, '{bad backup')
    expect((await store.read(map, image, 'config')).backupAvailable).toBe(false)
    await expect(store.recover(map, image, 'config')).rejects.toMatchObject({ code: 'CORRUPT_DATA' })
    expect(await readFile(file, 'utf8')).toBe('{bad')
    expect(await readFile(`${file}.bak`, 'utf8')).toBe('{bad backup')
  })

  it('preserves an oversized damaged primary when restoring a valid backup', async () => {
    const first = await store.save(map, image, request(config(1)))
    await store.save(map, image, request(config(2), first.revision))
    const file = join(`${map}_data`, 'Config.json')
    await truncate(file, MAX_DOCUMENT_BYTES + 1)
    expect((await store.recover(map, image, 'config')).document).toEqual(config(1))
    const preserved = (await readdir(`${map}_data`)).find((name) => name.startsWith('Config.json.corrupt-'))
    expect((await stat(join(`${map}_data`, preserved!))).size).toBe(MAX_DOCUMENT_BYTES + 1)
  })

  it('serializes competing saves and rejects stale revisions, including external edits', async () => {
    const first = await store.save(map, image, request(config(1)))
    const outcomes = await Promise.allSettled([
      store.save(map, image, request(config(2), first.revision)),
      store.save(map, image, request(config(3), first.revision))
    ])
    expect(outcomes[0].status).toBe('fulfilled')
    expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { code: 'CONFLICT' } })
    expect((await store.read(map, image, 'config')).document).toEqual(config(2))
    await expect(store.flush()).rejects.toMatchObject({ code: 'CONFLICT' })
    const file = join(`${map}_data`, 'Config.json')
    const stale = await store.read(map, image, 'config')
    await writeFile(file, JSON.stringify(config(4)))
    await expect(store.save(map, image, request(config(5), stale.revision))).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(config(4))
    const fresh = await store.read(map, image, 'config')
    await store.save(map, image, request(config(6), fresh.revision))
    await expect(store.flush()).resolves.toBeUndefined()
  })

  it.skipIf(process.platform === 'win32')('flush waits for pending saves and retains failure until a successful retry', async () => {
    await chmod(root, 0o500)
    await expect(store.save(map, image, request(config(1)))).rejects.toMatchObject({ code: 'IO_ERROR' })
    await expect(store.flush()).rejects.toMatchObject({ code: 'IO_ERROR' })
    await chmod(root, 0o700)
    const save = store.save(map, image, request(config(2)))
    await store.flush()
    await save
    expect((await store.read(map, image, 'config')).document).toEqual(config(2))
    await expect(store.flush()).resolves.toBeUndefined()
  })

  it('flush includes a save immediately after invocation and saves an immutable request snapshot', async () => {
    const document = config(250)
    const save = store.save(map, image, request(document))
    document.metersPerPixel = 8000
    await store.flush()
    expect(JSON.parse(await readFile(join(`${map}_data`, 'Config.json'), 'utf8'))).toEqual(config(250))
    await save
  })

  it('does not clear a failed save when another feature saves successfully', async () => {
    const first = await store.save(map, image, request(config(1)))
    await expect(store.save(map, image, request(config(2)))).rejects.toMatchObject({ code: 'CONFLICT' })
    await store.save(map, image, {
      mapId: 'map', feature: 'lines', expectedRevision: null,
      document: { version: 1, image, measurements: [] }
    })
    await expect(store.flush()).rejects.toMatchObject({ code: 'CONFLICT' })
    await store.save(map, image, request(config(2), first.revision))
    await expect(store.flush()).resolves.toBeUndefined()
  })

  it('remembers failures before queue creation when a map parent disappears', async () => {
    const unavailableMap = join(root, 'disappeared', 'map.png')
    await expect(store.save(unavailableMap, image, request(config(1)))).rejects.toMatchObject({ code: 'IO_ERROR' })
    await expect(store.flush()).rejects.toMatchObject({ code: 'IO_ERROR' })
    await mkdir(join(root, 'disappeared'))
    await writeFile(unavailableMap, 'image')
    await store.save(unavailableMap, image, request(config(2)))
    await expect(store.flush()).resolves.toBeUndefined()
  })

  it.skipIf(process.platform === 'win32')('refuses readonly data directories, primary files and backups', async () => {
    const first = await store.save(map, image, request(config(1)))
    const file = join(`${map}_data`, 'Config.json')
    await chmod(`${map}_data`, 0o500)
    await expect(store.save(map, image, request(config(2), first.revision))).rejects.toMatchObject({ code: 'IO_ERROR' })
    await chmod(`${map}_data`, 0o700)
    await chmod(file, 0o400)
    await expect(store.save(map, image, request(config(2), first.revision))).rejects.toMatchObject({ code: 'IO_ERROR' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(config(1))
    await chmod(file, 0o600)
    const second = await store.save(map, image, request(config(2), first.revision))
    await chmod(`${file}.bak`, 0o400)
    await expect(store.save(map, image, request(config(3), second.revision))).rejects.toMatchObject({ code: 'IO_ERROR' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(config(2))
  })

  it('blocks directory, primary and backup symbolic links without changing their targets', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'mapper-storage-outside-'))
    try {
      const outsideFile = join(outside, 'untouched.json')
      await writeFile(outsideFile, JSON.stringify(config(9)))
      await symlink(outside, `${map}_data`, 'dir')
      await expect(store.read(map, image, 'config')).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
      await expect(store.save(map, image, request(config()))).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
      await rm(`${map}_data`)
      await mkdir(`${map}_data`)
      const file = join(`${map}_data`, 'Config.json')
      await symlink(outsideFile, file)
      await expect(store.read(map, image, 'config')).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
      await expect(store.save(map, image, request(config()))).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
      await rm(file)
      await symlink(outsideFile, `${file}.bak`)
      await expect(store.save(map, image, request(config()))).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
      await expect(store.recover(map, image, 'config')).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
      expect(JSON.parse(await readFile(outsideFile, 'utf8'))).toEqual(config(9))
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('rejects a parent directory replaced by an external symbolic link for reads and writes', async () => {
    const parent = join(root, 'world')
    await mkdir(parent)
    const nestedMap = join(parent, 'map.png')
    await writeFile(nestedMap, 'image')
    await store.save(nestedMap, image, request(config(1)))
    const original = await store.read(nestedMap, image, 'config')
    const outside = await mkdtemp(join(tmpdir(), 'mapper-parent-outside-'))
    try {
      await writeFile(join(outside, 'map.png'), 'other image')
      await mkdir(join(outside, 'map.png_data'))
      const outsideFile = join(outside, 'map.png_data', 'Config.json')
      const untouched = JSON.stringify(config(9))
      await writeFile(outsideFile, untouched)
      await rm(parent, { recursive: true })
      await symlink(outside, parent, 'dir')
      await expect(store.read(nestedMap, image, 'config')).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
      await expect(store.save(nestedMap, image, request(config(2), original.revision))).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
      await expect(store.recover(nestedMap, image, 'config')).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
      expect(await readFile(outsideFile, 'utf8')).toBe(untouched)
      expect(await readdir(join(outside, 'map.png_data'))).toEqual(['Config.json'])
    } finally {
      await rm(parent, { force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('requires explicit image-change acceptance with the new image identity', async () => {
    const first = await store.save(map, image, request(config(250)))
    expect((await store.read(map, changedImage, 'config')).imageChanged).toBe(true)
    await expect(store.save(map, changedImage, request(config(250), first.revision))).rejects.toMatchObject({ code: 'IMAGE_CHANGED' })
    const updated = request(config(250, changedImage), first.revision)
    await expect(store.save(map, changedImage, updated)).rejects.toMatchObject({ code: 'IMAGE_CHANGED' })
    await expect(store.save(map, changedImage, { ...request(config(250), first.revision), acceptImageChange: true })).rejects.toMatchObject({ code: 'IMAGE_CHANGED' })
    await store.save(map, changedImage, { ...updated, acceptImageChange: true })
    const loaded = await store.read(map, changedImage, 'config')
    expect(loaded.imageChanged).toBe(false)
    expect(loaded.document).toEqual(config(250, changedImage))
  })

  it('keeps feature files independent and stores geometry without derived measurements', async () => {
    await store.save(map, image, request(config(250)))
    await store.save(map, image, {
      mapId: 'map', feature: 'lines', expectedRevision: null,
      document: { version: 1, image, measurements: [] }
    })
    await store.save(map, image, {
      mapId: 'map', feature: 'areas', expectedRevision: null,
      document: { version: 1, image, measurements: [] }
    })
    expect(await readdir(`${map}_data`)).toEqual(expect.arrayContaining([
      'Config.json', 'LineMeasurements.json', 'AreaMeasurements.json'
    ]))
    expect((await store.read(map, image, 'lines')).document).toEqual({ version: 1, image, measurements: [] })
    expect((await store.read(map, image, 'areas')).document).toEqual({ version: 1, image, measurements: [] })
    expect((await readdir(`${map}_data`)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
