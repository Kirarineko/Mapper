import { create } from 'zustand'
import { measureSelection, validateAreaGeometry, validateLineGeometry } from '../../../shared/geometry'
import type {
  AreaDocument,
  AreaGeometry,
  AreaMeasurement,
  BackendError,
  ConfigDocument,
  FeatureKind,
  ImageIdentity,
  LineDocument,
  LineGeometry,
  LineMeasurement,
  MapDescriptor,
  PathNode,
  Point,
  TileManifest,
  TileProgress,
  WorldSummary,
} from '../../../shared/types'
import { FORMAT_VERSION } from '../../../shared/types'
import { api, ApiError } from '../lib/api'

export type LineToolId = 'straight' | 'polyline' | 'freehand' | 'bezier'
export type AreaToolId = 'brush' | 'lasso' | 'polygon'
export type ToolId = LineToolId | AreaToolId

export const LINE_TOOLS: LineToolId[] = ['straight', 'polyline', 'freehand', 'bezier']
export const AREA_TOOLS: AreaToolId[] = ['brush', 'lasso', 'polygon']

export const TOOL_NAMES: Record<ToolId, string> = {
  straight: '直线',
  polyline: '折线',
  freehand: '自由画笔',
  bezier: '贝塞尔曲线',
  brush: '选区画笔',
  lasso: '普通套索',
  polygon: '多边形套索',
}

export function toolGroup(tool: ToolId): 'line' | 'area' {
  return (LINE_TOOLS as ToolId[]).includes(tool) ? 'line' : 'area'
}

export type DraftState =
  | { kind: 'straight'; first: Point }
  | { kind: 'polyline'; nodes: Point[] }
  | { kind: 'freehand'; points: Point[] }
  | { kind: 'bezier'; nodes: PathNode[] }
  | { kind: 'brush'; geometry: AreaGeometry; stroke: Point[] | null; erase: boolean }
  | { kind: 'lasso'; points: Point[] }
  | { kind: 'polygon'; nodes: Point[] }

export type CalibrationState =
  | { mode: 'closed' }
  | { mode: 'bubble' }
  | { mode: 'placing'; points: Point[] }
  | { mode: 'input'; points: [Point, Point] }

export interface SelectionRef {
  type: 'line' | 'area'
  id: string
}

export interface ContextMenuState {
  /** 屏幕坐标（相对于画布容器） */
  x: number
  y: number
  target: SelectionRef | null
}

export interface SaveIssue {
  feature: FeatureKind
  code: string
  message: string
}

interface Snapshot {
  lines: LineMeasurement[]
  areas: AreaMeasurement[]
}

interface MapSession {
  map: MapDescriptor
  image: ImageIdentity
  config: ConfigDocument
  lines: LineDocument
  areas: AreaDocument
  revisions: Record<FeatureKind, string | null>
  corrupt: Partial<Record<FeatureKind, { backupAvailable: boolean }>>
  imageChanged: Partial<Record<FeatureKind, boolean>>
  warnings: BackendError[]
}

export interface AppState {
  world: WorldSummary | null
  maps: MapDescriptor[]
  session: MapSession | null
  manifest: TileManifest | null
  tileProgress: TileProgress | null
  loadingMessage: string | null

  activeTool: ToolId
  draft: DraftState | null
  selection: SelectionRef | null
  calibration: CalibrationState
  contextMenu: ContextMenuState | null
  settingsOpen: boolean

  /** 临时显示全部分段距离（Ctrl+A） */
  showSegments: boolean
  /** 空格平移模式 */
  spacePanning: boolean
  /** 画笔擦除模式（Alt） */
  altErase: boolean

  dirty: FeatureKind[]
  saving: boolean
  savedTick: number
  saveIssue: SaveIssue | null
  acceptImageChange: boolean

  history: Snapshot[]
  historyIndex: number

  closingDialog: 'idle' | 'saving' | 'failed'
  closingMessage: string | null

  statusMessage: string | null

  chooseWorld: () => Promise<void>
  selectMap: (mapId: string) => Promise<void>
  reloadMaps: () => Promise<void>

  setTool: (tool: ToolId) => void
  setDraft: (draft: DraftState | null) => void
  cancelDraft: () => void
  setSelection: (selection: SelectionRef | null) => void
  setCalibration: (calibration: CalibrationState) => void
  setContextMenu: (menu: ContextMenuState | null) => void
  setSettingsOpen: (open: boolean) => void
  setShowSegments: (show: boolean) => void
  setSpacePanning: (panning: boolean) => void
  setAltErase: (erase: boolean) => void
  dismissStatus: () => void

  commitLine: (geometry: LineGeometry) => void
  commitAreas: (geometry: AreaGeometry) => void
  deleteMeasurement: (target: SelectionRef) => void
  updateLineGeometry: (id: string, geometry: LineGeometry) => void

  undo: () => void
  redo: () => void

  applyScale: (metersPerPixel: number) => void
  updateSettings: (settings: Partial<ConfigDocument['settings']>) => void

  flushNow: () => Promise<void>
  retrySave: () => void
  dismissSaveIssue: () => void
  confirmImageChange: () => void
  recoverFeature: (feature: FeatureKind) => Promise<void>

  handleCloseRequest: () => Promise<void>
  cancelClose: () => void
}

function emptyConfig(image: ImageIdentity): ConfigDocument {
  return {
    version: FORMAT_VERSION,
    image: { ...image },
    metersPerPixel: null,
    settings: { showSegmentLengths: true, brushDiameter: 64 },
  }
}

function emptyLines(image: ImageIdentity): LineDocument {
  return { version: FORMAT_VERSION, image: { ...image }, measurements: [] }
}

function emptyAreas(image: ImageIdentity): AreaDocument {
  return { version: FORMAT_VERSION, image: { ...image }, measurements: [] }
}

function nowIso(): string {
  return new Date().toISOString()
}

function newId(): string {
  return crypto.randomUUID()
}

/** 保存链：串行执行，读取执行时刻的最新文档，避免修订号竞争。 */
let saveChain: Promise<void> = Promise.resolve()

export const useAppStore = create<AppState>((set, get) => {
  function snapshotOf(session: MapSession): Snapshot {
    return {
      lines: session.lines.measurements,
      areas: session.areas.measurements,
    }
  }

  function pushHistory(next: Snapshot): Pick<AppState, 'history' | 'historyIndex'> {
    const { history, historyIndex } = get()
    const trimmed = history.slice(0, historyIndex + 1)
    trimmed.push(next)
    if (trimmed.length > 100) trimmed.shift()
    return { history: trimmed, historyIndex: trimmed.length - 1 }
  }

  function mutateSession(recipe: (session: MapSession) => Partial<MapSession>): void {
    set((state) => {
      if (!state.session) return state
      return { session: { ...state.session, ...recipe(state.session) } }
    })
  }

  function markDirty(feature: FeatureKind): void {
    set((state) => (state.dirty.includes(feature) ? state : { dirty: [...state.dirty, feature] }))
    enqueueSave(feature)
  }

  function enqueueSave(feature: FeatureKind): void {
    saveChain = saveChain.then(() => performSave(feature)).catch(() => undefined)
  }

  async function performSave(feature: FeatureKind): Promise<void> {
    const { session, acceptImageChange } = get()
    if (!session) return
    if (session.corrupt[feature]) return // 损坏文件绝不自动覆盖
    const document = session[feature]
    set({ saving: true })
    try {
      const response = await api.saveFeature({
        mapId: session.map.id,
        feature,
        document,
        expectedRevision: session.revisions[feature],
        acceptImageChange: acceptImageChange || undefined,
      } as Parameters<typeof api.saveFeature>[0])
      set((state) => {
        if (!state.session) return state
        const imageChanged = { ...state.session.imageChanged }
        delete imageChanged[feature]
        return {
          saving: false,
          dirty: state.dirty.filter((item) => item !== feature),
          savedTick: state.savedTick + 1,
          saveIssue: state.saveIssue?.feature === feature ? null : state.saveIssue,
          session: {
            ...state.session,
            revisions: { ...state.session.revisions, [feature]: response.revision },
            imageChanged,
          },
        }
      })
    } catch (error) {
      const issue: SaveIssue =
        error instanceof ApiError
          ? { feature, code: error.code, message: error.message }
          : { feature, code: 'IO_ERROR', message: error instanceof Error ? error.message : String(error) }
      set({ saving: false, saveIssue: issue })
      throw error
    }
  }

  function lineName(index: number): string {
    return `线测量 ${index + 1}`
  }

  function areaName(index: number): string {
    return `区域 ${index + 1}`
  }

  return {
    world: null,
    maps: [],
    session: null,
    manifest: null,
    tileProgress: null,
    loadingMessage: null,

    activeTool: 'straight',
    draft: null,
    selection: null,
    calibration: { mode: 'closed' },
    contextMenu: null,
    settingsOpen: false,

    showSegments: false,
    spacePanning: false,
    altErase: false,

    dirty: [],
    saving: false,
    savedTick: 0,
    saveIssue: null,
    acceptImageChange: false,

    history: [],
    historyIndex: -1,

    closingDialog: 'idle',
    closingMessage: null,
    statusMessage: null,

    async chooseWorld() {
      try {
        const world = await api.chooseWorld()
        if (!world) return
        set({ world, maps: world.maps, session: null, manifest: null, draft: null, selection: null })
        if (world.maps.length > 0) await get().selectMap(world.maps[0].id)
        else set({ statusMessage: '所选目录中没有可用的地图（支持 PNG / JPEG / WebP）。' })
      } catch (error) {
        set({ statusMessage: error instanceof Error ? error.message : String(error) })
      }
    },

    async reloadMaps() {
      try {
        const maps = await api.listMaps()
        set({ maps })
      } catch (error) {
        set({ statusMessage: error instanceof Error ? error.message : String(error) })
      }
    },

    async selectMap(mapId) {
      const state = get()
      if (state.session?.map.id === mapId) return
      // 切换地图前确保已完成操作落盘；失败时由用户决定重试或取消离开
      if (state.session && state.dirty.length > 0) {
        try {
          await get().flushNow()
        } catch {
          return // saveIssue 对话框会提示用户
        }
      }
      set({ loadingMessage: '正在加载地图…', session: null, manifest: null, draft: null, selection: null, calibration: { mode: 'closed' } })
      try {
        const result = await api.loadMap(mapId)
        const { image } = result
        const corrupt: MapSession['corrupt'] = {}
        const imageChanged: MapSession['imageChanged'] = {}
        const revisions: Record<FeatureKind, string | null> = { config: null, lines: null, areas: null }
        const session: MapSession = {
          map: result.map,
          image,
          config: emptyConfig(image),
          lines: emptyLines(image),
          areas: emptyAreas(image),
          revisions,
          corrupt,
          imageChanged,
          warnings: result.warnings,
        }
        for (const feature of ['config', 'lines', 'areas'] as FeatureKind[]) {
          const read = result.features[feature]
          revisions[feature] = read.revision
          if (read.status === 'ok' && read.document) {
            if (feature === 'config') session.config = read.document as ConfigDocument
            else if (feature === 'lines') session.lines = read.document as LineDocument
            else session.areas = read.document as AreaDocument
          }
          if (read.status === 'corrupt') corrupt[feature] = { backupAvailable: read.backupAvailable }
          if (read.imageChanged) imageChanged[feature] = true
        }
        const initial = snapshotOf(session)
        set({
          session,
          loadingMessage: null,
          history: [initial],
          historyIndex: 0,
          dirty: [],
          acceptImageChange: false,
          saveIssue: null,
        })
        // 后台准备切片
        set({ tileProgress: { mapId, phase: 'preview', completed: 0, total: 1 } })
        try {
          const manifest = await api.prepareTiles(mapId)
          set((current) => (current.session?.map.id === mapId ? { manifest, tileProgress: null } : current))
        } catch (error) {
          set((current) =>
            current.session?.map.id === mapId
              ? {
                  tileProgress: null,
                  statusMessage: `切片准备失败：${error instanceof Error ? error.message : String(error)}`,
                }
              : current
          )
        }
      } catch (error) {
        set({
          loadingMessage: null,
          statusMessage: `地图加载失败：${error instanceof Error ? error.message : String(error)}`,
        })
      }
    },

    setTool(tool) {
      set({ activeTool: tool, draft: null, selection: null, contextMenu: null })
    },
    setDraft(draft) {
      set({ draft })
    },
    cancelDraft() {
      set({ draft: null, calibration: { mode: 'closed' } })
    },
    setSelection(selection) {
      set({ selection })
    },
    setCalibration(calibration) {
      set({ calibration })
    },
    setContextMenu(contextMenu) {
      set({ contextMenu })
    },
    setSettingsOpen(settingsOpen) {
      set({ settingsOpen })
    },
    setShowSegments(showSegments) {
      set({ showSegments })
    },
    setSpacePanning(spacePanning) {
      set({ spacePanning })
    },
    setAltErase(altErase) {
      set({ altErase })
    },
    dismissStatus() {
      set({ statusMessage: null })
    },

    commitLine(geometry) {
      const { session } = get()
      if (!session) return
      try {
        validateLineGeometry(geometry, { width: session.image.width, height: session.image.height })
      } catch {
        set({ draft: null, statusMessage: '线条为空或超出地图范围，未保存。' })
        return
      }
      const timestamp = nowIso()
      const measurement: LineMeasurement = {
        id: newId(),
        name: lineName(session.lines.measurements.length),
        createdAt: timestamp,
        updatedAt: timestamp,
        geometry,
      }
      const lines = [...session.lines.measurements, measurement]
      mutateSession((current) => ({ lines: { ...current.lines, measurements: lines } }))
      const after = snapshotOf(get().session!)
      set(pushHistory(after))
      set({ draft: null, selection: { type: 'line', id: measurement.id } })
      markDirty('lines')
    },

    commitAreas(geometry) {
      const { session } = get()
      if (!session) return
      const bounds = { width: session.image.width, height: session.image.height }
      let measurements: AreaMeasurement[] = []
      try {
        const measured = measureSelection(geometry)
        const timestamp = nowIso()
        let index = session.areas.measurements.length
        for (const region of measured.geometry.regions) {
          const single: AreaGeometry = { regions: [region] }
          validateAreaGeometry(single, bounds)
          measurements.push({
            id: newId(),
            name: areaName(index++),
            createdAt: timestamp,
            updatedAt: timestamp,
            geometry: single,
          })
        }
      } catch {
        set({ draft: null, statusMessage: '选区为空或退化，未保存。' })
        return
      }
      if (measurements.length === 0) {
        set({ draft: null, statusMessage: '选区为空，未保存。' })
        return
      }
      const areas = [...session.areas.measurements, ...measurements]
      mutateSession((current) => ({ areas: { ...current.areas, measurements: areas } }))
      const after = snapshotOf(get().session!)
      set(pushHistory(after))
      set({ draft: null, selection: null })
      markDirty('areas')
    },

    deleteMeasurement(target) {
      const { session } = get()
      if (!session) return
      if (target.type === 'line') {
        const lines = session.lines.measurements.filter((item) => item.id !== target.id)
        if (lines.length === session.lines.measurements.length) return
        mutateSession((current) => ({ lines: { ...current.lines, measurements: lines } }))
        set(pushHistory(snapshotOf(get().session!)))
        set({ selection: null, contextMenu: null })
        markDirty('lines')
      } else {
        const areas = session.areas.measurements.filter((item) => item.id !== target.id)
        if (areas.length === session.areas.measurements.length) return
        mutateSession((current) => ({ areas: { ...current.areas, measurements: areas } }))
        set(pushHistory(snapshotOf(get().session!)))
        set({ selection: null, contextMenu: null })
        markDirty('areas')
      }
    },

    updateLineGeometry(id, geometry) {
      const { session } = get()
      if (!session) return
      try {
        validateLineGeometry(geometry, { width: session.image.width, height: session.image.height })
      } catch {
        set({ statusMessage: '节点超出地图范围，未保存本次修改。' })
        return
      }
      const lines = session.lines.measurements.map((item) =>
        item.id === id ? { ...item, geometry, updatedAt: nowIso() } : item
      )
      mutateSession((current) => ({ lines: { ...current.lines, measurements: lines } }))
      set(pushHistory(snapshotOf(get().session!)))
      markDirty('lines')
    },

    undo() {
      const { history, historyIndex, session } = get()
      if (!session || historyIndex <= 0) return
      const target = history[historyIndex - 1]
      mutateSession((current) => ({
        lines: { ...current.lines, measurements: target.lines },
        areas: { ...current.areas, measurements: target.areas },
      }))
      set({ historyIndex: historyIndex - 1, selection: null })
      markDirty('lines')
      markDirty('areas')
    },

    redo() {
      const { history, historyIndex, session } = get()
      if (!session || historyIndex >= history.length - 1) return
      const target = history[historyIndex + 1]
      mutateSession((current) => ({
        lines: { ...current.lines, measurements: target.lines },
        areas: { ...current.areas, measurements: target.areas },
      }))
      set({ historyIndex: historyIndex + 1, selection: null })
      markDirty('lines')
      markDirty('areas')
    },

    applyScale(metersPerPixel) {
      const { session } = get()
      if (!session) return
      mutateSession((current) => ({ config: { ...current.config, metersPerPixel } }))
      set({ calibration: { mode: 'closed' } })
      markDirty('config')
    },

    updateSettings(settings) {
      const { session } = get()
      if (!session) return
      mutateSession((current) => ({
        config: { ...current.config, settings: { ...current.config.settings, ...settings } },
      }))
      markDirty('config')
    },

    async flushNow() {
      await saveChain
      await api.flushSaves()
      if (get().dirty.length > 0) throw new Error('存在未完成的保存')
    },

    retrySave() {
      const issue = get().saveIssue
      if (!issue) return
      set({ saveIssue: null })
      markDirty(issue.feature)
    },

    dismissSaveIssue() {
      set({ saveIssue: null })
    },

    confirmImageChange() {
      const { session } = get()
      if (!session) return
      const image = { ...session.image }
      mutateSession((current) => ({
        config: { ...current.config, image },
        lines: { ...current.lines, image },
        areas: { ...current.areas, image },
      }))
      set({ acceptImageChange: true })
      markDirty('config')
      markDirty('lines')
      markDirty('areas')
    },

    async recoverFeature(feature) {
      const { session } = get()
      if (!session) return
      const read = await api.recoverFeature(session.map.id, feature)
      mutateSession((current) => {
        const corrupt = { ...current.corrupt }
        delete corrupt[feature]
        const next: Partial<MapSession> = {
          corrupt,
          revisions: { ...current.revisions, [feature]: read.revision },
        }
        if (read.status === 'ok' && read.document) {
          if (feature === 'config') next.config = read.document as ConfigDocument
          else if (feature === 'lines') next.lines = read.document as LineDocument
          else next.areas = read.document as AreaDocument
        } else {
          if (feature === 'config') next.config = emptyConfig(current.image)
          else if (feature === 'lines') next.lines = emptyLines(current.image)
          else next.areas = emptyAreas(current.image)
        }
        return next
      })
      set({ statusMessage: '已从备份恢复。' })
    },

    async handleCloseRequest() {
      set({ closingDialog: 'saving', closingMessage: null })
      try {
        await get().flushNow()
        await api.finishClose()
      } catch (error) {
        set({
          closingDialog: 'failed',
          closingMessage: error instanceof Error ? error.message : String(error),
        })
      }
    },

    cancelClose() {
      set({ closingDialog: 'idle', closingMessage: null })
    },
  }
})
