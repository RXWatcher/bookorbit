import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, computed } from 'vue'
import ReaderSettings from '../ReaderSettings.vue'

// --- Module-level mutable state for mocks ---

const userState = {
  settings: { syncReaderPreferences: false } as Record<string, unknown>,
}

const permissionState = { isDemo: false }

const apiMock = vi.fn<(...args: unknown[]) => Promise<{ ok: boolean }>>()

// --- Mocks ---

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => {
    const user = ref({ ...userState, settings: { ...userState.settings } })
    return { user }
  },
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    isDemoRestrictedAccount: computed(() => permissionState.isDemo),
  }),
}))

vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() },
}))

vi.mock('../SettingsPageHeader.vue', () => ({
  default: { template: '<div />' },
}))

import { toast } from 'vue-sonner'

function mountComponent(embedded = false) {
  return mount(ReaderSettings, { props: { embedded } })
}

describe('ReaderSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    permissionState.isDemo = false
    userState.settings = { syncReaderPreferences: false }
    apiMock.mockResolvedValue({ ok: true })
  })

  describe('non-demo user', () => {
    it('shows "This device only" as active when syncReaderPreferences is false', () => {
      userState.settings = { syncReaderPreferences: false }
      const wrapper = mountComponent()

      expect(wrapper.text()).toContain('This device only')
      const cards = wrapper.findAll('.rounded-lg.border-2')
      const deviceCard = cards[0]!
      expect(deviceCard.classes()).toContain('border-primary')
      expect(deviceCard.text()).toContain('Active')
    })

    it('shows "My account" as active when syncReaderPreferences is true', () => {
      userState.settings = { syncReaderPreferences: true }
      const wrapper = mountComponent()

      const cards = wrapper.findAll('.rounded-lg.border-2')
      const accountCard = cards[1]!
      expect(accountCard.classes()).toContain('border-primary')
      expect(accountCard.text()).toContain('Active')
    })

    it('does not show "Not available" badge for My account', () => {
      userState.settings = { syncReaderPreferences: false }
      const wrapper = mountComponent()
      expect(wrapper.text()).not.toContain('Not available')
    })

    it('calls the reader-storage-mode endpoint when switching to My account', async () => {
      userState.settings = { syncReaderPreferences: false }
      const wrapper = mountComponent()

      const cards = wrapper.findAll('.rounded-lg.border-2')
      await cards[1]!.trigger('click')
      await flushPromises()

      expect(apiMock).toHaveBeenCalledWith(
        '/api/v1/users/me/reader-storage-mode',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ sync: true }),
        }),
      )
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Preferences will now be synced')
    })

    it('calls the reader-storage-mode endpoint when switching to This device only', async () => {
      userState.settings = { syncReaderPreferences: true }
      const wrapper = mountComponent()

      const cards = wrapper.findAll('.rounded-lg.border-2')
      await cards[0]!.trigger('click')
      await flushPromises()

      expect(apiMock).toHaveBeenCalledWith(
        '/api/v1/users/me/reader-storage-mode',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ sync: false }),
        }),
      )
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Preferences will stay on this device')
    })

    it('does not call api when clicking the already active option', async () => {
      userState.settings = { syncReaderPreferences: false }
      const wrapper = mountComponent()

      const cards = wrapper.findAll('.rounded-lg.border-2')
      await cards[0]!.trigger('click')
      await flushPromises()

      expect(apiMock).not.toHaveBeenCalled()
    })

    it('shows error toast when api returns non-ok', async () => {
      apiMock.mockResolvedValue({ ok: false })
      userState.settings = { syncReaderPreferences: false }
      const wrapper = mountComponent()

      const cards = wrapper.findAll('.rounded-lg.border-2')
      await cards[1]!.trigger('click')
      await flushPromises()

      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to update storage mode')
    })

    it('shows error toast when api throws a network error', async () => {
      apiMock.mockRejectedValue(new Error('Network error'))
      userState.settings = { syncReaderPreferences: false }
      const wrapper = mountComponent()

      const cards = wrapper.findAll('.rounded-lg.border-2')
      await cards[1]!.trigger('click')
      await flushPromises()

      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('An error occurred while updating storage mode')
    })

    it('does not render SettingsPageHeader when embedded', () => {
      const wrapper = mountComponent(true)
      expect(wrapper.findComponent({ name: 'SettingsPageHeader' }).exists()).toBe(false)
    })

    it('renders SettingsPageHeader when not embedded', () => {
      const wrapper = mountComponent(false)
      expect(wrapper.findComponent({ name: 'SettingsPageHeader' }).exists()).toBe(true)
    })
  })

  describe('demo user', () => {
    beforeEach(() => {
      permissionState.isDemo = true
      userState.settings = { syncReaderPreferences: false }
    })

    it('always shows "This device only" as active regardless of user settings', () => {
      userState.settings = { syncReaderPreferences: true }
      const wrapper = mountComponent()

      const cards = wrapper.findAll('.rounded-lg.border-2')
      const deviceCard = cards[0]!
      expect(deviceCard.classes()).toContain('border-primary')
      expect(deviceCard.text()).toContain('Active')
    })

    it('shows "Not available" badge on My account card', () => {
      const wrapper = mountComponent()
      expect(wrapper.text()).toContain('Not available')
    })

    it('My account card is visually disabled (opacity and cursor)', () => {
      const wrapper = mountComponent()
      const cards = wrapper.findAll('.rounded-lg.border-2')
      const accountCard = cards[1]!
      expect(accountCard.classes()).toContain('opacity-50')
      expect(accountCard.classes()).toContain('cursor-not-allowed')
    })

    it('does not call api when clicking My account', async () => {
      const wrapper = mountComponent()

      const cards = wrapper.findAll('.rounded-lg.border-2')
      await cards[1]!.trigger('click')
      await flushPromises()

      expect(apiMock).not.toHaveBeenCalled()
    })

    it('shows toast error when clicking My account', async () => {
      const wrapper = mountComponent()

      const cards = wrapper.findAll('.rounded-lg.border-2')
      await cards[1]!.trigger('click')
      await flushPromises()

      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Demo-restricted account cannot change reader storage mode')
    })

    it('does not call api when clicking This device only (already active)', async () => {
      const wrapper = mountComponent()

      const cards = wrapper.findAll('.rounded-lg.border-2')
      await cards[0]!.trigger('click')
      await flushPromises()

      expect(apiMock).not.toHaveBeenCalled()
    })
  })
})
