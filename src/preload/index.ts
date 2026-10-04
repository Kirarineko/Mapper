import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS } from '../shared/channels'
import type { MapperApi, TileProgress } from '../shared/types'

const api: MapperApi = {
  chooseWorld: () => ipcRenderer.invoke(CHANNELS.chooseWorld),
  listMaps: () => ipcRenderer.invoke(CHANNELS.listMaps),
  loadMap: (mapId) => ipcRenderer.invoke(CHANNELS.loadMap, mapId),
  prepareTiles: (mapId) => ipcRenderer.invoke(CHANNELS.prepareTiles, mapId),
  readFeature: (request) => ipcRenderer.invoke(CHANNELS.readFeature, request),
  saveFeature: (request) => ipcRenderer.invoke(CHANNELS.saveFeature, request),
  recoverFeature: (request) => ipcRenderer.invoke(CHANNELS.recoverFeature, request),
  flushSaves: () => ipcRenderer.invoke(CHANNELS.flushSaves),
  finishClose: () => ipcRenderer.invoke(CHANNELS.finishClose),
  onTileProgress: (listener) => {
    const callback = (_event: IpcRendererEvent, progress: TileProgress): void => listener(progress)
    ipcRenderer.on(CHANNELS.tileProgress, callback)
    return () => ipcRenderer.removeListener(CHANNELS.tileProgress, callback)
  },
  onCloseRequested: (listener) => {
    const callback = (): void => listener()
    ipcRenderer.on(CHANNELS.closeRequested, callback)
    return () => ipcRenderer.removeListener(CHANNELS.closeRequested, callback)
  },
}

contextBridge.exposeInMainWorld('mapper', api)
