import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { MapCatalog, verifyContainedPath } from '../src/main/catalog'

const temporary: string[] = []
async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mapper-catalog-'))
  temporary.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('MapCatalog', () => {
  it('enumerates supported extensions recursively, ignores data/cache/hidden directories, and assigns stable opaque IDs', async () => {
    const root = await directory()
    for (const name of ['nested', 'map.png_data', '.hidden', 'cache', 'node_modules']) await mkdir(join(root, name))
    for (const name of ['a-map.png', 'a-map.jpeg', 'nested/b-map.WEBP', 'other-map.svg', 'map.png_data/ignored-map.png', '.hidden/ignored-map.png', 'cache/ignored-map.png', 'node_modules/ignored-map.png', '.hidden-map.png']) {
      await writeFile(join(root, name), '')
    }
    const catalog = new MapCatalog()
    const selected = await catalog.selectWorld(root)
    expect(selected.maps.map((map) => map.relativePath)).toEqual(['a-map.jpeg', 'a-map.png', 'nested/b-map.WEBP'])
    expect(selected.maps.every((map) => /^[a-f0-9]{64}$/.test(map.id))).toBe(true)
    const again = await new MapCatalog().selectWorld(root)
    expect(again).toEqual(selected)
    await writeFile(join(root, 'new-map.jpg'), '')
    expect((await catalog.refresh()).map((map) => map.name)).toContain('new-map.jpg')
    selected.maps[0].relativePath = '../escape.png'
    expect(catalog.listMaps()[0].relativePath).toBe('a-map.jpeg')
  })

  it('matches Chinese or case-insensitive map substrings in supported image filenames only', async () => {
    const root = await directory()
    await mkdir(join(root, 'map-directory'))
    const included = ['世界地图.png', '地图草稿.JPEG', 'Map.jpg', 'MAP.WEBP', 'beforemap.png', 'mapafter.jpeg', 'beforeMaPafter.webp', 'bitmap.png', 'map-directory/区域地图.jpg']
    const excluded = ['portrait.png', 'landscape.jpeg', 'reference.webp', 'map-directory/portrait.png', 'map.svg', '地图.gif', 'MAP.bmp', 'map.txt', '地图.png.txt']
    for (const name of [...included, ...excluded]) await writeFile(join(root, name), '')
    const catalog = new MapCatalog()
    const world = await catalog.selectWorld(root)
    expect(world.maps.map((map) => map.relativePath)).toEqual([...included].sort())
    expect(catalog.listMaps().map((map) => map.relativePath)).toEqual([...included].sort())
  })

  it('removes a previously listed map and its ID when refresh sees a name without the keyword', async () => {
    const root = await directory()
    const original = join(root, 'region-map.png')
    const renamed = join(root, 'portrait.png')
    await writeFile(original, '')
    const catalog = new MapCatalog()
    const { maps } = await catalog.selectWorld(root)
    expect(maps).toHaveLength(1)
    await rename(original, renamed)
    expect(await catalog.refresh()).toEqual([])
    expect(catalog.listMaps()).toEqual([])
    await expect(catalog.resolveMap(maps[0].id)).rejects.toMatchObject({ code: 'MAP_NOT_FOUND' })
    await rename(renamed, join(root, '重命名地图.png'))
    const refreshed = await catalog.refresh()
    expect(refreshed.map((map) => map.name)).toEqual(['重命名地图.png'])
    expect(refreshed[0].id).not.toBe(maps[0].id)
  })

  it('requires a selected world and rejects arbitrary IDs and escaped paths', async () => {
    const root = await directory()
    const catalog = new MapCatalog()
    expect(() => catalog.listMaps()).toThrow(expect.objectContaining({ code: 'NO_WORLD' }))
    await catalog.selectWorld(root)
    await expect(catalog.resolveMap('../outside.png')).rejects.toMatchObject({ code: 'MAP_NOT_FOUND' })
    await expect(verifyContainedPath(root, join(root, '..', 'outside.png'))).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
  })

  it('does not follow internal or external symbolic links and rejects a map replaced by a link', async () => {
    const root = await directory()
    const outside = await directory()
    await mkdir(join(root, 'nested'))
    await writeFile(join(root, 'nested', 'inside-map.png'), '')
    await writeFile(join(outside, 'outside-map.png'), '')
    await symlink(join(outside, 'outside-map.png'), join(root, 'outside-map-link.png'))
    await symlink(join(root, 'nested'), join(root, 'inside-link'), 'dir')
    await symlink(outside, join(root, 'outside-link'), 'dir')
    const catalog = new MapCatalog()
    const world = await catalog.selectWorld(root)
    expect(world.maps.map((map) => map.relativePath)).toEqual(['nested/inside-map.png'])
    const id = world.maps[0].id
    await rm(join(root, 'nested', 'inside-map.png'))
    await symlink(join(outside, 'outside-map.png'), join(root, 'nested', 'inside-map.png'))
    await expect(catalog.resolveMap(id)).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
  })

  it('validates image bytes, hashes the file, and detects changed image versions', async () => {
    const root = await directory()
    const path = join(root, 'map.png')
    await sharp({ create: { width: 37, height: 29, channels: 3, background: '#aabbcc' } }).png().toFile(path)
    const catalog = new MapCatalog()
    const { maps } = await catalog.selectWorld(root)
    const inspected = await catalog.inspect(maps[0].id)
    expect(inspected.image).toEqual({ sha256: createHash('sha256').update(await readFile(path)).digest('hex'), width: 37, height: 29 })
    await expect(catalog.assertImageCurrent(maps[0].id, inspected.image)).resolves.toMatchObject({ image: inspected.image })
    await sharp({ create: { width: 38, height: 30, channels: 3, background: '#ccaabb' } }).png().toFile(path)
    await expect(catalog.assertImageCurrent(maps[0].id, inspected.image)).rejects.toMatchObject({ code: 'IMAGE_CHANGED' })
    expect((await catalog.inspect(maps[0].id)).image.width).toBe(38)
  })

  it('uses unrotated JPEG dimensions even when EXIF requests rotation', async () => {
    const root = await directory()
    await sharp({ create: { width: 37, height: 29, channels: 3, background: '#aabbcc' } }).withMetadata({ orientation: 6 }).jpeg().toFile(join(root, 'map.jpg'))
    const catalog = new MapCatalog()
    const { maps } = await catalog.selectWorld(root)
    expect((await catalog.inspect(maps[0].id)).image).toMatchObject({ width: 37, height: 29 })
  })

  it.each(['png', 'jpeg', 'webp'] as const)('decodes static %s by actual format rather than trusting the extension', async (format) => {
    const root = await directory()
    await sharp({ create: { width: 7, height: 5, channels: 3, background: '#aabbcc' } }).toFormat(format).toFile(join(root, 'map.png'))
    const catalog = new MapCatalog()
    const { maps } = await catalog.selectWorld(root)
    expect((await catalog.inspect(maps[0].id)).image).toMatchObject({ width: 7, height: 5 })
  })

  it('rejects unsupported bytes disguised with an image extension and images wider than the limit', async () => {
    const root = await directory()
    await writeFile(join(root, 'fake-map.png'), 'not a png')
    await sharp({ create: { width: 16_385, height: 1, channels: 3, background: '#aabbcc' } }).png().toFile(join(root, 'too-wide-map.png'))
    const catalog = new MapCatalog()
    const { maps } = await catalog.selectWorld(root)
    expect(maps).toHaveLength(2)
    for (const map of maps) await expect(catalog.inspect(map.id)).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE' })
  })

  it('rejects APNG animation control and animated WebP instead of using only the first frame', async () => {
    const root = await directory()
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#aabbcc' } }).png().toBuffer()
    const control = Buffer.alloc(20)
    control.writeUInt32BE(8, 0)
    control.write('acTL', 4, 'ascii')
    control.writeUInt32BE(2, 8)
    await writeFile(join(root, 'animated-map.png'), Buffer.concat([png.subarray(0, 33), control, png.subarray(33)]))
    const webp = Buffer.alloc(32)
    webp.write('RIFF', 0, 'ascii')
    webp.writeUInt32LE(24, 4)
    webp.write('WEBPVP8X', 8, 'ascii')
    webp[20] = 2
    await writeFile(join(root, 'animated-map.webp'), webp)
    const catalog = new MapCatalog()
    const { maps } = await catalog.selectWorld(root)
    expect(maps).toHaveLength(2)
    for (const map of maps) await expect(catalog.inspect(map.id)).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE' })
  })
})
