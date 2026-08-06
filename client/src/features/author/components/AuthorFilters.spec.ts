import { mount } from '@vue/test-utils'
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types'
import { describe, expect, it } from 'vitest'
import AuthorFilters from './AuthorFilters.vue'

describe('AuthorFilters', () => {
  it('uses friendly source-backed library option values while emitting numeric ids', async () => {
    const wrapper = mount(AuthorFilters, {
      props: {
        libraryId: CLOUD_EBOOK_LIBRARY_ID,
        libraries: [
          { id: CLOUD_EBOOK_LIBRARY_ID, name: 'Ebook Library' },
          { id: CLOUD_AUDIO_LIBRARY_ID, name: 'Audio Library' },
          { id: 7, name: 'Local Library' },
        ],
        hasPhoto: null,
        minBookCount: null,
      },
    })

    const librarySelect = wrapper.get('select')
    const optionValues = wrapper.findAll('option').map((option) => option.attributes('value'))

    expect((librarySelect.element as HTMLSelectElement).value).toBe('ebooks')
    expect(optionValues).toContain('ebooks')
    expect(optionValues).toContain('audiobooks')
    expect(optionValues).not.toContain(String(CLOUD_EBOOK_LIBRARY_ID))
    expect(optionValues).not.toContain(String(CLOUD_AUDIO_LIBRARY_ID))

    await librarySelect.setValue('audiobooks')

    expect(wrapper.emitted('update:libraryId')?.at(-1)).toEqual([CLOUD_AUDIO_LIBRARY_ID])
  })
})
