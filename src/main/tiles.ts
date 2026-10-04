import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import sharp from './images'
import type { ImageIdentity, TileLevel, TileManifest, TileProgress } from '../shared/types'
import { MapCatalog, verifyContainedPath } from './catalog'
import { MapperError } from './errors'

const TILE_SIZE = 512
const CACHE_VERSION = 1

export function imageLevels(image: ImageIdentity): TileLevel[] {
  if (![image.width, image.height].every((dimension) => Number.isInteger(dimension) && dimension > 0 && dimension <= 16_384)) {
    throw new MapperError('INVALID_ARGUMENT', '地图尺寸无效。')
  }
  let reductions = 0
  while (Math.ceil(Math.max(image.width, image.height) / 2 ** reductions) > TILE_SIZE) reductions += 1
  return Array.from({ length: reductions + 1 }, (_, level) => {
    const divisor = 2 ** (reductions - level)
    const width = Math.ceil(image.width / divisor)
    const height = Math.ceil(image.height / divisor)
    return { level, width, height, columns: Math.ceil(width / TILE_SIZE), rows: Math.ceil(height / TILE_SIZE), scale: 1 / divisor }
  })
}

function manifestFor(mapId: string, image: ImageIdentity): TileManifest {
  const base = `mapper-resource://map/${mapId}/${image.sha256}`
  return { version: 1, mapId, image: { ...image }, tileSize: TILE_SIZE, levels: imageLevels(image), previewUrl: `${base}/preview.webp`, tileUrlTemplate: `${base}/{level}/{x}/{y}.webp` }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

// One native pyramid job at a time bounds decoded-image memory across all maps.
let nativeQueue: Promise<void> = Promise.resolve()
async function withNativeQueue<T>(action: () => Promise<T>): Promise<T> {
  const previous = nativeQueue
  let release!: () => void
  nativeQueue = new Promise<void>((resolve) => { release = resolve })
  await previous
  try {
    return await action()
  } finally {
    release()
  }
}

export class TileCache {
  private readonly jobs = new Map<string, Promise<void>>()
  private readonly ready = new Map<string, TileManifest>()
  private rootPromise: Promise<string> | null = null

  constructor(
    private readonly cacheRoot: string,
    private readonly catalog: MapCatalog,
    private readonly onProgress: (progress: TileProgress) => void = () => {}
  ) {}

  async prepare(mapId: string): Promise<TileManifest> {
    const inspected = await this.catalog.inspect(mapId)
    const manifest = manifestFor(mapId, inspected.image)
    const root = await this.root()
    const directory = this.directory(root, inspected.image.sha256)
    const report = (phase: TileProgress['phase'], completed: number): void => {
      try {
        this.onProgress({ mapId, phase, completed, total: this.total(manifest) })
      } catch {
        // A disconnected observer must not abort an otherwise valid cache job.
      }
    }
    if (!await this.readReady(directory, manifest)) {
      let job = this.jobs.get(inspected.image.sha256)
      if (!job) {
        job = withNativeQueue(async () => {
          if (!await this.readReady(directory, manifest)) {
            await this.generate(inspected.path, directory, manifest, report, () => this.catalog.assertImageCurrent(mapId, inspected.image).then(() => {}))
          }
        })
        this.jobs.set(inspected.image.sha256, job)
        void job.finally(() => this.jobs.delete(inspected.image.sha256)).catch(() => {})
      }
      try {
        await job
      } catch (error) {
        report('failed', 0)
        if (error instanceof MapperError) throw error
        throw new MapperError('TILE_FAILED', '切片生成失败，请检查缓存目录权限和磁盘空间后重试。')
      }
    }
    await this.catalog.assertImageCurrent(mapId, inspected.image)
    this.ready.set(mapId, manifest)
    report('ready', this.total(manifest))
    return manifest
  }

  async resolveResource(resourceUrl: string): Promise<string> {
    if (typeof resourceUrl !== 'string' || !/^mapper-resource:\/\/map\/[a-f0-9]{64}\/[a-f0-9]{64}\/(?:preview\.webp|(?:0|[1-9]\d*)\/(?:0|[1-9]\d*)\/(?:0|[1-9]\d*)\.webp)$/.test(resourceUrl)) {
      throw new MapperError('FORBIDDEN', '资源地址无效。')
    }
    const url = new URL(resourceUrl)
    const [, mapId, sha, ...resource] = url.pathname.split('/')
    const manifest = this.ready.get(mapId)
    if (!manifest) throw new MapperError('NOT_READY', '地图切片尚未准备完成。')
    if (manifest.image.sha256 !== sha) throw new MapperError('IMAGE_CHANGED', '切片与当前地图版本不符。')
    await this.catalog.assertImageCurrent(mapId, manifest.image)
    let relativePath: string
    if (resource.length === 1 && resource[0] === 'preview.webp') {
      relativePath = 'preview.webp'
    } else {
      const [levelText, xText, yText] = resource
      const level = Number(levelText)
      const x = Number(xText)
      const y = Number(yText.slice(0, -5))
      const descriptor = manifest.levels[level]
      if (!Number.isSafeInteger(level) || !Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !descriptor || x >= descriptor.columns || y >= descriptor.rows) {
        throw new MapperError('FORBIDDEN', '切片坐标超出地图范围。')
      }
      relativePath = join(String(level), String(x), `${y}.webp`)
    }
    const root = await this.root()
    const path = join(this.directory(root, sha), relativePath)
    try {
      await verifyContainedPath(root, path)
    } catch (error) {
      if (isMissing(error)) throw new MapperError('NOT_READY', '切片缓存已丢失，请重新生成。')
      throw error
    }
    return path
  }

  private async root(): Promise<string> {
    this.rootPromise ??= mkdir(this.cacheRoot, { recursive: true }).then(() => realpath(this.cacheRoot)).catch((error: unknown) => {
      this.rootPromise = null
      throw error
    })
    const root = await this.rootPromise
    try {
      const info = await lstat(root)
      if (info.isSymbolicLink() || !info.isDirectory()) throw new MapperError('UNSAFE_PATH', '切片缓存目录已被替换。')
      return root
    } catch (error) {
      if (!isMissing(error)) throw error
      this.rootPromise = null
      return this.root()
    }
  }

  private directory(root: string, sha: string): string {
    return join(root, `${sha}-v${CACHE_VERSION}-webp512`)
  }

  private total(manifest: TileManifest): number {
    return 1 + manifest.levels.reduce((sum, level) => sum + level.columns * level.rows, 0)
  }

  private async readReady(directory: string, manifest: TileManifest): Promise<boolean> {
    try {
      const root = await this.root()
      await verifyContainedPath(root, join(directory, 'manifest.json'))
      const stored: unknown = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
      const expected = { version: CACHE_VERSION, image: manifest.image, tileSize: TILE_SIZE, levels: manifest.levels }
      if (JSON.stringify(stored) !== JSON.stringify(expected)) return false
      await verifyContainedPath(root, join(directory, 'preview.webp'))
      for (const level of manifest.levels) {
        for (let x = 0; x < level.columns; x += 1) {
          for (let y = 0; y < level.rows; y += 1) await verifyContainedPath(root, join(directory, String(level.level), String(x), `${y}.webp`))
        }
      }
      return true
    } catch (error) {
      if (error instanceof MapperError && error.code === 'UNSAFE_PATH') throw error
      return false
    }
  }

  private async generate(
    source: string,
    directory: string,
    manifest: TileManifest,
    report: (phase: TileProgress['phase'], completed: number) => void,
    validateSource: () => Promise<void>
  ): Promise<void> {
    await validateSource()
    const root = await this.root()
    const prefix = `${basename(directory)}.tmp-`
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.name.startsWith(prefix) && /^[a-f0-9-]{36}$/.test(entry.name.slice(prefix.length))) {
        const abandoned = join(root, entry.name)
        await verifyContainedPath(root, abandoned, 'directory')
        await rm(abandoned, { recursive: true, force: true })
      }
    }
    const staging = `${directory}.tmp-${randomUUID()}`
    const nativeBase = join(staging, 'pyramid')
    const nativeFiles = `${nativeBase}_files`
    await mkdir(staging)
    try {
      report('preview', 0)
      const options = { sequentialRead: true, limitInputPixels: 16_384 ** 2, failOn: 'warning' as const }
      await sharp(source, options).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toFile(join(staging, 'preview.webp'))
      report('tiles', 1)
      let polling = false
      let progressActive = true
      const timer = setInterval(() => {
        if (polling) return
        polling = true
        void this.countNativeTiles(nativeFiles).then((count) => {
          if (progressActive) report('tiles', Math.min(this.total(manifest) - 1, 1 + count))
        }).catch(() => {}).finally(() => { polling = false })
      }, 250)
      try {
        await sharp(source, options).webp({ quality: 90 }).tile({ size: TILE_SIZE, overlap: 0, depth: 'onetile', layout: 'dz' }).toFile(nativeBase)
      } finally {
        progressActive = false
        clearInterval(timer)
      }
      await validateSource()
      const nativeLevels = (await readdir(nativeFiles)).filter((name) => /^\d+$/.test(name)).map(Number).sort((a, b) => a - b)
      if (nativeLevels.length !== manifest.levels.length) throw new MapperError('TILE_FAILED', '切片金字塔层级不完整。')
      for (const level of manifest.levels) {
        for (let x = 0; x < level.columns; x += 1) {
          await mkdir(join(staging, String(level.level), String(x)), { recursive: true })
          for (let y = 0; y < level.rows; y += 1) {
            await rename(join(nativeFiles, String(nativeLevels[level.level]), `${x}_${y}.webp`), join(staging, String(level.level), String(x), `${y}.webp`))
          }
        }
      }
      await rm(nativeFiles, { recursive: true, force: true })
      await rm(`${nativeBase}.dzi`, { force: true })
      const stored = { version: CACHE_VERSION, image: manifest.image, tileSize: TILE_SIZE, levels: manifest.levels }
      await writeFile(join(staging, 'manifest.json.tmp'), JSON.stringify(stored), { flag: 'wx' })
      await rename(join(staging, 'manifest.json.tmp'), join(staging, 'manifest.json'))
      try {
        await verifyContainedPath(root, directory, 'directory')
        await rm(directory, { recursive: true, force: true })
      } catch (error) {
        if (!isMissing(error)) throw error
      }
      await rename(staging, directory)
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }

  private async countNativeTiles(directory: string): Promise<number> {
    let count = 0
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && /^\d+$/.test(entry.name)) {
        count += (await readdir(join(directory, entry.name))).filter((name) => /^\d+_\d+\.webp$/.test(name)).length
      }
    }
    return count
  }
}
