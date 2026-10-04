import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path'
import sharp from 'sharp'
import type { ImageIdentity, MapDescriptor, WorldSummary } from '../shared/types'
import { MapperError } from './errors'

export const MAX_IMAGE_DIMENSION = 16_384
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const MAP_FILENAME_PATTERN = /地图|map/i
const OMIT_DIRECTORIES = new Set(['cache', 'caches', 'node_modules', 'out', 'dist'])
const NOFOLLOW = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW

export interface ResolvedMap {
  map: MapDescriptor
  path: string
  root: string
}

export interface InspectedMap extends ResolvedMap {
  image: ImageIdentity
}

interface Inspection {
  fingerprint: string
  image: ImageIdentity
}

function opaqueId(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export async function verifyContainedPath(
  root: string,
  path: string,
  kind: 'file' | 'directory' = 'file'
): Promise<void> {
  const local = relative(root, path)
  if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) {
    throw new MapperError('UNSAFE_PATH', '资源路径不在所选目录中。')
  }
  const segments = local ? local.split(sep) : []
  let current = root
  for (let index = -1; index < segments.length; index += 1) {
    if (index >= 0) current = join(current, segments[index])
    const info = await lstat(current)
    const final = index === segments.length - 1
    if (info.isSymbolicLink() || (!final && !info.isDirectory())) {
      throw new MapperError('UNSAFE_PATH', '不允许通过符号链接访问地图或资源。')
    }
    if (final && !(kind === 'file' ? info.isFile() : info.isDirectory())) {
      throw new MapperError('UNSAFE_PATH', '资源类型与预期不符。')
    }
  }
  if ((await realpath(path)) !== path) {
    throw new MapperError('UNSAFE_PATH', '资源路径已被替换，请重新选择目录。')
  }
}

async function fingerprint(path: string): Promise<string> {
  const info = await stat(path, { bigint: true })
  return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':')
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

async function inspectFile(path: string): Promise<ImageIdentity> {
  const file = await open(path, constants.O_RDONLY | NOFOLLOW)
  try {
    const header = Buffer.alloc(32)
    const { bytesRead } = await file.read(header, 0, header.length, 0)
    let format: 'png' | 'jpeg' | 'webp'
    if (bytesRead >= 8 && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      format = 'png'
      const size = (await file.stat()).size
      let offset = 8
      // APNG's animation control chunk precedes the first image-data chunk.
      while (offset + 12 <= size) {
        const chunk = Buffer.alloc(8)
        const read = await file.read(chunk, 0, 8, offset)
        if (read.bytesRead !== 8) throw new MapperError('UNSUPPORTED_IMAGE', 'PNG 文件不完整。')
        const length = chunk.readUInt32BE(0)
        const type = chunk.toString('ascii', 4, 8)
        if (type === 'acTL') throw new MapperError('UNSUPPORTED_IMAGE', '暂不支持动画地图。')
        if (offset + length + 12 > size) throw new MapperError('UNSUPPORTED_IMAGE', 'PNG 文件不完整。')
        if (type === 'IDAT' || type === 'IEND') break
        offset += length + 12
      }
    } else if (bytesRead >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255) {
      format = 'jpeg'
    } else if (bytesRead >= 16 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') {
      format = 'webp'
      if (header.toString('ascii', 12, 16) === 'VP8X' && (header[20] & 2) !== 0) {
        throw new MapperError('UNSUPPORTED_IMAGE', '暂不支持动画地图。')
      }
    } else {
      throw new MapperError('UNSUPPORTED_IMAGE', '仅支持 PNG、JPEG 和 WebP 静态图片。')
    }
    const options = { limitInputPixels: MAX_IMAGE_DIMENSION ** 2, sequentialRead: true, failOn: 'warning' as const }
    const metadata = await sharp(path, options).metadata()
    const { width, height } = metadata
    if (metadata.format !== format || !width || !height || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      throw new MapperError('UNSUPPORTED_IMAGE', '地图尺寸必须在 1 到 16384 像素之间。')
    }
    if ((metadata.pages ?? 1) > 1) throw new MapperError('UNSUPPORTED_IMAGE', '暂不支持动画地图。')
    // Do not auto-orient: persisted geometry refers to the unrotated decoded image.
    await sharp(path, options).resize(1, 1, { fit: 'fill' }).raw().toBuffer()
    const hash = createHash('sha256')
    for await (const chunk of file.createReadStream({ start: 0, autoClose: false })) hash.update(chunk)
    return { sha256: hash.digest('hex'), width, height }
  } catch (error) {
    if (error instanceof MapperError) throw error
    throw new MapperError('UNSUPPORTED_IMAGE', '图片无法完整解码，或超出支持的尺寸。')
  } finally {
    await file.close()
  }
}

export class MapCatalog {
  private root: string | null = null
  private maps = new Map<string, MapDescriptor>()
  private inspections = new Map<string, Inspection>()
  private readonly inspectionJobs = new Map<string, Promise<ImageIdentity>>()

  async selectWorld(directory: string): Promise<WorldSummary> {
    if (typeof directory !== 'string' || !isAbsolute(directory)) {
      throw new MapperError('INVALID_ARGUMENT', '请选择有效的世界观目录。')
    }
    const root = await realpath(directory)
    await verifyContainedPath(root, root, 'directory')
    const maps = await this.enumerate(root)
    this.root = root
    this.maps = new Map(maps.map((map) => [map.id, { ...map }]))
    this.inspections.clear()
    return { id: opaqueId(root), name: basename(root), maps }
  }

  listMaps(): MapDescriptor[] {
    if (!this.root) throw new MapperError('NO_WORLD', '请先选择世界观目录。')
    return [...this.maps.values()].map((map) => ({ ...map }))
  }

  async refresh(): Promise<MapDescriptor[]> {
    const root = this.requireRoot()
    const maps = await this.enumerate(root)
    if (this.root !== root) throw new MapperError('CONFLICT', '世界观目录已切换，请重试。')
    this.maps = new Map(maps.map((map) => [map.id, map]))
    for (const id of this.inspections.keys()) if (!this.maps.has(id)) this.inspections.delete(id)
    return this.listMaps()
  }

  async resolveMap(mapId: string): Promise<ResolvedMap> {
    const root = this.requireRoot()
    const map = this.maps.get(mapId)
    if (!map) throw new MapperError('MAP_NOT_FOUND', '地图不存在，请刷新地图列表。')
    const path = join(root, ...map.relativePath.split('/'))
    try {
      await verifyContainedPath(root, path)
    } catch (error) {
      if (isMissing(error)) throw new MapperError('MAP_NOT_FOUND', '地图已被移动或删除。')
      throw error
    }
    if (this.root !== root) throw new MapperError('CONFLICT', '世界观目录已切换，请重试。')
    return { root, path, map: { ...map } }
  }

  async inspect(mapId: string): Promise<InspectedMap> {
    const resolved = await this.resolveMap(mapId)
    const before = await fingerprint(resolved.path)
    const cached = this.inspections.get(mapId)
    if (cached?.fingerprint === before) return { ...resolved, image: { ...cached.image } }
    const key = `${mapId}:${before}`
    let job = this.inspectionJobs.get(key)
    if (!job) {
      job = inspectFile(resolved.path)
      this.inspectionJobs.set(key, job)
      void job.finally(() => this.inspectionJobs.delete(key)).catch(() => {})
    }
    const image = await job
    await this.resolveMap(mapId)
    if (before !== await fingerprint(resolved.path)) {
      throw new MapperError('IMAGE_CHANGED', '地图在读取期间发生变化，请重试。')
    }
    this.inspections.set(mapId, { fingerprint: before, image })
    return { ...resolved, image: { ...image } }
  }

  async assertImageCurrent(mapId: string, image: ImageIdentity): Promise<InspectedMap> {
    const resolved = await this.resolveMap(mapId)
    const cached = this.inspections.get(mapId)
    if (!cached) {
      const inspected = await this.inspect(mapId)
      if (inspected.image.sha256 === image.sha256 && inspected.image.width === image.width && inspected.image.height === image.height) return inspected
    } else if (cached.image.sha256 === image.sha256 && cached.image.width === image.width && cached.image.height === image.height && cached.fingerprint === await fingerprint(resolved.path)) {
      return { ...resolved, image: { ...cached.image } }
    }
    throw new MapperError('IMAGE_CHANGED', '地图内容已变化，请重新加载并检查旧测量。')
  }

  private requireRoot(): string {
    if (!this.root) throw new MapperError('NO_WORLD', '请先选择世界观目录。')
    return this.root
  }

  private async enumerate(root: string): Promise<MapDescriptor[]> {
    const maps: MapDescriptor[] = []
    const visit = async (directory: string): Promise<void> => {
      await verifyContainedPath(root, directory, 'directory')
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue
        const path = join(directory, entry.name)
        if (entry.isDirectory()) {
          const name = entry.name.toLowerCase()
          if (!name.endsWith('_data') && !OMIT_DIRECTORIES.has(name)) await visit(path)
        } else if (
          entry.isFile() &&
          IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()) &&
          MAP_FILENAME_PATTERN.test(entry.name)
        ) {
          await verifyContainedPath(root, path)
          const relativePath = relative(root, path).split(sep).join('/')
          maps.push({ id: opaqueId(`${root}\0${relativePath}`), name: entry.name, relativePath })
        }
      }
    }
    await visit(root)
    return maps.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0)
  }
}
