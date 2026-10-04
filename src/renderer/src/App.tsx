import { useEffect } from 'react'
import { api } from './lib/api'
import { useAppStore } from './store/appStore'
import { useGlobalKeys } from './hooks/useGlobalKeys'
import { TopBar } from './components/TopBar'
import { ToolRail } from './components/ToolRail'
import { MapCanvas } from './components/MapCanvas'
import {
  CalibrationDistanceDialog,
  ClosingDialog,
  SaveIssueDialog,
  SettingsDialog,
  StatusSnackbar,
  TileProgressBar,
  WarningBanners,
} from './components/Dialogs'
import { MdButton } from './components/md'
import { IconFolder, IconMap } from './components/icons'

export function App() {
  const world = useAppStore((state) => state.world)
  const session = useAppStore((state) => state.session)
  const loadingMessage = useAppStore((state) => state.loadingMessage)
  const chooseWorld = useAppStore((state) => state.chooseWorld)

  useGlobalKeys()

  // 关闭请求：先落盘再允许退出
  useEffect(() => {
    return api.onCloseRequested(() => {
      void useAppStore.getState().handleCloseRequest()
    })
  }, [])

  // 切片准备进度
  useEffect(() => {
    return api.onTileProgress((progress) => {
      const state = useAppStore.getState()
      if (!state.session || state.session.map.id !== progress.mapId) return
      if (progress.phase === 'ready') useAppStore.setState({ tileProgress: null })
      else useAppStore.setState({ tileProgress: progress })
    })
  }, [])

  return (
    <div className="flex h-full flex-col bg-surface text-on-surface">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ToolRail />
        <main className="relative min-w-0 flex-1">
          {session ? (
            <MapCanvas />
          ) : (
            <EmptyState hasWorld={world !== null} loading={loadingMessage} onChooseWorld={() => void chooseWorld()} />
          )}
          <WarningBanners />
          <TileProgressBar />
          <StatusSnackbar />
        </main>
      </div>

      <SettingsDialog />
      <CalibrationDistanceDialog />
      <SaveIssueDialog />
      <ClosingDialog />
    </div>
  )
}

function EmptyState({
  hasWorld,
  loading,
  onChooseWorld,
}: {
  hasWorld: boolean
  loading: string | null
  onChooseWorld: () => void
}) {
  return (
    <div className="flex h-full items-center justify-center bg-surface">
      <div className="flex max-w-sm flex-col items-center gap-4 rounded-[28px] bg-surface-container p-10 text-center shadow-elevation-1">
        <IconMap width={48} height={48} className="text-primary" />
        <h1 className="md3-headline-small">mapper</h1>
        <p className="md3-body-medium text-on-surface-variant">
          {loading ?? (hasWorld ? '从顶栏选择一张地图开始测量。' : '选择原创世界观的地图目录，开始线测量与面测量。')}
        </p>
        {!hasWorld && !loading && (
          <MdButton onClick={onChooseWorld}>
            <IconFolder width={18} height={18} />
            选择世界观目录
          </MdButton>
        )}
      </div>
    </div>
  )
}
