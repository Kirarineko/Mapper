import { describe, expect, it } from 'vitest'
import type { AreaGeometry, LineGeometry, Point } from '../src/shared/types'
import {
  applyBrushStroke,
  areaInSquareMeters,
  brushStrokeSelection,
  calibrateFromPoints,
  calibrateScale,
  calibrationPixels,
  GEOMETRY_LIMITS,
  lassoSelection,
  lengthInMeters,
  lineLabelPlacement,
  measureArea,
  measureLength,
  measurePath,
  measurePathSegments,
  measureSelection,
  normalizeArea,
  pointAtPathDistance,
  readableAngle,
  subtractAreas,
  unionAreas,
  validateAreaGeometry,
  validateLineGeometry
} from '../src/shared/geometry'

const bounds = { width: 500, height: 500 }
const empty: AreaGeometry = { regions: [] }

function square(x: number, y: number, size: number): Point[] {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size }
  ]
}

function area(points: Point[]): AreaGeometry {
  return { regions: [{ outer: points, holes: [] }] }
}

function path(kind: LineGeometry['kind'], points: Point[]): LineGeometry {
  return { kind, nodes: points.map((point) => ({ point })) }
}

describe('calibration and measurement units', () => {
  it('implements both planned calibration examples', () => {
    expect(calibrateScale(1, 250, 'm')).toBe(250)
    expect(calibrateScale(128, 1024, 'km')).toBe(8000)
  })

  it('uses the same rounded integer pixel distance for display and calculation', () => {
    const start = { x: 0, y: 0 }
    const end = { x: 3.2, y: 4 }
    expect(calibrationPixels(start, end)).toBe(5)
    expect(calibrateFromPoints(start, end, 10, 'm')).toBe(2)
    expect(calibrateScale(5.49, 10, 'm')).toBe(2)
    expect(calibrateScale(5.5, 12, 'm')).toBe(2)
  })

  it('rejects zero after rounding, non-positive distances and non-finite input', () => {
    expect(() => calibrateScale(0.49, 1, 'm')).toThrow()
    expect(() => calibrateScale(-1, 1, 'm')).toThrow()
    expect(() => calibrateScale(1, 0, 'm')).toThrow()
    expect(() => calibrateScale(1, -1, 'km')).toThrow()
    expect(() => calibrateScale(NaN, 1, 'm')).toThrow()
    expect(() => calibrateScale(1, Infinity, 'm')).toThrow()
    expect(() => calibrateScale(1, 1, 'mile' as 'm')).toThrow()
  })

  it('uses px without calibration and switches length units at 1000 meters', () => {
    expect(measureLength(12.5, null)).toEqual({ value: 12.5, unit: 'px' })
    expect(measureLength(999, 1)).toEqual({ value: 999, unit: 'm' })
    expect(measureLength(1000, 1)).toEqual({ value: 1, unit: 'km' })
    expect(measureArea(12.5, null)).toEqual({ value: 12.5, unit: 'px\u00b2' })
  })

  it('keeps exactly 10 square kilometers in square meters', () => {
    expect(measureArea(10, 1000)).toEqual({ value: 10_000_000, unit: 'm\u00b2' })
    expect(measureArea(10.000001, 1000).unit).toBe('km\u00b2')
    expect(measureArea(9.999999, 1000).unit).toBe('m\u00b2')
  })

  it('recalibrates from original pixels and squares the scale for area', () => {
    expect(lengthInMeters(12, 2)).toBe(24)
    expect(lengthInMeters(12, 3)).toBe(36)
    expect(areaInSquareMeters(12, 2)).toBe(48)
    expect(areaInSquareMeters(12, 3)).toBe(108)
    expect(() => measureLength(-1, 1)).toThrow()
    expect(() => measureArea(1, 0)).toThrow()
    expect(() => areaInSquareMeters(1, 1e300)).toThrow()
  })
})

describe('path lengths and label positions', () => {
  it('measures straight, polyline and saved freehand tracks', () => {
    expect(measurePath(path('straight', [{ x: 0, y: 0 }, { x: 3, y: 4 }])).pixelLength).toBe(5)
    const points = [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 8 }]
    for (const kind of ['polyline', 'freehand'] as const) {
      const result = measurePath(path(kind, points))
      expect(result.pixelLength).toBe(9)
      expect(result.segments.map((segment) => segment.pixelLength)).toEqual([5, 4])
    }
  })

  it('measures cubic arc length and evaluates its midpoint and local tangent', () => {
    const geometry: LineGeometry = {
      kind: 'bezier',
      nodes: [
        { point: { x: 0, y: 0 }, handleOut: { x: 0, y: 100 } },
        { point: { x: 100, y: 0 }, handleIn: { x: 100, y: 100 } }
      ]
    }
    const result = measurePath(geometry)
    expect(result.pixelLength).toBeCloseTo(200, 7)
    expect(result.midpoint.point.x).toBeCloseTo(50, 6)
    expect(result.midpoint.point.y).toBeCloseTo(75, 6)
    expect(result.midpoint.angleDegrees).toBeCloseTo(0, 6)
    expect(result.midpoint.tangent.x).toBeCloseTo(1, 6)
  })

  it('uses arc length rather than parameter t=0.5 for an uneven cubic', () => {
    const geometry: LineGeometry = {
      kind: 'bezier',
      nodes: [
        { point: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
        { point: { x: 100, y: 0 }, handleIn: { x: 0, y: 0 } }
      ]
    }
    const result = measurePath(geometry)
    expect(result.pixelLength).toBeCloseTo(100, 7)
    expect(result.midpoint.point.x).toBeCloseTo(50, 6)
    expect(result.midpoint.t).toBeCloseTo(Math.cbrt(0.5), 7)
    expect(pointAtPathDistance(geometry, 0).tangent).toEqual({ x: 1, y: 0 })
  })

  it('finds a freehand midpoint by cumulative saved track length', () => {
    const geometry = path('freehand', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }])
    const midpoint = measurePath(geometry).midpoint
    expect(midpoint.point).toEqual({ x: 10, y: 10 })
    expect(midpoint.angleDegrees).toBe(90)
    expect(midpoint.segmentIndex).toBe(1)
    expect(pointAtPathDistance(geometry, -10).point).toEqual({ x: 0, y: 0 })
    expect(pointAtPathDistance(geometry, 100).point).toEqual({ x: 10, y: 30 })
  })

  it('provides segment arc midpoints for temporary segment labels', () => {
    const segments = measurePathSegments(path('polyline', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }]))
    expect(segments.map((segment) => segment.pixelLength)).toEqual([10, 30])
    expect(segments.map((segment) => segment.midpoint.point)).toEqual([{ x: 5, y: 0 }, { x: 10, y: 15 }])
    expect(segments.map((segment) => segment.midpoint.segmentIndex)).toEqual([0, 1])
  })

  it('keeps reversed labels readable and falls back to a start bubble for short lines', () => {
    const geometry = path('straight', [{ x: 100, y: 0 }, { x: 0, y: 0 }])
    expect(lineLabelPlacement(geometry, 20).mode).toBe('inline')
    expect(lineLabelPlacement(geometry, 20).angleDegrees).toBe(0)
    expect(lineLabelPlacement(geometry, 90)).toEqual({ mode: 'bubble', point: { x: 100, y: 0 }, angleDegrees: 0 })
    expect(readableAngle({ x: -1, y: -1 })).toBe(45)
    expect(lineLabelPlacement(path('polyline', [{ x: 0, y: 0 }, { x: 100, y: 0 }]), 20).mode).toBe('bubble')
  })

  it('does not mutate geometry to create a display gap or depend on viewport zoom', () => {
    const geometry = path('freehand', [{ x: 0, y: 0 }, { x: 30, y: 40 }])
    const original = structuredClone(geometry)
    const first = measurePath(geometry)
    lineLabelPlacement(geometry, 20)
    expect(geometry).toEqual(original)
    expect(measurePath(geometry)).toEqual(first)
  })

  it('handles zero-length segments but rejects empty saved paths and invalid data', () => {
    const geometry = path('polyline', [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }])
    expect(measurePath(geometry).midpoint.point).toEqual({ x: 5, y: 0 })
    expect(() => validateLineGeometry(geometry, bounds)).not.toThrow()
    const zero = path('straight', [{ x: 1, y: 1 }, { x: 1, y: 1 }])
    expect(measurePath(zero).pixelLength).toBe(0)
    expect(lineLabelPlacement(zero, 0, 0).mode).toBe('bubble')
    expect(() => validateLineGeometry(zero)).toThrow()
    expect(() => measurePath(path('straight', [{ x: 0, y: 0 }]))).toThrow()
    expect(() => measurePath(path('straight', [{ x: NaN, y: 0 }, { x: 1, y: 0 }]))).toThrow()
    expect(() => validateLineGeometry(path('straight', [{ x: -1, y: 0 }, { x: 1, y: 0 }]), bounds)).toThrow()
  })
})

describe('selection geometry', () => {
  it('closes ordinary and polygon lassos and clips them to the image', () => {
    const selection = lassoSelection(square(-10, -10, 30), bounds)
    expect(measureSelection(selection).pixelArea).toBe(400)
    expect(selection.regions[0].outer.every((point) => point.x >= 0 && point.y >= 0)).toBe(true)
    expect(() => validateAreaGeometry(selection, bounds)).not.toThrow()
  })

  it('uses even-odd fill for a crossing lasso', () => {
    const selection = lassoSelection([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }], bounds)
    const result = measureSelection(selection)
    expect(result.pixelArea).toBe(50)
    expect(result.regions).toHaveLength(2)
    expect(result.regions.map((region) => region.pixelArea)).toEqual([25, 25])
    expect(() => validateAreaGeometry(selection, bounds)).not.toThrow()
  })

  it('does not save degenerate, off-image or empty selections', () => {
    expect(lassoSelection([], bounds)).toEqual(empty)
    expect(lassoSelection([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], bounds)).toEqual(empty)
    expect(lassoSelection(square(600, 600, 10), bounds)).toEqual(empty)
    expect(normalizeArea(empty)).toEqual(empty)
    expect(unionAreas([])).toEqual(empty)
    expect(subtractAreas(empty, area(square(1, 1, 2)))).toEqual(empty)
    expect(() => validateAreaGeometry(empty)).toThrow()
  })

  it('unions overlapping fills once without changing its inputs', () => {
    const first = area(square(0, 0, 10))
    const second = area(square(5, 0, 10))
    const original = structuredClone([first, second])
    const union = unionAreas([first, second], bounds)
    expect(measureSelection(union).pixelArea).toBe(150)
    expect(union.regions).toHaveLength(1)
    expect([first, second]).toEqual(original)
    expect(() => validateAreaGeometry(union, bounds)).not.toThrow()
  })

  it('subtracts holes and reports net area for each disconnected region', () => {
    const subject = unionAreas([area(square(10, 10, 100)), area(square(200, 200, 20))])
    const result = subtractAreas(subject, area(square(30, 30, 20)))
    const measurement = measureSelection(result)
    expect(measurement.pixelArea).toBe(10_000)
    expect(measurement.regions.map((region) => region.pixelArea).sort((a, b) => a - b)).toEqual([400, 9600])
    expect(result.regions.reduce((count, region) => count + region.holes.length, 0)).toBe(1)
    expect(() => validateAreaGeometry(result, bounds)).not.toThrow()
  })

  it('supports filled islands inside holes without adding hole area', () => {
    const ring = subtractAreas(area(square(10, 10, 100)), area(square(30, 30, 60)))
    const result = unionAreas([ring, area(square(40, 40, 20))])
    expect(result.regions).toHaveLength(2)
    expect(measureSelection(result).pixelArea).toBe(6800)
    expect(() => validateAreaGeometry(result, bounds)).not.toThrow()
  })

  it('normalizes reversed rings, overlapping holes and holes outside an outer ring', () => {
    const geometry: AreaGeometry = {
      regions: [{ outer: square(0, 0, 100).reverse(), holes: [square(10, 10, 20), square(20, 10, 20).reverse(), square(200, 200, 20)] }]
    }
    expect(measureSelection(geometry).pixelArea).toBe(9400)
    expect(normalizeArea(geometry).regions).toHaveLength(1)
    expect(() => validateAreaGeometry(geometry)).toThrow()
  })

  it('builds a continuous round brush capsule instead of spaced dots', () => {
    const diameter = 20
    const stroke = brushStrokeSelection([{ x: 50, y: 50 }, { x: 150, y: 50 }], diameter, bounds)
    const expectedArea = 100 * diameter + Math.PI * (diameter / 2) ** 2
    expect(Math.abs(measureSelection(stroke).pixelArea - expectedArea) / expectedArea).toBeLessThan(0.001)
    expect(stroke.regions).toHaveLength(1)
    expect(() => validateAreaGeometry(stroke, bounds)).not.toThrow()
  })

  it('supports single-point round dabs, overlap and circular erasure holes', () => {
    const dab = brushStrokeSelection([{ x: 100, y: 100 }], 100, bounds)
    expect(Math.abs(measureSelection(dab).pixelArea - Math.PI * 2500) / (Math.PI * 2500)).toBeLessThan(0.002)
    const repeated = applyBrushStroke(dab, [{ x: 100, y: 100 }], 100, bounds)
    expect(measureSelection(repeated).pixelArea).toBe(measureSelection(dab).pixelArea)
    const erased = applyBrushStroke(repeated, [{ x: 100, y: 100 }], 20, bounds, 'erase')
    expect(erased.regions[0].holes).toHaveLength(1)
    expect(measureSelection(erased).pixelArea).toBeCloseTo(measureSelection(dab).pixelArea - measureSelection(brushStrokeSelection([{ x: 100, y: 100 }], 20, bounds)).pixelArea, 5)
    expect(() => validateAreaGeometry(erased, bounds)).not.toThrow()
  })

  it('retains the closing segment in an open stroke that returns to its first point', () => {
    const stroke = brushStrokeSelection([{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 150 }, { x: 50, y: 50 }], 10, bounds)
    expect(stroke.regions[0].holes).toHaveLength(1)
  })

  it('keeps separate brush strokes as separate regions and clips dabs at the image edge', () => {
    const first = applyBrushStroke(empty, [{ x: 100, y: 100 }], 20, bounds)
    const result = applyBrushStroke(first, [{ x: 200, y: 200 }], 20, bounds)
    expect(result.regions).toHaveLength(2)
    const clipped = brushStrokeSelection([{ x: 0, y: 0 }], 20, bounds)
    expect(Math.abs(measureSelection(clipped).pixelArea - Math.PI * 25)).toBeLessThan(0.3)
    expect(applyBrushStroke(empty, [], 10, bounds)).toEqual(empty)
    expect(() => validateAreaGeometry(result, bounds)).not.toThrow()
  })

  it('validates topology and rejects overlapping regions, self-intersection and invalid bounds', () => {
    expect(() => validateAreaGeometry({ regions: [area(square(0, 0, 20)).regions[0], area(square(10, 0, 20)).regions[0]] })).toThrow()
    expect(() => validateAreaGeometry(area([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }]))).toThrow()
    expect(() => validateAreaGeometry(area([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]))).toThrow()
    expect(() => validateAreaGeometry({ regions: [{ outer: square(0, 0, 100), holes: [square(-5, -5, 10)] }] })).toThrow()
    expect(() => validateAreaGeometry(area(square(490, 490, 20)), bounds)).toThrow()
    expect(() => lassoSelection(square(1, 1, 10), { width: 0, height: 20 })).toThrow()
    expect(() => brushStrokeSelection([{ x: 1, y: NaN }], 10, bounds)).toThrow()
    expect(() => brushStrokeSelection([{ x: 1, y: 1 }], 0, bounds)).toThrow()
  })

  it('accepts normalized erasure touching the outer boundary at a single point', () => {
    const erased = subtractAreas(area(square(0, 0, 100)), area([{ x: 0, y: 50 }, { x: 10, y: 40 }, { x: 10, y: 60 }]))
    expect(measureSelection(erased).pixelArea).toBe(9900)
    expect(() => validateAreaGeometry(erased, bounds)).not.toThrow()
  })

  it('rejects excessive geometry before clipping or curve computation', () => {
    const points = Array.from({ length: GEOMETRY_LIMITS.areaPoints + 1 }, () => ({ x: 1, y: 1 }))
    expect(() => lassoSelection(points, bounds)).toThrow(/Too many/)
    expect(() => brushStrokeSelection(points, 10, bounds)).toThrow(/Too many/)
    expect(() => measurePath(path('polyline', points))).toThrow(/Too many/)
    expect(() => normalizeArea(area([{ x: Infinity, y: 0 }]))).toThrow()
  })
})
