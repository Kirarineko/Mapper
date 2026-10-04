import { measureArea, measureLength } from '../../../shared/geometry'

/**
 * 测量值的显示格式化。
 * 单位规则由共享几何模块决定（长度 <1000 m 用 m，否则 km；面积 >10 km² 用 km²，恰好 10 km² 仍用 m²），
 * 这里只负责数值的显示取舍，不影响内部计算。
 */
export function formatMeasurementValue(value: number, unit: string): string {
  return `${formatNumber(value)} ${unit}`
}

/** 显示取舍：大值取整，小值保留必要小数；不改变内部计算。 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1000) return Math.round(value).toLocaleString('zh-CN')
  if (abs >= 100) return value.toFixed(0)
  if (abs >= 10) return trimZeros(value.toFixed(1))
  if (abs >= 1) return trimZeros(value.toFixed(2))
  if (abs === 0) return '0'
  return trimZeros(value.toFixed(3))
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

export function formatLength(pixelLength: number, metersPerPixel: number | null): string {
  const measured = measureLength(pixelLength, metersPerPixel)
  return formatMeasurementValue(measured.value, measured.unit)
}

export function formatArea(pixelArea: number, metersPerPixel: number | null): string {
  const measured = measureArea(pixelArea, metersPerPixel)
  return formatMeasurementValue(measured.value, measured.unit)
}

/** 比例尺的简述，例如「250 米/像素」；未标定时返回 null。 */
export function formatScale(metersPerPixel: number | null): string | null {
  if (metersPerPixel === null) return null
  return `${formatNumber(metersPerPixel)} 米/像素`
}
