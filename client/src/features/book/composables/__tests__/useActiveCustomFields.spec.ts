import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { nextTick } from 'vue'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))

import { useActiveCustomFields, _resetActiveCustomFieldsState } from '../useActiveCustomFields'
import type { CustomMetadataFieldSummary } from '@bookorbit/types'

function makeField(overrides: Partial<CustomMetadataFieldSummary> = {}): CustomMetadataFieldSummary {
  return {
    id: 1,
    label: 'Award Winner',
    type: 'text',
    displayOrder: 0,
    archivedAt: null,
    enabledLibraryIds: [1],
    ...overrides,
  }
}

describe('useActiveCustomFields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetActiveCustomFieldsState()
  })

  it('starts with empty fields and loading false before fetch completes', () => {
    let resolveApi!: (r: Response) => void
    ;(mocks.api as Mock).mockReturnValue(
      new Promise<Response>((res) => {
        resolveApi = res
      }),
    )

    const { fields } = useActiveCustomFields()

    expect(fields.value).toEqual([])
    resolveApi({ ok: true, json: async () => [] } as Response)
  })

  it('fetches active fields from the correct endpoint', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: true, json: async () => [] } as Response)
    useActiveCustomFields()
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(mocks.api).toHaveBeenCalledWith('/api/v1/custom-metadata/fields/active')
  })

  it('populates fields after a successful fetch', async () => {
    const fieldList = [makeField({ id: 1, label: 'Award' }), makeField({ id: 2, label: 'Score' })]
    ;(mocks.api as Mock).mockResolvedValue({ ok: true, json: async () => fieldList } as Response)

    const { fields } = useActiveCustomFields()
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(fields.value).toHaveLength(2)
    expect(fields.value[0]?.label).toBe('Award')
  })

  it('leaves fields as empty array on API failure', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: false, status: 500 } as Response)

    const { fields } = useActiveCustomFields()
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(fields.value).toEqual([])
  })

  it('leaves fields as empty array on network error', async () => {
    ;(mocks.api as Mock).mockRejectedValue(new Error('network error'))

    const { fields } = useActiveCustomFields()
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(fields.value).toEqual([])
  })

  it('returns the same fields ref from multiple composable calls (singleton)', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: true, json: async () => [makeField({ id: 1 })] } as Response)

    const { fields: fields1 } = useActiveCustomFields()
    const { fields: fields2 } = useActiveCustomFields()
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(fields1).toBe(fields2)
  })

  it('only fetches once even when called multiple times', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: true, json: async () => [] } as Response)

    useActiveCustomFields()
    useActiveCustomFields()
    useActiveCustomFields()
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(mocks.api).toHaveBeenCalledTimes(1)
  })

  it('refresh re-fetches and updates the fields', async () => {
    ;(mocks.api as Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => [makeField({ id: 1 })] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [makeField({ id: 1 }), makeField({ id: 2 })] } as Response)

    const { fields, refresh } = useActiveCustomFields()
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    expect(fields.value).toHaveLength(1)

    await refresh()
    expect(fields.value).toHaveLength(2)
    expect(mocks.api).toHaveBeenCalledTimes(2)
  })

  it('sets initialized to true after first successful fetch', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: true, json: async () => [] } as Response)

    const { initialized } = useActiveCustomFields()
    expect(initialized.value).toBe(false)

    await nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(initialized.value).toBe(true)
  })

  it('does not re-fetch when already initialized', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: true, json: async () => [] } as Response)

    useActiveCustomFields()
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))

    vi.clearAllMocks()
    ;(mocks.api as Mock).mockResolvedValue({ ok: true, json: async () => [] } as Response)

    useActiveCustomFields()
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(mocks.api).not.toHaveBeenCalled()
  })
})
