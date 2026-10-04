import { Bezier } from 'bezier-js'
import type { LineGeometry, PathNode, Point } from '../types'
import type { ImageBounds } from './areas'
import { assertFinite, assertNonNegative, assertPoint, assertPositive, GEOMETRY_LIMITS } from './validation'

export interface PathPosition {
  point: Point
  tangent: Point
  angleDegrees: number
  segmentIndex: number
  t: number
}

export interface PathMeasurement {
  pixelLength: number
  segments: { index: number; pixelLength: number }[]
  midpoint: PathPosition
}

export interface PathSegmentMeasurement {
  index: number
  pixelLength: number
  midpoint: PathPosition
}

export interface LineLabelPlacement {
  mode: 'inline' | 'bubble'
  point: Point
  angleDegrees: number
}

interface Segment {
  start: Point
  end: Point
  curve: Bezier | null
  length: number
}

function validateNode(node: PathNode): void {
  if (!node || typeof node !== 'object') throw new TypeError('Invalid path node')
  assertPoint(node.point)
  if (node.handleIn !== undefined) assertPoint(node.handleIn)
  if (node.handleOut !== undefined) assertPoint(node.handleOut)
}

function buildSegments(geometry: LineGeometry): Segment[] {
  if (!geometry || !['straight', 'polyline', 'freehand', 'bezier'].includes(geometry.kind)) {
    throw new TypeError('Invalid line geometry kind')
  }
  if (!Array.isArray(geometry.nodes) || geometry.nodes.length < 2) {
    throw new RangeError('A path requires at least two nodes')
  }
  if (geometry.nodes.length > GEOMETRY_LIMITS.pathNodes) throw new RangeError('Too many path nodes')
  if (geometry.kind === 'straight' && geometry.nodes.length !== 2) {
    throw new RangeError('A straight line requires exactly two nodes')
  }
  geometry.nodes.forEach(validateNode)
  return geometry.nodes.slice(1).map((next, index) => {
    const previous = geometry.nodes[index]
    const start = previous.point
    const end = next.point
    const curve =
      geometry.kind === 'bezier' && (previous.handleOut || next.handleIn)
        ? new Bezier(start, previous.handleOut ?? start, next.handleIn ?? end, end)
        : null
    const length = curve ? curve.length() : Math.hypot(end.x - start.x, end.y - start.y)
    assertNonNegative(length, 'Segment length')
    return { start, end, curve, length }
  })
}

export function readableAngle(tangent: Point): number {
  assertPoint(tangent)
  let angle = (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI
  if (angle > 90) angle -= 180
  if (angle < -90) angle += 180
  return angle
}

function curveParameterAtLength(curve: Bezier, distance: number, length: number): number {
  if (distance <= 0 || length === 0) return 0
  if (distance >= length) return 1
  let low = 0
  let high = 1
  for (let iteration = 0; iteration < 32; iteration++) {
    const midpoint = (low + high) / 2
    if (curve.split(0, midpoint).length() < distance) low = midpoint
    else high = midpoint
  }
  return (low + high) / 2
}

function segmentPosition(segment: Segment, index: number, distance: number): PathPosition {
  const t = segment.curve
    ? curveParameterAtLength(segment.curve, distance, segment.length)
    : segment.length === 0
      ? 0
      : distance / segment.length
  const point = segment.curve
    ? segment.curve.get(t)
    : {
        x: segment.start.x + (segment.end.x - segment.start.x) * t,
        y: segment.start.y + (segment.end.y - segment.start.y) * t
      }
  let derivative: Point = segment.curve
    ? segment.curve.derivative(t)
    : { x: segment.end.x - segment.start.x, y: segment.end.y - segment.start.y }
  if (segment.curve && Math.hypot(derivative.x, derivative.y) < 1e-10) {
    derivative = segment.curve.derivative(t < 1 ? Math.min(1, t + 1e-5) : Math.max(0, t - 1e-5))
  }
  let magnitude = Math.hypot(derivative.x, derivative.y)
  if (magnitude < 1e-10) {
    derivative = { x: segment.end.x - segment.start.x, y: segment.end.y - segment.start.y }
    magnitude = Math.hypot(derivative.x, derivative.y)
  }
  const tangent = magnitude > 0 ? { x: derivative.x / magnitude, y: derivative.y / magnitude } : { x: 1, y: 0 }
  return { point: { x: point.x, y: point.y }, tangent, angleDegrees: readableAngle(tangent), segmentIndex: index, t }
}

function positionAtDistance(segments: Segment[], distance: number): PathPosition {
  const total = segments.reduce((sum, segment) => sum + segment.length, 0)
  let remaining = Math.max(0, Math.min(total, distance))
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (segment.length > 0 && (remaining <= segment.length || index === segments.length - 1)) {
      return segmentPosition(segment, index, remaining)
    }
    remaining -= segment.length
  }
  return segmentPosition(segments[0], 0, 0)
}

export function measurePath(geometry: LineGeometry): PathMeasurement {
  const segments = buildSegments(geometry)
  const pixelLength = segments.reduce((sum, segment) => sum + segment.length, 0)
  assertFinite(pixelLength, 'Path length')
  return {
    pixelLength,
    segments: segments.map((segment, index) => ({ index, pixelLength: segment.length })),
    midpoint: positionAtDistance(segments, pixelLength / 2)
  }
}

export function measurePathSegments(geometry: LineGeometry): PathSegmentMeasurement[] {
  return buildSegments(geometry).map((segment, index) => ({
    index,
    pixelLength: segment.length,
    midpoint: segmentPosition(segment, index, segment.length / 2)
  }))
}

export function validateLineGeometry(geometry: LineGeometry, bounds?: ImageBounds): void {
  if (!buildSegments(geometry).some((segment) => segment.length > 0)) {
    throw new RangeError('An empty path cannot be saved')
  }
  if (bounds) {
    assertPositive(bounds.width, 'Image width')
    assertPositive(bounds.height, 'Image height')
    for (const node of geometry.nodes) {
      if (node.point.x < 0 || node.point.y < 0 || node.point.x > bounds.width || node.point.y > bounds.height) {
        throw new RangeError('Path node is outside the image')
      }
    }
  }
}

export function pointAtPathDistance(geometry: LineGeometry, pixelDistance: number): PathPosition {
  assertFinite(pixelDistance, 'Path distance')
  return positionAtDistance(buildSegments(geometry), pixelDistance)
}

export function lineLabelPlacement(
  geometry: LineGeometry,
  labelWidthPixels: number,
  paddingPixels = 8
): LineLabelPlacement {
  assertNonNegative(labelWidthPixels, 'Label width')
  assertNonNegative(paddingPixels, 'Label padding')
  const measurement = measurePath(geometry)
  if (
    geometry.kind === 'polyline' ||
    geometry.kind === 'bezier' ||
    measurement.pixelLength === 0 ||
    measurement.pixelLength < labelWidthPixels + paddingPixels * 2
  ) {
    return { mode: 'bubble', point: { ...geometry.nodes[0].point }, angleDegrees: 0 }
  }
  return { mode: 'inline', point: measurement.midpoint.point, angleDegrees: measurement.midpoint.angleDegrees }
}
