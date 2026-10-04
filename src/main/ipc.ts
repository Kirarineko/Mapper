import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '../shared/channels'
import { resultOf } from './errors'
import { assertArgumentCount, authorizeIpc } from './ipc-policy'
import { MapperService } from './service'

export function registerIpc(
  window: BrowserWindow,
  rendererUrl: string,
  service: MapperService,
  finishClose: () => void
): () => void {
  const handlers: Array<[string, number, (...args: unknown[]) => Promise<unknown>]> = [
    [CHANNELS.chooseWorld, 0, () => service.chooseWorld()],
    [CHANNELS.listMaps, 0, () => service.listMaps()],
    [CHANNELS.loadMap, 1, (value) => service.loadMap(value)],
    [CHANNELS.prepareTiles, 1, (value) => service.prepareTiles(value)],
    [CHANNELS.readFeature, 1, (value) => service.readFeature(value)],
    [CHANNELS.saveFeature, 1, (value) => service.saveFeature(value)],
    [CHANNELS.recoverFeature, 1, (value) => service.recoverFeature(value)],
    [CHANNELS.flushSaves, 0, () => service.flushSaves()],
    [CHANNELS.finishClose, 0, async () => {
      await service.prepareClose()
      setImmediate(finishClose)
    }],
  ]
  for (const [channel, count, handler] of handlers) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => resultOf(async () => {
      authorizeIpc({
        senderId: event.sender.id,
        frameIsMain: event.senderFrame === event.sender.mainFrame,
        frameUrl: event.senderFrame?.url ?? '',
      }, window.webContents.id, rendererUrl)
      assertArgumentCount(args, count)
      return handler(...args)
    }))
  }
  return () => {
    for (const [channel] of handlers) ipcMain.removeHandler(channel)
  }
}
