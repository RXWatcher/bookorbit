import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WarehouseAudiobookExternalSearchPage,
  WarehouseAudiobookQueuePage,
  WarehouseAudiobookRequestSubmitPayload,
  WarehouseExternalAudiobookSearchResult,
  WarehouseRequestDetail,
  WarehouseRequestListQuery,
  WarehouseRequestPage,
} from '@bookorbit/types'
import CatalogAudiobookRequestDialog from '../CatalogAudiobookRequestDialog.vue'

const mocks = vi.hoisted(() => ({
  fetchQueue: vi.fn<() => Promise<WarehouseAudiobookQueuePage>>(),
  fetchRequests: vi.fn<(query: WarehouseRequestListQuery) => Promise<WarehouseRequestPage>>(),
  refreshRequests: vi.fn<(query?: WarehouseRequestListQuery) => Promise<WarehouseRequestPage>>(),
  searchCandidates: vi.fn<(q: string) => Promise<WarehouseAudiobookExternalSearchPage>>(),
  searchExternal: vi.fn<(q: string) => Promise<WarehouseAudiobookExternalSearchPage>>(),
  submit: vi.fn<(payload: WarehouseAudiobookRequestSubmitPayload) => Promise<WarehouseRequestDetail>>(),
}))

vi.mock('@/features/warehouse/api/catalog-source.api', () => ({
  fetchCatalogSourceAudiobookRequestQueue: mocks.fetchQueue,
  fetchCatalogSourceAudiobookRequests: mocks.fetchRequests,
  refreshCatalogSourceAudiobookRequests: mocks.refreshRequests,
  searchCatalogSourceRequestAudiobookCandidates: mocks.searchCandidates,
  searchCatalogSourceRequestAudiobooks: mocks.searchExternal,
  submitCatalogSourceAudiobookRequest: mocks.submit,
}))

function makeRequest(overrides: Partial<WarehouseRequestDetail> = {}): WarehouseRequestDetail {
  return {
    id: 37,
    mediaType: 'audiobook',
    status: 'pending',
    title: 'Murderbot Diaries',
    author: 'Martha Wells',
    isbn: null,
    completedRemoteId: null,
    requestedAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    lastStatusSyncedAt: null,
    requestedPayload: {
      title: 'Murderbot Diaries',
      author: 'Martha Wells',
    },
    ...overrides,
  }
}

function makePage(): WarehouseRequestPage {
  return { items: [], page: 1, limit: 24, total: 0 }
}

function makeQueue(): WarehouseAudiobookQueuePage {
  return { items: [] }
}

function mountDialog(open = true) {
  return mount(CatalogAudiobookRequestDialog, {
    props: { open },
    global: {
      stubs: {
        Teleport: true,
      },
    },
  })
}

function findButton(wrapper: ReturnType<typeof mountDialog>, text: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().trim() === text)
  expect(button).toBeDefined()
  return button!
}

async function runSearch(wrapper: ReturnType<typeof mountDialog>, mode: 'Discover' | 'Candidates', query: string) {
  await wrapper.get('input[placeholder="Title or author"]').setValue(query)
  await findButton(wrapper, mode).trigger('click')
  await flushPromises()
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('CatalogAudiobookRequestDialog', () => {
  beforeEach(() => {
    mocks.fetchQueue.mockReset()
    mocks.fetchRequests.mockReset()
    mocks.refreshRequests.mockReset()
    mocks.searchCandidates.mockReset()
    mocks.searchExternal.mockReset()
    mocks.submit.mockReset()
    mocks.fetchQueue.mockResolvedValue(makeQueue())
    mocks.fetchRequests.mockResolvedValue(makePage())
    mocks.refreshRequests.mockResolvedValue(makePage())
    mocks.searchCandidates.mockResolvedValue({ results: [] })
    mocks.searchExternal.mockResolvedValue({ results: [] })
    mocks.submit.mockResolvedValue(makeRequest())
  })

  it('renders nothing when closed and does not load request data on mount', () => {
    const wrapper = mountDialog(false)

    expect(wrapper.text()).toBe('')
    expect(wrapper.find('input').exists()).toBe(false)
    expect(mocks.fetchRequests).not.toHaveBeenCalled()
    expect(mocks.fetchQueue).not.toHaveBeenCalled()
  })

  it('trims direct title and author submit, then emits submitted and close', async () => {
    const request = makeRequest({ id: 44, title: 'System Collapse', author: 'Martha Wells' })
    mocks.submit.mockResolvedValueOnce(request)
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="Title"]').setValue(' System Collapse ')
    await wrapper.get('input[placeholder="Author"]').setValue(' Martha Wells ')
    await findButton(wrapper, 'Submit request').trigger('click')
    await flushPromises()

    expect(mocks.submit).toHaveBeenCalledWith({ title: 'System Collapse', author: 'Martha Wells' })
    expect(wrapper.emitted('submitted')).toEqual([[request]])
    expect(wrapper.emitted('close')).toEqual([[]])
    expect((wrapper.get('input[placeholder="Title"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('input[placeholder="Author"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('input[placeholder="Title or author"]').element as HTMLInputElement).value).toBe('')
  })

  it('omits a blank author and disables blank direct submit', async () => {
    const wrapper = mountDialog()
    const submitButton = findButton(wrapper, 'Submit request')

    expect(submitButton.attributes('disabled')).toBeDefined()
    await submitButton.trigger('click')
    expect(mocks.submit).not.toHaveBeenCalled()

    await wrapper.get('input[placeholder="Title"]').setValue(' All Systems Red ')
    await wrapper.get('input[placeholder="Author"]').setValue('   ')
    await findButton(wrapper, 'Submit request').trigger('click')
    await flushPromises()

    expect(mocks.submit).toHaveBeenCalledWith({ title: 'All Systems Red' })
  })

  it('disables direct submit while saving', async () => {
    const submitRequest = deferred<WarehouseRequestDetail>()
    mocks.submit.mockReturnValueOnce(submitRequest.promise)
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="Title"]').setValue('All Systems Red')
    await findButton(wrapper, 'Submit request').trigger('click')
    await nextTick()

    expect(findButton(wrapper, 'Submit request').attributes('disabled')).toBeDefined()
    expect(mocks.submit).toHaveBeenCalledWith({ title: 'All Systems Red' })

    submitRequest.resolve(makeRequest())
    await flushPromises()
  })

  it('searches discovery and candidates with trimmed queries', async () => {
    mocks.searchExternal.mockResolvedValueOnce({
      results: [{ title: 'All Systems Red', author: 'Martha Wells', asin: 'B076XSGP65' }],
    })
    mocks.searchCandidates.mockResolvedValueOnce({
      results: [{ title: 'System Collapse', author: 'Martha Wells', narrators: ['Kevin R. Free'] }],
    })
    const wrapper = mountDialog()

    await runSearch(wrapper, 'Discover', ' murderbot ')

    expect(mocks.searchExternal).toHaveBeenCalledWith('murderbot')
    expect(wrapper.text()).toContain('All Systems Red')
    expect(wrapper.text()).toContain('Martha Wells')

    await runSearch(wrapper, 'Candidates', ' system ')

    expect(mocks.searchCandidates).toHaveBeenCalledWith('system')
    expect(wrapper.text()).toContain('System Collapse')
  })

  it('uses selected result to pre-fill title and author', async () => {
    mocks.searchExternal.mockResolvedValueOnce({
      results: [{ title: 'All Systems Red', author: 'Martha Wells', narrators: ['Kevin R. Free'] }],
    })
    const wrapper = mountDialog()

    await runSearch(wrapper, 'Discover', 'murderbot')
    await findButton(wrapper, 'Use').trigger('click')

    expect((wrapper.get('input[placeholder="Title"]').element as HTMLInputElement).value).toBe('All Systems Red')
    expect((wrapper.get('input[placeholder="Author"]').element as HTMLInputElement).value).toBe('Martha Wells')
  })

  it('requests selected result with only supported title and author fields', async () => {
    const result = {
      title: 'All Systems Red',
      author: 'Martha Wells',
      asin: 'B076XSGP65',
      source: 'Source-only label',
      upstream: 'Upstream-only label',
      vendor: 'Vendor-only label',
    } as WarehouseExternalAudiobookSearchResult & Record<string, unknown>
    const request = makeRequest({ id: 45, title: result.title })
    mocks.searchExternal.mockResolvedValueOnce({ results: [result] })
    mocks.submit.mockResolvedValueOnce(request)
    const wrapper = mountDialog()

    await runSearch(wrapper, 'Discover', 'murderbot')
    await findButton(wrapper, 'Request').trigger('click')
    await flushPromises()

    expect(mocks.submit).toHaveBeenCalledWith({ title: 'All Systems Red', author: 'Martha Wells' })
    expect(wrapper.emitted('submitted')).toEqual([[request]])
    expect(wrapper.text()).not.toMatch(/Book Warehouse|warehouse|third-party|upstream|provider|source|vendor/i)
  })

  it('shows native loading, empty, search failure, candidate failure, and submit failure states', async () => {
    const searchRequest = deferred<WarehouseAudiobookExternalSearchPage>()
    mocks.searchExternal.mockReturnValueOnce(searchRequest.promise)
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="Title or author"]').setValue('missing')
    await findButton(wrapper, 'Discover').trigger('click')

    expect(wrapper.text()).toContain('Searching...')

    searchRequest.resolve({ results: [] })
    await flushPromises()

    expect(wrapper.text()).toContain('No matches found')

    mocks.searchExternal.mockRejectedValueOnce(new Error('third-party provider exploded'))
    await runSearch(wrapper, 'Discover', 'still missing')

    expect(wrapper.text()).toContain('Failed to search titles')
    expect(wrapper.text().toLowerCase()).not.toContain('catalog')
    expect(wrapper.text()).not.toContain('third-party provider exploded')

    mocks.searchCandidates.mockRejectedValueOnce(new Error('upstream vendor exploded'))
    await runSearch(wrapper, 'Candidates', 'candidate')

    expect(wrapper.text()).toContain('Failed to search candidates')
    expect(wrapper.text()).not.toContain('upstream vendor exploded')

    mocks.submit.mockRejectedValueOnce(new Error('private submit failure'))
    await wrapper.get('input[placeholder="Title"]').setValue('All Systems Red')
    await findButton(wrapper, 'Submit request').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to submit request')
    expect(wrapper.text()).not.toContain('private submit failure')
  })

  it('resets local state from overlay and close icon without rendering cancel or stream controls', async () => {
    mocks.searchExternal.mockResolvedValueOnce({ results: [{ title: 'All Systems Red', author: 'Martha Wells' }] })
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="Title"]').setValue('All Systems Red')
    await wrapper.get('input[placeholder="Author"]').setValue('Martha Wells')
    await runSearch(wrapper, 'Discover', 'murderbot')
    expect(wrapper.text()).toContain('All Systems Red')

    await wrapper.get('[data-testid="audiobook-request-overlay"]').trigger('click')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect((wrapper.get('input[placeholder="Title"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('input[placeholder="Author"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('input[placeholder="Title or author"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.text()).not.toContain('Cancel')
    expect(wrapper.text()).not.toMatch(/stream/i)

    await wrapper.get('[data-testid="audiobook-request-close"]').trigger('click')

    expect(wrapper.emitted('close')).toEqual([[], []])
  })

  it('ignores in-flight search and submit completions after close', async () => {
    const searchRequest = deferred<WarehouseAudiobookExternalSearchPage>()
    const submitRequest = deferred<WarehouseRequestDetail>()
    mocks.searchExternal.mockReturnValueOnce(searchRequest.promise)
    mocks.submit.mockReturnValueOnce(submitRequest.promise)
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="Title or author"]').setValue('murderbot')
    await findButton(wrapper, 'Discover').trigger('click')
    await wrapper.get('[data-testid="audiobook-request-overlay"]').trigger('click')
    await wrapper.setProps({ open: false })

    searchRequest.resolve({ results: [{ title: 'All Systems Red', author: 'Martha Wells' }] })
    await flushPromises()
    await wrapper.setProps({ open: true })

    expect(wrapper.text()).not.toContain('All Systems Red')

    await wrapper.get('input[placeholder="Title"]').setValue('System Collapse')
    await findButton(wrapper, 'Submit request').trigger('click')
    await wrapper.get('[data-testid="audiobook-request-close"]').trigger('click')
    await wrapper.setProps({ open: false })

    submitRequest.resolve(makeRequest({ id: 51, title: 'System Collapse' }))
    await flushPromises()

    expect(wrapper.emitted('submitted')).toBeUndefined()
  })

  it('ignores stale search success and failure after the query changes', async () => {
    const staleSuccess = deferred<WarehouseAudiobookExternalSearchPage>()
    const staleFailure = deferred<WarehouseAudiobookExternalSearchPage>()
    mocks.searchExternal.mockReturnValueOnce(staleSuccess.promise).mockReturnValueOnce(staleFailure.promise)
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="Title or author"]').setValue('dune')
    await findButton(wrapper, 'Discover').trigger('click')
    await wrapper.get('input[placeholder="Title or author"]').setValue('murderbot')

    staleSuccess.resolve({ results: [{ title: 'Dune', author: 'Frank Herbert' }] })
    await flushPromises()

    expect(wrapper.text()).not.toContain('Dune')
    expect(wrapper.text()).not.toContain('Searching...')
    expect(findButton(wrapper, 'Discover').attributes('disabled')).toBeUndefined()

    await findButton(wrapper, 'Discover').trigger('click')
    await wrapper.get('input[placeholder="Title or author"]').setValue('system')

    staleFailure.reject(new Error('provider failed'))
    await flushPromises()

    expect(wrapper.text()).not.toContain('Failed to search titles')
    expect(wrapper.text()).not.toContain('provider failed')
    expect(wrapper.text()).not.toContain('Searching...')
    expect(findButton(wrapper, 'Discover').attributes('disabled')).toBeUndefined()
  })

  it('does not render banned wording in visible component text', () => {
    const wrapper = mountDialog()

    expect(wrapper.text()).toContain('Request Audiobook')
    expect(wrapper.text()).not.toMatch(/Book Warehouse|warehouse|third-party|upstream|provider|source|vendor/i)
  })
})
