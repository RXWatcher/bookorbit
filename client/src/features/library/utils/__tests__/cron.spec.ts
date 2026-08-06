import { describe, expect, it } from 'vitest'

import { parseCronToHuman } from '../cron'

describe('parseCronToHuman', () => {
  it('returns null for null input', () => {
    expect(parseCronToHuman(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(parseCronToHuman(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseCronToHuman('')).toBeNull()
  })

  it('parses a daily cron to a human-readable string', () => {
    const result = parseCronToHuman('0 2 * * *')
    expect(result).not.toBeNull()
    expect(result!.toLowerCase()).toContain('02:00 am')
  })

  it('parses an every-5-minutes cron', () => {
    const result = parseCronToHuman('*/5 * * * *')
    expect(result).not.toBeNull()
    expect(result!.toLowerCase()).toContain('every 5 minutes')
  })

  it('parses a weekly cron', () => {
    const result = parseCronToHuman('0 0 * * 1')
    expect(result).not.toBeNull()
    expect(result!.toLowerCase()).toContain('monday')
  })

  it('falls back to the raw cron string on invalid input', () => {
    const garbage = 'not-a-cron-at-all'
    expect(parseCronToHuman(garbage)).toBe(garbage)
  })

  it('parses a monthly cron', () => {
    const result = parseCronToHuman('0 0 1 * *')
    expect(result).not.toBeNull()
    expect(result!.toLowerCase()).toContain('day 1')
  })

  it('parses an hourly cron', () => {
    const result = parseCronToHuman('0 * * * *')
    expect(result).not.toBeNull()
    expect(result!.toLowerCase()).toContain('every hour')
  })
})
