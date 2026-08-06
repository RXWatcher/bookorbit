import { mount } from '@vue/test-utils'
import { CLOUD_AUDIO_LIBRARY_ID } from '@bookorbit/types'
import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BookUploadModal from '../BookUploadModal.vue'

const routerPush = vi.fn<() => Promise<void>>()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
}))

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => Promise<{ ok: boolean; json: () => Promise<{ id: number; name: string; folders: unknown[] }> }>>().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ id: CLOUD_AUDIO_LIBRARY_ID, name: 'Audio Library', folders: [] }),
  }),
}))

vi.mock('../../composables/useLibraries', () => ({
  useLibraries: () => ({ libraries: ref([]), fetchLibraries: vi.fn<() => Promise<void>>() }),
}))

vi.mock('../../composables/useLibraryUploadEvents', () => ({
  emitLibraryUploadCompleted: vi.fn<() => void>(),
}))

vi.mock('../../composables/useBookUpload', () => ({
  SUPPORTED_FORMATS: ['EPUB'],
  SUPPORTED_FORMATS_ACCEPT: '.epub',
  useBookUpload: () => ({
    files: ref([
      {
        id: 'file-1',
        file: new File(['audio'], 'Audio Book.mp3', { type: 'audio/mpeg' }),
        status: 'done',
        progress: 100,
        bookId: 101,
      },
    ]),
    pendingCount: ref(0),
    isUploading: ref(false),
    doneCount: ref(1),
    errorCount: ref(0),
    uploadedBookIds: ref([101]),
    addFiles: vi.fn<() => void>(),
    removeFile: vi.fn<() => void>(),
    retryFile: vi.fn<() => void>(),
    reset: vi.fn<() => void>(),
    startUpload: vi.fn<() => Promise<void>>(),
  }),
}))

describe('BookUploadModal', () => {
  beforeEach(() => {
    routerPush.mockClear()
    document.body.innerHTML = ''
  })

  it('uses friendly source-backed library route params from the success action', async () => {
    mount(BookUploadModal, {
      props: { libraryId: CLOUD_AUDIO_LIBRARY_ID },
      attachTo: document.body,
      global: { stubs: { Teleport: true } },
    })
    await nextTick()

    const button = Array.from(document.body.querySelectorAll('button')).find((candidate) => candidate.textContent?.includes('View in Library'))
    expect(button).toBeTruthy()
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(routerPush).toHaveBeenCalledWith({ name: 'library', params: { id: 'audiobooks' } })
  })
})
