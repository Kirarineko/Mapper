import { Circle, Group, Layer, Line } from 'react-konva'
import type { Point } from '../../../../shared/types'
import { roundedPixelDistance } from '../../lib/geometryView'
import type { CanvasColors } from '../../hooks/useThemeColors'
import type { CalibrationState } from '../../store/appStore'
import { PointBubble } from './MeasurementLayers'

interface CalibrationLayerProps {
  calibration: CalibrationState
  hover: Point | null
  scale: number
  colors: CanvasColors
  onMovePoint: (index: number, point: Point) => void
}

/** 图上标定：两个可拖动点位、连线与取整像素距离。 */
export function CalibrationLayer({ calibration, hover, scale, colors, onMovePoint }: CalibrationLayerProps) {
  if (calibration.mode !== 'placing' && calibration.mode !== 'input') return null
  const points = calibration.points
  const first = points[0] ?? null
  const second = points[1] ?? null
  const previewEnd = second ?? (first ? hover : null)

  return (
    <Layer>
      {first && previewEnd && (
        <Line
          points={[first.x, first.y, previewEnd.x, previewEnd.y]}
          stroke={colors.calibration}
          strokeWidth={2}
          strokeScaleEnabled={false}
          dash={second ? undefined : [8 / scale, 5 / scale]}
          listening={false}
        />
      )}
      {second && first && (
        <Group listening={false}>
          <PointBubble
            point={{ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }}
            text={`${roundedPixelDistance(first, second)} px（Enter 输入实际距离）`}
            scale={scale}
            colors={colors}
          />
        </Group>
      )}
      {points.map((point, index) => (
        <Circle
          key={index}
          x={point.x}
          y={point.y}
          radius={7 / scale}
          fill={colors.anchorFill}
          stroke={colors.calibration}
          strokeWidth={2.5}
          strokeScaleEnabled={false}
          draggable
          onDragMove={(event) => onMovePoint(index, event.target.position())}
        />
      ))}
      {!first && hover && (
        <Circle
          x={hover.x}
          y={hover.y}
          radius={7 / scale}
          stroke={colors.calibration}
          strokeWidth={1.5}
          strokeScaleEnabled={false}
          opacity={0.6}
          listening={false}
        />
      )}
    </Layer>
  )
}
