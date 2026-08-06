import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import MetadataAllSettings from '../MetadataAllSettings.vue'

const mocks = vi.hoisted(() => ({
  route: { query: {} as Record<string, unknown> },
  replace: vi.fn<(location: unknown) => void>(),
  permissions: new Set<string>(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ replace: mocks.replace }),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (name: string) => mocks.permissions.has(name),
  }),
}))

function stub(name: string) {
  return defineComponent({ name, template: `<div data-test="${name}" />` })
}

vi.mock('../metadata-preferences/MetadataPreferencesSettings.vue', () => ({ default: stub('providers') }))
vi.mock('../metadata-preferences/MetadataFieldRulesSettings.vue', () => ({ default: stub('field-rules') }))
vi.mock('../metadata-preferences/CustomMetadataSettings.vue', () => ({ default: stub('custom-fields') }))
vi.mock('../metadata-preferences/MetadataGenreBlocklistSettings.vue', () => ({ default: stub('genre-blocklist') }))
vi.mock('../MetadataScoreWeightsSettings.vue', () => ({ default: stub('score') }))
vi.mock('../metadata-auto-fetch/BookMetadataFetchSettings.vue', () => ({ default: stub('auto-fetch') }))
vi.mock('../AuthorEnrichmentSettings.vue', () => ({ default: stub('authors') }))
vi.mock('../SettingsPageHeader.vue', () => ({
  default: defineComponent({
    name: 'SettingsPageHeader',
    props: { title: String, subtitle: String },
    template: '<header><h1>{{ title }}</h1><p>{{ subtitle }}</p></header>',
  }),
}))

describe('MetadataAllSettings', () => {
  beforeEach(() => {
    mocks.route.query = {}
    mocks.replace.mockReset()
    mocks.permissions.clear()
  })

  it('renders no restricted metadata panels when the user has no metadata permissions', () => {
    mocks.route.query = { tab: 'custom-fields' }

    const wrapper = mount(MetadataAllSettings)

    expect(wrapper.text()).toContain('You do not have permission to manage metadata settings.')
    expect(wrapper.find('[data-test="custom-fields"]').exists()).toBe(false)
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('allows library managers to access only the custom fields tab', () => {
    mocks.permissions.add('manage_libraries')

    const wrapper = mount(MetadataAllSettings)

    expect(wrapper.find('[data-test="custom-fields"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="providers"]').exists()).toBe(false)
    expect(mocks.replace).toHaveBeenCalledWith({ name: 'settings-admin-metadata', query: { tab: 'custom-fields' } })
  })
})
