import { MapperError } from './errors'
import { validateAreaGeometry, validateLineGeometry } from './geometry'
import type { FeatureDocument, FeatureDocuments, FeatureKind, ImageIdentity, SaveRequest } from './types'

export const DOCUMENT_LIMITS = { measurements: 10_000, nameLength: 256, brushDiameter: 32_768 } as const

function invalid(): never {
  throw new MapperError('INVALID_ARGUMENT', '参数或数据格式无效。')
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) invalid()
}

export function validateMapId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return invalid()
  return value
}

export function validateFeature(value: unknown): FeatureKind {
  if (value !== 'config' && value !== 'lines' && value !== 'areas') return invalid()
  return value
}

export function validateFeatureRequest(value: unknown): { mapId: string; feature: FeatureKind } {
  const object = record(value)
  keys(object, ['mapId', 'feature'])
  return { mapId: validateMapId(object.mapId), feature: validateFeature(object.feature) }
}

export function validateImage(value: unknown): ImageIdentity {
  const object = record(value)
  keys(object, ['sha256', 'width', 'height'])
  if (typeof object.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(object.sha256)) invalid()
  for (const dimension of [object.width, object.height]) {
    if (typeof dimension !== 'number' || !Number.isInteger(dimension) || dimension < 1 || dimension > 16_384) invalid()
  }
  return value as ImageIdentity
}

export function sameImage(a: ImageIdentity, b: ImageIdentity): boolean {
  return a.sha256 === b.sha256 && a.width === b.width && a.height === b.height
}

function timestamp(value: unknown): void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid()
}

function point(value: unknown): void {
  const object = record(value)
  keys(object, ['x', 'y'])
  for (const coordinate of [object.x, object.y]) {
    if (typeof coordinate !== 'number' || !Number.isFinite(coordinate)) invalid()
  }
}

export function validateDocument<K extends FeatureKind>(feature: K, value: unknown): FeatureDocuments[K] {
  const object = record(value)
  keys(object, feature === 'config' ? ['version', 'image', 'metersPerPixel', 'settings'] : ['version', 'image', 'measurements'])
  if (object.version !== 1) invalid()
  const image = validateImage(object.image)
  if (feature === 'config') {
    if (object.metersPerPixel !== null && (typeof object.metersPerPixel !== 'number' || !Number.isFinite(object.metersPerPixel) || object.metersPerPixel <= 0)) invalid()
    const settings = record(object.settings)
    keys(settings, ['showSegmentLengths', 'brushDiameter'])
    if (typeof settings.showSegmentLengths !== 'boolean' || typeof settings.brushDiameter !== 'number' || !Number.isFinite(settings.brushDiameter) || settings.brushDiameter <= 0 || settings.brushDiameter > DOCUMENT_LIMITS.brushDiameter) invalid()
  } else {
    if (!Array.isArray(object.measurements) || object.measurements.length > DOCUMENT_LIMITS.measurements) invalid()
    const ids = new Set<string>()
    for (const item of object.measurements) {
      const measurement = record(item)
      keys(measurement, ['id', 'name', 'createdAt', 'updatedAt', 'geometry'])
      if (typeof measurement.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(measurement.id) || ids.has(measurement.id)) invalid()
      ids.add(measurement.id)
      if (typeof measurement.name !== 'string' || measurement.name.length > DOCUMENT_LIMITS.nameLength) invalid()
      timestamp(measurement.createdAt)
      timestamp(measurement.updatedAt)
      if (String(measurement.updatedAt) < String(measurement.createdAt)) invalid()
      const geometry = record(measurement.geometry)
      try {
        if (feature === 'lines') {
          keys(geometry, ['kind', 'nodes'])
          if (!Array.isArray(geometry.nodes)) invalid()
          for (const node of geometry.nodes) {
            const objectNode = record(node)
            keys(objectNode, ['point'], ['handleIn', 'handleOut'])
            point(objectNode.point)
            if (objectNode.handleIn !== undefined) point(objectNode.handleIn)
            if (objectNode.handleOut !== undefined) point(objectNode.handleOut)
          }
          validateLineGeometry(geometry as unknown as FeatureDocuments['lines']['measurements'][number]['geometry'], image)
        } else {
          keys(geometry, ['regions'])
          if (!Array.isArray(geometry.regions)) invalid()
          for (const region of geometry.regions) {
            const objectRegion = record(region)
            keys(objectRegion, ['outer', 'holes'])
            if (!Array.isArray(objectRegion.outer) || !Array.isArray(objectRegion.holes)) invalid()
            objectRegion.outer.forEach(point)
            for (const hole of objectRegion.holes) {
              if (!Array.isArray(hole)) invalid()
              hole.forEach(point)
            }
          }
          validateAreaGeometry(geometry as unknown as FeatureDocuments['areas']['measurements'][number]['geometry'], image)
        }
      } catch {
        invalid()
      }
    }
  }
  return value as FeatureDocuments[K]
}

export function validateSaveRequest(value: unknown): SaveRequest {
  const object = record(value)
  keys(object, ['mapId', 'feature', 'document', 'expectedRevision'], ['acceptImageChange'])
  validateMapId(object.mapId)
  const feature = validateFeature(object.feature)
  validateDocument(feature, object.document)
  if (object.expectedRevision !== null && (typeof object.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(object.expectedRevision))) invalid()
  if (object.acceptImageChange !== undefined && typeof object.acceptImageChange !== 'boolean') invalid()
  return value as SaveRequest
}

export function defaultDocument<K extends FeatureKind>(feature: K, image: ImageIdentity): FeatureDocuments[K] {
  const base = { version: 1 as const, image: { ...image } }
  const document: FeatureDocument = feature === 'config'
    ? { ...base, metersPerPixel: null, settings: { showSegmentLengths: true, brushDiameter: 24 } }
    : { ...base, measurements: [] }
  return document as FeatureDocuments[K]
}
