import { constants, type Stats } from 'node:fs'
import { access, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type {
  FeatureDocuments,
  FeatureKind,
  FeatureRead,
  ImageIdentity,
  SaveRequest,
  SaveResponse
} from '../shared/types'
import { defaultDocument, sameImage, validateDocument } from '../shared/validation'
import { MapperError } from './errors'

export const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024
const NOFOLLOW = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW

const filenames: Record<FeatureKind, string> = {
  config: 'Config.json',
  lines: 'LineMeasurements.json',
  areas: 'AreaMeasurements.json'
}

interface StoragePaths {
  directory: string
  file: string
  backup: string
}

interface StoredDocument<K extends FeatureKind = FeatureKind> {
  status: 'missing' | 'ok' | 'corrupt'
  raw: Buffer | null
  document: FeatureDocuments[K] | null
  revision: string | null
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function ioError(error: unknown): MapperError {
  if (error instanceof MapperError) return error
  if (error instanceof Error && 'code' in error && error.code === 'ELOOP') {
    return new MapperError('UNSAFE_PATH', '数据路径不能使用符号链接。')
  }
  return new MapperError('IO_ERROR', '数据读写失败，请检查文件权限、磁盘空间并重试。')
}

function revision(raw: Buffer): string {
  return createHash('sha256').update(raw).digest('hex')
}

async function fileInfo(path: string): Promise<Stats | null> {
  let info: Stats
  try {
    info = await lstat(path)
  } catch (error) {
    if (isMissing(error)) return null
    throw ioError(error)
  }
  if (info.isSymbolicLink() || !info.isFile() || info.nlink > 1) {
    throw new MapperError('UNSAFE_PATH', '数据文件和备份必须是独立的普通文件。')
  }
  return info
}

async function writable(path: string, mode: number): Promise<void> {
  if ((mode & 0o222) === 0) throw new MapperError('IO_ERROR', '数据路径为只读，无法保存。')
  try {
    await access(path, constants.W_OK)
  } catch (error) {
    throw ioError(error)
  }
}

async function safeAncestors(directory: string): Promise<void> {
  const ancestors: string[] = []
  let current = directory
  while (true) {
    ancestors.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  for (const path of ancestors.reverse()) {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new MapperError('UNSAFE_PATH', '地图数据路径的父目录不能使用符号链接。')
    }
  }
  if (await realpath(directory) !== directory) {
    throw new MapperError('UNSAFE_PATH', '地图数据目录的真实路径发生变化，请重新选择目录。')
  }
}

async function safeDirectory(paths: StoragePaths, create = false): Promise<boolean> {
  try {
    await safeAncestors(dirname(paths.directory))
    let info
    try {
      info = await lstat(paths.directory)
    } catch (error) {
      if (!isMissing(error)) throw error
      if (!create) return false
      const parent = dirname(paths.directory)
      const parentInfo = await lstat(parent)
      await writable(parent, parentInfo.mode)
      try {
        await mkdir(paths.directory, { mode: 0o700 })
      } catch (mkdirError) {
        if (!(mkdirError instanceof Error && 'code' in mkdirError && mkdirError.code === 'EEXIST')) {
          throw mkdirError
        }
      }
      info = await lstat(paths.directory)
    }
    if (info.isSymbolicLink() || !info.isDirectory() || (await realpath(paths.directory)) !== paths.directory) {
      throw new MapperError('UNSAFE_PATH', '地图数据目录不能使用符号链接。')
    }
    if (create) await writable(paths.directory, info.mode)
    return true
  } catch (error) {
    throw ioError(error)
  }
}

async function readStored<K extends FeatureKind>(path: string, feature: K): Promise<StoredDocument<K>> {
  await safeAncestors(dirname(path))
  const info = await fileInfo(path)
  if (!info) return { status: 'missing', raw: null, document: null, revision: null }
  if (info.size > MAX_DOCUMENT_BYTES) {
    return { status: 'corrupt', raw: null, document: null, revision: null }
  }
  let handle: FileHandle | undefined
  let raw: Buffer
  try {
    handle = await open(path, constants.O_RDONLY | NOFOLLOW)
    const openedInfo = await handle.stat()
    if (!openedInfo.isFile() || openedInfo.nlink > 1 || openedInfo.dev !== info.dev || openedInfo.ino !== info.ino) {
      throw new MapperError('UNSAFE_PATH', '读取期间数据文件发生变化，请重试。')
    }
    const chunks: Buffer[] = []
    let bytes = 0
    while (bytes <= MAX_DOCUMENT_BYTES) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_DOCUMENT_BYTES + 1 - bytes))
      const result = await handle.read(chunk, 0, chunk.length, null)
      if (result.bytesRead === 0) break
      chunks.push(chunk.subarray(0, result.bytesRead))
      bytes += result.bytesRead
    }
    if (bytes > MAX_DOCUMENT_BYTES) {
      return { status: 'corrupt', raw: null, document: null, revision: null }
    }
    raw = Buffer.concat(chunks, bytes)
  } catch (error) {
    throw ioError(error)
  } finally {
    await handle?.close()
  }
  try {
    const document = validateDocument(feature, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as unknown)
    return { status: 'ok', raw, document, revision: revision(raw) }
  } catch {
    return { status: 'corrupt', raw, document: null, revision: revision(raw) }
  }
}

async function syncDirectory(directory: string): Promise<void> {
  // Windows does not support opening directories for fsync through Node.
  if (process.platform === 'win32') return
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | NOFOLLOW)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function temporaryFile(paths: StoragePaths, raw: Buffer): Promise<string> {
  await safeDirectory(paths, true)
  const temp = join(paths.directory, `${basename(paths.file)}.${randomUUID()}.tmp`)
  let handle: FileHandle | undefined
  try {
    handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600)
    await handle.writeFile(raw)
    await handle.sync()
    await handle.close()
    handle = undefined
    return temp
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await unlink(temp).catch(() => undefined)
    throw ioError(error)
  }
}

async function replaceFile(
  paths: StoragePaths,
  target: string,
  raw: Buffer,
  beforeReplace?: () => Promise<void>
): Promise<void> {
  const temp = await temporaryFile(paths, raw)
  try {
    await safeDirectory(paths, true)
    const targetInfo = await fileInfo(target)
    if (targetInfo) await writable(target, targetInfo.mode)
    await beforeReplace?.()
    await rename(temp, target)
    await syncDirectory(paths.directory)
  } catch (error) {
    throw ioError(error)
  } finally {
    await unlink(temp).catch(() => undefined)
  }
}

export class FeatureStore {
  private readonly pending = new Map<string, Promise<void>>()
  private readonly failures = new Map<string, MapperError>()
  private readonly operations = new Set<Promise<void>>()

  private track<T>(operation: Promise<T>): Promise<T> {
    const settled = operation.then(() => undefined, () => undefined)
    this.operations.add(settled)
    void settled.then(() => this.operations.delete(settled))
    return operation
  }

  private async paths(mapPath: string, feature: FeatureKind): Promise<StoragePaths> {
    if (!isAbsolute(mapPath) || !Object.hasOwn(filenames, feature)) {
      throw new MapperError('INVALID_ARGUMENT', '地图路径或功能类型无效。')
    }
    try {
      const parent = dirname(mapPath)
      await safeAncestors(parent)
      const directory = join(parent, `${basename(mapPath)}_data`)
      const file = join(directory, filenames[feature])
      return { directory, file, backup: `${file}.bak` }
    } catch (error) {
      throw ioError(error)
    }
  }

  private async mutationPaths(mapPath: string, feature: FeatureKind): Promise<StoragePaths> {
    const requestKey = `${mapPath}\0${feature}`
    try {
      const paths = await this.paths(mapPath, feature)
      this.failures.delete(requestKey)
      return paths
    } catch (error) {
      const mapped = ioError(error)
      this.failures.set(requestKey, mapped)
      throw mapped
    }
  }

  private enqueue<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key) ?? Promise.resolve()
    const result = previous.then(action).then(
      (value) => {
        this.failures.delete(key)
        return value
      },
      (error: unknown) => {
        const mapped = ioError(error)
        this.failures.set(key, mapped)
        throw mapped
      }
    )
    const settled = result.then(() => undefined, () => undefined)
    this.pending.set(key, settled)
    void settled.then(() => {
      if (this.pending.get(key) === settled) this.pending.delete(key)
    })
    return result
  }

  private async readPaths<K extends FeatureKind>(paths: StoragePaths, image: ImageIdentity, feature: K): Promise<FeatureRead<FeatureDocuments[K]>> {
    if (!(await safeDirectory(paths))) {
      return {
        status: 'missing', document: defaultDocument(feature, image), revision: null,
        backupAvailable: false, imageChanged: false
      }
    }
    const stored = await readStored(paths.file, feature)
    const backup = await readStored(paths.backup, feature)
    return {
      status: stored.status,
      document: stored.status === 'missing' ? defaultDocument(feature, image) : stored.document,
      revision: stored.revision,
      backupAvailable: backup.status === 'ok',
      imageChanged: stored.document !== null && !sameImage(stored.document.image, image)
    }
  }

  async read<K extends FeatureKind>(mapPath: string, image: ImageIdentity, feature: K): Promise<FeatureRead<FeatureDocuments[K]>> {
    const paths = await this.paths(mapPath, feature)
    await this.pending.get(paths.file)
    return this.readPaths(paths, image, feature)
  }

  save(mapPath: string, image: ImageIdentity, request: SaveRequest): Promise<SaveResponse> {
    return this.track(this.saveQueued(mapPath, { ...image }, request))
  }

  private async saveQueued(mapPath: string, image: ImageIdentity, request: SaveRequest): Promise<SaveResponse> {
    // Capture the request before it joins a queue so later caller mutations cannot change a save.
    const expectedRevision = request.expectedRevision
    const acceptImageChange = request.acceptImageChange === true
    const feature = request.feature
    let raw: Buffer
    let validationError: unknown
    try {
      const document = validateDocument(feature, request.document)
      raw = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
    } catch (error) {
      validationError = error
      raw = Buffer.alloc(0)
    }
    const paths = await this.mutationPaths(mapPath, feature)
    return this.enqueue(paths.file, async () => {
      if (validationError) throw ioError(validationError)
      if (raw.length > MAX_DOCUMENT_BYTES) {
        throw new MapperError('INVALID_ARGUMENT', '数据文件超过允许的大小。')
      }
      if (expectedRevision !== null && !/^[a-f0-9]{64}$/.test(expectedRevision)) {
        throw new MapperError('INVALID_ARGUMENT', '文件版本标识无效。')
      }
      const document = validateDocument(feature, JSON.parse(raw.toString('utf8')) as unknown)
      if (!sameImage(document.image, image)) {
        throw new MapperError('IMAGE_CHANGED', '保存内容必须明确使用当前地图图像标识。')
      }
      const directoryExists = await safeDirectory(paths)
      const current = directoryExists
        ? await readStored(paths.file, feature)
        : { status: 'missing' as const, raw: null, document: null, revision: null }
      if (current.status === 'corrupt') {
        throw new MapperError('CORRUPT_DATA', '原数据已损坏，请先恢复备份或保留原文件后处理。')
      }
      if (current.revision !== expectedRevision) {
        throw new MapperError('CONFLICT', '数据已被其他操作修改，请重新读取后保存。')
      }
      if (current.document && !sameImage(current.document.image, image) && !acceptImageChange) {
        throw new MapperError('IMAGE_CHANGED', '地图图像已变化，请确认旧测量后再保存。')
      }
      await safeDirectory(paths, true)
      const originalInfo = await fileInfo(paths.file)
      if (originalInfo) await writable(paths.file, originalInfo.mode)
      const backup = await readStored(paths.backup, feature)
      if (backup.status === 'corrupt') {
        throw new MapperError('CORRUPT_DATA', '备份数据已损坏，请保留并处理该备份后重试。')
      }
      if (current.raw) await replaceFile(paths, paths.backup, current.raw)
      await replaceFile(paths, paths.file, raw, async () => {
        const latest = await readStored(paths.file, feature)
        if (latest.status === 'corrupt') throw new MapperError('CORRUPT_DATA', '保存期间原数据发生损坏。')
        if (latest.revision !== expectedRevision) {
          throw new MapperError('CONFLICT', '保存期间数据被外部修改，请重新读取。')
        }
      })
      return { revision: revision(raw) }
    })
  }

  recover<K extends FeatureKind>(mapPath: string, image: ImageIdentity, feature: K): Promise<FeatureRead<FeatureDocuments[K]>> {
    return this.track(this.recoverQueued(mapPath, { ...image }, feature))
  }

  private async recoverQueued<K extends FeatureKind>(mapPath: string, image: ImageIdentity, feature: K): Promise<FeatureRead<FeatureDocuments[K]>> {
    const paths = await this.mutationPaths(mapPath, feature)
    return this.enqueue(paths.file, async () => {
      if (!(await safeDirectory(paths))) throw new MapperError('CORRUPT_DATA', '没有可恢复的备份。')
      const backup = await readStored(paths.backup, feature)
      if (backup.status !== 'ok' || !backup.raw) {
        throw new MapperError('CORRUPT_DATA', '没有合法备份可供恢复。')
      }
      const originalInfo = await fileInfo(paths.file)
      if (originalInfo) await writable(paths.file, originalInfo.mode)
      const temp = await temporaryFile(paths, backup.raw)
      const preserved = `${paths.file}.corrupt-${Date.now()}-${randomUUID()}`
      let movedOriginal = false
      try {
        await safeDirectory(paths, true)
        const latestInfo = await fileInfo(paths.file)
        if (latestInfo) {
          await writable(paths.file, latestInfo.mode)
          await rename(paths.file, preserved)
          movedOriginal = true
        }
        try {
          await rename(temp, paths.file)
        } catch (error) {
          if (movedOriginal) await rename(preserved, paths.file)
          throw error
        }
        await syncDirectory(paths.directory)
      } catch (error) {
        throw ioError(error)
      } finally {
        await unlink(temp).catch(() => undefined)
      }
      return this.readPaths(paths, image, feature)
    })
  }

  async flush(): Promise<void> {
    while (this.operations.size > 0 || this.pending.size > 0) {
      await Promise.all([...this.operations, ...this.pending.values()])
    }
    const firstFailure = this.failures.values().next().value as MapperError | undefined
    if (firstFailure) throw firstFailure
  }
}
