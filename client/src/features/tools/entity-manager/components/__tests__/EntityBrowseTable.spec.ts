import { describe, expect, it } from 'vitest'
import { mount, shallowMount } from '@vue/test-utils'
import { ENTITY_CAPABILITIES, type BrowseEntityItem } from '@bookorbit/types'

import EntityBrowseTable from '../EntityBrowseTable.vue'

function makeItem(id: number | string): BrowseEntityItem {
  return {
    id,
    name: `Entity ${id}`,
    bookCount: 1,
  }
}

function mountTable(overrides: Partial<InstanceType<typeof EntityBrowseTable>['$props']> = {}) {
  return shallowMount(EntityBrowseTable, {
    props: {
      items: [1, 2, 3].map(makeItem),
      total: 3,
      page: 1,
      pageSize: 25,
      totalPages: 1,
      search: '',
      sortBy: 'name',
      sortOrder: 'asc',
      bookCount: 'any',
      loading: false,
      selectedIds: new Set<number | string>(),
      capabilities: ENTITY_CAPABILITIES.author,
      isInline: false,
      ...overrides,
    },
  })
}

function mountTableWithDropdown(overrides: Partial<InstanceType<typeof EntityBrowseTable>['$props']> = {}) {
  return mount(EntityBrowseTable, {
    props: {
      items: [makeItem(1)],
      total: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
      search: '',
      sortBy: 'name',
      sortOrder: 'asc',
      bookCount: 'any',
      loading: false,
      selectedIds: new Set<number | string>(),
      capabilities: ENTITY_CAPABILITIES.author,
      isInline: false,
      ...overrides,
    },
    global: {
      stubs: {
        DropdownMenu: { template: '<div><slot /></div>' },
        DropdownMenuTrigger: { template: '<div><slot /></div>' },
        DropdownMenuContent: { template: '<div><slot /></div>' },
        DropdownMenuItem: { emits: ['click'], template: '<button class="dropdown-item" @click="$emit(\'click\')"><slot /></button>' },
        DropdownMenuSeparator: { template: '<hr />' },
      },
    },
  })
}

describe('EntityBrowseTable', () => {
  function rowCheckboxes(wrapper: ReturnType<typeof mountTable>) {
    return wrapper.findAll('input[type="checkbox"]').slice(1)
  }

  it('emits the checkbox click event so Shift-click selection can be handled by the parent', async () => {
    const wrapper = mountTable()
    const checkbox = rowCheckboxes(wrapper)[2]!

    await checkbox.trigger('click', { shiftKey: true })

    const selectEvent = wrapper.emitted('select')?.[0]
    expect(selectEvent?.[0]).toBe(3)
    expect(selectEvent?.[1]).toBeInstanceOf(MouseEvent)
    expect((selectEvent?.[1] as MouseEvent | undefined)?.shiftKey).toBe(true)
  })

  it('still emits ordinary checkbox clicks without Shift pressed', async () => {
    const wrapper = mountTable()
    const checkbox = rowCheckboxes(wrapper)[0]!

    await checkbox.trigger('click')

    const selectEvent = wrapper.emitted('select')?.[0]
    expect(selectEvent?.[0]).toBe(1)
    expect((selectEvent?.[1] as MouseEvent | undefined)?.shiftKey).toBe(false)
  })

  it('emits sort updates when the sort selector changes', async () => {
    const wrapper = mountTable()

    await wrapper.find('select').setValue('bookCount-asc')

    expect(wrapper.emitted('sortChange')?.[0]).toEqual(['bookCount', 'asc'])
  })

  it('emits all supported sort options from the sort selector', async () => {
    const wrapper = mountTable()
    const select = wrapper.find('select')

    await select.setValue('name-desc')
    await select.setValue('bookCount-desc')
    await select.setValue('name-asc')

    expect(wrapper.emitted('sortChange')).toEqual([
      ['name', 'desc'],
      ['bookCount', 'desc'],
      ['name', 'asc'],
    ])
  })

  it('emits empty-only filter updates for first-class entities', async () => {
    const wrapper = mountTable()

    const checkbox = wrapper.find('label input[type="checkbox"]')
    await checkbox.setValue(true)

    expect(wrapper.emitted('update:bookCount')?.[0]).toEqual(['empty'])
  })

  it('hides the empty-only filter for inline entity types', () => {
    const wrapper = mountTable({ isInline: true })

    expect(wrapper.text()).not.toContain('Empty only')
  })

  it('emits search updates from the search input', async () => {
    const wrapper = mountTable()

    await wrapper.find('input[type="text"]').setValue('tolkien')

    expect(wrapper.emitted('update:search')?.[0]).toEqual(['tolkien'])
  })

  it('emits previous and next page updates', async () => {
    const wrapper = mountTable({ items: [], total: 40, page: 2, totalPages: 3 })
    const buttons = wrapper.findAll('button')

    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')

    expect(wrapper.emitted('update:page')).toEqual([[1], [3]])
  })

  it('emits row action events', async () => {
    const item = makeItem(7)
    const wrapper = mountTable({ items: [item] })

    const buttons = wrapper.findAll('button')
    await buttons.find((button) => button.text() === 'Rename')!.trigger('click')
    await buttons.find((button) => button.text() === 'Split')!.trigger('click')
    await buttons.find((button) => button.text() === 'Delete')!.trigger('click')

    expect(wrapper.emitted('rename')?.[0]).toEqual([item])
    expect(wrapper.emitted('split')?.[0]).toEqual([item])
    expect(wrapper.emitted('delete')?.[0]).toEqual([item])
  })

  it('emits mobile dropdown action events', async () => {
    const item = makeItem(1)
    const wrapper = mountTableWithDropdown({ items: [item] })

    const dropdownItems = wrapper.findAll('.dropdown-item')
    await dropdownItems[0]!.trigger('click')
    await dropdownItems[1]!.trigger('click')
    await dropdownItems[2]!.trigger('click')

    expect(wrapper.emitted('rename')?.[0]).toEqual([item])
    expect(wrapper.emitted('split')?.[0]).toEqual([item])
    expect(wrapper.emitted('delete')?.[0]).toEqual([item])
  })

  it('emits bulk action and clear selection events', async () => {
    const wrapper = mountTable({ selectedIds: new Set([1, 2]) })

    const buttons = wrapper.findAll('button')
    await buttons.find((button) => button.text() === 'Clear')!.trigger('click')
    await buttons.find((button) => button.text() === 'Merge (2)')!.trigger('click')
    await buttons.find((button) => button.text() === 'Delete (2)')!.trigger('click')

    expect(wrapper.emitted('clearSelection')).toHaveLength(1)
    expect(wrapper.emitted('bulkMerge')).toHaveLength(1)
    expect(wrapper.emitted('bulkDelete')).toHaveLength(1)
  })

  it('shows loading and empty states', () => {
    expect(mountTable({ loading: true }).text()).toContain('Loading...')
    expect(mountTable({ items: [], total: 0 }).text()).toContain('No entities found')
  })
})
