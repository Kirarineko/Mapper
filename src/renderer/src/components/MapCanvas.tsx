import { useCallback, useEffect, useRef, useState } from 'react'
import { Stage } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { applyBrushStroke, lassoSelection } from '../../../shared/geometry'
import type { LineGeometry, PathNode, Point } from '../../../shared/types'
import { simplifyStroke } from '../lib/geometryView'
import { useAppStore } from '../store/appStore'
import { useCanvasColors } from '../hooks/useThemeColors'
import { TileLayer, type CanvasView } from './canvas/TileLayer'
import { AreasLayer, findMeasurementRef, LinesLayer } from './canvas/MeasurementLayers'
import { DraftLayer } from './canvas/DraftLayer'
import { CalibrationLayer } from './canvas/CalibrationLayer'
import { Bubble } from './md'
import { MdMenu } from './md'
import { IconDelete } from './icons'

const MIN_SCALE = 0.02
const MAX_SCALE = 64

export function MapCanvas() {
  const session = useAppStore((state) => state.session)
  const manifest = useAppStore((state) => state.manifest)
  const activeTool = useAppStore((state) => state.activeTool)
  const draft = useAppStore((state) => state.draft)
  const selection = useAppStore((state) => state.selection)
  const calibration = useAppStore((state) => state.calibration)
  const contextMenu = useAppStore((state) => state.contextMenu)
  const spacePanning = useAppStore((state) => state.spacePanning)
  const altErase = useAppStore((state) => state.altErase)
  const showSegments = useAppStore((state) => state.showSegments)

  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<CanvasView>({ x: 0, y: 0, scale: 1 })
  const [hover, setHover] = useState<Point | null>(null)
  const panRef = useRef<{ pointerX: number; pointerY: number; viewX: number; viewY: number } | null>(null)
  const bezierDragRef = useRef<{ index: number; moved: boolean } | null>(null)

  const colors = useCanvasColors()

  // 容器尺寸跟踪
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // 新地图加载后自动适配视野
  const mapId = session?.map.id ?? null
  useEffect(() => {
    if (!session || size.width === 0) return
    const { width: imageWidth, height: imageHeight } = session.image
    const scale = Math.min(size.width / imageWidth, size.height / imageHeight) * 0.96
    setView({
      x: (size.width - imageWidth * scale) / 2,
      y: (size.height - imageHeight * scale) / 2,
      scale,
    })
    // 仅在切换地图或容器首次就绪时适配
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, size.width > 0])

  const toImage = useCallback(
    (screenX: number, screenY: number): Point => ({
      x: (screenX - view.x) / view.scale,
      y: (screenY - view.y) / view.scale,
    }),
    [view]
  )

  const onWheel = useCallback(
    (event: KonvaEventObject<WheelEvent>) => {
      event.evt.preventDefault()
      const stage = event.target.getStage()
      const pointer = stage?.getPointerPosition()
      if (!pointer) return
      setView((current) => {
        const factor = Math.pow(1.0018, -event.evt.deltaY)
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor))
        const imagePoint = {
          x: (pointer.x - current.x) / current.scale,
          y: (pointer.y - current.y) / current.scale,
        }
        return {
          scale,
          x: pointer.x - imagePoint.x * scale,
          y: pointer.y - imagePoint.y * scale,
        }
      })
    },
    []
  )

  const pointerImage = (event: KonvaEventObject<MouseEvent>): Point | null => {
    const pointer = event.target.getStage()?.getPointerPosition()
    if (!pointer) return null
    return toImage(pointer.x, pointer.y)
  }

  const finishFreehand = useCallback(() => {
    const state = useAppStore.getState()
    if (state.draft?.kind !== 'freehand') return
    const points = simplifyStroke(state.draft.points, 1.5)
    if (points.length < 2) {
      state.setDraft(null)
      return
    }
    state.commitLine({ kind: 'freehand', nodes: points.map((point) => ({ point })) })
  }, [])

  const finishLasso = useCallback(() => {
    const state = useAppStore.getState()
    if (state.draft?.kind !== 'lasso' || !state.session) return
    const points = simplifyStroke(state.draft.points, 1.5)
    const bounds = { width: state.session.image.width, height: state.session.image.height }
    // 普通套索：松开后用直线连接首尾并计算
    state.commitAreas(lassoSelection(points, bounds))
  }, [])

  const finishBrushStroke = useCallback(() => {
    const state = useAppStore.getState()
    if (state.draft?.kind !== 'brush' || !state.draft.stroke || !state.session) return
    const { geometry, stroke, erase } = state.draft
    const bounds = { width: state.session.image.width, height: state.session.image.height }
    const diameter = state.session.config.settings.brushDiameter
    const points = simplifyStroke(stroke, Math.max(1, diameter / 16))
    try {
      const next = applyBrushStroke(geometry, points, diameter, bounds, erase ? 'erase' : 'add')
      state.setDraft({ kind: 'brush', geometry: next, stroke: null, erase })
    } catch {
      state.setDraft({ kind: 'brush', geometry, stroke: null, erase })
      useAppStore.setState({ statusMessage: '该笔画过于复杂，已舍弃；请分多次涂抹。' })
    }
  }, [])

  // 指针在窗口任意位置松开都要结束当前笔画
  useEffect(() => {
    const listener = () => {
      panRef.current = null
      bezierDragRef.current = null
      finishFreehand()
      finishLasso()
      finishBrushStroke()
    }
    window.addEventListener('mouseup', listener)
    return () => window.removeEventListener('mouseup', listener)
  }, [finishFreehand, finishLasso, finishBrushStroke])

  const onMouseDown = (event: KonvaEventObject<MouseEvent>) => {
    const state = useAppStore.getState()
    containerRef.current?.focus()

    if (event.evt.button === 1 || (event.evt.button === 0 && state.spacePanning)) {
      event.evt.preventDefault()
      const pointer = event.target.getStage()?.getPointerPosition()
      if (pointer) panRef.current = { pointerX: pointer.x, pointerY: pointer.y, viewX: view.x, viewY: view.y }
      return
    }
    if (event.evt.button !== 0) return

    // 命中线测量时不绘制（交由选中、拖动与右键菜单处理）；
    // 面测量不阻挡——画笔、套索等工具必须能在已有区域上继续作业
    const hit = findMeasurementRef(event.target)
    if (hit && hit.type === 'line') return

    const point = pointerImage(event)
    if (!point || !state.session) return

    // 图上标定模式
    if (state.calibration.mode === 'placing') {
      if (state.calibration.points.length < 2) {
        state.setCalibration({ mode: 'placing', points: [...state.calibration.points, point] })
      }
      return
    }

    state.setSelection(null)

    switch (state.activeTool) {
      case 'straight':
        if (state.draft?.kind === 'straight') {
          const geometry: LineGeometry = {
            kind: 'straight',
            nodes: [{ point: state.draft.first }, { point }],
          }
          state.commitLine(geometry)
        } else {
          state.setDraft({ kind: 'straight', first: point })
        }
        break
      case 'polyline': {
        const nodes = state.draft?.kind === 'polyline' ? [...state.draft.nodes, point] : [point]
        state.setDraft({ kind: 'polyline', nodes })
        break
      }
      case 'freehand':
        state.setDraft({ kind: 'freehand', points: [point] })
        break
      case 'bezier': {
        const nodes: PathNode[] =
          state.draft?.kind === 'bezier' ? [...state.draft.nodes, { point }] : [{ point }]
        state.setDraft({ kind: 'bezier', nodes })
        bezierDragRef.current = { index: nodes.length - 1, moved: false }
        break
      }
      case 'brush': {
        const geometry = state.draft?.kind === 'brush' ? state.draft.geometry : { regions: [] }
        state.setDraft({ kind: 'brush', geometry, stroke: [point], erase: state.altErase })
        break
      }
      case 'lasso':
        state.setDraft({ kind: 'lasso', points: [point] })
        break
      case 'polygon': {
        const nodes = state.draft?.kind === 'polygon' ? [...state.draft.nodes, point] : [point]
        state.setDraft({ kind: 'polygon', nodes })
        break
      }
    }
  }

  const onMouseMove = (event: KonvaEventObject<MouseEvent>) => {
    const state = useAppStore.getState()
    const pointer = event.target.getStage()?.getPointerPosition()
    if (!pointer) return

    if (panRef.current) {
      const pan = panRef.current
      setView((current) => ({
        ...current,
        x: pan.viewX + (pointer.x - pan.pointerX),
        y: pan.viewY + (pointer.y - pan.pointerY),
      }))
      return
    }

    const point = toImage(pointer.x, pointer.y)
    setHover(point)

    // 贝塞尔：点击并拖动生成对称方向手柄
    const bezierDrag = bezierDragRef.current
    if (bezierDrag && state.draft?.kind === 'bezier') {
      const node = state.draft.nodes[bezierDrag.index]
      if (node) {
        const distance = Math.hypot(point.x - node.point.x, point.y - node.point.y)
        if (bezierDrag.moved || distance > 3 / view.scale) {
          bezierDrag.moved = true
          const nodes = state.draft.nodes.map((item, index): PathNode =>
            index === bezierDrag.index
              ? {
                  point: item.point,
                  handleOut: { ...point },
                  handleIn: { x: 2 * item.point.x - point.x, y: 2 * item.point.y - point.y },
                }
              : item
          )
          state.setDraft({ kind: 'bezier', nodes })
        }
      }
      return
    }

    if (state.draft?.kind === 'freehand') {
      const points = state.draft.points
      const last = points[points.length - 1]
      if (Math.hypot(point.x - last.x, point.y - last.y) > 1.5 / view.scale) {
        state.setDraft({ kind: 'freehand', points: [...points, point] })
      }
    } else if (state.draft?.kind === 'lasso') {
      const points = state.draft.points
      const last = points[points.length - 1]
      if (Math.hypot(point.x - last.x, point.y - last.y) > 1.5 / view.scale) {
        state.setDraft({ kind: 'lasso', points: [...points, point] })
      }
    } else if (state.draft?.kind === 'brush' && state.draft.stroke) {
      const stroke = state.draft.stroke
      const last = stroke[stroke.length - 1]
      if (Math.hypot(point.x - last.x, point.y - last.y) > 1.5 / view.scale) {
        state.setDraft({ ...state.draft, stroke: [...stroke, point] })
      }
    }
  }

  const onMouseUp = (event: KonvaEventObject<MouseEvent>) => {
    if (event.evt.button === 1 || panRef.current) {
      panRef.current = null
      return
    }
    bezierDragRef.current = null
    finishFreehand()
    finishLasso()
    finishBrushStroke()
  }

  const onClick = (event: KonvaEventObject<MouseEvent>) => {
    if (event.evt.button !== 0) return
    const state = useAppStore.getState()
    const ref = findMeasurementRef(event.target)
    // 左键选中限线工具下的线测量；面测量通过右键菜单选中（避免套索收尾误选）
    if (ref && ref.type === 'line' && !state.draft) {
      event.cancelBubble = true
      state.setSelection(ref)
    }
  }

  const onContextMenu = (event: KonvaEventObject<MouseEvent>) => {
    event.evt.preventDefault()
    const state = useAppStore.getState()
    const pointer = event.target.getStage()?.getPointerPosition()
    if (!pointer) return
    const ref = findMeasurementRef(event.target)
    // 右键已有线或区域优先显示对象菜单；画笔模式下提供粗细滑块
    if (ref) {
      state.setContextMenu({ x: pointer.x, y: pointer.y, target: ref })
      state.setSelection(ref)
    } else if (state.activeTool === 'brush') {
      state.setContextMenu({ x: pointer.x, y: pointer.y, target: null })
    }
  }

  const moveCalibrationPoint = useCallback((index: number, point: Point) => {
    const state = useAppStore.getState()
    if (state.calibration.mode !== 'placing' && state.calibration.mode !== 'input') return
    const points = [...state.calibration.points]
    points[index] = point
    if (state.calibration.mode === 'placing') {
      state.setCalibration({ mode: 'placing', points })
    } else if (points.length === 2) {
      state.setCalibration({ mode: 'input', points: [points[0], points[1]] })
    }
  }, [])

  const brushDiameter = session?.config.settings.brushDiameter ?? 64
  const metersPerPixel = session?.config.metersPerPixel ?? null

  const cursor = spacePanning
    ? panRef.current
      ? 'grabbing'
      : 'grab'
    : activeTool === 'brush'
      ? 'none'
      : 'crosshair'

  return (
    <div
      id="map-canvas"
      ref={containerRef}
      tabIndex={0}
      className="relative h-full w-full overflow-hidden bg-surface-dim outline-none"
      style={{ cursor }}
      onMouseLeave={() => setHover(null)}
    >
      {session && size.width > 0 && (
        <Stage
          width={size.width}
          height={size.height}
          x={view.x}
          y={view.y}
          scaleX={view.scale}
          scaleY={view.scale}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onClick={onClick}
          onContextMenu={onContextMenu}
        >
          {manifest && <TileLayer manifest={manifest} view={view} width={size.width} height={size.height} />}
          <AreasLayer
            lines={session.lines.measurements}
            areas={session.areas.measurements}
            selection={selection}
            scale={view.scale}
            colors={colors}
            metersPerPixel={metersPerPixel}
            showSegments={showSegments}
            onCommitLine={useAppStore.getState().updateLineGeometry}
          />
          <LinesLayer
            lines={session.lines.measurements}
            areas={session.areas.measurements}
            selection={selection}
            scale={view.scale}
            colors={colors}
            metersPerPixel={metersPerPixel}
            showSegments={showSegments}
            onCommitLine={useAppStore.getState().updateLineGeometry}
          />
          <DraftLayer
            draft={draft}
            hover={hover}
            scale={view.scale}
            colors={colors}
            brushDiameter={brushDiameter}
            brushActive={activeTool === 'brush'}
          />
          <CalibrationLayer
            calibration={calibration}
            hover={hover}
            scale={view.scale}
            colors={colors}
            onMovePoint={moveCalibrationPoint}
          />
        </Stage>
      )}

      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => useAppStore.getState().setContextMenu(null)}
        />
      )}
    </div>
  )
}

function CanvasContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const contextMenu = useAppStore((state) => state.contextMenu)
  const deleteMeasurement = useAppStore((state) => state.deleteMeasurement)
  const brushDiameter = useAppStore((state) => state.session?.config.settings.brushDiameter ?? 64)
  const updateSettings = useAppStore((state) => state.updateSettings)

  if (!contextMenu) return null
  return (
    <Bubble
      className="!p-0"
      style={{ left: x, top: y, position: 'absolute' }}
      onDismiss={onClose}
    >
      {contextMenu.target ? (
        <MdMenu
          items={[
            {
              key: 'delete',
              label: '删除',
              icon: <IconDelete width={18} height={18} />,
              danger: true,
              onSelect: () => deleteMeasurement(contextMenu.target!),
            },
          ]}
        />
      ) : (
        <div className="flex w-64 flex-col gap-2 p-4">
          <div className="md3-label-medium text-on-surface-variant">画笔直径（原图像素）</div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={4}
              max={512}
              step={1}
              value={brushDiameter}
              onChange={(event) => updateSettings({ brushDiameter: Math.round(Number(event.target.value)) })}
              className="md3-slider flex-1"
            />
            <span className="md3-body-medium w-12 text-right text-on-surface">{brushDiameter}px</span>
          </div>
        </div>
      )}
    </Bubble>
  )
}
