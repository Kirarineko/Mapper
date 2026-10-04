import type { Point } from '../types'

export const GEOMETRY_LIMITS = {
  coordinateMagnitude: 10_000_000,
  pathNodes: 10_000,
  areaPoints: 20_000,
  areaRegions: 2_000,
  brushPoints: 2_000
} as const

export function assertFinite(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`)
  }
}

export function assertPositive(value: number, name: string): void {
  assertFinite(value, name)
  if (value <= 0) throw new RangeError(`${name} must be positive`)
}

export function assertNonNegative(value: number, name: string): void {
  assertFinite(value, name)
  if (value < 0) throw new RangeError(`${name} must be non-negative`)
}

export function assertPoint(point: Point): void {
  if (!point || typeof point !== 'object') throw new TypeError('Invalid point')
  assertFinite(point.x, 'Point x')
  assertFinite(point.y, 'Point y')
  if (
    Math.abs(point.x) > GEOMETRY_LIMITS.coordinateMagnitude ||
    Math.abs(point.y) > GEOMETRY_LIMITS.coordinateMagnitude
  ) {
    throw new RangeError('Point exceeds the coordinate limit')
  }
}

export function assertPoints(points: Point[], maximum: number): void {
  if (!Array.isArray(points)) throw new TypeError('Points must be an array')
  if (points.length > maximum) throw new RangeError('Too many geometry points')
  points.forEach(assertPoint)
}

export function assertScale(scale: number | null): void {
  if (scale !== null) assertPositive(scale, 'Meters per pixel')
}
