import type { ErrorCode } from './types'

export class MapperError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message)
    this.name = 'MapperError'
  }
}
