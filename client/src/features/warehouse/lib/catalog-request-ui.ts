import type { WarehouseMediaType, WarehouseRequestStatus } from '@bookorbit/types'

export type RequestStatusTone = 'neutral' | 'info' | 'success' | 'danger' | 'muted'

const UNKNOWN_DATE_LABEL = 'Unknown'
const FALLBACK_REQUEST_TITLE = 'Library request'
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export const REQUEST_STATUS_LABELS = {
  pending: 'Requested',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  unknown: 'Requested',
} satisfies Record<WarehouseRequestStatus, string>

export const REQUEST_STATUS_TONE = {
  pending: 'neutral',
  processing: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'muted',
  unknown: 'neutral',
} satisfies Record<WarehouseRequestStatus, RequestStatusTone>

export const REQUEST_MEDIA_LABELS = {
  ebook: 'Book',
  audiobook: 'Audiobook',
  comic: 'Comic',
} satisfies Record<WarehouseMediaType, string>

interface RequestTitleFields {
  title?: string | null
}

interface RequestAuthorFields {
  author?: string | null
}

export function formatRequestDate(value: string | null | undefined): string {
  const rawValue = value?.trim()
  if (!rawValue) {
    return UNKNOWN_DATE_LABEL
  }

  const dateOnly = DATE_ONLY_PATTERN.exec(rawValue)
  const date = dateOnly ? localDateFromParts(dateOnly[1]!, dateOnly[2]!, dateOnly[3]!) : new Date(rawValue)
  if (Number.isNaN(date.getTime())) {
    return UNKNOWN_DATE_LABEL
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(date)
}

function localDateFromParts(yearText: string, monthText: string, dayText: string): Date {
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(year, month - 1, day)

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return new Date(Number.NaN)
  }

  return date
}

export function requestDisplayTitle(request: RequestTitleFields): string {
  return request.title?.trim() || FALLBACK_REQUEST_TITLE
}

export function requestDisplayAuthor(request: RequestAuthorFields): string | null {
  return request.author?.trim() || null
}

export function visibleRequestCopySnapshot(): string[] {
  return Array.from(
    new Set([...Object.values(REQUEST_STATUS_LABELS), ...Object.values(REQUEST_MEDIA_LABELS), UNKNOWN_DATE_LABEL, FALLBACK_REQUEST_TITLE]),
  )
}
