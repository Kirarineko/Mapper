import { useEffect, useState, type FormEvent, type JSX } from 'react'
import { calibrateScale } from '../../../shared/geometry'
import { roundedPixelDistance } from '../lib/geometryView'
import { useAppStore } from '../store/appStore'
import { DialogActions, DialogHeadline, MdButton, MdDialog, MdSegmented, MdSwitch } from './md'
import { IconWarning } from './icons'

/** 设置对话框：与 Config.json 的用户设置对应。 */
export function SettingsDialog() {
  const open = useAppStore((state) => state.settingsOpen)
  const setOpen = useAppStore((state) => state.setSettingsOpen)
  const settings = useAppStore((state) => state.session?.config.settings ?? null)
  const updateSettings = useAppStore((state) => state.updateSettings)

  return (
    <MdDialog open={open} onClose={() => setOpen(false)}>
      <DialogHeadline>设置</DialogHeadline>
      {settings ? (
        <div className="flex w-[380px] flex-col gap-5">
          <label className="flex items-center justify-between gap-4">
            <span className="md3-body-medium text-on-surface">
              按住 Ctrl+A 显示分段距离
              <span className="md3-body-small block text-on-surface-variant">
                临时显示折线与贝塞尔曲线的分段距离，松开或窗口失焦即恢复
              </span>
            </span>
            <MdSwitch
              checked={settings.showSegmentLengths}
              onChange={(checked) => updateSettings({ showSegmentLengths: checked })}
              label="按住 Ctrl+A 显示分段距离"
            />
          </label>
          <label className="md3-body-medium flex flex-col gap-1 text-on-surface">
            选区画笔直径（原图像素）
            <input
              className="md3-field"
              type="number"
              min={1}
              step={1}
              value={settings.brushDiameter}
              onChange={(event) => {
                const value = Math.round(Number(event.target.value))
                if (Number.isFinite(value) && value > 0) updateSettings({ brushDiameter: value })
              }}
            />
          </label>
        </div>
      ) : (
        <div className="md3-body-medium text-on-surface-variant">加载地图后可修改设置。</div>
      )}
      <DialogActions>
        <MdButton variant="text" onClick={() => setOpen(false)}>
          关闭
        </MdButton>
      </DialogActions>
    </MdDialog>
  )
}

/** 图上标定的实际距离输入弹窗（Enter 打开，点击遮罩不关闭）。 */
export function CalibrationDistanceDialog() {
  const calibration = useAppStore((state) => state.calibration)
  const setCalibration = useAppStore((state) => state.setCalibration)
  const applyScale = useAppStore((state) => state.applyScale)

  const [distance, setDistance] = useState('')
  const [unit, setUnit] = useState<'m' | 'km'>('m')
  const [error, setError] = useState<string | null>(null)

  const open = calibration.mode === 'input'
  const pixels = open ? roundedPixelDistance(calibration.points[0], calibration.points[1]) : 0

  useEffect(() => {
    if (open) {
      setDistance('')
      setError(null)
    }
  }, [open])

  const confirm = (event: FormEvent) => {
    event.preventDefault()
    if (!open) return
    const parsedDistance = Number(distance)
    try {
      if (pixels <= 0) throw new Error('标定像素为零，无法确认')
      if (!Number.isFinite(parsedDistance) || parsedDistance <= 0) throw new Error('实际距离必须为正数')
      applyScale(calibrateScale(pixels, parsedDistance, unit))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <MdDialog open={open} modal onClose={() => setCalibration({ mode: 'closed' })}>
      <DialogHeadline>输入实际距离</DialogHeadline>
      <form onSubmit={confirm} className="flex w-[360px] flex-col gap-4">
        <div className="md3-body-medium text-on-surface-variant">
          图上标定距离：<span className="text-on-surface">{pixels} 像素</span>（四舍五入取整）
        </div>
        <label className="md3-label-medium flex flex-col gap-1 text-on-surface-variant">
          实际距离
          <div className="flex items-center gap-2">
            <input
              className="md3-field flex-1"
              type="number"
              min="0"
              step="any"
              autoFocus
              value={distance}
              onChange={(event) => setDistance(event.target.value)}
              placeholder="例如 250"
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
        <DialogActions>
          <MdButton type="button" variant="text" onClick={() => setCalibration({ mode: 'closed' })}>
            取消
          </MdButton>
          <MdButton type="submit" disabled={pixels <= 0}>
            确认
          </MdButton>
        </DialogActions>
      </form>
    </MdDialog>
  )
}

const FEATURE_LABELS = { config: '配置', lines: '线测量数据', areas: '面测量数据' } as const

/** 保存失败对话框：明确错误信息，允许重试。 */
export function SaveIssueDialog() {
  const issue = useAppStore((state) => state.saveIssue)
  const retrySave = useAppStore((state) => state.retrySave)
  const dismiss = useAppStore((state) => state.dismissSaveIssue)

  return (
    <MdDialog open={issue !== null} onClose={dismiss}>
      <DialogHeadline>保存失败</DialogHeadline>
      {issue && (
        <div className="md3-body-medium w-[380px] text-on-surface">
          <p className="mb-2">
            {FEATURE_LABELS[issue.feature]}保存失败（{issue.code}）：
          </p>
          <p className="md3-body-small text-on-surface-variant">{issue.message}</p>
          {issue.code === 'CONFLICT' && (
            <p className="md3-body-small mt-2 text-on-surface-variant">
              文件已被外部修改。重试将以当前界面内容覆盖，或稍后重新加载地图。
            </p>
          )}
          {issue.code === 'IMAGE_CHANGED' && (
            <p className="md3-body-small mt-2 text-on-surface-variant">
              地图图像已变更。请先在警告条中确认变更，再重新保存。
            </p>
          )}
        </div>
      )}
      <DialogActions>
        <MdButton variant="text" onClick={dismiss}>
          知道了
        </MdButton>
        <MdButton onClick={retrySave}>重试</MdButton>
      </DialogActions>
    </MdDialog>
  )
}

/** 关闭应用时的保存流程对话框。 */
export function ClosingDialog() {
  const closing = useAppStore((state) => state.closingDialog)
  const message = useAppStore((state) => state.closingMessage)
  const handleClose = useAppStore((state) => state.handleCloseRequest)
  const cancelClose = useAppStore((state) => state.cancelClose)

  return (
    <MdDialog open={closing !== 'idle'} modal>
      <DialogHeadline>{closing === 'saving' ? '正在保存…' : '保存失败'}</DialogHeadline>
      <div className="md3-body-medium w-[360px] text-on-surface">
        {closing === 'saving'
          ? '正在保存未完成的修改，请稍候。'
          : `应用尚未关闭。${message ?? ''}`}
      </div>
      {closing === 'failed' && (
        <DialogActions>
          <MdButton variant="text" onClick={cancelClose}>
            取消
          </MdButton>
          <MdButton onClick={() => void handleClose()}>重试</MdButton>
        </DialogActions>
      )}
    </MdDialog>
  )
}

/** 顶部警告条区域：图像变更确认、损坏文件恢复、后端警告。 */
export function WarningBanners() {
  const session = useAppStore((state) => state.session)
  const confirmImageChange = useAppStore((state) => state.confirmImageChange)
  const recoverFeature = useAppStore((state) => state.recoverFeature)
  const acceptImageChange = useAppStore((state) => state.acceptImageChange)
  const [dismissedWarnings, setDismissedWarnings] = useState(0)

  useEffect(() => setDismissedWarnings(0), [session?.map.id])

  if (!session) return null
  const banners: { key: string; content: JSX.Element }[] = []

  const imageChangedFeatures = (Object.keys(session.imageChanged) as Array<keyof typeof session.imageChanged>).filter(
    (feature) => session.imageChanged[feature]
  )
  if (imageChangedFeatures.length > 0 && !acceptImageChange) {
    banners.push({
      key: 'image-changed',
      content: (
        <>
          <IconWarning width={18} height={18} />
          <span className="md3-body-medium flex-1">地图图像内容或尺寸已变更，请检查已有测量是否仍然正确。</span>
          <MdButton variant="tonal" className="!h-8" onClick={confirmImageChange}>
            确认变更并保存
          </MdButton>
        </>
      ),
    })
  }

  for (const feature of ['config', 'lines', 'areas'] as const) {
    const corrupt = session.corrupt[feature]
    if (!corrupt) continue
    banners.push({
      key: `corrupt-${feature}`,
      content: (
        <>
          <IconWarning width={18} height={18} />
          <span className="md3-body-medium flex-1">
            {FEATURE_LABELS[feature]}文件已损坏，不会被自动覆盖。
            {corrupt.backupAvailable ? '可以从备份恢复。' : '没有可用备份。'}
          </span>
          {corrupt.backupAvailable && (
            <MdButton variant="tonal" className="!h-8" onClick={() => void recoverFeature(feature)}>
              从备份恢复
            </MdButton>
          )}
        </>
      ),
    })
  }

  session.warnings.slice(dismissedWarnings).forEach((warning, index) => {
    banners.push({
      key: `warning-${index}`,
      content: (
        <>
          <IconWarning width={18} height={18} />
          <span className="md3-body-medium flex-1">{warning.message}</span>
          <MdButton variant="text" className="!h-8" onClick={() => setDismissedWarnings((count) => count + 1)}>
            忽略
          </MdButton>
        </>
      ),
    })
  })

  if (banners.length === 0) return null
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-30 flex w-[min(640px,90%)] -translate-x-1/2 flex-col gap-2">
      {banners.map((banner) => (
        <div
          key={banner.key}
          className="md3-pop pointer-events-auto flex items-center gap-3 rounded-2xl bg-error-container px-4 py-2.5 text-on-error-container shadow-elevation-2"
        >
          {banner.content}
        </div>
      ))}
    </div>
  )
}

/** 底部状态条（轻提示）。 */
export function StatusSnackbar() {
  const message = useAppStore((state) => state.statusMessage)
  const dismiss = useAppStore((state) => state.dismissStatus)

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(dismiss, 6000)
    return () => window.clearTimeout(timer)
  }, [message, dismiss])

  if (!message) return null
  return (
    <div className="md3-pop absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-inverse-surface px-4 py-3 text-inverse-on-surface shadow-elevation-2">
      <span className="md3-body-medium">{message}</span>
      <button className="md3-label-large text-inverse-primary" onClick={dismiss}>
        知道了
      </button>
    </div>
  )
}

/** 切片准备进度条。 */
export function TileProgressBar() {
  const progress = useAppStore((state) => state.tileProgress)
  if (!progress || progress.phase === 'ready') return null
  const ratio = progress.total > 0 ? progress.completed / progress.total : 0
  const label = progress.phase === 'preview' ? '正在生成预览…' : progress.phase === 'failed' ? '切片准备失败' : '正在准备地图切片…'
  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 bg-surface-container/90 px-4 py-2">
      <div className="md3-label-medium mb-1 text-on-surface-variant">
        {label} {progress.total > 1 ? `${progress.completed}/${progress.total}` : ''}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-container-highest">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
    </div>
  )
}
