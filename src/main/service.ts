import type { FeatureRead, MapLoadResult, SaveResponse, TileManifest, WorldSummary } from '../shared/types'
import { validateFeatureRequest, validateMapId, validateSaveRequest } from '../shared/validation'
import { MapCatalog } from './catalog'
import { FeatureStore } from './storage'
import { TileCache } from './tiles'
import { MapperError } from './errors'

export class MapperService {
  private mutationQueue: Promise<void> = Promise.resolve()
  private closing = false

  constructor(
    readonly catalog: MapCatalog,
    readonly storage: FeatureStore,
    readonly tiles: TileCache,
    private readonly selectDirectory: () => Promise<string | null>
  ) {}

  chooseWorld(): Promise<WorldSummary | null> {
    return this.mutate(async () => {
      await this.storage.flush()
      const directory = await this.selectDirectory()
      return directory === null ? null : this.catalog.selectWorld(directory)
    })
  }

  async listMaps() {
    return this.catalog.refresh()
  }

  async loadMap(value: unknown): Promise<MapLoadResult> {
    const mapId = validateMapId(value)
    // Read again after a failed save so the frontend can resolve a conflict or image change.
    await this.mutationQueue
    const { map, path, image } = await this.catalog.inspect(mapId)
    const [config, lines, areas] = await Promise.all([
      this.storage.read(path, image, 'config'),
      this.storage.read(path, image, 'lines'),
      this.storage.read(path, image, 'areas'),
    ])
    await this.catalog.assertImageCurrent(mapId, image)
    const features = { config, lines, areas }
    const warnings: MapLoadResult['warnings'] = []
    if (Object.values(features).some((feature) => feature.status === 'corrupt')) {
      warnings.push({ code: 'CORRUPT_DATA', message: '部分测量文件损坏；原文件已保留，请检查备份并显式恢复。' })
    }
    if (Object.values(features).some((feature) => feature.imageChanged)) {
      warnings.push({ code: 'IMAGE_CHANGED', message: '地图内容或尺寸已变化，请检查旧测量并确认后保存。' })
    }
    return { map, image, features, warnings }
  }

  async prepareTiles(value: unknown): Promise<TileManifest> {
    return this.tiles.prepare(validateMapId(value))
  }

  async readFeature(value: unknown): Promise<FeatureRead> {
    const request = validateFeatureRequest(value)
    const { path, image } = await this.catalog.inspect(request.mapId)
    const read = await this.storage.read(path, image, request.feature)
    await this.catalog.assertImageCurrent(request.mapId, image)
    return read
  }

  saveFeature(value: unknown): Promise<SaveResponse> {
    return this.mutate(async () => {
      const request = validateSaveRequest(value)
      const { path, image } = await this.catalog.inspect(request.mapId)
      return this.storage.save(path, image, request)
    })
  }

  recoverFeature(value: unknown): Promise<FeatureRead> {
    return this.mutate(async () => {
      const request = validateFeatureRequest(value)
      const { path, image } = await this.catalog.inspect(request.mapId)
      return this.storage.recover(path, image, request.feature)
    })
  }

  flushSaves(): Promise<void> {
    return this.mutate(() => this.storage.flush())
  }

  async prepareClose(): Promise<void> {
    if (this.closing) throw new MapperError('NOT_READY', '正在关闭应用。')
    this.closing = true
    try {
      await this.mutationQueue
      await this.storage.flush()
    } catch (error) {
      this.closing = false
      throw error
    }
  }

  private mutate<T>(action: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new MapperError('NOT_READY', '正在关闭应用，暂时无法修改数据。'))
    const operation = this.mutationQueue.then(action)
    this.mutationQueue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
