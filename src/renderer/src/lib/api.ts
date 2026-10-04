import type {
  BackendError,
  FeatureKind,
  FeatureRead,
  MapDescriptor,
  MapLoadResult,
  MapperApi,
  Result,
  SaveRequest,
  SaveResponse,
  TileManifest,
  TileProgress,
  WorldSummary,
} from '../../../shared/types'

/** 后端返回的业务错误，code 为稳定错误码。 */
export class ApiError extends Error {
  readonly code: BackendError['code']

  constructor(error: BackendError) {
    super(error.message)
    this.name = 'ApiError'
    this.code = error.code
  }
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new ApiError(result.error)
  return result.value
}

function backend(): MapperApi {
  if (!window.mapper) throw new Error('预加载接口不可用')
  return window.mapper
}

export const api = {
  chooseWorld: (): Promise<WorldSummary | null> => backend().chooseWorld().then(unwrap),
  listMaps: (): Promise<MapDescriptor[]> => backend().listMaps().then(unwrap),
  loadMap: (mapId: string): Promise<MapLoadResult> => backend().loadMap(mapId).then(unwrap),
  prepareTiles: (mapId: string): Promise<TileManifest> => backend().prepareTiles(mapId).then(unwrap),
  readFeature: (mapId: string, feature: FeatureKind): Promise<FeatureRead> =>
    backend().readFeature({ mapId, feature }).then(unwrap),
  saveFeature: (request: SaveRequest): Promise<SaveResponse> =>
    backend().saveFeature(request).then(unwrap),
  recoverFeature: (mapId: string, feature: FeatureKind): Promise<FeatureRead> =>
    backend().recoverFeature({ mapId, feature }).then(unwrap),
  flushSaves: (): Promise<void> => backend().flushSaves().then(unwrap),
  finishClose: (): Promise<void> => backend().finishClose().then(unwrap),
  onTileProgress: (listener: (progress: TileProgress) => void): (() => void) =>
    backend().onTileProgress(listener),
  onCloseRequested: (listener: () => void): (() => void) => backend().onCloseRequested(listener),
}
