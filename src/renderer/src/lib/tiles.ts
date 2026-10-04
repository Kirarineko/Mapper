import type { ImageIdentity, TileLevel, TileManifest } from '../../../shared/types'

/** 按当前缩放选择切片层级：选择分辨率足够（level.scale ≥ 视图缩放）的最低层级。 */
export function chooseLevel(levels: TileLevel[], viewScale: number): TileLevel {
  if (levels.length === 0) throw new Error('切片清单为空')
  const sorted = [...levels].sort((a, b) => a.scale - b.scale)
  for (const level of sorted) {
    if (level.scale >= viewScale) return level
  }
  return sorted[sorted.length - 1]
}

export interface VisibleRange {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** 视野（原图像素坐标）与层级信息求需要的切片行列范围。 */
export function visibleTileRange(level: TileLevel, view: VisibleRange, tileSize: number): { columns: number[]; rows: number[] } {
  const levelView = {
    x0: view.x0 * level.scale,
    y0: view.y0 * level.scale,
    x1: view.x1 * level.scale,
    y1: view.y1 * level.scale,
  }
  const colStart = clamp(Math.floor(levelView.x0 / tileSize), 0, level.columns - 1)
  const colEnd = clamp(Math.floor((levelView.x1 - 1e-9) / tileSize), 0, level.columns - 1)
  const rowStart = clamp(Math.floor(levelView.y0 / tileSize), 0, level.rows - 1)
  const rowEnd = clamp(Math.floor((levelView.y1 - 1e-9) / tileSize), 0, level.rows - 1)
  const columns: number[] = []
  const rows: number[] = []
  for (let column = colStart; column <= colEnd; column++) columns.push(column)
  for (let row = rowStart; row <= rowEnd; row++) rows.push(row)
  return { columns, rows }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function tileUrl(manifest: TileManifest, level: number, column: number, row: number): string {
  return manifest.tileUrlTemplate
    .replace('{level}', String(level))
    .replace('{x}', String(column))
    .replace('{y}', String(row))
}

interface CacheEntry {
  image: HTMLImageElement
  lastUsed: number
}

/** 已解码切片的容量受限缓存（LRU）。 */
export class TileImageCache {
  private readonly entries = new Map<string, CacheEntry>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly capacity = 256) {}

  get(url: string): HTMLImageElement | null {
    const entry = this.entries.get(url)
    if (entry) {
      entry.lastUsed = Date.now()
      return entry.image.complete && entry.image.naturalWidth > 0 ? entry.image : null
    }
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => this.notify()
    image.onerror = () => {
      this.entries.delete(url)
      this.notify()
    }
    image.src = url
    this.entries.set(url, { image, lastUsed: Date.now() })
    this.evict()
    return null
  }

  peek(url: string): HTMLImageElement | null {
    const entry = this.entries.get(url)
    if (!entry) return null
    entry.lastUsed = Date.now()
    return entry.image.complete && entry.image.naturalWidth > 0 ? entry.image : null
  }

  clear(): void {
    this.entries.clear()
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  private evict(): void {
    if (this.entries.size <= this.capacity) return
    const ordered = [...this.entries.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    const removeCount = this.entries.size - this.capacity
    for (let index = 0; index < removeCount; index++) {
      this.entries.delete(ordered[index][0])
    }
  }
}

/** 预览图在视野中的铺满尺寸（原图像素坐标即为绘制坐标）。 */
export function previewRect(image: ImageIdentity): { x: number; y: number; width: number; height: number } {
  return { x: 0, y: 0, width: image.width, height: image.height }
}
