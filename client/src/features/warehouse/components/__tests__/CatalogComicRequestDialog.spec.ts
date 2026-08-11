import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WarehouseComicRequestSubmitPayload, WarehouseRequestDetail, WarehouseRequestListQuery, WarehouseRequestPage } from '@bookorbit/types'
import CatalogComicRequestDialog from '../CatalogComicRequestDialog.vue'

const mocks = vi.hoisted(() => ({
  fetchRequests: vi.fn<(query: WarehouseRequestListQuery) => Promise<WarehouseRequestPage>>(),
  submit: vi.fn<(payload: WarehouseComicRequestSubmitPayload) => Promise<WarehouseRequestDetail>>(),
}))

vi.mock('@/features/warehouse/api/catalog-source.api', () => ({
  fetchCatalogSourceComicRequests: mocks.fetchRequests,
  submitCatalogSourceComicRequest: mocks.submit,
}))

function makeRequest(overrides: Partial<WarehouseRequestDetail> = {}): WarehouseRequestDetail {
  return {
    id: 51,
    mediaType: 'comic',
    status: 'pending',
    title: 'Saga #1',
    author: 'Image',
    isbn: null,
    completedRemoteId: null,
    requestedAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    lastStatusSyncedAt: null,
    requestedPayload: {
      seriesTitle: 'Saga',
      issueNumber: '1',
      publisher: 'Image',
      year: 2012,
    },
    ...overrides,
  }
}

function makePage(): WarehouseRequestPage {
  return { items: [], page: 1, limit: 24, total: 0 }
}

function mountDialog(open = true) {
  return mount(CatalogComicRequestDialog, {
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('CatalogComicRequestDialog', () => {
  beforeEach(() => {
    mocks.fetchRequests.mockReset()
    mocks.submit.mockReset()
    mocks.fetchRequests.mockResolvedValue(makePage())
    mocks.submit.mockResolvedValue(makeRequest())
  })

  it('renders nothing when closed and does not load request data on mount', () => {
    const wrapper = mountDialog(false)

    expect(wrapper.text()).toBe('')
    expect(wrapper.find('input').exists()).toBe(false)
    expect(mocks.fetchRequests).not.toHaveBeenCalled()
  })

  it('trims comic request fields and emits submitted and close', async () => {
    const request = makeRequest({ id: 71, title: 'Saga #1' })
    mocks.submit.mockResolvedValueOnce(request)
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="Series title"]').setValue(' Saga ')
    await wrapper.get('input[placeholder="Issue"]').setValue(' 1 ')
    await wrapper.get('input[placeholder="Publisher"]').setValue(' Image ')
    await wrapper.get('input[placeholder="Year"]').setValue('2012')
    await findButton(wrapper, 'Submit request').trigger('click')
    await flushPromises()

    expect(mocks.submit).toHaveBeenCalledWith({ seriesTitle: 'Saga', issueNumber: '1', publisher: 'Image', year: 2012 })
    expect(wrapper.emitted('submitted')).toEqual([[request]])
    expect(wrapper.emitted('close')).toEqual([[]])
    expect((wrapper.get('input[placeholder="Series title"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('input[placeholder="Issue"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('input[placeholder="Publisher"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('input[placeholder="Year"]').element as HTMLInputElement).value).toBe('')
  })

  it('omits blank optional fields and disables blank series submit', async () => {
    const wrapper = mountDialog()
    const submitButton = findButton(wrapper, 'Submit request')

    expect(submitButton.attributes('disabled')).toBeDefined()
    await submitButton.trigger('click')
    expect(mocks.submit).not.toHaveBeenCalled()

    await wrapper.get('input[placeholder="Series title"]').setValue(' Monstress ')
    await wrapper.get('input[placeholder="Issue"]').setValue('   ')
    await wrapper.get('input[placeholder="Publisher"]').setValue('   ')
    await wrapper.get('input[placeholder="Year"]').setValue('')
    await findButton(wrapper, 'Submit request').trigger('click')
    await flushPromises()

    expect(mocks.submit).toHaveBeenCalledWith({ seriesTitle: 'Monstress' })
  })

  it('disables direct submit while saving', async () => {
    const submitRequest = deferred<WarehouseRequestDetail>()
    mocks.submit.mockReturnValueOnce(submitRequest.promise)
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="Series title"]').setValue('Saga')
    await findButton(wrapper, 'Submit request').trigger('click')
    await nextTick()

    expect(findButton(wrapper, 'Submit request').attributes('disabled')).toBeDefined()
    expect(mocks.submit).toHaveBeenCalledWith({ seriesTitle: 'Saga' })

    submitRequest.resolve(makeRequest())
    await flushPromises()
  })

  it('shows safe submit failure copy and hides private details', async () => {
    mocks.submit.mockRejectedValueOnce(new Error('private upstream request failure'))
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="Series title"]').setValue('Saga')
    await findButton(wrapper, 'Submit request').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to submit request')
    expect(wrapper.text()).not.toContain('private upstream request failure')
    expect(wrapper.text()).not.toMatch(/Book Warehouse|warehouse|third-party|upstream|provider|source|vendor/i)
  })

  it('resets local state from overlay and close icon without rendering unsupported controls', async () => {
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="Series title"]').setValue('Saga')
    await wrapper.get('input[placeholder="Issue"]').setValue('1')
    await wrapper.get('[data-testid="comic-request-overlay"]').trigger('click')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect((wrapper.get('input[placeholder="Series title"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('input[placeholder="Issue"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.text()).not.toMatch(/Search|Cancel request|Stream/i)

    await wrapper.get('[data-testid="comic-request-close"]').trigger('click')

    expect(wrapper.emitted('close')).toEqual([[], []])
  })

  it('ignores in-flight submit completion after close', async () => {
    const submitRequest = deferred<WarehouseRequestDetail>()
    mocks.submit.mockReturnValueOnce(submitRequest.promise)
    const wrapper = mountDialog()

    await wrapper.get('input[placeholder="Series title"]').setValue('Saga')
    await findButton(wrapper, 'Submit request').trigger('click')
    await wrapper.get('[data-testid="comic-request-close"]').trigger('click')
    await wrapper.setProps({ open: false })

    submitRequest.resolve(makeRequest({ id: 77 }))
    await flushPromises()

    expect(wrapper.emitted('submitted')).toBeUndefined()
  })
})
