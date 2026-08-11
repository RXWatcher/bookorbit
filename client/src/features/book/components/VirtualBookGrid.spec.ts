import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { BookCard } from '@bookorbit/types'
import VirtualBookGrid from './VirtualBookGrid.vue'
import type { BookSlot } from '../composables/useBookWindow'

vi.mock('./BookCoverCard.vue', () => ({
  default: {
    name: 'BookCoverCard',
    props: ['book', 'selectionMode', 'selected', 'showLabel', 'coverAspectRatio'],
    emits: ['action', 'select', 'update:book'],
    template:
      '<div>' +
      '<button data-testid="book-card" :data-cover-ratio="coverAspectRatio || \'\'" @click="$emit(\'action\', \'quick-view\')">' +
      '{{ book.id }}<span v-if="showLabel" data-testid="book-card-label-slot" /></button>' +
      '<button data-testid="book-card-select" @click="$emit(\'select\', $event)">select</button>' +
      '<button data-testid="book-card-update" @click="$emit(\'update:book\', { ...book, title: \'Updated\' })">update</button>' +
      '</div>',
  },
}))

vi.mock('./CollapsedSeriesCard.vue', () => ({
  default: {
    name: 'CollapsedSeriesCard',
    props: ['book', 'showLabel', 'selectionMode'],
    template:
      '<div data-testid="collapsed-series-card" :data-selection-mode="String(selectionMode)">{{ book.id }}<span v-if="showLabel" data-testid="series-card-label-slot" /></div>',
  },
}))

const displaySettingsState = {
  gridCardPrimaryLabel: ref('hidden'),
  gridCardSecondaryLabel: ref('hidden'),
  cardInfoMode: ref('hover-overlay'),
}

vi.mock('@/composables/useDisplaySettings', () => ({
  useDisplaySettings: () => displaySettingsState,
}))

function makeBook(id: number, overrides: Partial<BookCard> = {}): BookCard {
  return {
    id,
    status: 'present',
    coverAspectRatio: '2/3',
    title: `Book ${id}`,
    authors: [],
    seriesName: null,
    seriesIndex: id,
    files: [],
    publishedDate: null,
    publishedYear: null,
    language: null,
    genres: [],
    tags: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    metadataScore: null,
    hasCover: false,
    hasMetadataLocks: false,
    lockedFields: [],
    subtitle: null,
    publisher: null,
    pageCount: null,
    isbn13: null,
    narrators: [],
    customMetadata: [],
    ...overrides,
  }
}

// Mirrors what useBookWindow hands over: a slot per row, where everything not
// yet fetched is the one shared placeholder object.
function makeCatalogue(total: number, loaded = 200): BookSlot[] {
  const placeholder = Object.freeze({ id: 0, placeholder: true as const })
  const slots: BookSlot[] = Array.from({ length: total }, () => placeholder)
  for (let index = 0; index < Math.min(loaded, total); index++) slots[index] = makeBook(index + 1)
  return slots
}

describe('VirtualBookGrid', () => {
  it('uses the virtual window by default', () => {
    const wrapper = mount(VirtualBookGrid, {
      props: {
        books: [makeBook(1), makeBook(2)],
        coverSize: 120,
        gridGap: 12,
      },
    })

    expect(wrapper.find('[data-testid="book-grid-virtual"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="book-grid-static"]').exists()).toBe(false)
  })

  it('renders every book directly when virtualization is disabled', () => {
    const books = Array.from({ length: 27 }, (_, index) => makeBook(index + 1))
    const wrapper = mount(VirtualBookGrid, {
      props: {
        books,
        coverSize: 120,
        gridGap: 12,
        virtualized: false,
      },
    })

    expect(wrapper.find('[data-testid="book-grid-virtual"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="book-card"]')).toHaveLength(27)
    expect(wrapper.get('[data-testid="book-grid-static"]').classes()).toContain('items-end')
  })

  it('keeps book actions wired in direct render mode', async () => {
    const books = [makeBook(1)]
    const wrapper = mount(VirtualBookGrid, {
      props: {
        books,
        coverSize: 120,
        gridGap: 12,
        virtualized: false,
      },
    })

    await wrapper.get('[data-testid="book-card"]').trigger('click')

    expect(wrapper.emitted('action')).toEqual([[books[0], 'quick-view']])
  })

  it('forwards select and update events in direct render mode', async () => {
    const books = [makeBook(1)]
    const wrapper = mount(VirtualBookGrid, {
      props: {
        books,
        coverSize: 120,
        gridGap: 12,
        virtualized: false,
      },
    })

    await wrapper.get('[data-testid="book-card-select"]').trigger('click')
    await wrapper.get('[data-testid="book-card-update"]').trigger('click')

    expect(wrapper.emitted('select')?.[0]?.[0]).toBe(1)
    const updateEvent = wrapper.emitted('update:book')
    expect(updateEvent).toBeDefined()
    const updatedBook = updateEvent?.[0]?.[0] as BookCard | undefined
    expect(updatedBook).toBeDefined()
    expect(updatedBook?.title).toBe('Updated')
  })

  it('forwards select and update events in virtualized mode', async () => {
    const books = [makeBook(2)]
    const wrapper = mount(VirtualBookGrid, {
      props: {
        books,
        coverSize: 120,
        gridGap: 12,
      },
    })

    await wrapper.get('[data-testid="book-card-select"]').trigger('click')
    await wrapper.get('[data-testid="book-card-update"]').trigger('click')

    expect(wrapper.emitted('select')?.[0]?.[0]).toBe(2)
    const updateEvent = wrapper.emitted('update:book')
    expect(updateEvent).toBeDefined()
    const updatedBook = updateEvent?.[0]?.[0] as BookCard | undefined
    expect(updatedBook).toBeDefined()
    expect(updatedBook?.title).toBe('Updated')
  })

  it.each([false, true])('forwards selection mode to collapsed series cards when virtualized=%s', (virtualized) => {
    const seriesBook = makeBook(4, {
      collapsedSeries: {
        bookCount: 3,
        readCount: 0,
        coverBookIds: [4],
        seriesLatestAddedAt: null,
      },
    })
    const wrapper = mount(VirtualBookGrid, {
      props: {
        books: [seriesBook],
        coverSize: 120,
        gridGap: 12,
        selectionMode: true,
        virtualized,
      },
    })

    expect(wrapper.get('[data-testid="collapsed-series-card"]').attributes('data-selection-mode')).toBe('true')
  })

  it('scales square cover slots independently of media format in static mode', () => {
    const books = [
      makeBook(1, {
        coverAspectRatio: '2/3',
        files: [
          { id: 11, format: 'epub', role: 'primary', sizeBytes: null },
          { id: 12, format: 'm4b', role: 'content', sizeBytes: null },
        ],
      }),
      makeBook(2, { coverAspectRatio: '1/1', files: [{ id: 22, format: 'epub', role: 'primary', sizeBytes: null }] }),
    ]

    const wrapper = mount(VirtualBookGrid, {
      props: {
        books,
        coverSize: 120,
        gridGap: 12,
        virtualized: false,
        squareCoverScale: 1.25,
      },
    })

    const itemWrappers = wrapper.findAll('.min-w-0.shrink-0')
    expect(itemWrappers).toHaveLength(2)
    expect(wrapper.get('[data-testid="book-grid-static"]').classes()).toContain('content-start')
    expect(wrapper.get('[data-testid="book-grid-static"]').classes()).toContain('items-end')
    const cards = wrapper.findAll('[data-testid="book-card"]')
    expect(cards[0]!.attributes('data-cover-ratio')).toBe('2/3')
    expect(cards[1]!.attributes('data-cover-ratio')).toBe('1/1')

    const ebookWrapperStyle = itemWrappers[0]!.attributes('style')
    const audioWrapperStyle = itemWrappers[1]!.attributes('style')

    expect(ebookWrapperStyle).toContain('width: 120px;')
    expect(audioWrapperStyle).toContain('width: 150px;')
  })

  describe('windowed slots', () => {
    it('renders skeletons for placeholder slots and cards for loaded slots', () => {
      const wrapper = mount(VirtualBookGrid, {
        props: {
          books: [makeBook(1), { id: -1, placeholder: true as const }, makeBook(2)],
          coverSize: 120,
          gridGap: 12,
        },
      })

      expect(wrapper.findAll('[data-testid="book-cover-skeleton"]')).toHaveLength(1)
      expect(wrapper.findAll('[data-testid="book-card"]')).toHaveLength(2)
    })

    it('renders only the visible window of a very large catalogue', async () => {
      const wrapper = mount(VirtualBookGrid, {
        props: { books: makeCatalogue(100_000), coverSize: 120, gridGap: 12 },
      })
      await nextTick()

      const rendered = wrapper.findAll('[data-testid="book-card"]').length
      expect(rendered).toBeGreaterThan(0)
      expect(rendered).toBeLessThan(200)

      // The scroll surface still spans the whole catalogue even though almost
      // none of it exists in the DOM.
      const style = wrapper.get('[data-testid="book-grid-virtual"]').attributes('style') ?? ''
      const height = Number(/(?:^|;)\s*height:\s*(\d+)px/.exec(style)?.[1])
      expect(height).toBeGreaterThan(1_000_000)
    })

    it('keeps the scroll surface inside the browser element height cap', async () => {
      // Two columns of a 410k row catalogue wants roughly 60M px, well past
      // what Blink or Gecko will lay out.
      const wrapper = mount(VirtualBookGrid, {
        props: { books: makeCatalogue(410_000), coverSize: 3_000, gridGap: 12 },
      })
      await nextTick()

      const style = wrapper.get('[data-testid="book-grid-virtual"]').attributes('style') ?? ''
      const height = Number(/(?:^|;)\s*height:\s*(\d+)px/.exec(style)?.[1])
      expect(height).toBeGreaterThan(0)
      expect(height).toBeLessThanOrEqual(16_000_000)
      expect(wrapper.get('[data-testid="book-grid-virtual"]').classes()).toContain('book-grid-scroller--compressed')
    })

    it('reaches the last row of a catalogue too tall to lay out', async () => {
      const scrollParent = document.createElement('div')
      scrollParent.style.overflowY = 'auto'
      document.body.append(scrollParent)
      const wrapper = mount(VirtualBookGrid, {
        attachTo: scrollParent,
        props: { books: makeCatalogue(410_000), coverSize: 3_000, gridGap: 12 },
      })
      await nextTick()

      ;(wrapper.vm as unknown as { scrollToIndex: (i: number) => void }).scrollToIndex(409_999)

      // The compressed surface must still be a position the element can hold.
      expect(scrollParent.scrollTop).toBeGreaterThan(0)
      expect(scrollParent.scrollTop).toBeLessThanOrEqual(16_000_000)

      wrapper.unmount()
      scrollParent.remove()
    })

    it('emits a range that covers the visible window, not the catalogue', async () => {
      const wrapper = mount(VirtualBookGrid, {
        props: { books: makeCatalogue(5_000), coverSize: 120, gridGap: 12 },
      })
      await nextTick()

      const ranges = wrapper.emitted('range') as [number, number][] | undefined
      expect(ranges).toBeDefined()
      const [start, end] = ranges![ranges!.length - 1]!
      expect(start).toBe(0)
      expect(end).toBeGreaterThan(0)
      expect(end).toBeLessThan(4_999)
    })

    it('keeps shared placeholder slots distinct when one of them loads', async () => {
      const placeholder = Object.freeze({ id: 0, placeholder: true as const })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const wrapper = mount(VirtualBookGrid, {
        props: { books: [makeBook(-7), placeholder, placeholder, placeholder], coverSize: 120, gridGap: 12 },
      })

      expect(wrapper.findAll('[data-testid="book-cover-skeleton"]')).toHaveLength(3)

      await wrapper.setProps({ books: [makeBook(-7), placeholder, makeBook(-8), placeholder] })

      expect(wrapper.findAll('[data-testid="book-cover-skeleton"]')).toHaveLength(2)
      expect(wrapper.findAll('[data-testid="book-card"]')).toHaveLength(2)
      expect(warn.mock.calls.flat().join(' ')).not.toContain('Duplicate keys')
      warn.mockRestore()
    })

    it('scrolls the scroll parent to put the requested row at the top', async () => {
      const scrollParent = document.createElement('div')
      scrollParent.style.overflowY = 'auto'
      document.body.append(scrollParent)
      const books = Array.from({ length: 400 }, (_, index) => makeBook(index + 1))
      const wrapper = mount(VirtualBookGrid, {
        attachTo: scrollParent,
        props: { books, coverSize: 120, gridGap: 12 },
      })
      await nextTick()

      expect(scrollParent.scrollTop).toBe(0)
      ;(wrapper.vm as unknown as { scrollToIndex: (i: number) => void }).scrollToIndex(200)

      expect(scrollParent.scrollTop).toBeGreaterThan(0)

      wrapper.unmount()
      scrollParent.remove()
    })

    it('reports index zero at the top and preserves a jump target within the same row', async () => {
      const scrollParent = document.createElement('div')
      scrollParent.style.overflowY = 'auto'
      document.body.append(scrollParent)
      const requestAnimationFrameSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
        callback(0)
        return 0
      })
      const books = Array.from({ length: 12 }, (_, index) => makeBook(index + 1))
      const wrapper = mount(VirtualBookGrid, {
        attachTo: scrollParent,
        props: { books, coverSize: 120, gridGap: 12 },
      })
      vi.spyOn(scrollParent, 'getBoundingClientRect').mockReturnValue({
        top: 0,
        left: 0,
        right: 600,
        bottom: 800,
        width: 600,
        height: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      })
      vi.spyOn(wrapper.element, 'getBoundingClientRect').mockReturnValue({
        top: 0,
        left: 0,
        right: 600,
        bottom: 1600,
        width: 600,
        height: 1600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      })

      await nextTick()
      scrollParent.dispatchEvent(new Event('scroll'))

      expect(wrapper.emitted('first-visible-index')).toEqual([[0]])
      ;(wrapper.vm as unknown as { scrollToIndex: (index: number) => void }).scrollToIndex(3)
      scrollParent.dispatchEvent(new Event('scroll'))

      expect(wrapper.emitted('first-visible-index')).toEqual([[0], [3]])

      wrapper.unmount()
      scrollParent.remove()
      requestAnimationFrameSpy.mockRestore()
    })

    it('reserves a compact right gutter for the alphabet rail', () => {
      const wrapper = mount(VirtualBookGrid, {
        props: { books: [makeBook(1)], coverSize: 120, gridGap: 12, railGutter: true },
      })

      expect(wrapper.classes()).toContain('pr-10')
    })

    it('reserves a wider right gutter for the temporal rail', () => {
      const wrapper = mount(VirtualBookGrid, {
        props: { books: [makeBook(1)], coverSize: 120, gridGap: 12, railGutter: true, railGutterKind: 'temporal' },
      })

      expect(wrapper.classes()).toContain('pr-14')
    })

    it('reserves the widest right gutter for categorical labels', () => {
      const wrapper = mount(VirtualBookGrid, {
        props: { books: [makeBook(1)], coverSize: 120, gridGap: 12, railGutter: true, railGutterKind: 'category' },
      })

      expect(wrapper.classes()).toContain('pr-22')
    })
  })

  describe('show-label prop forwarding', () => {
    afterEach(() => {
      displaySettingsState.cardInfoMode.value = 'hover-overlay'
    })

    it('does not pass showLabel when cardInfoMode is hover-overlay', () => {
      displaySettingsState.cardInfoMode.value = 'hover-overlay'

      const wrapper = mount(VirtualBookGrid, {
        props: { books: [makeBook(1)], coverSize: 120, gridGap: 12, virtualized: false },
      })

      expect(wrapper.find('[data-testid="book-card-label-slot"]').exists()).toBe(false)
    })

    it('passes showLabel=true when cardInfoMode is below-cover', () => {
      displaySettingsState.cardInfoMode.value = 'below-cover'

      const wrapper = mount(VirtualBookGrid, {
        props: { books: [makeBook(1)], coverSize: 120, gridGap: 12, virtualized: false },
      })

      expect(wrapper.find('[data-testid="book-card-label-slot"]').exists()).toBe(true)
    })

    it('does not pass showLabel when cardInfoMode is off', () => {
      displaySettingsState.cardInfoMode.value = 'off'

      const wrapper = mount(VirtualBookGrid, {
        props: { books: [makeBook(1)], coverSize: 120, gridGap: 12, virtualized: false },
      })

      expect(wrapper.find('[data-testid="book-card-label-slot"]').exists()).toBe(false)
    })

    it('passes showLabel to CollapsedSeriesCard when cardInfoMode is below-cover', () => {
      displaySettingsState.cardInfoMode.value = 'below-cover'

      const seriesBook = makeBook(1, {
        collapsedSeries: {
          bookCount: 3,
          readCount: 0,
          coverBookIds: [],
          seriesLatestAddedAt: null,
          firstVolumeBookId: null,
          latestVolumeBookId: null,
          firstUnreadBookId: null,
        },
      })
      const wrapper = mount(VirtualBookGrid, {
        props: { books: [seriesBook], coverSize: 120, gridGap: 12, virtualized: false },
      })

      expect(wrapper.find('[data-testid="series-card-label-slot"]').exists()).toBe(true)
    })
  })
})
