import type { Point } from '../types'
import { assertFinite, assertNonNegative, assertPoint, assertPositive, assertScale } from './validation'

export type DistanceUnit = 'm' | 'km'
export interface MeasurementValue<Unit extends string> {
  value: number
  unit: Unit
}

export function calibrationPixels(start: Point, end: Point): number {
  assertPoint(start)
  assertPoint(end)
  return Math.round(Math.hypot(end.x - start.x, end.y - start.y))
}

export function calibrateScale(pixels: number, distance: number, unit: DistanceUnit): number {
  assertNonNegative(pixels, 'Calibration pixels')
  assertPositive(distance, 'Calibration distance')
  if (unit !== 'm' && unit !== 'km') throw new TypeError('Invalid distance unit')
  const roundedPixels = Math.round(pixels)
  assertPositive(roundedPixels, 'Rounded calibration pixels')
  const scale = (distance * (unit === 'km' ? 1_000 : 1)) / roundedPixels
  assertPositive(scale, 'Meters per pixel')
  return scale
}

export function calibrateFromPoints(
  start: Point,
  end: Point,
  distance: number,
  unit: DistanceUnit
): number {
  return calibrateScale(calibrationPixels(start, end), distance, unit)
}

export function lengthInMeters(pixelLength: number, metersPerPixel: number): number {
  assertNonNegative(pixelLength, 'Pixel length')
  assertPositive(metersPerPixel, 'Meters per pixel')
  const meters = pixelLength * metersPerPixel
  assertFinite(meters, 'Length in meters')
  return meters
}

export function areaInSquareMeters(pixelArea: number, metersPerPixel: number): number {
  assertNonNegative(pixelArea, 'Pixel area')
  assertPositive(metersPerPixel, 'Meters per pixel')
  const area = pixelArea * metersPerPixel * metersPerPixel
  assertFinite(area, 'Area in square meters')
  return area
}

export function measureLength(
  pixelLength: number,
  metersPerPixel: number | null
): MeasurementValue<'px' | DistanceUnit> {
  assertNonNegative(pixelLength, 'Pixel length')
  assertScale(metersPerPixel)
  if (metersPerPixel === null) return { value: pixelLength, unit: 'px' }
  const meters = lengthInMeters(pixelLength, metersPerPixel)
  return meters < 1_000 ? { value: meters, unit: 'm' } : { value: meters / 1_000, unit: 'km' }
}

export function measureArea(
  pixelArea: number,
  metersPerPixel: number | null
): MeasurementValue<'px\u00b2' | 'm\u00b2' | 'km\u00b2'> {
  assertNonNegative(pixelArea, 'Pixel area')
  assertScale(metersPerPixel)
  if (metersPerPixel === null) return { value: pixelArea, unit: 'px\u00b2' }
  const area = areaInSquareMeters(pixelArea, metersPerPixel)
  return area > 10_000_000 ? { value: area / 1_000_000, unit: 'km\u00b2' } : { value: area, unit: 'm\u00b2' }
}
