import { useMemo, useState } from 'react'
import { Circle, Group, Layer, Line, Path, Rect, Text } from 'react-konva'
import type Konva from 'konva'
import {
  lineLabelPlacement,
  measurePath,
  measurePathSegments,
  measureSelection,
  type PathMeasurement,
} from '../../../../shared/geometry'
import type {
  AreaMeasurement,
  LineGeometry,
  LineMeasurement,
  PathNode,
  Point,
} from '../../../../shared/types'
import { formatArea, formatLength } from '../../lib/format'
import { areaToPathData, lineToFlatPoints, regionLabelPoint } from '../../lib/geometryView'
import { measureLabelWidth } from '../../lib/textMeasure'
import type { CanvasColors } from '../../hooks/useThemeColors'
import type { SelectionRef } from '../../store/appStore'

const FONT_SCREEN = 13

interface LabelProps {
  point: Point
  text: string
  scale: number
  colors: CanvasColors
  angleDegrees?: number
}

/** 跟随路径走向的行内标签（底色块造成"断线"的视觉效果，不修改几何）。 */
export function InlineLabel({ point, text, scale, colors, angleDegrees = 0 }: LabelProps) {
  const fontSize = FONT_SCREEN / scale
  const padX = 6 / scale
  const padY = 3 / scale
  const width = measureLabelWidth(text, FONT_SCREEN) / scale + padX * 2
  const height = fontSize + padY * 2
  return (
    <Group x={point.x} y={point.y} rotation={angleDegrees} listening={false}>
      <Rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        cornerRadius={4 / scale}
        fill={colors.labelBg}
        opacity={0.92}
      />
      <Text
        x={-width / 2}
        y={-fontSize / 2}
        width={width}
        align="center"
        text={text}
        fontSize={fontSize}
        fontStyle="500"
        fill={colors.labelText}
        listening={false}
      />
    </Group>
  )
}

/** 起点气泡标签。 */
export function PointBubble({ point, text, scale, colors }: LabelProps) {
  const fontSize = FONT_SCREEN / scale
  const padX = 8 / scale
  const padY = 5 / scale
  const width = measureLabelWidth(text, FONT_SCREEN) / scale + padX * 2
  const height = fontSize + padY * 2
  const gap = 10 / scale
  return (
    <Group x={point.x} y={point.y} listening={false}>
      <Rect
        x={-width / 2}
        y={-height - gap}
        width={width}
        height={height}
        cornerRadius={10 / scale}
        fill={colors.labelBg}
        opacity={0.95}
        shadowColor="#000"
        shadowBlur={4 / scale}
        shadowOpacity={0.3}
      />
      <Text
        x={-width / 2}
        y={-height - gap + padY}
        width={width}
        align="center"
        text={text}
        fontSize={fontSize}
        fontStyle="500"
        fill={colors.labelText}
        listening={false}
      />
    </Group>
  )
}

function safeMeasurePath(geometry: LineGeometry): PathMeasurement | null {
  try {
    return measurePath(geometry)
  } catch {
    return null
  }
}

interface LineShapeProps {
  measurement: LineMeasurement
  selected: boolean
  scale: number
  colors: CanvasColors
  metersPerPixel: number | null
  showSegments: boolean
  onCommit: (id: string, geometry: LineGeometry) => void
}

function LineShape({ measurement, selected, scale, colors, metersPerPixel, showSegments, onCommit }: LineShapeProps) {
  const [override, setOverride] = useState<LineGeometry | null>(null)
  const geometry = override ?? measurement.geometry
  const flat = useMemo(() => lineToFlatPoints(geometry), [geometry])
  const pathMeasurement = useMemo(() => safeMeasurePath(geometry), [geometry])

  const editable = geometry.kind !== 'freehand'
  const text = pathMeasurement ? formatLength(pathMeasurement.pixelLength, metersPerPixel) : ''

  const label = useMemo(() => {
    if (!pathMeasurement || !text) return null
    if (geometry.kind === 'polyline' || geometry.kind === 'bezier') {
      return { mode: 'bubble' as const, point: { ...geometry.nodes[0].point }, angleDegrees: 0 }
    }
    const labelWidthPixels = measureLabelWidth(text, FONT_SCREEN) / scale
    return lineLabelPlacement(geometry, labelWidthPixels, 8 / scale)
  }, [geometry, pathMeasurement, text, scale])

  const segments = useMemo(() => {
    if (!showSegments || (geometry.kind !== 'polyline' && geometry.kind !== 'bezier')) return []
    try {
      return measurePathSegments(geometry)
    } catch {
      return []
    }
  }, [geometry, showSegments])

  const moveNode = (index: number, point: Point) => {
    const nodes = geometry.nodes.map((node, nodeIndex): PathNode => {
      if (nodeIndex !== index) return node
      // 节点移动时保持手柄的相对位置
      const dx = point.x - node.point.x
      const dy = point.y - node.point.y
      return {
        point,
        handleIn: node.handleIn ? { x: node.handleIn.x + dx, y: node.handleIn.y + dy } : undefined,
        handleOut: node.handleOut ? { x: node.handleOut.x + dx, y: node.handleOut.y + dy } : undefined,
      }
    })
    setOverride({ ...geometry, nodes })
  }

  const moveHandle = (index: number, which: 'handleIn' | 'handleOut', point: Point) => {
    const nodes = geometry.nodes.map((node, nodeIndex): PathNode =>
      nodeIndex === index ? { ...node, [which]: point } : node
    )
    setOverride({ ...geometry, nodes })
  }

  const finishDrag = () => {
    if (override) {
      onCommit(measurement.id, override)
      setOverride(null)
    }
  }

  const anchorRadius = 5.5 / scale
  const handleRadius = 4.5 / scale

  return (
    <Group measurementId={measurement.id} measurementType="line">
      <Line
        points={flat}
        stroke={selected ? colors.measureStroke : colors.measureLine}
        strokeWidth={selected ? 3 : 2.5}
        strokeScaleEnabled={false}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={Math.max(12 / scale, 6)}
      />
      {label &&
        (label.mode === 'inline' ? (
          <InlineLabel point={label.point} text={text} scale={scale} colors={colors} angleDegrees={label.angleDegrees} />
        ) : (
          <PointBubble point={label.point} text={text} scale={scale} colors={colors} />
        ))}
      {segments.map((segment) => (
        <InlineLabel
          key={segment.index}
          point={segment.midpoint.point}
          text={formatLength(segment.pixelLength, metersPerPixel)}
          scale={scale}
          colors={colors}
          angleDegrees={segment.midpoint.angleDegrees}
        />
      ))}
      {selected &&
        editable &&
        geometry.nodes.map((node, index) => (
          <Group key={index}>
            {geometry.kind === 'bezier' && node.handleIn && (
              <Line
                points={[node.point.x, node.point.y, node.handleIn.x, node.handleIn.y]}
                stroke={colors.anchorStroke}
                strokeWidth={1}
                strokeScaleEnabled={false}
                dash={[4 / scale, 4 / scale]}
                listening={false}
              />
            )}
            {geometry.kind === 'bezier' && node.handleOut && (
              <Line
                points={[node.point.x, node.point.y, node.handleOut.x, node.handleOut.y]}
                stroke={colors.anchorStroke}
                strokeWidth={1}
                strokeScaleEnabled={false}
                dash={[4 / scale, 4 / scale]}
                listening={false}
              />
            )}
            {geometry.kind === 'bezier' && node.handleIn && (
              <Rect
                x={node.handleIn.x - handleRadius}
                y={node.handleIn.y - handleRadius}
                width={handleRadius * 2}
                height={handleRadius * 2}
                fill={colors.anchorFill}
                stroke={colors.anchorStroke}
                strokeWidth={1.5}
                strokeScaleEnabled={false}
                draggable
                onDragMove={(event) => moveHandle(index, 'handleIn', event.target.position())}
                onDragEnd={finishDrag}
              />
            )}
            {geometry.kind === 'bezier' && node.handleOut && (
              <Rect
                x={node.handleOut.x - handleRadius}
                y={node.handleOut.y - handleRadius}
                width={handleRadius * 2}
                height={handleRadius * 2}
                fill={colors.anchorFill}
                stroke={colors.anchorStroke}
                strokeWidth={1.5}
                strokeScaleEnabled={false}
                draggable
                onDragMove={(event) => moveHandle(index, 'handleOut', event.target.position())}
                onDragEnd={finishDrag}
              />
            )}
            <Circle
              x={node.point.x}
              y={node.point.y}
              radius={anchorRadius}
              fill={colors.anchorFill}
              stroke={colors.anchorStroke}
              strokeWidth={2}
              strokeScaleEnabled={false}
              draggable
              onDragMove={(event) => moveNode(index, event.target.position())}
              onDragEnd={finishDrag}
            />
          </Group>
        ))}
    </Group>
  )
}

interface AreaShapeProps {
  measurement: AreaMeasurement
  selected: boolean
  scale: number
  colors: CanvasColors
  metersPerPixel: number | null
}

function AreaShape({ measurement, selected, scale, colors, metersPerPixel }: AreaShapeProps) {
  const measured = useMemo(() => {
    try {
      return measureSelection(measurement.geometry)
    } catch {
      return null
    }
  }, [measurement.geometry])

  const data = useMemo(
    () => (measured ? areaToPathData(measured.geometry) : areaToPathData(measurement.geometry)),
    [measured, measurement.geometry]
  )

  return (
    <Group measurementId={measurement.id} measurementType="area">
      <Path
        data={data}
        fill={colors.measureFill}
        stroke={selected ? colors.measureLine : colors.measureStroke}
        strokeWidth={selected ? 2.5 : 1.8}
        strokeScaleEnabled={false}
        fillRule="evenodd"
        hitStrokeWidth={Math.max(8 / scale, 4)}
      />
      {measured?.geometry.regions.map((region, index) => (
        <PointBubble
          key={index}
          point={regionLabelPoint(region)}
          text={formatArea(measured.regions[index]?.pixelArea ?? 0, metersPerPixel)}
          scale={scale}
          colors={colors}
        />
      ))}
    </Group>
  )
}

export interface MeasurementLayersProps {
  lines: LineMeasurement[]
  areas: AreaMeasurement[]
  selection: SelectionRef | null
  scale: number
  colors: CanvasColors
  metersPerPixel: number | null
  showSegments: boolean
  onCommitLine: (id: string, geometry: LineGeometry) => void
}

export function AreasLayer({ areas, selection, scale, colors, metersPerPixel }: MeasurementLayersProps) {
  return (
    <Layer>
      {areas.map((area) => (
        <AreaShape
          key={area.id}
          measurement={area}
          selected={selection?.type === 'area' && selection.id === area.id}
          scale={scale}
          colors={colors}
          metersPerPixel={metersPerPixel}
        />
      ))}
    </Layer>
  )
}

export function LinesLayer({ lines, selection, scale, colors, metersPerPixel, showSegments, onCommitLine }: MeasurementLayersProps) {
  return (
    <Layer>
      {lines.map((line) => (
        <LineShape
          key={line.id}
          measurement={line}
          selected={selection?.type === 'line' && selection.id === line.id}
          scale={scale}
          colors={colors}
          metersPerPixel={metersPerPixel}
          showSegments={showSegments}
          onCommit={onCommitLine}
        />
      ))}
    </Layer>
  )
}

export function findMeasurementRef(target: Konva.Node | null): SelectionRef | null {
  let node: Konva.Node | null = target
  while (node) {
    const attrs = node.attrs as { measurementId?: string; measurementType?: 'line' | 'area' }
    if (attrs.measurementId && attrs.measurementType) {
      return { type: attrs.measurementType, id: attrs.measurementId }
    }
    node = node.getParent()
  }
  return null
}
