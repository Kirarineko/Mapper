import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { MapCatalog } from '../src/main/catalog'
import { TileCache } from '../src/main/tiles'
import type { TileProgress } from '../src/shared/types'

it('processes a 16384×16384 static image without blocking the event loop', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mapper-large-image-'))
  const imagePath = join(root, 'world-map.png')
  const cache = join(root, 'cache')
  const dimension = 16_384
  const rssStart = process.memoryUsage().rss
  let peakRss = rssStart
  let heartbeatCount = 0
  let longestHeartbeatGap = 0
  let lastHeartbeat = performance.now()
  const monitor = setInterval(() => {
    const now = performance.now()
    longestHeartbeatGap = Math.max(longestHeartbeatGap, now - lastHeartbeat)
    lastHeartbeat = now
    heartbeatCount += 1
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
  }, 25)
  const started = performance.now()
  try {
    await sharp({ create: { width: dimension, height: dimension, channels: 3, background: '#88aacc' }, limitInputPixels: dimension ** 2 }).png({ compressionLevel: 1 }).toFile(imagePath)
    const fixtureDone = performance.now()
    const progress: TileProgress[] = []
    const catalog = new MapCatalog()
    const { maps } = await catalog.selectWorld(root)
    expect(maps).toHaveLength(1)
    const tiles = new TileCache(cache, catalog, (event) => progress.push(event))
    const ticksBefore = heartbeatCount
    const manifest = await tiles.prepare(maps[0].id)
    const processingDone = performance.now()
    expect(manifest.image).toMatchObject({ width: dimension, height: dimension })
    expect(manifest.levels.map((level) => [level.width, level.height])).toEqual([512, 1024, 2048, 4096, 8192, dimension].map((size) => [size, size]))
    expect(manifest.levels.reduce((sum, level) => sum + level.rows * level.columns, 0)).toBe(1365)
    expect(progress[0]).toMatchObject({ phase: 'preview', completed: 0, total: 1366 })
    expect(progress.at(-1)).toMatchObject({ phase: 'ready', completed: 1366, total: 1366 })
    expect(progress.some((event) => event.phase === 'tiles' && event.completed > 1)).toBe(true)
    expect(heartbeatCount - ticksBefore).toBeGreaterThan(10)
    expect(longestHeartbeatGap).toBeLessThan(1000)
    const previewPath = await tiles.resolveResource(manifest.previewUrl)
    expect(await sharp(previewPath).metadata()).toMatchObject({ format: 'webp', width: 1024, height: 1024 })
    const directory = join(cache, (await readdir(cache)).find((name) => !name.includes('.tmp-'))!)
    let tileCount = 0
    let cacheBytes = (await stat(previewPath)).size
    for (const level of manifest.levels) {
      for (let x = 0; x < level.columns; x += 1) {
        for (let y = 0; y < level.rows; y += 1) {
          const tilePath = join(directory, String(level.level), String(x), `${y}.webp`)
          expect(await sharp(tilePath).metadata()).toMatchObject({ format: 'webp', width: 512, height: 512 })
          cacheBytes += (await stat(tilePath)).size
          tileCount += 1
        }
      }
    }
    expect(tileCount).toBe(1365)
    const tileUrl = manifest.tileUrlTemplate.replace('{level}', '5').replace('{x}', '31').replace('{y}', '31')
    const sample = await sharp(await tiles.resolveResource(tileUrl)).raw().toBuffer({ resolveWithObject: true })
    expect(sample.info).toMatchObject({ width: 512, height: 512, channels: 3 })
    expect(sample.data[0]).toBeGreaterThan(100)
    const cachedStarted = performance.now()
    expect(await tiles.prepare(maps[0].id)).toEqual(manifest)
    const cachedMs = performance.now() - cachedStarted
    console.info(JSON.stringify({ scenario: '16384x16384-low-entropy-png', fixtureMs: Math.round(fixtureDone - started), processingMs: Math.round(processingDone - fixtureDone), cachedMs: Math.round(cachedMs), totalMs: Math.round(performance.now() - started), rssStartMiB: Math.round(rssStart / 2 ** 20), peakRssMiB: Math.round(peakRss / 2 ** 20), longestHeartbeatGapMs: Math.round(longestHeartbeatGap), heartbeatCount, progressEvents: progress.length, tiles: tileCount, sourceBytes: (await stat(imagePath)).size, cacheBytes }))
  } finally {
    clearInterval(monitor)
    await rm(root, { recursive: true, force: true })
  }
}, 300_000)
