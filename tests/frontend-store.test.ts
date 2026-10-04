import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SaveRequest } from '../src/shared/types'
import { FORMAT_VERSION } from '../src/shared/types'

const saveFeature = vi.fn<(request: SaveRequest) => Promise<{ revision: string }>>()
const flushSaves = vi.fn<() => Promise<void>>()

vi.mock('../src/renderer/src/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/renderer/src/lib/api')>()
  return {
    ...original,
    api: {
      ...original.api,
      saveFeature: (request: SaveRequest) => saveFeature(request),
      flushSaves: () => flushSaves(),
    },
  }
})

import { useAppStore } from '../src/renderer/src/store/appStore'

const image = { sha256: 'a'.repeat(64), width: 1000, height: 1000 }

function resetSession() {
  useAppStore.setState({
    world: { id: 'w1', name: '世界', maps: [] },
    session: {
      map: { id: 'm1', name: '地图', relativePath: 'map.png' },
      image,
      config: {
        version: FORMAT_VERSION,
        image: { ...image },
        metersPerPixel: null,
        settings: { showSegmentLengths: true, brushDiameter: 64 },
      },
      lines: { version: FORMAT_VERSION, image: { ...image }, measurements: [] },
      areas: { version: FORMAT_VERSION, image: { ...image }, measurements: [] },
      revisions: { config: null, lines: null, areas: null },
      corrupt: {},
      imageChanged: {},
      warnings: [],
    },
    draft: null,
    selection: null,
    dirty: [],
    saveIssue: null,
    acceptImageChange: false,
    history: [{ lines: [], areas: [] }],
    historyIndex: 0,
  })
}

beforeEach(() => {
  saveFeature.mockReset()
  flushSaves.mockReset()
  flushSaves.mockResolvedValue(undefined)
  let revision = 0
  saveFeature.mockImplementation(async () => ({ revision: `rev-${++revision}` }))
  resetSession()
})

const straight = {
  kind: 'straight' as const,
  nodes: [{ point: { x: 10, y: 10 } }, { point: { x: 110, y: 10 } }],
}

const square = {
  regions: [
    {
      outer: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      holes: [],
    },
  ],
}

describe('线测量提交与保存', () => {
  it('提交直线后写入文档并自动保存', async () => {
    useAppStore.getState().commitLine(straight)
    expect(useAppStore.getState().session!.lines.measurements).toHaveLength(1)
    expect(useAppStore.getState().dirty).toContain('lines')

    await useAppStore.getState().flushNow()
    expect(saveFeature).toHaveBeenCalledTimes(1)
    const request = saveFeature.mock.calls[0][0]
    expect(request.feature).toBe('lines')
    expect(request.expectedRevision).toBeNull()
    expect(useAppStore.getState().session!.revisions.lines).toBe('rev-1')
    expect(useAppStore.getState().dirty).toHaveLength(0)
  })

  it('退化直线不保存', () => {
    useAppStore.getState().commitLine({
      kind: 'straight',
      nodes: [{ point: { x: 5, y: 5 } }, { point: { x: 5, y: 5 } }],
    })
    expect(useAppStore.getState().session!.lines.measurements).toHaveLength(0)
  })

  it('节点拖动更新几何并保存', async () => {
    useAppStore.getState().commitLine(straight)
    const id = useAppStore.getState().session!.lines.measurements[0].id
    useAppStore.getState().updateLineGeometry(id, {
      kind: 'straight',
      nodes: [{ point: { x: 0, y: 0 } }, { point: { x: 200, y: 0 } }],
    })
    expect(useAppStore.getState().session!.lines.measurements[0].geometry.nodes[0].point).toEqual({ x: 0, y: 0 })
    await useAppStore.getState().flushNow()
    expect(saveFeature).toHaveBeenCalledTimes(2)
  })

  it('删除线测量并保存', async () => {
    useAppStore.getState().commitLine(straight)
    const id = useAppStore.getState().session!.lines.measurements[0].id
    useAppStore.getState().deleteMeasurement({ type: 'line', id })
    expect(useAppStore.getState().session!.lines.measurements).toHaveLength(0)
    await useAppStore.getState().flushNow()
  })
})

describe('面测量提交', () => {
  it('一次操作拆分为多个不连续区域', () => {
    useAppStore.getState().commitAreas({
      regions: [
        square.regions[0],
        {
          outer: [
            { x: 200, y: 200 },
            { x: 300, y: 200 },
            { x: 300, y: 300 },
            { x: 200, y: 300 },
          ],
          holes: [],
        },
      ],
    })
    expect(useAppStore.getState().session!.areas.measurements).toHaveLength(2)
  })

  it('空选区不保存', () => {
    useAppStore.getState().commitAreas({ regions: [] })
    expect(useAppStore.getState().session!.areas.measurements).toHaveLength(0)
  })
})

describe('撤销与重做', () => {
  it('撤销恢复上一状态，重做重放', () => {
    const store = useAppStore.getState()
    store.commitLine(straight)
    expect(useAppStore.getState().session!.lines.measurements).toHaveLength(1)
    useAppStore.getState().undo()
    expect(useAppStore.getState().session!.lines.measurements).toHaveLength(0)
    useAppStore.getState().redo()
    expect(useAppStore.getState().session!.lines.measurements).toHaveLength(1)
  })

  it('新操作截断重做分支', () => {
    useAppStore.getState().commitLine(straight)
    useAppStore.getState().undo()
    useAppStore.getState().commitAreas(square)
    const state = useAppStore.getState()
    expect(state.historyIndex).toBe(state.history.length - 1)
    useAppStore.getState().redo()
    expect(useAppStore.getState().session!.lines.measurements).toHaveLength(0)
    expect(useAppStore.getState().session!.areas.measurements).toHaveLength(1)
  })
})

describe('标定与设置', () => {
  it('应用比例尺并保存配置', async () => {
    useAppStore.getState().applyScale(250)
    expect(useAppStore.getState().session!.config.metersPerPixel).toBe(250)
    await useAppStore.getState().flushNow()
    expect(saveFeature.mock.calls.some((call) => call[0].feature === 'config')).toBe(true)
  })

  it('更新用户设置', () => {
    useAppStore.getState().updateSettings({ brushDiameter: 128, showSegmentLengths: false })
    const settings = useAppStore.getState().session!.config.settings
    expect(settings.brushDiameter).toBe(128)
    expect(settings.showSegmentLengths).toBe(false)
  })
})

describe('保存失败与图像变更', () => {
  it('保存失败产生错误信息，重试后恢复', async () => {
    saveFeature.mockRejectedValueOnce(new Error('磁盘写入失败'))
    useAppStore.getState().commitLine(straight)
    await expect(useAppStore.getState().flushNow()).rejects.toThrow()
    expect(useAppStore.getState().saveIssue?.feature).toBe('lines')

    useAppStore.getState().retrySave()
    await useAppStore.getState().flushNow()
    expect(useAppStore.getState().saveIssue).toBeNull()
    expect(useAppStore.getState().dirty).toHaveLength(0)
  })

  it('确认图像变更后携带 acceptImageChange 保存', async () => {
    useAppStore.setState((state) => ({
      session: state.session ? { ...state.session, imageChanged: { lines: true } } : state.session,
    }))
    useAppStore.getState().confirmImageChange()
    await useAppStore.getState().flushNow()
    for (const call of saveFeature.mock.calls) {
      expect(call[0].acceptImageChange).toBe(true)
    }
    expect(useAppStore.getState().session!.imageChanged).toEqual({})
  })

  it('损坏功能不会被自动覆盖', async () => {
    useAppStore.setState((state) => ({
      session: state.session
        ? { ...state.session, corrupt: { lines: { backupAvailable: true } } }
        : state.session,
    }))
    useAppStore.getState().commitLine(straight)
    saveFeature.mockClear()
    // 直接驱动保存链：flushNow 只等待已有链与后端落盘
    await useAppStore.getState().flushNow().catch(() => undefined)
    expect(saveFeature.mock.calls.every((call) => call[0].feature !== 'lines')).toBe(true)
  })
})
