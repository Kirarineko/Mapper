import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MapCatalog } from '../src/main/catalog'
import { FeatureStore } from '../src/main/storage'
import { TileCache } from '../src/main/tiles'
import { MapperService } from '../src/main/service'
import type { ConfigDocument } from '../src/shared/types'

describe('backend integration', () => {
  let root: string
  let service: MapperService
  let mapPath: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mapper-service-'))
    mapPath = join(root, 'map.png')
    await sharp({ create: { width: 64, height: 32, channels: 3, background: '#80c0a0' } }).png().toFile(mapPath)
    const catalog = new MapCatalog()
    service = new MapperService(catalog, new FeatureStore(), new TileCache(join(root, '.cache'), catalog), async () => root)
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('selects, saves, reopens and rescales geometry without persisting calculated values', async () => {
    const world = await service.chooseWorld()
    const mapId = world!.maps[0].id
    const loaded = await service.loadMap(mapId)
    const config = loaded.features.config.document!
    config.metersPerPixel = 250
    const saving = service.saveFeature({ mapId, feature: 'config', document: config, expectedRevision: null })
    await service.flushSaves()
    const saved = await saving
    const lines = {
      version: 1, image: loaded.image,
      measurements: [{
        id: 'one', name: 'road', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
        geometry: { kind: 'straight', nodes: [{ point: { x: 0, y: 0 } }, { point: { x: 20, y: 0 } }] },
      }],
    }
    await service.saveFeature({ mapId, feature: 'lines', document: lines, expectedRevision: null })
    config.metersPerPixel = 8000
    await service.saveFeature({ mapId, feature: 'config', document: config, expectedRevision: saved.revision })
    const reopened = await service.loadMap(mapId)
    expect(reopened.features.config.document!.metersPerPixel).toBe(8000)
    expect(reopened.features.lines.document!.measurements[0].geometry).toEqual(lines.measurements[0].geometry)
    expect(await readFile(join(`${mapPath}_data`, 'LineMeasurements.json'), 'utf8')).not.toContain('pixelLength')
  })

  it('rejects arbitrary IDs, paths, unknown features and malformed saves', async () => {
    await service.chooseWorld()
    for (const invalid of ['../map.png', '/etc/passwd', null, 42]) {
      await expect(service.loadMap(invalid)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    }
    const mapId = (await service.listMaps())[0].id
    await expect(service.readFeature({ mapId, feature: '../../secret' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(service.saveFeature({ mapId, feature: 'config', document: {}, expectedRevision: null })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(service.readFeature({ mapId, feature: 'config', path: '/tmp/file' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('detects changed content, blocks old geometry and requires explicit acknowledgement', async () => {
    await service.chooseWorld()
    const mapId = (await service.listMaps())[0].id
    const loaded = await service.loadMap(mapId)
    const original = loaded.features.config.document!
    const first = await service.saveFeature({ mapId, feature: 'config', document: original, expectedRevision: null })
    await sharp({ create: { width: 64, height: 32, channels: 3, background: '#c060a0' } }).png().toFile(mapPath)
    const changed = await service.loadMap(mapId)
    expect(changed.warnings).toContainEqual(expect.objectContaining({ code: 'IMAGE_CHANGED' }))
    await expect(service.saveFeature({ mapId, feature: 'config', document: original, expectedRevision: first.revision })).rejects.toMatchObject({ code: 'IMAGE_CHANGED' })
    const updated: ConfigDocument = { ...original, image: changed.image }
    await expect(service.saveFeature({ mapId, feature: 'config', document: updated, expectedRevision: first.revision })).rejects.toMatchObject({ code: 'IMAGE_CHANGED' })
    await service.saveFeature({ mapId, feature: 'config', document: updated, expectedRevision: first.revision, acceptImageChange: true })
    expect((await service.loadMap(mapId)).warnings).toEqual([])
  })

  it('returns damaged-file warnings and restores a backup only on explicit request', async () => {
    await service.chooseWorld()
    const mapId = (await service.listMaps())[0].id
    const config = (await service.loadMap(mapId)).features.config.document!
    const first = await service.saveFeature({ mapId, feature: 'config', document: config, expectedRevision: null })
    await service.saveFeature({ mapId, feature: 'config', document: { ...config, metersPerPixel: 250 }, expectedRevision: first.revision })
    await writeFile(join(`${mapPath}_data`, 'Config.json'), '{ damaged')
    const loaded = await service.loadMap(mapId)
    expect(loaded.features.config).toMatchObject({ status: 'corrupt', document: null, backupAvailable: true })
    expect(loaded.warnings).toContainEqual(expect.objectContaining({ code: 'CORRUPT_DATA' }))
    const recovered = await service.recoverFeature({ mapId, feature: 'config' })
    expect(recovered.document).toEqual(config)
  })

  it('closes with a write barrier so no save can start after the final flush', async () => {
    await service.chooseWorld()
    const mapId = (await service.listMaps())[0].id
    const config = (await service.loadMap(mapId)).features.config.document!
    const closing = service.prepareClose()
    await expect(service.saveFeature({ mapId, feature: 'config', document: config, expectedRevision: null })).rejects.toMatchObject({ code: 'NOT_READY' })
    await expect(closing).resolves.toBeUndefined()
  })
})
