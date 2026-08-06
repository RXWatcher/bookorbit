import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import BulkDeleteModal from '../BulkDeleteModal.vue'

function mountModal(overrides: Partial<InstanceType<typeof BulkDeleteModal>['$props']> = {}) {
  return mount(BulkDeleteModal, {
    props: {
      count: 3,
      isInline: false,
      loading: false,
      ...overrides,
    },
  })
}

describe('BulkDeleteModal', () => {
  it('uses the default delete mode when confirming', async () => {
    const wrapper = mountModal({ defaultMode: 'hard' })

    await wrapper.findAll('button').at(-1)!.trigger('click')

    expect(wrapper.emitted('confirm')?.[0]).toEqual(['hard', false])
  })

  it('emits inline mode for inline entity deletes', async () => {
    const wrapper = mountModal({ isInline: true, defaultMode: 'soft' })

    await wrapper.findAll('button').at(-1)!.trigger('click')

    expect(wrapper.text()).not.toContain('Delete mode')
    expect(wrapper.emitted('confirm')?.[0]).toEqual(['inline', false])
  })

  it('emits selected mode and write-files preference', async () => {
    const wrapper = mountModal()
    const radios = wrapper.findAll('input[type="radio"]')

    await radios.find((radio) => radio.attributes('value') === 'hard')!.setValue()
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await wrapper.findAll('button').at(-1)!.trigger('click')

    expect(wrapper.emitted('confirm')?.[0]).toEqual(['hard', true])
  })

  it('emits cancel from the close button and backdrop', async () => {
    const wrapper = mountModal()

    await wrapper.findAll('button')[0]!.trigger('click')
    await wrapper.find('.fixed').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(2)
  })
})
