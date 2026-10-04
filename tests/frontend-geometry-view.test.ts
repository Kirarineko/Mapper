import { describe, expect, it } from 'vitest'
import {
  areaToPathData,
  lineToFlatPoints,
  ringCentroid,
  roundedPixelDistance,
  simplifyStroke,
} from '../src/renderer/src/lib/geometryView'
import type { LineGeometry, Point } from '../src/shared/types'

describe('lineToFlatPoints', () => {
  it('直线直接输出两个端点', () => {
    const geometry: LineGeometry = {
      kind: 'straight',
      nodes: [{ point: { x: 0, y: 0 } }, { point: { x: 10, y: 5 } }],
    }
    expect(lineToFlatPoints(geometry)).toEqual([0, 0, 10, 5])
  })
  it('折线按顺序输出', () => {
    const geometry: LineGeometry = {
      kind: 'polyline',
      nodes: [{ point: { x: 0, y: 0 } }, { point: { x: 4, y: 0 } }, { point: { x: 4, y: 3 } }],
    }
    expect(lineToFlatPoints(geometry)).toEqual([0, 0, 4, 0, 4, 3])
  })
  it('贝塞尔带手柄时采样为多点折线', () => {
    const geometry: LineGeometry = {
      kind: 'bezier',
      nodes: [
        { point: { x: 0, y: 0 }, handleOut: { x: 100, y: 0 } },
        { point: { x: 200, y: 200 }, handleIn: { x: 200, y: 100 } },
      ],
    }
    const points = lineToFlatPoints(geometry)
    expect(points.length).toBeGreaterThan(4)
    // 起终点保持精确
    expect(points[0]).toBe(0)
    expect(points[1]).toBe(0)
    expect(points[points.length - 2]).toBe(200)
    expect(points[points.length - 1]).toBe(200)
  })
  it('贝塞尔无手柄分段退化为直线', () => {
    const geometry: LineGeometry = {
      kind: 'bezier',
      nodes: [{ point: { x: 0, y: 0 } }, { point: { x: 10, y: 10 } }],
    }
    expect(lineToFlatPoints(geometry)).toEqual([0, 0, 10, 10])
  })
})

describe('ringCentroid', () => {
  it('正方形质心在中心', () => {
    const ring: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]
    const centroid = ringCentroid(ring)
    expect(centroid.x).toBeCloseTo(50)
    expect(centroid.y).toBeCloseTo(50)
  })
  it('退化多边形退回顶点均值', () => {
    const ring: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]
    const centroid = ringCentroid(ring)
    expect(centroid.x).toBeCloseTo(10)
    expect(centroid.y).toBeCloseTo(0)
  })
})

describe('simplifyStroke', () => {
  it('剔除过密点但保留首尾', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 0.2, y: 0 },
      { x: 0.4, y: 0 },
      { x: 5, y: 0 },
      { x: 5.1, y: 0 },
      { x: 10, y: 0 },
    ]
    const simplified = simplifyStroke(points, 1)
    expect(simplified[0]).toEqual({ x: 0, y: 0 })
    expect(simplified[simplified.length - 1]).toEqual({ x: 10, y: 0 })
    expect(simplified.length).toBeLessThan(points.length)
  })
  it('两点原样返回', () => {
    const points: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }]
    expect(simplifyStroke(points, 1)).toEqual(points)
  })
})

describe('roundedPixelDistance（标定取整）', () => {
  it('四舍五入取整', () => {
    expect(roundedPixelDistance({ x: 0, y: 0 }, { x: 3.4, y: 0 })).toBe(3)
    expect(roundedPixelDistance({ x: 0, y: 0 }, { x: 3.5, y: 0 })).toBe(4)
  })
  it('斜线距离', () => {
    expect(roundedPixelDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })
})

describe('areaToPathData', () => {
  it('生成外环与孔洞的 evenodd 路径', () => {
    const data = areaToPathData({
      regions: [
        {
          outer: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
          holes: [
            [
              { x: 2, y: 2 },
              { x: 4, y: 2 },
              { x: 4, y: 4 },
            ],
          ],
        },
      ],
    })
    expect(data).toContain('M0 0')
    expect(data).toContain('M2 2')
    expect((data.match(/Z/g) ?? []).length).toBe(2)
  })
})
