import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BookCoverPlaceholder from '../BookCoverPlaceholder.vue'
import { useThemeStore } from '@/stores/theme'

type PaletteResult = {
  gradient: string
  from: string
  to: string
  color: string
  accent: string
  textMuted: string
}

const paletteSpy = vi.fn<() => PaletteResult>(() => ({
  gradient: 'linear-gradient(135deg, oklch(0.6 0.18 210) 0%, oklch(0.45 0.18 210) 100%)',
  from: 'oklch(0.6 0.18 210)',
  to: 'oklch(0.45 0.18 210)',
  color: 'oklch(0.99 0.01 210)',
  accent: 'oklch(0.86 0.08 210)',
  textMuted: 'oklch(0.9 0.02 210)',
}))

vi.mock('@/features/book/lib/book-cover', () => ({
  bookCoverPalette: (...args: Parameters<typeof paletteSpy>) => paletteSpy(...args),
}))

describe('BookCoverPlaceholder', () => {
  beforeEach(() => {
    paletteSpy.mockClear()
  })

  it('recomputes palette when accent changes', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(BookCoverPlaceholder, {
      props: {
        title: 'Dune',
        authorLine: 'Frank Herbert',
        isAudio: false,
        seed: 'dune-seed',
      },
      global: { plugins: [pinia] },
    })

    const store = useThemeStore(pinia)
    const initialCalls = paletteSpy.mock.calls.length
    store.setAccent(store.accent === 'blue' ? 'rose' : 'blue')
    await nextTick()

    expect(paletteSpy.mock.calls.length).toBeGreaterThan(initialCalls)
    wrapper.unmount()
  })

  it('recomputes palette when light/dark theme changes', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(BookCoverPlaceholder, {
      props: {
        title: 'Dune',
        authorLine: 'Frank Herbert',
        isAudio: false,
        seed: 'dune-seed',
      },
      global: { plugins: [pinia] },
    })

    const store = useThemeStore(pinia)
    const initialCalls = paletteSpy.mock.calls.length
    store.setTheme(store.theme === 'dark' ? 'light' : 'dark')
    await nextTick()

    expect(paletteSpy.mock.calls.length).toBeGreaterThan(initialCalls)
    wrapper.unmount()
  })
})
