import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useReaderSettings } from '../useReaderSettings'

const apiMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>())
const userState = vi.hoisted(() => ({
  settings: { syncReaderPreferences: true } as Record<string, unknown>,
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => ({
    user: ref({ settings: { ...userState.settings } }),
  }),
}))

describe('useReaderSettings', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    userState.settings = { syncReaderPreferences: true }
    apiMock.mockResolvedValue({ ok: true, json: vi.fn<() => Promise<unknown>>().mockResolvedValue({}) })
  })

  it('uses a custom per-book storage key without syncing local file preferences', async () => {
    const settings = useReaderSettings(0, 'epub', {
      bookStorageKey: 'reader:catalog:ebook:remote-7',
      syncBookPreferences: false,
    })

    await settings.load()
    settings.updateBookSettings({ fontSize: 1.25 })

    expect(localStorage.getItem('reader:book:0')).toBeNull()
    expect(JSON.parse(localStorage.getItem('reader:catalog:ebook:remote-7') ?? '{}')).toEqual({ fontSize: 1.25 })
    expect(apiMock).toHaveBeenCalledWith('/api/v1/reader/defaults')
    expect(apiMock).not.toHaveBeenCalledWith('/api/v1/reader/preferences/0')
    expect(apiMock).not.toHaveBeenCalledWith('/api/v1/reader/preferences/0', expect.anything())
  })
})
