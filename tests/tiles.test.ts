import { unlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { MapCatalog } from '../src/main/catalog'
import { imageLevels, TileCache } from '../src/main/tiles'
import type { TileProgress } from '../src/shared/types'

const temporary: string[] = []
async function fixture(width = 1301, height = 703): Promise<{ root: string; cache: string; catalog: MapCatalog; mapId: string; imagePath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'mapper-tiles-'))
  temporary.push(root)
  const imagePath = join(root, 'map.png')
  await sharp({ create: { width, height, channels: 4, background: '#88bbcc' } }).png().toFile(imagePath)
  const catalog = new MapCatalog()
  const world = await catalog.selectWorld(root)
  expect(world.maps).toHaveLength(1)
  return { root, cache: join(root, 'cache'), catalog, mapId: world.maps[0].id, imagePath }
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('TileCache', () => {
  it('builds a rounded pyramid from a single tile to original pixels', () => {
    const sha256 = 'a'.repeat(64)
    expect(imageLevels({ sha256, width: 1301, height: 703 })).toEqual([
      { level: 0, width: 326, height: 176, columns: 1, rows: 1, scale: 0.25 },
      { level: 1, width: 651, height: 352, columns: 2, rows: 1, scale: 0.5 },
      { level: 2, width: 1301, height: 703, columns: 3, rows: 2, scale: 1 }
    ])
    expect(imageLevels({ sha256, width: 16_384, height: 16_384 })).toHaveLength(6)
    expect(imageLevels({ sha256, width: 1, height: 1 })).toHaveLength(1)
  })

  it('generates preview, edge tiles and progress, keeps the event loop responsive and reuses a completed cache', async () => {
    const { cache, catalog, mapId } = await fixture()
    const progress: TileProgress[] = []
    const tiles = new TileCache(cache, catalog, (event) => progress.push(event))
    let ticked = false
    const timer = setTimeout(() => { ticked = true }, 0)
    const manifest = await tiles.prepare(mapId)
    clearTimeout(timer)
    expect(ticked).toBe(true)
    expect(progress[0]).toMatchObject({ mapId, phase: 'preview', completed: 0, total: 10 })
    expect(progress.at(-1)).toMatchObject({ phase: 'ready', completed: 10, total: 10 })
    const preview = await sharp(await tiles.resolveResource(manifest.previewUrl)).metadata()
    expect(preview.width).toBe(1024)
    expect(preview.height).toBeLessThanOrEqual(1024)
    const edge = manifest.tileUrlTemplate.replace('{level}', '2').replace('{x}', '2').replace('{y}', '1')
    expect(await sharp(await tiles.resolveResource(edge)).metadata()).toMatchObject({ format: 'webp', width: 277, height: 191 })
    expect(await sharp(await tiles.resolveResource(manifest.tileUrlTemplate.replace('{level}', '0').replace('{x}', '0').replace('{y}', '0'))).metadata()).toMatchObject({ width: 326, height: 176 })
    progress.length = 0
    expect(await tiles.prepare(mapId)).toEqual(manifest)
    expect(progress).toEqual([{ mapId, phase: 'ready', completed: 10, total: 10 }])
    const restarted = new TileCache(cache, catalog)
    expect(await restarted.prepare(mapId)).toEqual(manifest)
    await rm(cache, { recursive: true, force: true })
    expect(await tiles.prepare(mapId)).toEqual(manifest)
  })

  it('deduplicates simultaneous requests and does not enlarge small maps', async () => {
    const { cache, catalog, mapId } = await fixture(23, 17)
    const progress: TileProgress[] = []
    const tiles = new TileCache(cache, catalog, (event) => progress.push(event))
    const [first, second] = await Promise.all([tiles.prepare(mapId), tiles.prepare(mapId)])
    expect(first).toEqual(second)
    expect(progress.filter((event) => event.phase === 'preview')).toHaveLength(1)
    expect(await sharp(await tiles.resolveResource(first.previewUrl)).metadata()).toMatchObject({ width: 23, height: 17 })
    expect((await readdir(cache)).some((name) => name.includes('.tmp-'))).toBe(false)
  })

  it('rejects traversal, URL suffixes, unknown maps, stale hashes and out-of-range coordinates', async () => {
    const { cache, catalog, mapId } = await fixture(23, 17)
    const tiles = new TileCache(cache, catalog)
    const manifest = await tiles.prepare(mapId)
    for (const url of [
      `${manifest.previewUrl}?path=/etc/passwd`,
      `${manifest.previewUrl}#fragment`,
      manifest.previewUrl.replace('preview.webp', '../manifest.json'),
      manifest.previewUrl.replace('preview.webp', '1/0/0.webp'),
      manifest.previewUrl.replace('preview.webp', '0/1/0.webp'),
      manifest.previewUrl.replace('preview.webp', '0/-1/0.webp'),
      manifest.previewUrl.replace('preview.webp', '0/00/0.webp'),
      manifest.previewUrl.replace('mapper-resource://map/', 'file://map/')
    ]) await expect(tiles.resolveResource(url)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(tiles.resolveResource(manifest.previewUrl.replace(mapId, 'a'.repeat(64)))).rejects.toMatchObject({ code: 'NOT_READY' })
    await expect(tiles.resolveResource(manifest.previewUrl.replace(manifest.image.sha256, 'a'.repeat(64)))).rejects.toMatchObject({ code: 'IMAGE_CHANGED' })
  })

  it('invalidates resources when image bytes change and generates a separate cache version', async () => {
    const { cache, catalog, mapId, imagePath } = await fixture(23, 17)
    const tiles = new TileCache(cache, catalog)
    const original = await tiles.prepare(mapId)
    await sharp({ create: { width: 25, height: 19, channels: 3, background: '#ccaabb' } }).png().toFile(imagePath)
    await expect(tiles.resolveResource(original.previewUrl)).rejects.toMatchObject({ code: 'IMAGE_CHANGED' })
    const next = await tiles.prepare(mapId)
    expect(next.image.sha256).not.toBe(original.image.sha256)
    expect(next.image).toMatchObject({ width: 25, height: 19 })
    expect((await readdir(cache)).filter((name) => !name.includes('.tmp-'))).toHaveLength(2)
    await expect(tiles.resolveResource(original.previewUrl)).rejects.toMatchObject({ code: 'IMAGE_CHANGED' })
  })

  it('rebuilds interrupted or incomplete caches and refuses cache symlinks', async () => {
    const { root, cache, catalog, mapId } = await fixture(23, 17)
    const tiles = new TileCache(cache, catalog)
    const manifest = await tiles.prepare(mapId)
    const preview = await tiles.resolveResource(manifest.previewUrl)
    const bytes = await readFile(preview)
    await rm(preview)
    await expect(tiles.resolveResource(manifest.previewUrl)).rejects.toMatchObject({ code: 'NOT_READY' })
    expect(await tiles.prepare(mapId)).toEqual(manifest)
    await writeFile(join(root, 'outside.webp'), bytes)
    await rm(preview)
    await symlink(join(root, 'outside.webp'), preview)
    await expect(tiles.resolveResource(manifest.previewUrl)).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
    await expect(tiles.prepare(mapId)).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
  })

  it('recovers from malformed completion markers and retries a failed native generation', async () => {
    const { cache, catalog, mapId, imagePath } = await fixture(23, 17)
    const progress: TileProgress[] = []
    let deleteSource = false
    const tiles = new TileCache(cache, catalog, (event) => {
      progress.push(event)
      if (deleteSource && event.phase === 'preview') {
        deleteSource = false
        unlinkSync(imagePath)
      }
    })
    const manifest = await tiles.prepare(mapId)
    const cacheDir = join(cache, (await readdir(cache))[0])
    await writeFile(join(cacheDir, 'manifest.json'), '{broken')
    expect(await tiles.prepare(mapId)).toEqual(manifest)
    await rm(cacheDir, { recursive: true, force: true })
    const abandoned = `${cacheDir}.tmp-00000000-0000-4000-8000-000000000000`
    await mkdir(abandoned)
    const bytes = await readFile(imagePath)
    deleteSource = true
    await expect(tiles.prepare(mapId)).rejects.toMatchObject({ code: 'TILE_FAILED' })
    expect(progress.at(-1)).toMatchObject({ phase: 'failed' })
    expect((await readdir(cache)).some((name) => name.includes('.tmp-'))).toBe(false)
    await writeFile(imagePath, bytes)
    expect(await tiles.prepare(mapId)).toEqual(manifest)
    expect(await readFile(imagePath)).not.toHaveLength(0)
  })

  it('does not commit a cache under an old hash when the source changes during native processing', async () => {
    const { cache, catalog, mapId, imagePath } = await fixture(23, 17)
    const replacement = await sharp({ create: { width: 25, height: 19, channels: 3, background: '#ccaabb' } }).png().toBuffer()
    let replace = true
    const tiles = new TileCache(cache, catalog, (event) => {
      if (replace && event.phase === 'tiles') {
        replace = false
        writeFileSync(imagePath, replacement)
      }
    })
    await expect(tiles.prepare(mapId)).rejects.toMatchObject({ code: 'IMAGE_CHANGED' })
    expect(await readdir(cache)).toEqual([])
    expect((await tiles.prepare(mapId)).image).toMatchObject({ width: 25, height: 19 })
  })
})
