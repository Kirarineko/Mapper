import type { MapperApi } from '../../shared/types'

declare global {
  interface Window {
    mapper: MapperApi
  }
}

export {}
