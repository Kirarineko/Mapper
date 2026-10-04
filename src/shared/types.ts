export const FORMAT_VERSION = 1 as const

export interface Point {
  x: number
  y: number
}

// Handles use absolute original-image pixel coordinates.
export interface PathNode {
  point: Point
  handleIn?: Point
  handleOut?: Point
}

export interface LineGeometry {
  kind: 'straight' | 'polyline' | 'freehand' | 'bezier'
  nodes: PathNode[]
}

export interface AreaRegion {
  outer: Point[]
  holes: Point[][]
}

export interface AreaGeometry {
  regions: AreaRegion[]
}

export interface MeasurementBase {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface LineMeasurement extends MeasurementBase {
  geometry: LineGeometry
}

export interface AreaMeasurement extends MeasurementBase {
  geometry: AreaGeometry
}

export interface ImageIdentity {
  sha256: string
  width: number
  height: number
}

export interface DocumentBase {
  version: typeof FORMAT_VERSION
  image: ImageIdentity
}

export interface ConfigDocument extends DocumentBase {
  metersPerPixel: number | null
  settings: {
    showSegmentLengths: boolean
    brushDiameter: number
  }
}

export interface LineDocument extends DocumentBase {
  measurements: LineMeasurement[]
}

export interface AreaDocument extends DocumentBase {
  measurements: AreaMeasurement[]
}

export interface FeatureDocuments {
  config: ConfigDocument
  lines: LineDocument
  areas: AreaDocument
}

export type FeatureKind = keyof FeatureDocuments
export type FeatureDocument = FeatureDocuments[FeatureKind]

export type ErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NO_WORLD'
  | 'MAP_NOT_FOUND'
  | 'UNSAFE_PATH'
  | 'UNSUPPORTED_IMAGE'
  | 'IMAGE_CHANGED'
  | 'CORRUPT_DATA'
  | 'CONFLICT'
  | 'IO_ERROR'
  | 'TILE_FAILED'
  | 'FORBIDDEN'
  | 'NOT_READY'

export interface BackendError {
  code: ErrorCode
  message: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: BackendError }

export interface MapDescriptor {
  id: string
  name: string
  relativePath: string
}

export interface WorldSummary {
  id: string
  name: string
  maps: MapDescriptor[]
}

export interface FeatureRead<T extends FeatureDocument = FeatureDocument> {
  status: 'missing' | 'ok' | 'corrupt'
  document: T | null
  revision: string | null
  backupAvailable: boolean
  imageChanged: boolean
}

export type MapFeatures = { [K in FeatureKind]: FeatureRead<FeatureDocuments[K]> }

export interface MapLoadResult {
  map: MapDescriptor
  image: ImageIdentity
  features: MapFeatures
  warnings: BackendError[]
}

export type SaveRequest = {
  [K in FeatureKind]: {
    mapId: string
    feature: K
    document: FeatureDocuments[K]
    expectedRevision: string | null
    acceptImageChange?: boolean
  }
}[FeatureKind]

export interface SaveResponse {
  revision: string
}

export interface FeatureRequest {
  mapId: string
  feature: FeatureKind
}

export interface TileLevel {
  level: number
  width: number
  height: number
  columns: number
  rows: number
  scale: number
}

export interface TileManifest {
  version: 1
  mapId: string
  image: ImageIdentity
  tileSize: 512
  levels: TileLevel[]
  previewUrl: string
  tileUrlTemplate: string
}

export interface TileProgress {
  mapId: string
  phase: 'preview' | 'tiles' | 'ready' | 'failed'
  completed: number
  total: number
}

export interface MapperApi {
  chooseWorld(): Promise<Result<WorldSummary | null>>
  listMaps(): Promise<Result<MapDescriptor[]>>
  loadMap(mapId: string): Promise<Result<MapLoadResult>>
  prepareTiles(mapId: string): Promise<Result<TileManifest>>
  readFeature(request: FeatureRequest): Promise<Result<FeatureRead>>
  saveFeature(request: SaveRequest): Promise<Result<SaveResponse>>
  recoverFeature(request: FeatureRequest): Promise<Result<FeatureRead>>
  flushSaves(): Promise<Result<void>>
  finishClose(): Promise<Result<void>>
  onTileProgress(listener: (progress: TileProgress) => void): () => void
  onCloseRequested(listener: () => void): () => void
}
