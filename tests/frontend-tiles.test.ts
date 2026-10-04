import { describe, expect, it } from 'vitest'
import type { TileLevel, TileManifest } from '../src/shared/types'
import { chooseLevel, tileUrl, visibleTileRange } from '../src/renderer/src/lib/tiles'

const levels: TileLevel[] = [
  { level: 0, width: 256, height: 256, columns: 1, rows: 1, scale: 0.25 },
  { level: 1, width: 512, height: 512, columns: 1, rows: 1, scale: 0.5 },
  { level: 2, width: 1024, height: 1024, columns: 2, rows: 2, scale: 1 },
]

describe('chooseLevel', () => {
  it('选择分辨率足够的最低层级', () => {
    expect(chooseLevel(levels, 0.2).level).toBe(0)
    expect(chooseLevel(levels, 0.25).level).toBe(0)
    expect(chooseLevel(levels, 0.3).level).toBe(1)
    expect(chooseLevel(levels, 0.9).level).toBe(2)
  })
  it('超过最高分辨率时使用最高层级', () => {
    expect(chooseLevel(levels, 4).level).toBe(2)
  })
})

describe('visibleTileRange', () => {
  it('按视野换算切片行列', () => {
    const level = levels[2] // scale 1，1024×1024，2×2 张
    const range = visibleTileRange(level, { x0: 100, y0: 100, x1: 900, y1: 900 }, 512)
    expect(range.columns).toEqual([0, 1])
    expect(range.rows).toEqual([0, 1])
  })
  it('视野超出地图时裁剪到边界', () => {
    const level = levels[2]
    const range = visibleTileRange(level, { x0: -500, y0: -500, x1: 300, y1: 300 }, 512)
    expect(range.columns).toEqual([0])
    expect(range.rows).toEqual([0])
  })
  it('按层级缩放换算视野', () => {
    const level = levels[0] // scale 0.25，256×256，1 张
    const range = visibleTileRange(level, { x0: 0, y0: 0, x1: 1024, y1: 1024 }, 512)
    expect(range.columns).toEqual([0])
    expect(range.rows).toEqual([0])
  })
})

describe('tileUrl', () => {
  it('替换模板中的层级与行列', () => {
    const manifest = {
      tileUrlTemplate: 'mapper-resource://map/abc/def/{level}/{x}/{y}.webp',
    } as TileManifest
    expect(tileUrl(manifest, 2, 3, 4)).toBe('mapper-resource://map/abc/def/2/3/4.webp')
  })
})
