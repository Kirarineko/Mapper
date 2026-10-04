import { describe, expect, it } from 'vitest'
import { formatArea, formatLength, formatNumber, formatScale } from '../src/renderer/src/lib/format'

describe('formatNumber 显示取舍', () => {
  it('大值取整并使用千分位', () => {
    expect(formatNumber(12345)).toBe((12345).toLocaleString('zh-CN'))
  })
  it('百位以上不保留小数', () => {
    expect(formatNumber(250)).toBe('250')
  })
  it('十位保留一位小数并去尾零', () => {
    expect(formatNumber(12.34)).toBe('12.3')
    expect(formatNumber(12)).toBe('12')
  })
  it('个位保留两位小数', () => {
    expect(formatNumber(1.005)).toBe('1')
    expect(formatNumber(3.14)).toBe('3.14')
  })
  it('小于 1 保留三位小数', () => {
    expect(formatNumber(0.456)).toBe('0.456')
  })
  it('零与非有限值', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(Number.NaN)).toBe('—')
  })
})

describe('长度单位规则', () => {
  it('未标定时显示像素', () => {
    expect(formatLength(500, null)).toBe('500 px')
  })
  it('不足 1000 米显示 m', () => {
    expect(formatLength(100, 5)).toBe('500 m')
  })
  it('达到 1000 米显示 km', () => {
    expect(formatLength(200, 5)).toBe('1 km')
    expect(formatLength(300, 5)).toBe('1.5 km')
  })
})

describe('面积单位规则', () => {
  it('未标定时显示 px²', () => {
    expect(formatArea(100, null)).toBe('100 px²')
  })
  it('恰好 10 km² 仍使用 m²', () => {
    // 10 px² × (1000 m/px)² = 10 000 000 m² = 10 km²
    expect(formatArea(10, 1000)).toBe(`${(10_000_000).toLocaleString('zh-CN')} m²`)
  })
  it('超过 10 km² 使用 km²', () => {
    expect(formatArea(11, 1000)).toBe('11 km²')
  })
  it('小面积使用 m²', () => {
    expect(formatArea(5, 2)).toBe('20 m²')
  })
})

describe('比例尺简述', () => {
  it('未标定返回 null', () => {
    expect(formatScale(null)).toBeNull()
  })
  it('示例：1 像素 250 米', () => {
    expect(formatScale(250)).toBe('250 米/像素')
  })
  it('示例：128 像素 1024 公里 → 8000 米/像素', () => {
    expect(formatScale(8000)).toBe('8,000 米/像素')
  })
})
