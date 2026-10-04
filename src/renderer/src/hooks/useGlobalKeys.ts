import { useEffect } from 'react'
import { lassoSelection } from '../../../shared/geometry'
import type { LineGeometry } from '../../../shared/types'
import { useAppStore } from '../store/appStore'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function canvasHasFocus(): boolean {
  return document.activeElement?.id === 'map-canvas'
}

/**
 * 全局快捷键：
 * - Enter 完成当前绘制 / 打开图上标定的距离输入
 * - Esc 取消未完成绘制（右键菜单 → 标定 → 草稿 → 选中项 依次优先）
 * - Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 撤销重做；Ctrl+S 立即保存
 * - 空格平移；Alt 画笔擦除；Ctrl+A 临时显示分段距离（仅画布聚焦且设置开启时）
 */
export function useGlobalKeys() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useAppStore.getState()

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void state
          .flushNow()
          .then(() => useAppStore.setState({ statusMessage: '已保存。' }))
          .catch(() => undefined) // 失败由保存失败对话框呈现
        return
      }

      if (isEditableTarget(event.target)) return

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        state.undo()
        return
      }
      if (
        ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'z') ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y')
      ) {
        event.preventDefault()
        state.redo()
        return
      }

      // Ctrl+A 临时显示全部折线、曲线的分段距离；仅画布获得焦点时生效
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        if (canvasHasFocus() && state.session?.config.settings.showSegmentLengths) {
          event.preventDefault()
          state.setShowSegments(true)
        }
        return
      }

      if (event.key === ' ') {
        event.preventDefault()
        state.setSpacePanning(true)
        return
      }
      if (event.key === 'Alt') {
        state.setAltErase(true)
        return
      }

      if (event.key === 'Escape') {
        if (state.contextMenu) {
          state.setContextMenu(null)
        } else if (state.calibration.mode !== 'closed') {
          state.setCalibration({ mode: 'closed' })
        } else if (state.draft) {
          state.cancelDraft()
        } else if (state.selection) {
          state.setSelection(null)
        }
        return
      }

      if (event.key === 'Enter') {
        // 图上标定：两点放置完成后打开实际距离弹窗
        if (state.calibration.mode === 'placing' && state.calibration.points.length === 2) {
          event.preventDefault()
          const [first, second] = state.calibration.points
          state.setCalibration({ mode: 'input', points: [first, second] })
          return
        }
        if (!state.draft || !state.session) return
        const draft = state.draft
        if (draft.kind === 'polyline' && draft.nodes.length >= 2) {
          event.preventDefault()
          const geometry: LineGeometry = {
            kind: 'polyline',
            nodes: draft.nodes.map((point) => ({ point })),
          }
          state.commitLine(geometry)
        } else if (draft.kind === 'bezier' && draft.nodes.length >= 2) {
          event.preventDefault()
          state.commitLine({ kind: 'bezier', nodes: draft.nodes })
        } else if (draft.kind === 'brush') {
          event.preventDefault()
          if (draft.geometry.regions.length > 0) state.commitAreas(draft.geometry)
          else state.cancelDraft()
        } else if (draft.kind === 'polygon' && draft.nodes.length >= 3) {
          event.preventDefault()
          // 多边形套索：自动连接首尾；自交采用奇偶填充规则
          const bounds = { width: state.session.image.width, height: state.session.image.height }
          state.commitAreas(lassoSelection(draft.nodes, bounds))
        }
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      const state = useAppStore.getState()
      // 松开 Ctrl 或 A 任一键即恢复
      if (event.key === 'Control' || event.key === 'Meta' || event.key.toLowerCase() === 'a') {
        state.setShowSegments(false)
      }
      if (event.key === ' ') state.setSpacePanning(false)
      if (event.key === 'Alt') state.setAltErase(false)
    }

    const onBlur = () => {
      const state = useAppStore.getState()
      // 窗口失焦即恢复
      state.setShowSegments(false)
      state.setSpacePanning(false)
      state.setAltErase(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // 设置关闭分段距离功能时立即恢复
  const segmentsEnabled = useAppStore((state) => state.session?.config.settings.showSegmentLengths ?? true)
  useEffect(() => {
    if (!segmentsEnabled) useAppStore.getState().setShowSegments(false)
  }, [segmentsEnabled])
}
