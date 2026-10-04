import { useState, type FormEvent } from 'react'
import { calibrateScale } from '../../../shared/geometry'
import { formatNumber, formatScale } from '../lib/format'
import { AREA_TOOLS, LINE_TOOLS, TOOL_NAMES, toolGroup, useAppStore, type ToolId } from '../store/appStore'
import { Bubble, MdButton, MdIconButton, MdMenu, MdSegmented } from './md'
import {
  IconBezier,
  IconBrush,
  IconFolder,
  IconFreehand,
  IconLasso,
  IconMap,
  IconPolygon,
  IconPolyline,
  IconRedo,
  IconRuler,
  IconSettings,
  IconStraight,
  IconUndo,
} from './icons'

const TOOL_HINTS: Record<ToolId, string> = {
  straight: '点击放置两个端点，第二次点击完成',
  polyline: '按顺序点击放点，Enter 完成',
  freehand: '按住左键自由画线，松开完成',
  bezier: '点击放节点，点击并拖动生成方向手柄，Enter 完成',
  brush: '按住左键涂抹，Alt 擦除，Enter 完成；右键调整画笔粗细',
  lasso: '按住左键圈选，松开自动闭合并计算',
  polygon: '按顺序点击放点，Enter 自动闭合并计算',
}

export const TOOL_ICONS: Record<ToolId, typeof IconStraight> = {
  straight: IconStraight,
  polyline: IconPolyline,
  freehand: IconFreehand,
  bezier: IconBezier,
  brush: IconBrush,
  lasso: IconLasso,
  polygon: IconPolygon,
}

export function TopBar() {
  const world = useAppStore((state) => state.world)
  const maps = useAppStore((state) => state.maps)
  const session = useAppStore((state) => state.session)
  const activeTool = useAppStore((state) => state.activeTool)
  const saving = useAppStore((state) => state.saving)
  const dirty = useAppStore((state) => state.dirty)
  const historyIndex = useAppStore((state) => state.historyIndex)
  const historyLength = useAppStore((state) => state.history.length)
  const chooseWorld = useAppStore((state) => state.chooseWorld)
  const selectMap = useAppStore((state) => state.selectMap)
  const undo = useAppStore((state) => state.undo)
  const redo = useAppStore((state) => state.redo)
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen)
  const calibration = useAppStore((state) => state.calibration)
  const setCalibration = useAppStore((state) => state.setCalibration)

  const [mapMenuOpen, setMapMenuOpen] = useState(false)

  const scale = session?.config.metersPerPixel ?? null
  const scaleText = session ? (formatScale(scale) ?? '未标定，显示像素单位') : ''
  const ToolIcon = TOOL_ICONS[activeTool]

  return (
    <header className="flex shrink-0 flex-col border-b border-outline-variant bg-surface-container">
      {/* 第一行：世界观目录、地图选择、设置 */}
      <div className="flex h-14 items-center gap-2 px-3">
        <MdButton variant="tonal" onClick={() => void chooseWorld()} className="!h-9">
          <IconFolder width={18} height={18} />
          {world ? world.name : '选择世界观目录'}
        </MdButton>

        <div className="relative">
          <MdButton
            variant="outlined"
            className="!h-9"
            disabled={!world || maps.length === 0}
            onClick={() => setMapMenuOpen((open) => !open)}
          >
            <IconMap width={18} height={18} />
            {session ? session.map.name : '选择地图'}
          </MdButton>
          {mapMenuOpen && (
            <Bubble className="left-0 top-12 !p-0" onDismiss={() => setMapMenuOpen(false)}>
              <div className="max-h-80 overflow-auto">
                <MdMenu
                  items={maps.map((map) => ({
                    key: map.id,
                    label: map.relativePath,
                    onSelect: () => {
                      setMapMenuOpen(false)
                      void selectMap(map.id)
                    },
                  }))}
                />
              </div>
            </Bubble>
          )}
        </div>

        <div className="flex-1" />

        <span className="md3-body-small text-on-surface-variant" role="status">
          {saving ? '保存中…' : dirty.length > 0 ? '有未保存的修改' : session ? '已保存' : ''}
        </span>
        <MdIconButton label="设置" onClick={() => setSettingsOpen(true)}>
          <IconSettings />
        </MdIconButton>
      </div>

      {/* 第二行：当前工具选项与标定 */}
      <div className="relative flex h-12 items-center gap-3 border-t border-outline-variant px-3">
        <span className="flex items-center gap-2 text-on-surface">
          <ToolIcon width={18} height={18} />
          <span className="md3-title-small">{TOOL_NAMES[activeTool]}</span>
        </span>
        <span className="md3-body-small text-on-surface-variant">{TOOL_HINTS[activeTool]}</span>

        <div className="flex-1" />

        <span className="md3-body-medium text-on-surface-variant">{scaleText}</span>
        <div className="relative">
          <MdButton
            variant="tonal"
            className="!h-9"
            disabled={!session}
            onClick={() =>
              setCalibration(calibration.mode === 'bubble' ? { mode: 'closed' } : { mode: 'bubble' })
            }
          >
            <IconRuler width={18} height={18} />
            标定
          </MdButton>
          {calibration.mode === 'bubble' && <CalibrationBubble />}
        </div>

        <MdIconButton label="撤销 (Ctrl+Z)" disabled={historyIndex <= 0} onClick={undo}>
          <IconUndo />
        </MdIconButton>
        <MdIconButton label="重做 (Ctrl+Shift+Z)" disabled={historyIndex >= historyLength - 1} onClick={redo}>
          <IconRedo />
        </MdIconButton>
      </div>
    </header>
  )
}

function CalibrationBubble() {
  const setCalibration = useAppStore((state) => state.setCalibration)
  const applyScale = useAppStore((state) => state.applyScale)

  const [pixels, setPixels] = useState('')
  const [distance, setDistance] = useState('')
  const [unit, setUnit] = useState<'m' | 'km'>('m')
  const [error, setError] = useState<string | null>(null)

  const confirm = (event: FormEvent) => {
    event.preventDefault()
    const parsedPixels = Number(pixels)
    const parsedDistance = Number(distance)
    try {
      if (!Number.isFinite(parsedPixels) || parsedPixels <= 0) throw new Error('图上像素必须为正数')
      if (!Number.isFinite(parsedDistance) || parsedDistance <= 0) throw new Error('实际距离必须为正数')
      const scale = calibrateScale(parsedPixels, parsedDistance, unit)
      applyScale(scale)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <Bubble className="right-0 top-12 w-80" onDismiss={() => setCalibration({ mode: 'closed' })}>
      <form onSubmit={confirm} className="flex flex-col gap-3">
        <div className="md3-title-small">设置比例尺</div>
        <label className="md3-label-medium flex flex-col gap-1 text-on-surface-variant">
          图上像素
          <input
            className="md3-field"
            type="number"
            min="0"
            step="any"
            value={pixels}
            onChange={(event) => setPixels(event.target.value)}
            placeholder="例如 128（取整后计算）"
            autoFocus
          />
        </label>
        <label className="md3-label-medium flex flex-col gap-1 text-on-surface-variant">
          实际距离
          <div className="flex items-center gap-2">
            <input
              className="md3-field flex-1"
              type="number"
              min="0"
              step="any"
              value={distance}
              onChange={(event) => setDistance(event.target.value)}
              placeholder="例如 1024"
            />
            <MdSegmented
              options={[
                { value: 'm' as const, label: 'm' },
                { value: 'km' as const, label: 'km' },
              ]}
              value={unit}
              onChange={setUnit}
            />
          </div>
        </label>
        {error && <div className="md3-body-small text-error">{error}</div>}
        <div className="mt-1 flex items-center justify-between">
          <MdButton
            type="button"
            variant="text"
            onClick={() => setCalibration({ mode: 'placing', points: [] })}
          >
            图上标定
          </MdButton>
          <MdButton type="submit">确认</MdButton>
        </div>
      </form>
    </Bubble>
  )
}

export function ScalePreview({ metersPerPixel }: { metersPerPixel: number | null }) {
  if (metersPerPixel === null) return null
  return <span>{formatNumber(metersPerPixel)} 米/像素</span>
}

export { AREA_TOOLS, LINE_TOOLS, toolGroup }
