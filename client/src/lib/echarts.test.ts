import { describe, it, expect } from 'vitest'
import { getThemePalette, getBookorbitThemeName, initChartThemes } from './echarts'
import { DEFAULT_ACCENT } from './theme-accent-meta'

function isHexColor(v: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(v)
}

describe('getThemePalette', () => {
  it('returns a 10-color hex palette', () => {
    const palette = getThemePalette('dark', 'blue')
    expect(palette).toHaveLength(10)
    expect(palette.every(isHexColor)).toBe(true)
  })

  it('falls back to the default accent when accent is unknown', () => {
    expect(getThemePalette('light', 'unknown-accent')).toEqual(getThemePalette('light', DEFAULT_ACCENT))
  })

  it('produces different palettes for light and dark mode', () => {
    const lightPalette = getThemePalette('light', 'blue')
    const darkPalette = getThemePalette('dark', 'blue')
    expect(lightPalette).not.toEqual(darkPalette)
  })
})

describe('getBookorbitThemeName', () => {
  it('uses normalized accent names in theme keys', () => {
    expect(getBookorbitThemeName('dark', 'blue')).toBe('bookorbit-dark-blue')
    expect(getBookorbitThemeName('light', 'mint')).toBe('bookorbit-light-mint')
  })

  it('falls back to default accent for invalid names', () => {
    expect(getBookorbitThemeName('dark', 'bad-accent')).toBe(`bookorbit-dark-${DEFAULT_ACCENT}`)
  })
})

describe('initChartThemes', () => {
  it('is idempotent when called repeatedly', () => {
    expect(() => {
      initChartThemes()
      initChartThemes()
    }).not.toThrow()
  })
})
