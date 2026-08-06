import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const authState = vi.hoisted(() => ({
  user: {
    __v_isRef: true,
    value: {
      settings: {
        notificationPreferences: {},
      },
    },
  },
  me: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => authState,
}))

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => Promise<Response>>(),
}))

vi.mock('@/features/settings/SettingsPageHeader.vue', () => ({
  default: { template: '<div data-testid="settings-page-header" />' },
}))

import NotificationPreferences from '../NotificationPreferences.vue'

describe('NotificationPreferences', () => {
  it('labels request notifications with native request wording', () => {
    const wrapper = mount(NotificationPreferences, { props: { embedded: true } })

    expect(wrapper.text()).toContain('Library Requests')
    expect(wrapper.text()).not.toContain('Catalog Requests')
  })
})
