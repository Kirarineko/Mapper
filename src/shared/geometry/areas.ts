import ClipperLib from 'clipper-lib'
import type { AreaGeometry, AreaRegion, Point } from '../types'
import { assertPoints, assertPositive, GEOMETRY_LIMITS } from './validation'

export interface ImageBounds {
  width: number
  height: number
}

export interface SelectionMeasurement {
  geometry: AreaGeometry
  pixelArea: number
  regions: { index: number; pixelArea: number }[]
}

// Integer clipping retains 1/1024-pixel precision without depending on viewport zoom.
export const CLIPPING_SCALE = 1_024

function validateBounds(bounds: ImageBounds): void {
  if (!bounds || typeof bounds !== 'object') throw new TypeError('Invalid image bounds')
  assertPositive(bounds.width, 'Image width')
  assertPositive(bounds.height, 'Image height')
  if (bounds.width > GEOMETRY_LIMITS.coordinateMagnitude || bounds.height > GEOMETRY_LIMITS.coordinateMagnitude) {
    throw new RangeError('Image bounds exceed the coordinate limit')
  }
}

function toPath(points: Point[], closed = true): ClipperLib.Path {
  const path: ClipperLib.Path = []
  for (const point of points) {
    const integer = { X: Math.round(point.x * CLIPPING_SCALE), Y: Math.round(point.y * CLIPPING_SCALE) }
    const previous = path[path.length - 1]
    if (!previous || previous.X !== integer.X || previous.Y !== integer.Y) path.push(integer)
  }
  if (closed && path.length > 1 && path[0].X === path[path.length - 1].X && path[0].Y === path[path.length - 1].Y) {
    path.pop()
  }
  return path
}

function fromPath(path: ClipperLib.Path): Point[] {
  return path.map((point) => ({ x: point.X / CLIPPING_SCALE, y: point.Y / CLIPPING_SCALE }))
}

function treePaths(tree: ClipperLib.PolyTree): ClipperLib.Paths {
  const paths: ClipperLib.Paths = []
  let pointCount = 0
  const nodes = [...tree.Childs()]
  while (nodes.length > 0) {
    const node = nodes.pop()!
    const contour = node.Contour()
    if (contour.length >= 3) {
      pointCount += contour.length
      if (pointCount > GEOMETRY_LIMITS.areaPoints) throw new RangeError('Selection result has too many points')
      paths.push(contour)
    }
    nodes.push(...node.Childs())
  }
  return paths
}

function execute(
  subject: ClipperLib.Paths,
  clip: ClipperLib.Paths,
  operation: ClipperLib.ClipType,
  subjectFill = ClipperLib.PolyFillType.pftNonZero,
  clipFill = ClipperLib.PolyFillType.pftNonZero
): ClipperLib.PolyTree {
  const result = new ClipperLib.PolyTree()
  if (
    (subject.length === 0 && clip.length === 0) ||
    (subject.length === 0 && operation === ClipperLib.ClipType.ctDifference) ||
    ((subject.length === 0 || clip.length === 0) && operation === ClipperLib.ClipType.ctIntersection)
  ) {
    return result
  }
  const clipper = new ClipperLib.Clipper()
  clipper.StrictlySimple = true
  if (subject.length > 0) clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true)
  if (clip.length > 0) clipper.AddPaths(clip, ClipperLib.PolyType.ptClip, true)
  if (!clipper.Execute(operation, result, subjectFill, clipFill)) {
    // Clipper rejects zero-area inputs before execution.
    return new ClipperLib.PolyTree()
  }
  treePaths(result)
  return result
}

function treeGeometry(tree: ClipperLib.PolyTree): AreaGeometry {
  const regions: AreaRegion[] = []
  const nodes = [...tree.Childs()]
  while (nodes.length > 0) {
    const node = nodes.pop()!
    if (!node.IsHole() && node.Contour().length >= 3) {
      regions.push({
        outer: fromPath(node.Contour()),
        holes: node.Childs().filter((child) => child.IsHole()).map((child) => fromPath(child.Contour()))
      })
      if (regions.length > GEOMETRY_LIMITS.areaRegions) throw new RangeError('Too many selection regions')
    }
    nodes.push(...node.Childs())
  }
  return { regions }
}

function geometryPaths(geometry: AreaGeometry): ClipperLib.Paths {
  if (!geometry || !Array.isArray(geometry.regions)) throw new TypeError('Invalid area geometry')
  if (geometry.regions.length > GEOMETRY_LIMITS.areaRegions) throw new RangeError('Too many selection regions')
  let pointCount = 0
  let contourCount = 0
  const result: ClipperLib.Paths = []
  for (const region of geometry.regions) {
    if (!region || !Array.isArray(region.holes)) throw new TypeError('Invalid area region')
    contourCount += 1 + region.holes.length
    if (contourCount > GEOMETRY_LIMITS.areaPoints) throw new RangeError('Too many selection contours')
    const contours = [region.outer, ...region.holes]
    for (const contour of contours) {
      assertPoints(contour, GEOMETRY_LIMITS.areaPoints)
      pointCount += contour.length
      if (pointCount > GEOMETRY_LIMITS.areaPoints) throw new RangeError('Too many selection points')
    }
    const outer = toPath(region.outer)
    if (outer.length < 3) continue
    const holes = region.holes.map((hole) => toPath(hole)).filter((path) => path.length >= 3)
    for (const hole of holes) {
      if (!ClipperLib.Clipper.Orientation(hole)) hole.reverse()
    }
    // Resolve each region first so holes outside its outer ring cannot create filled islands.
    result.push(
      ...treePaths(
        execute([outer], holes, ClipperLib.ClipType.ctDifference, ClipperLib.PolyFillType.pftEvenOdd)
      )
    )
  }
  return result
}

function boundsPath(bounds: ImageBounds): ClipperLib.Path {
  validateBounds(bounds)
  return toPath([
    { x: 0, y: 0 },
    { x: bounds.width, y: 0 },
    { x: bounds.width, y: bounds.height },
    { x: 0, y: bounds.height }
  ])
}

function clipTree(tree: ClipperLib.PolyTree, bounds?: ImageBounds): ClipperLib.PolyTree {
  return bounds
    ? execute(treePaths(tree), [boundsPath(bounds)], ClipperLib.ClipType.ctIntersection)
    : tree
}

export function normalizeArea(geometry: AreaGeometry, bounds?: ImageBounds): AreaGeometry {
  return treeGeometry(clipTree(execute(geometryPaths(geometry), [], ClipperLib.ClipType.ctUnion), bounds))
}

function integerTreeArea(tree: ClipperLib.PolyTree): number {
  const nodes = [...tree.Childs()]
  let area = 0
  while (nodes.length > 0) {
    const node = nodes.pop()!
    area += Math.abs(ClipperLib.Clipper.Area(node.Contour())) * (node.IsHole() ? -1 : 1)
    nodes.push(...node.Childs())
  }
  return area
}

function equalArea(first: number, second: number): boolean {
  return Math.abs(first - second) <= Math.max(1, Math.max(Math.abs(first), Math.abs(second)) * 1e-12)
}

function validateRing(path: ClipperLib.Path): number {
  if (new Set(path.map((point) => `${point.X},${point.Y}`)).size !== path.length) {
    throw new RangeError('Area rings must not revisit a vertex')
  }
  const area = Math.abs(ClipperLib.Clipper.Area(path))
  const tree = execute([path], [], ClipperLib.ClipType.ctUnion, ClipperLib.PolyFillType.pftEvenOdd)
  const shape = treeGeometry(tree)
  if (area <= 0 || shape.regions.length !== 1 || shape.regions[0].holes.length !== 0 || !equalArea(area, integerTreeArea(tree))) {
    throw new RangeError('Area rings must be non-degenerate and simple')
  }
  return area
}

export function validateAreaGeometry(geometry: AreaGeometry, bounds?: ImageBounds): void {
  const paths = geometryPaths(geometry)
  if (geometry.regions.length === 0) throw new RangeError('An empty selection cannot be saved')
  if (bounds) validateBounds(bounds)
  let expectedArea = 0
  for (const region of geometry.regions) {
    const outer = toPath(region.outer)
    let area = validateRing(outer)
    const holes = region.holes.map((hole) => toPath(hole))
    let holesArea = 0
    for (const hole of holes) {
      holesArea += validateRing(hole)
      if (hole.some((point) => ClipperLib.Clipper.PointInPolygon(point, outer) === 0)) {
        throw new RangeError('A hole must be inside its outer ring')
      }
      if (integerTreeArea(execute([hole], [outer], ClipperLib.ClipType.ctDifference, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd)) > 0) {
        throw new RangeError('A hole crosses its outer ring')
      }
    }
    const normalizedHoles = holes.map((hole) => ClipperLib.Clipper.Orientation(hole) ? hole : [...hole].reverse())
    if (!equalArea(holesArea, integerTreeArea(execute(normalizedHoles, [], ClipperLib.ClipType.ctUnion)))) {
      throw new RangeError('Area holes must not overlap')
    }
    area -= holesArea
    if (area <= 0) throw new RangeError('An empty region cannot be saved')
    expectedArea += area
    if (bounds) {
      const tolerance = 1 / CLIPPING_SCALE
      for (const point of [region.outer, ...region.holes].flat()) {
        if (point.x < -tolerance || point.y < -tolerance || point.x > bounds.width + tolerance || point.y > bounds.height + tolerance) {
          throw new RangeError('Area is outside the image')
        }
      }
    }
  }
  if (!equalArea(expectedArea, integerTreeArea(execute(paths, [], ClipperLib.ClipType.ctUnion)))) {
    throw new RangeError('Area regions must not overlap')
  }
}

export function lassoSelection(points: Point[], bounds: ImageBounds): AreaGeometry {
  assertPoints(points, GEOMETRY_LIMITS.areaPoints)
  validateBounds(bounds)
  const path = toPath(points)
  if (path.length < 3) return { regions: [] }
  return treeGeometry(
    clipTree(execute([path], [], ClipperLib.ClipType.ctUnion, ClipperLib.PolyFillType.pftEvenOdd), bounds)
  )
}

export function unionAreas(geometries: AreaGeometry[], bounds?: ImageBounds): AreaGeometry {
  if (!Array.isArray(geometries)) throw new TypeError('Area geometries must be an array')
  if (geometries.length > GEOMETRY_LIMITS.areaRegions) throw new RangeError('Too many area geometries')
  const paths = geometries.flatMap(geometryPaths)
  if (paths.reduce((count, path) => count + path.length, 0) > GEOMETRY_LIMITS.areaPoints) {
    throw new RangeError('Too many combined selection points')
  }
  return treeGeometry(clipTree(execute(paths, [], ClipperLib.ClipType.ctUnion), bounds))
}

export function subtractAreas(subject: AreaGeometry, eraser: AreaGeometry, bounds?: ImageBounds): AreaGeometry {
  const subjectPaths = geometryPaths(subject)
  const eraserPaths = geometryPaths(eraser)
  if ([...subjectPaths, ...eraserPaths].reduce((count, path) => count + path.length, 0) > GEOMETRY_LIMITS.areaPoints) {
    throw new RangeError('Too many combined selection points')
  }
  return treeGeometry(clipTree(execute(subjectPaths, eraserPaths, ClipperLib.ClipType.ctDifference), bounds))
}

export function brushStrokeSelection(points: Point[], diameterPixels: number, bounds: ImageBounds): AreaGeometry {
  assertPoints(points, GEOMETRY_LIMITS.brushPoints)
  assertPositive(diameterPixels, 'Brush diameter')
  validateBounds(bounds)
  if (diameterPixels > GEOMETRY_LIMITS.coordinateMagnitude) throw new RangeError('Brush diameter exceeds the limit')
  const path = toPath(points, false)
  if (path.length === 0) return { regions: [] }
  const radius = (diameterPixels * CLIPPING_SCALE) / 2
  const offset = new ClipperLib.ClipperOffset(2, Math.max(1, Math.min(radius * 0.001, CLIPPING_SCALE * 0.05)))
  offset.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etOpenRound)
  const outline: ClipperLib.Paths = []
  offset.Execute(outline, radius)
  if (outline.reduce((count, contour) => count + contour.length, 0) > GEOMETRY_LIMITS.areaPoints) {
    throw new RangeError('Brush result has too many points; use shorter stroke batches')
  }
  return treeGeometry(clipTree(execute(outline, [], ClipperLib.ClipType.ctUnion), bounds))
}

export function applyBrushStroke(
  current: AreaGeometry,
  points: Point[],
  diameterPixels: number,
  bounds: ImageBounds,
  mode: 'add' | 'erase' = 'add'
): AreaGeometry {
  if (mode !== 'add' && mode !== 'erase') throw new TypeError('Invalid brush mode')
  const stroke = brushStrokeSelection(points, diameterPixels, bounds)
  return mode === 'add' ? unionAreas([current, stroke], bounds) : subtractAreas(current, stroke, bounds)
}

export function measureSelection(geometry: AreaGeometry): SelectionMeasurement {
  const normalized = normalizeArea(geometry)
  const regions = normalized.regions.map((region, index) => ({
    index,
    pixelArea:
      (Math.abs(ClipperLib.Clipper.Area(toPath(region.outer))) -
        region.holes.reduce((sum, hole) => sum + Math.abs(ClipperLib.Clipper.Area(toPath(hole))), 0)) /
      (CLIPPING_SCALE * CLIPPING_SCALE)
  }))
  return { geometry: normalized, pixelArea: regions.reduce((sum, region) => sum + region.pixelArea, 0), regions }
}
