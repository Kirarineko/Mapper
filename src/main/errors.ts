import type { BackendError, Result } from '../shared/types'
import { MapperError } from '../shared/errors'
export { MapperError } from '../shared/errors'

export function backendError(error: unknown): BackendError {
  if (error instanceof MapperError) return { code: error.code, message: error.message }
  return { code: 'IO_ERROR', message: '操作失败，请检查文件权限、磁盘空间并重试。' }
}

export async function resultOf<T>(action: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await action() }
  } catch (error) {
    return { ok: false, error: backendError(error) }
  }
}
