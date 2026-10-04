import { MapperError } from './errors'

export interface IpcSource {
  senderId: number
  frameIsMain: boolean
  frameUrl: string
}

export function authorizeIpc(source: IpcSource, windowId: number, rendererUrl: string): void {
  if (source.senderId !== windowId || !source.frameIsMain || source.frameUrl !== rendererUrl) {
    throw new MapperError('FORBIDDEN', 'IPC 只允许来自应用主窗口。')
  }
}

export function assertArgumentCount(args: unknown[], expected: number): void {
  if (args.length !== expected) throw new MapperError('INVALID_ARGUMENT', 'IPC 参数数量无效。')
}
