import { describe, expect, it } from 'vitest'
import type { WarehouseRequestStatus } from '@bookorbit/types'

import {
  formatRequestDate,
  REQUEST_MEDIA_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_TONE,
  requestDisplayAuthor,
  requestDisplayTitle,
  visibleRequestCopySnapshot,
} from '../catalog-request-ui'

describe('catalog request UI helpers', () => {
  it('maps every request status to native labels and stable tones', () => {
    const statuses: WarehouseRequestStatus[] = ['pending', 'processing', 'completed', 'failed', 'cancelled', 'unknown']

    expect(Object.keys(REQUEST_STATUS_LABELS).sort()).toEqual([...statuses].sort())
    expect(REQUEST_STATUS_LABELS).toEqual({
      pending: 'Requested',
      processing: 'Processing',
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
      unknown: 'Requested',
    })

    expect(Object.keys(REQUEST_STATUS_TONE).sort()).toEqual([...statuses].sort())
    expect(REQUEST_STATUS_TONE).toEqual({
      pending: 'neutral',
      processing: 'info',
      completed: 'success',
      failed: 'danger',
      cancelled: 'muted',
      unknown: 'neutral',
    })
  })

  it('maps request media types to native labels', () => {
    expect(REQUEST_MEDIA_LABELS).toEqual({
      ebook: 'Book',
      audiobook: 'Audiobook',
      comic: 'Comic',
    })
  })

  it('formats valid request dates as short local dates and hides empty or invalid dates', () => {
    const isoDate = '2026-06-03T14:45:00.000Z'
    const expected = new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(isoDate))
    const dateOnlyExpected = new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(2026, 5, 3))

    expect(formatRequestDate(isoDate)).toBe(expected)
    expect(formatRequestDate('2026-06-03')).toBe(dateOnlyExpected)
    expect(formatRequestDate('')).toBe('Unknown')
    expect(formatRequestDate('   ')).toBe('Unknown')
    expect(formatRequestDate(null)).toBe('Unknown')
    expect(formatRequestDate(undefined)).toBe('Unknown')
    expect(formatRequestDate('not-a-date')).toBe('Unknown')
    expect(formatRequestDate('2026-02-31')).toBe('Unknown')
  })

  it('returns safe title and author display values', () => {
    expect(requestDisplayTitle({ title: '  System Collapse  ' })).toBe('System Collapse')
    expect(requestDisplayTitle({ title: '' })).toBe('Library request')
    expect(requestDisplayTitle({ title: '   ' })).toBe('Library request')
    expect(requestDisplayTitle({ title: null })).toBe('Library request')

    expect(requestDisplayAuthor({ author: '  Martha Wells  ' })).toBe('Martha Wells')
    expect(requestDisplayAuthor({ author: '' })).toBeNull()
    expect(requestDisplayAuthor({ author: '   ' })).toBeNull()
    expect(requestDisplayAuthor({ author: null })).toBeNull()
  })

  it('returns a copy snapshot without private source wording', () => {
    const copy = visibleRequestCopySnapshot()

    expect(copy).toEqual(
      expect.arrayContaining(['Requested', 'Processing', 'Completed', 'Failed', 'Cancelled', 'Book', 'Audiobook', 'Unknown', 'Library request']),
    )
    expect(copy.join(' ')).not.toMatch(/Book Warehouse|warehouse|third-party|upstream|provider|source|vendor|catalog/i)
  })
})
