import { describe, expect, it } from 'vitest'
import { stripBearerPrefix, unwrapQuotedValue } from './provider-token'

describe('unwrapQuotedValue', () => {
  it('returns the trimmed value when not quoted', () => {
    expect(unwrapQuotedValue('  token  ')).toBe('token')
  })

  it('strips matching double quotes', () => {
    expect(unwrapQuotedValue('"abc"')).toBe('abc')
  })

  it('strips matching single quotes', () => {
    expect(unwrapQuotedValue("'abc'")).toBe('abc')
  })

  it('does not strip mismatched quotes', () => {
    expect(unwrapQuotedValue('"abc\'')).toBe(`"abc'`)
  })

  it('returns trimmed input when length is below two', () => {
    expect(unwrapQuotedValue('"')).toBe('"')
    expect(unwrapQuotedValue(' ')).toBe('')
  })
})

describe('stripBearerPrefix', () => {
  it('returns input unchanged when no bearer prefix', () => {
    expect(stripBearerPrefix('abc-123')).toBe('abc-123')
  })

  it('strips bearer prefix case-insensitively', () => {
    expect(stripBearerPrefix('Bearer abc')).toBe('abc')
    expect(stripBearerPrefix('bearer abc')).toBe('abc')
    expect(stripBearerPrefix('BEARER abc')).toBe('abc')
  })

  it('handles surrounding quotes', () => {
    expect(stripBearerPrefix('"Bearer abc"')).toBe('abc')
    expect(stripBearerPrefix("'Bearer abc'")).toBe('abc')
    expect(stripBearerPrefix('Bearer "abc"')).toBe('abc')
  })

  it('returns empty string for empty or whitespace input', () => {
    expect(stripBearerPrefix('')).toBe('')
    expect(stripBearerPrefix('   ')).toBe('')
  })
})
