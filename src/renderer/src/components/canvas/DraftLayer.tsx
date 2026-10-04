import { Circle, Layer, Line, Path } from 'react-konva'
import type { Point } from '../../../../shared/types'
import { lineToFlatPoints, areaToPathData } from '../../lib/geometryView'
import type { CanvasColors } from '../../hooks/useThemeColors'
import type { DraftState } from '../../store/appStore'

interface DraftLayerProps {
  draft: DraftState | null
  hover: Point | null
  scale: number
  colors: CanvasColors
  brushDiameter: number
  brushActive: boolean
}

function flat(points: Point[]): number[] {
  return points.flatMap((point) => [point.x, point.y])
}

function NodeDots({ points, colors, scale }: { points: Point[]; colors: CanvasColors; scale: number }) {
  return (
    <>
      {points.map((point, index) => (
        <Circle
          key={index}
          x={point.x}
          y={point.y}
          radius={4 / scale}
          fill={colors.draftLine}
          listening={false}
        />
      ))}
    </>
  )
}

/** 未完成的绘制草稿与工具光标预览。 */
export function DraftLayer({ draft, hover, scale, colors, brushDiameter, brushActive }: DraftLayerProps) {
  const strokeWidth = 2 / scale
  return (
    <Layer listening={false}>
      {draft?.kind === 'straight' && (
        <>
          <NodeDots points={[draft.first]} colors={colors} scale={scale} />
          {hover && (
            <Line
              points={[draft.first.x, draft.first.y, hover.x, hover.y]}
              stroke={colors.draftLine}
              strokeWidth={strokeWidth}
              dash={[6 / scale, 4 / scale]}
            />
          )}
        </>
      )}

      {draft?.kind === 'polyline' && (
        <>
          <Line points={flat(draft.nodes)} stroke={colors.draftLine} strokeWidth={strokeWidth} lineJoin="round" />
          {hover && draft.nodes.length > 0 && (
            <Line
              points={[
                draft.nodes[draft.nodes.length - 1].x,
                draft.nodes[draft.nodes.length - 1].y,
                hover.x,
                hover.y,
              ]}
              stroke={colors.draftLine}
              strokeWidth={strokeWidth}
              dash={[6 / scale, 4 / scale]}
            />
          )}
          <NodeDots points={draft.nodes} colors={colors} scale={scale} />
        </>
      )}

      {draft?.kind === 'freehand' && draft.points.length > 1 && (
        <Line
          points={flat(draft.points)}
          stroke={colors.draftLine}
          strokeWidth={strokeWidth}
          lineCap="round"
          lineJoin="round"
          tension={0.3}
        />
      )}

      {draft?.kind === 'bezier' && (
        <>
          {draft.nodes.length > 1 && (
            <Line
              points={lineToFlatPoints({ kind: 'bezier', nodes: draft.nodes })}
              stroke={colors.draftLine}
              strokeWidth={strokeWidth}
              lineCap="round"
            />
          )}
          {hover && draft.nodes.length > 0 && (
            <Line
              points={[
                draft.nodes[draft.nodes.length - 1].point.x,
                draft.nodes[draft.nodes.length - 1].point.y,
                hover.x,
                hover.y,
              ]}
              stroke={colors.draftLine}
              strokeWidth={strokeWidth}
              dash={[6 / scale, 4 / scale]}
            />
          )}
          {draft.nodes.map((node, index) => (
            <Circle key={index} x={node.point.x} y={node.point.y} radius={4 / scale} fill={colors.draftLine} />
          ))}
          {draft.nodes.map((node, index) =>
            node.handleOut ? (
              <Line
                key={`handle-${index}`}
                points={[node.point.x, node.point.y, node.handleOut.x, node.handleOut.y]}
                stroke={colors.draftLine}
                strokeWidth={1 / scale}
                dash={[3 / scale, 3 / scale]}
              />
            ) : null
          )}
        </>
      )}

      {draft?.kind === 'brush' && (
        <>
          {draft.geometry.regions.length > 0 && (
            <Path
              data={areaToPathData(draft.geometry)}
              fill={colors.measureFill}
              stroke={colors.measureStroke}
              strokeWidth={1.5 / scale}
              fillRule="evenodd"
            />
          )}
          {draft.stroke && draft.stroke.length > 0 && (
            <Line
              points={flat(draft.stroke)}
              stroke={draft.erase ? colors.erase : colors.measureStroke}
              strokeWidth={brushDiameter}
              lineCap="round"
              lineJoin="round"
              opacity={0.55}
            />
          )}
        </>
      )}

      {draft?.kind === 'lasso' && draft.points.length > 1 && (
        <Line
          points={hover ? [...flat(draft.points), hover.x, hover.y] : flat(draft.points)}
          stroke={colors.draftLine}
          strokeWidth={strokeWidth}
          lineJoin="round"
        />
      )}

      {draft?.kind === 'polygon' && (
        <>
          <Line points={flat(draft.nodes)} stroke={colors.draftLine} strokeWidth={strokeWidth} lineJoin="round" />
          {hover && draft.nodes.length > 0 && (
            <Line
              points={[
                draft.nodes[draft.nodes.length - 1].x,
                draft.nodes[draft.nodes.length - 1].y,
                hover.x,
                hover.y,
              ]}
              stroke={colors.draftLine}
              strokeWidth={strokeWidth}
              dash={[6 / scale, 4 / scale]}
            />
          )}
          {draft.nodes.length > 2 && hover && (
            <Line
              points={[hover.x, hover.y, draft.nodes[0].x, draft.nodes[0].y]}
              stroke={colors.draftLine}
              strokeWidth={1 / scale}
              dash={[3 / scale, 3 / scale]}
            />
          )}
          <NodeDots points={draft.nodes} colors={colors} scale={scale} />
        </>
      )}

      {brushActive && hover && (
        <Circle
          x={hover.x}
          y={hover.y}
          radius={brushDiameter / 2}
          stroke={draft?.kind === 'brush' && draft.erase ? colors.erase : colors.draftLine}
          strokeWidth={1.5 / scale}
          dash={draft?.kind === 'brush' && draft.erase ? [4 / scale, 4 / scale] : undefined}
        />
      )}
    </Layer>
  )
}
