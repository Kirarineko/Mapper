import { useSyncExternalStore } from 'react'

export interface CanvasColors {
  measureLine: string
  measureFill: string
  measureStroke: string
  draftLine: string
  labelBg: string
  labelText: string
  anchorFill: string
  anchorStroke: string
  erase: string
  calibration: string
}

const light: CanvasColors = {
  measureLine: '#b3261e',
  measureFill: 'rgba(103, 80, 164, 0.28)',
  measureStroke: '#6750a4',
  draftLine: '#7d5260',
  labelBg: '#322f35',
  labelText: '#f5eff7',
  anchorFill: '#ffffff',
  anchorStroke: '#6750a4',
  erase: '#b3261e',
  calibration: '#006a6a',
}

const dark: CanvasColors = {
  measureLine: '#f2b8b5',
  measureFill: 'rgba(208, 188, 255, 0.3)',
  measureStroke: '#d0bcff',
  draftLine: '#efb8c8',
  labelBg: '#e6e0e9',
  labelText: '#322f35',
  anchorFill: '#1d1b20',
  anchorStroke: '#d0bcff',
  erase: '#f2b8b5',
  calibration: '#80d5d4',
}

const query = '(prefers-color-scheme: dark)'

function subscribe(callback: () => void): () => void {
  const media = window.matchMedia(query)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

/** 画布绘制用色（跟随系统 MD3 亮暗主题）。 */
export function useCanvasColors(): CanvasColors {
  const isDark = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
  return isDark ? dark : light
}
