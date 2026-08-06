import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import HighlightNoteEditor from '../HighlightNoteEditor.vue'

describe('HighlightNoteEditor', () => {
  it('renders textarea with initial note value', () => {
    const wrapper = mount(HighlightNoteEditor, {
      props: { initialNote: 'existing note' },
    })
    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)
    expect((textarea.element as HTMLTextAreaElement).value).toBe('existing note')
  })

  it('renders empty textarea when initialNote is null', () => {
    const wrapper = mount(HighlightNoteEditor, {
      props: { initialNote: null },
    })
    const textarea = wrapper.find('textarea')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('')
  })

  it('emits save with trimmed note on save button click', async () => {
    const wrapper = mount(HighlightNoteEditor, {
      props: { initialNote: null },
    })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('  new note  ')

    const saveBtn = wrapper.findAll('button').find((b) => b.text().includes('Save'))!
    await saveBtn.trigger('click')

    expect(wrapper.emitted('save')).toBeTruthy()
    expect(wrapper.emitted('save')![0]).toEqual(['new note'])
  })

  it('emits save with null when note is empty/whitespace', async () => {
    const wrapper = mount(HighlightNoteEditor, {
      props: { initialNote: 'old note' },
    })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('   ')

    const saveBtn = wrapper.findAll('button').find((b) => b.text().includes('Save'))!
    await saveBtn.trigger('click')

    expect(wrapper.emitted('save')![0]).toEqual([null])
  })

  it('emits cancel on cancel button click', async () => {
    const wrapper = mount(HighlightNoteEditor, {
      props: { initialNote: null },
    })
    const cancelBtn = wrapper.findAll('button').find((b) => b.text().includes('Cancel'))!
    await cancelBtn.trigger('click')

    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('shows placeholder text', () => {
    const wrapper = mount(HighlightNoteEditor, {
      props: { initialNote: null },
    })
    expect(wrapper.find('textarea').attributes('placeholder')).toBe('Add a note...')
  })
})
