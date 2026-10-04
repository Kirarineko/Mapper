let context: CanvasRenderingContext2D | null = null

/** 估算标签文本在屏幕上的宽度（13px 字号），用于决定线中标签能否放下。 */
export function measureLabelWidth(text: string, fontSize = 13): number {
  if (typeof document === 'undefined') return text.length * fontSize * 0.6
  if (!context) context = document.createElement('canvas').getContext('2d')
  if (!context) return text.length * fontSize * 0.6
  context.font = `500 ${fontSize}px Roboto, "Noto Sans SC", sans-serif`
  return context.measureText(text).width
}
