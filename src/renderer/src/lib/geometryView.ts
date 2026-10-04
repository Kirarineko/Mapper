import { Bezier } from 'bezier-js'
import type { AreaGeometry, AreaRegion, LineGeometry, PathNode, Point } from '../../../shared/types'

/**
 * 几何 → 画布渲染辅助。
 * 贝塞尔分段的构造规则与共享几何模块 paths.ts 保持一致：仅当相邻节点带有手柄时按三次贝塞尔处理。
 */

function segmentCurve(previous: PathNode, next: PathNode): Bezier | null {
  if (!previous.handleOut && !next.handleIn) return null
  const start = previous.point
  const end = next.point
  return new Bezier(start, previous.handleOut ?? start, next.handleIn ?? end, end)
}

/** 线几何展开为 Konva 需要的扁平点数组（原图像素坐标）。 */
export function lineToFlatPoints(geometry: LineGeometry): number[] {
  const points: number[] = []
  const nodes = geometry.nodes
  if (nodes.length === 0) return points
  points.push(nodes[0].point.x, nodes[0].point.y)
  const sampleCurves = geometry.kind === 'bezier'
  for (let index = 1; index < nodes.length; index++) {
    const previous = nodes[index - 1]
    const next = nodes[index]
    const curve = sampleCurves ? segmentCurve(previous, next) : null
    if (curve) {
      const approxLength =
        Math.hypot(next.point.x - previous.point.x, next.point.y - previous.point.y) * 1.5
      const steps = Math.min(128, Math.max(8, Math.ceil(approxLength / 6)))
      const lut = curve.getLUT(steps)
      for (let sample = 1; sample < lut.length; sample++) {
        points.push(lut[sample].x, lut[sample].y)
      }
    } else {
      points.push(next.point.x, next.point.y)
    }
  }
  return points
}

function ringToPathData(ring: Point[]): string {
  if (ring.length === 0) return ''
  const [first, ...rest] = ring
  const parts = [`M${round(first.x)} ${round(first.y)}`]
  for (const point of rest) parts.push(`L${round(point.x)} ${round(point.y)}`)
  parts.push('Z')
  return parts.join('')
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export function regionToPathData(region: AreaRegion): string {
  return [ringToPathData(region.outer), ...region.holes.map(ringToPathData)].join('')
}

export function areaToPathData(geometry: AreaGeometry): string {
  return geometry.regions.map(regionToPathData).join('')
}

/** 多边形质心（面积加权）；退化时退回顶点均值。 */
export function ringCentroid(ring: Point[]): Point {
  if (ring.length === 0) return { x: 0, y: 0 }
  let twiceArea = 0
  let cx = 0
  let cy = 0
  for (let index = 0; index < ring.length; index++) {
    const current = ring[index]
    const next = ring[(index + 1) % ring.length]
    const cross = current.x * next.y - next.x * current.y
    twiceArea += cross
    cx += (current.x + next.x) * cross
    cy += (current.y + next.y) * cross
  }
  if (Math.abs(twiceArea) < 1e-9) {
    const sum = ring.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 })
    return { x: sum.x / ring.length, y: sum.y / ring.length }
  }
  return { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) }
}

/** 区域标注位置：外环质心。 */
export function regionLabelPoint(region: AreaRegion): Point {
  return ringCentroid(region.outer)
}

/** 自由画笔轨迹抽稀：过密的点对长度计算与存储都没有意义。 */
export function simplifyStroke(points: Point[], minDistance = 1): Point[] {
  if (points.length <= 2) return points
  const result: Point[] = [points[0]]
  for (let index = 1; index < points.length - 1; index++) {
    const last = result[result.length - 1]
    const point = points[index]
    if (Math.hypot(point.x - last.x, point.y - last.y) >= minDistance) result.push(point)
  }
  result.push(points[points.length - 1])
  return result
}

/** 标定两点的取整像素距离（与共享校准函数取整规则一致）。 */
export function roundedPixelDistance(start: Point, end: Point): number {
  return Math.round(Math.hypot(end.x - start.x, end.y - start.y))
}
