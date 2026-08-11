import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WarehouseEbookExternalSearchPage,
  WarehouseEbookRequestSubmitPayload,
  WarehouseExternalBookSearchResult,
  WarehouseRequestDetail,
} from '@bookorbit/types'
import CatalogEbookRequestDialog from '../CatalogEbookRequestDialog.vue'

const mocks = vi.hoisted(() => ({
  searchExternal: vi.fn<(query: string) => Promise<WarehouseEbookExternalSearchPage>>(),
  submit: vi.fn<(payload: WarehouseEbookRequestSubmitPayload) => Promise<WarehouseRequestDetail>>(),
  fetchRequests: vi.fn<(query: unknown) => Promise<unknown>>(),
}))

vi.mock('@/features/warehouse/api/catalog-source.api', () => ({
  cancelCatalogSourceRequest: vi.fn<(id: number) => Promise<WarehouseRequestDetail>>(),
  fetchCatalogSourceRequests: mocks.fetchRequests,
  refreshCatalogSourceRequest: vi.fn<(id: number) => Promise<WarehouseRequestDetail>>(),
  searchCatalogSourceRequestBooks: mocks.searchExternal,
  submitCatalogSourceEbookRequest: mocks.submit,
}))

function makeRequest(overrides: Partial<WarehouseRequestDetail> = {}): WarehouseRequestDetail {
  return {
    id: 9,
    mediaType: 'ebook',
    status: 'pending',
    title: 'A Psalm for the Wild-Built',
    author: 'Becky Chambers',
    isbn: '9781250236210',
    completedRemoteId: null,
    requestedAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    lastStatusSyncedAt: null,
    requestedPayload: {
      isbn: '9781250236210',
      searchResult: {
        title: 'A Psalm for the Wild-Built',
        author: 'Becky Chambers',
        isbn: '9781250236210',
      },
    },
    ...overrides,
  }
}

function mountDialog(open = true) {
  return mount(CatalogEbookRequestDialog, {
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

async function search(wrapper: ReturnType<typeof mountDialog>, query: string) {
  await wrapper.get('input[placeholder="Title, author, or ISBN"]').setValue(query)
  await findButton(wrapper, 'Search').trigger('click')
  await flushPromises()
}

describe('CatalogEbookRequestDialog', () => {
  beforeEach(() => {
    mocks.searchExternal.mockReset()
    mocks.submit.mockReset()
    mocks.fetchRequests.mockReset()
    mocks.searchExternal.mockResolvedValue({ results: [] })
    mocks.submit.mockResolvedValue(makeRequest())
    mocks.fetchRequests.mockResolvedValue({ items: [], page: 1, limit: 24, total: 0 })
  })

  it('renders nothing when closed', () => {
    const wrapper = mountDialog(false)

    expect(wrapper.text()).toBe('')
    expect(wrapper.find('input').exists()).toBe(false)
  })

  it('does not load request history when mounted as a dialog', () => {
    mountDialog(false)

    expect(mocks.fetchRequests).not.toHaveBeenCalled()
  })

  it('trims manual ISBN submit, then emits submitted and close', async () => {
    const request = makeRequest({ id: 44, isbn: '9781250236210' })
    mocks.submit.mockResolvedValueOnce(request)
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="ISBN"]').setValue(' 9781250236210 ')
    await findButton(wrapper, 'Submit request').trigger('click')
    await flushPromises()

    expect(mocks.submit).toHaveBeenCalledWith({ isbn: '9781250236210' })
    expect(wrapper.emitted('submitted')).toEqual([[request]])
    expect(wrapper.emitted('close')).toEqual([[]])
    expect((wrapper.get('input[placeholder="ISBN"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('input[placeholder="Title, author, or ISBN"]').element as HTMLInputElement).value).toBe('')
  })

  it('disables blank manual ISBN submit', async () => {
    const wrapper = mountDialog()
    const submitButton = findButton(wrapper, 'Submit request')

    expect(submitButton.attributes('disabled')).toBeDefined()
    await submitButton.trigger('click')

    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('disables manual ISBN submit while saving', async () => {
    let resolve!: (request: WarehouseRequestDetail) => void
    mocks.submit.mockReturnValueOnce(
      new Promise((promiseResolve) => {
        resolve = promiseResolve
      }),
    )
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="ISBN"]').setValue('9781250236210')
    const submitButton = findButton(wrapper, 'Submit request')
    await submitButton.trigger('click')
    await nextTick()

    expect(findButton(wrapper, 'Submit request').attributes('disabled')).toBeDefined()
    expect(mocks.submit).toHaveBeenCalledWith({ isbn: '9781250236210' })

    resolve(makeRequest())
    await flushPromises()
  })

  it('trims search query, calls searchExternal, and renders returned results', async () => {
    mocks.searchExternal.mockResolvedValueOnce({
      results: [
        {
          title: 'A Psalm for the Wild-Built',
          author: 'Becky Chambers',
          isbn: '9781250236210',
        },
      ],
    })
    const wrapper = mountDialog()

    await search(wrapper, ' psalm ')

    expect(mocks.searchExternal).toHaveBeenCalledWith('psalm')
    expect(wrapper.text()).toContain('A Psalm for the Wild-Built')
    expect(wrapper.text()).toContain('Becky Chambers')
    expect(wrapper.text()).toContain('9781250236210')
  })

  it('submits selected search result without leaking unsupported fields into visible copy', async () => {
    const searchResult = {
      title: 'The Long Way to a Small Angry Planet',
      author: 'Becky Chambers',
      vendor: 'Vendor-only label',
      upstream: 'Upstream-only label',
      source: 'Source-only label',
    } as WarehouseExternalBookSearchResult & Record<string, unknown>
    const request = makeRequest({ id: 51, title: searchResult.title, isbn: null })
    mocks.searchExternal.mockResolvedValueOnce({ results: [searchResult] })
    mocks.submit.mockResolvedValueOnce(request)
    const wrapper = mountDialog()

    await search(wrapper, ' angry planet ')
    await findButton(wrapper, 'Request').trigger('click')
    await flushPromises()

    expect(mocks.submit).toHaveBeenCalledWith({
      searchResult: {
        title: 'The Long Way to a Small Angry Planet',
        author: 'Becky Chambers',
      },
    })
    expect(wrapper.emitted('submitted')).toEqual([[request]])
    expect(wrapper.text()).not.toMatch(/Book Warehouse|warehouse|third-party|upstream|provider|source|vendor/i)
  })

  it('includes ISBN when submitting a selected result that has one', async () => {
    const searchResult = {
      title: 'A Psalm for the Wild-Built',
      author: 'Becky Chambers',
      isbn: '9781250236210',
    }
    mocks.searchExternal.mockResolvedValueOnce({ results: [searchResult] })
    const wrapper = mountDialog()

    await search(wrapper, ' psalm ')
    await findButton(wrapper, 'Request').trigger('click')
    await flushPromises()

    expect(mocks.submit).toHaveBeenCalledWith({ searchResult, isbn: '9781250236210' })
  })

  it('shows safe search and submit failure messages', async () => {
    mocks.searchExternal.mockRejectedValueOnce(new Error('third-party provider exploded'))
    const wrapper = mountDialog()

    await search(wrapper, 'missing')

    expect(wrapper.text()).toContain('Failed to search titles')
    expect(wrapper.text().toLowerCase()).not.toContain('catalog')
    expect(wrapper.text()).not.toContain('third-party provider exploded')

    mocks.submit.mockRejectedValueOnce(new Error('upstream vendor failed'))
    await wrapper.get('input[placeholder="ISBN"]').setValue('9781250236210')
    await findButton(wrapper, 'Submit request').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to submit request')
    expect(wrapper.text()).not.toContain('upstream vendor failed')
  })

  it('clears local state when closed and reopened', async () => {
    mocks.searchExternal.mockResolvedValueOnce({
      results: [{ title: 'A Psalm for the Wild-Built', author: 'Becky Chambers', isbn: '9781250236210' }],
    })
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="ISBN"]').setValue('9781250236210')
    await search(wrapper, 'psalm')
    expect(wrapper.text()).toContain('A Psalm for the Wild-Built')

    await findButton(wrapper, 'Cancel').trigger('click')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect((wrapper.get('input[placeholder="ISBN"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('input[placeholder="Title, author, or ISBN"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.text()).not.toContain('A Psalm for the Wild-Built')
  })

  it('ignores stale search results after the query changes while searching', async () => {
    let resolveFirst!: (page: WarehouseEbookExternalSearchPage) => void
    mocks.searchExternal.mockReturnValueOnce(
      new Promise((promiseResolve) => {
        resolveFirst = promiseResolve
      }),
    )
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="Title, author, or ISBN"]').setValue('dune')
    await findButton(wrapper, 'Search').trigger('click')
    await wrapper.get('input[placeholder="Title, author, or ISBN"]').setValue('psalm')

    resolveFirst({ results: [{ title: 'Dune', author: 'Frank Herbert' }] })
    await flushPromises()

    expect(wrapper.text()).not.toContain('Dune')
    expect(wrapper.text()).not.toContain('Searching...')
    expect(findButton(wrapper, 'Search').attributes('disabled')).toBeUndefined()
  })

  it('ignores stale search failures after the query changes while searching', async () => {
    let rejectSearch!: (error: Error) => void
    mocks.searchExternal.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectSearch = reject
      }),
    )
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="Title, author, or ISBN"]').setValue('dune')
    await findButton(wrapper, 'Search').trigger('click')
    await wrapper.get('input[placeholder="Title, author, or ISBN"]').setValue('psalm')

    rejectSearch(new Error('provider failed'))
    await flushPromises()

    expect(wrapper.text()).not.toContain('Failed to search titles')
    expect(wrapper.text()).not.toContain('provider failed')
    expect(wrapper.text()).not.toContain('Searching...')
    expect(findButton(wrapper, 'Search').attributes('disabled')).toBeUndefined()
  })

  it('ignores in-flight search failures after close', async () => {
    let rejectSearch!: (error: Error) => void
    mocks.searchExternal.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectSearch = reject
      }),
    )
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="Title, author, or ISBN"]').setValue('missing')
    await findButton(wrapper, 'Search').trigger('click')
    await findButton(wrapper, 'Cancel').trigger('click')
    await wrapper.setProps({ open: false })

    rejectSearch(new Error('provider failed'))
    await flushPromises()
    await wrapper.setProps({ open: true })

    expect(wrapper.text()).not.toContain('Failed to search titles')
    expect(wrapper.text()).not.toContain('provider failed')
  })

  it('shows native loading and empty search states', async () => {
    let resolve!: (page: WarehouseEbookExternalSearchPage) => void
    mocks.searchExternal.mockReturnValueOnce(
      new Promise((promiseResolve) => {
        resolve = promiseResolve
      }),
    )
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="Title, author, or ISBN"]').setValue('none')
    await findButton(wrapper, 'Search').trigger('click')

    expect(wrapper.text()).toContain('Searching...')

    resolve({ results: [] })
    await flushPromises()

    expect(wrapper.text()).toContain('No matches found')
  })

  it('emits close from the overlay, close icon, and Cancel', async () => {
    const wrapper = mountDialog()

    await wrapper.get('[data-testid="ebook-request-overlay"]').trigger('click')
    await wrapper.get('[data-testid="ebook-request-close"]').trigger('click')
    await findButton(wrapper, 'Cancel').trigger('click')

    expect(wrapper.emitted('close')).toEqual([[], [], []])
  })

  it('does not render banned wording in visible component text', () => {
    const wrapper = mountDialog()

    expect(wrapper.text()).not.toMatch(/Book Warehouse|warehouse|third-party|upstream|provider|source|vendor/i)
  })
})
