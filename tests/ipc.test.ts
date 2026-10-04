import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { MapperApi, TileProgress } from '../src/shared/types'
import { CHANNELS } from '../src/shared/channels'
import { authorizeIpc } from '../src/main/ipc-policy'
import { registerIpc } from '../src/main/ipc'
import type { MapperService } from '../src/main/service'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
  expose: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
  },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
  },
  contextBridge: { exposeInMainWorld: mocks.expose },
}))

const rendererUrl = 'file:///app/out/renderer/index.html'
const frame = { url: rendererUrl }
const window = { webContents: { id: 7 } } as unknown as BrowserWindow
const event = { sender: { id: 7, mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent

describe('IPC boundary', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    vi.clearAllMocks()
  })

  it('rejects other windows, subframes and remote origins', () => {
    for (const source of [
      { senderId: 8, frameIsMain: true, frameUrl: rendererUrl },
      { senderId: 7, frameIsMain: false, frameUrl: rendererUrl },
      { senderId: 7, frameIsMain: true, frameUrl: 'https://example.com' },
      { senderId: 7, frameIsMain: true, frameUrl: `${rendererUrl}?other` },
    ]) expect(() => authorizeIpc(source, 7, rendererUrl)).toThrow()
    expect(() => authorizeIpc({ senderId: 7, frameIsMain: true, frameUrl: rendererUrl }, 7, rendererUrl)).not.toThrow()
  })

  it('registers only fixed operations and rejects extra arguments before calling the service', async () => {
    const listMaps = vi.fn().mockResolvedValue([])
    const service = { listMaps } as unknown as MapperService
    const dispose = registerIpc(window, rendererUrl, service, vi.fn())
    expect(mocks.handlers.size).toBe(9)
    const list = mocks.handlers.get(CHANNELS.listMaps)!
    expect(await list(event)).toEqual({ ok: true, value: [] })
    expect(await list(event, '/etc/passwd')).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    expect(listMaps).toHaveBeenCalledTimes(1)
    const untrusted = { sender: { id: 8, mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent
    expect(await list(untrusted)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(listMaps).toHaveBeenCalledTimes(1)
    dispose()
    expect(mocks.handlers.size).toBe(0)
  })

  it('refuses closing after failed flush and closes after a successful retry', async () => {
    const prepareClose = vi.fn().mockRejectedValueOnce(new Error('disk failure')).mockResolvedValue(undefined)
    const finish = vi.fn()
    registerIpc(window, rendererUrl, { prepareClose } as unknown as MapperService, finish)
    const close = mocks.handlers.get(CHANNELS.finishClose)!
    expect(await close(event)).toMatchObject({ ok: false, error: { code: 'IO_ERROR' } })
    expect(finish).not.toHaveBeenCalled()
    expect(await close(event)).toMatchObject({ ok: true })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(finish).toHaveBeenCalledTimes(1)
  })

  it('preload exposes typed commands and removable event subscriptions without raw IPC', async () => {
    await import('../src/preload/index')
    const [name, exposed] = mocks.expose.mock.calls[0] as [string, MapperApi]
    expect(name).toBe('mapper')
    expect(Object.keys(exposed)).not.toContain('invoke')
    await exposed.loadMap('map-id')
    expect(mocks.invoke).toHaveBeenCalledWith(CHANNELS.loadMap, 'map-id')
    const listener = vi.fn()
    const unsubscribe = exposed.onTileProgress(listener)
    const [channel, callback] = mocks.on.mock.calls[0] as [string, (event: unknown, progress: TileProgress) => void]
    const progress: TileProgress = { mapId: 'map', phase: 'ready', completed: 2, total: 2 }
    callback({}, progress)
    expect(listener).toHaveBeenCalledWith(progress)
    unsubscribe()
    expect(mocks.removeListener).toHaveBeenCalledWith(channel, callback)
    const onClose = vi.fn()
    const unsubscribeClose = exposed.onCloseRequested(onClose)
    const [closeChannel, closeCallback] = mocks.on.mock.calls[1] as [string, () => void]
    closeCallback()
    expect(onClose).toHaveBeenCalledWith()
    unsubscribeClose()
    expect(mocks.removeListener).toHaveBeenCalledWith(closeChannel, closeCallback)
  })
})
