import { useEffect, useMemo, useState } from 'react'
import { Image as KonvaImage, Layer, Rect } from 'react-konva'
import type { TileManifest } from '../../../../shared/types'
import { chooseLevel, previewRect, TileImageCache, tileUrl, visibleTileRange } from '../../lib/tiles'

export interface CanvasView {
  x: number
  y: number
  scale: number
}

const tileCache = new TileImageCache(256)

interface TileLayerProps {
  manifest: TileManifest
  view: CanvasView
  width: number
  height: number
}

/** 地图瓦片层：预览图垫底，按视野与缩放等级加载金字塔切片（LRU 缓存已解码图像）。 */
export function TileLayer({ manifest, view, width, height }: TileLayerProps) {
  const [preview, setPreview] = useState<HTMLImageElement | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    setPreview(null)
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => setPreview(image)
    image.src = manifest.previewUrl
    return tileCache.onChange(() => setVersion((value) => value + 1))
  }, [manifest.previewUrl, manifest.mapId])

  const level = useMemo(
    () => chooseLevel(manifest.levels, view.scale),
    [manifest.levels, view.scale]
  )

  const tiles = useMemo(() => {
    void version // 缓存加载完成后触发重算
    const visible = {
      x0: -view.x / view.scale,
      y0: -view.y / view.scale,
      x1: (width - view.x) / view.scale,
      y1: (height - view.y) / view.scale,
    }
    const range = visibleTileRange(level, visible, manifest.tileSize)
    const result: {
      key: string
      image: HTMLImageElement
      x: number
      y: number
      width: number
      height: number
    }[] = []
    for (const column of range.columns) {
      for (const row of range.rows) {
        const url = tileUrl(manifest, level.level, column, row)
        const image = tileCache.get(url)
        if (!image) continue
        const tileWidth = Math.min(manifest.tileSize, level.width - column * manifest.tileSize)
        const tileHeight = Math.min(manifest.tileSize, level.height - row * manifest.tileSize)
        result.push({
          key: `${level.level}:${column}:${row}`,
          image,
          x: (column * manifest.tileSize) / level.scale,
          y: (row * manifest.tileSize) / level.scale,
          width: tileWidth / level.scale,
          height: tileHeight / level.scale,
        })
      }
    }
    return result
  }, [manifest, level, view, width, height, version])

  const rect = previewRect(manifest.image)

  return (
    <Layer listening={false}>
      <Rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill="#76717c" />
      {preview && (
        <KonvaImage image={preview} x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
      )}
      {tiles.map((tile) => (
        <KonvaImage
          key={tile.key}
          image={tile.image}
          x={tile.x}
          y={tile.y}
          width={tile.width}
          height={tile.height}
        />
      ))}
    </Layer>
  )
}
