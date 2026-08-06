import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApplyHardcoverImportPayload, HardcoverImportApplyResult, HardcoverImportPreview } from '@bookorbit/types'

vi.mock('../../api/hardcover.api', () => ({
  previewHardcoverImport: vi.fn<() => Promise<HardcoverImportPreview>>(),
  applyHardcoverImport: vi.fn<(payload?: ApplyHardcoverImportPayload) => Promise<HardcoverImportApplyResult>>(),
}))

import { applyHardcoverImport, previewHardcoverImport } from '../../api/hardcover.api'

const mockPreview = vi.mocked(previewHardcoverImport)
const mockApply = vi.mocked(applyHardcoverImport)

const PREVIEW: HardcoverImportPreview = {
  summary: {
    totalHardcoverBooks: 2,
    matchedBooks: 1,
    willUpdate: 1,
    needsReview: 0,
    conflicts: 0,
    unmatched: 1,
    skipped: 0,
    progressWillUpdate: 1,
    progressConflicts: 0,
    progressSkipped: 1,
  },
  rows: [],
}

const RESULT: HardcoverImportApplyResult = {
  ...PREVIEW.summary,
  applied: 1,
  progressApplied: 1,
  failed: 0,
}

async function loadComposable() {
  const { useHardcoverImport } = await import('../useHardcoverImport')
  return useHardcoverImport()
}

describe('useHardcoverImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads preview and enables apply when rows can be updated', async () => {
    mockPreview.mockResolvedValue(PREVIEW)

    const c = await loadComposable()
    await c.loadPreview()

    expect(c.preview.value).toEqual(PREVIEW)
    expect(c.canApply.value).toBe(true)
    expect(c.error.value).toBeNull()
  })

  it('keeps apply disabled when preview has no importable rows', async () => {
    mockPreview.mockResolvedValue({
      ...PREVIEW,
      summary: {
        ...PREVIEW.summary,
        willUpdate: 0,
        needsReview: 0,
      },
    })

    const c = await loadComposable()
    await c.loadPreview()

    expect(c.hasPreview.value).toBe(true)
    expect(c.canApply.value).toBe(false)
  })

  it('captures preview errors', async () => {
    mockPreview.mockRejectedValue(new Error('No token'))

    const c = await loadComposable()
    await c.loadPreview()

    expect(c.preview.value).toBeNull()
    expect(c.error.value).toBe('No token')
  })

  it('uses a fallback message for non-error preview failures', async () => {
    mockPreview.mockRejectedValue('No token')

    const c = await loadComposable()
    await c.loadPreview()

    expect(c.preview.value).toBeNull()
    expect(c.error.value).toBe('Failed to preview Hardcover import')
  })

  it('applies preview and clears it on success', async () => {
    mockApply.mockResolvedValue(RESULT)

    const c = await loadComposable()
    c.preview.value = PREVIEW

    await expect(c.applyPreview([1000], true)).resolves.toEqual(RESULT)
    expect(mockApply).toHaveBeenCalledWith({ hardcoverUserBookIds: [1000], importProgress: true })
    expect(c.result.value).toEqual(RESULT)
    expect(c.preview.value).toBeNull()
  })

  it('returns null and keeps preview on apply failure', async () => {
    mockApply.mockRejectedValue(new Error('Failed'))

    const c = await loadComposable()
    c.preview.value = PREVIEW

    await expect(c.applyPreview()).resolves.toBeNull()
    expect(c.preview.value).toEqual(PREVIEW)
    expect(c.error.value).toBe('Failed')
  })

  it('uses a fallback message for non-error apply failures', async () => {
    mockApply.mockRejectedValue('Failed')

    const c = await loadComposable()
    c.preview.value = PREVIEW

    await expect(c.applyPreview()).resolves.toBeNull()
    expect(c.error.value).toBe('Failed to import Hardcover read status')
  })

  it('clears preview, result, and errors', async () => {
    const c = await loadComposable()
    c.preview.value = PREVIEW
    c.result.value = RESULT
    c.error.value = 'Failed'

    c.clearImport()

    expect(c.preview.value).toBeNull()
    expect(c.result.value).toBeNull()
    expect(c.error.value).toBeNull()
  })
})
