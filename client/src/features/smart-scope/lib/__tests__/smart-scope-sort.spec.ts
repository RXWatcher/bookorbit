import { describe, expect, it } from 'vitest'
import type { BookCard, DashboardCatalogItem } from '@bookorbit/types'
import { sortSmartScopeItems } from '../smart-scope-sort'

function makeBook(overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 1,
    status: 'active',
    title: 'Local Book',
    subtitle: null,
    authors: [],
    narrators: [],
    seriesName: null,
    seriesIndex: null,
    publishedDate: null,
    publishedYear: null,
    language: null,
    publisher: null,
    pageCount: null,
    isbn13: null,
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
    files: [],
    customMetadata: [],
    ...overrides,
  }
}

function makeCatalogItem(overrides: Partial<DashboardCatalogItem> = {}): DashboardCatalogItem {
  return {
    type: 'catalog-item',
    mediaType: 'ebook',
    remoteId: 'ebook-1',
    title: 'Source-backed Book',
    subtitle: null,
    seriesName: null,
    seriesIndex: null,
    authors: [],
    narrators: [],
    libraryName: 'Ebook Library',
    formats: ['epub'],
    language: null,
    publisher: null,
    rating: null,
    readingProgress: null,
    readStatus: null,
    lastReadAt: null,
    finishedAt: null,
    durationSeconds: null,
    hasCover: false,
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('sortSmartScopeItems', () => {
  it('sorts source-backed and filesystem items together by read status', () => {
    const localRead = makeBook({
      id: 1,
      title: 'Local Read',
      readStatus: {
        status: 'read',
        source: 'manual',
        startedAt: null,
        finishedAt: null,
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    })
    const sourceReading = makeCatalogItem({
      remoteId: 'ebook-reading',
      title: 'Library Reading',
      readStatus: 'reading',
    })
    const sourceMissing = makeCatalogItem({
      remoteId: 'ebook-missing',
      title: 'Library Missing',
      readStatus: null,
    })

    const sorted = sortSmartScopeItems([localRead, sourceMissing, sourceReading], [{ field: 'readStatus', dir: 'desc' }])

    expect(sorted.map((item) => item.title)).toEqual(['Library Reading', 'Local Read', 'Library Missing'])
  })

  it('sorts source-backed and filesystem items together by publisher', () => {
    const localZeta = makeBook({
      id: 1,
      title: 'Local Zeta',
      publisher: 'Zeta Press',
    })
    const sourceAlpha = makeCatalogItem({
      remoteId: 'ebook-alpha',
      title: 'Library Alpha',
      publisher: 'Alpha Press',
    })
    const sourceMissing = makeCatalogItem({
      remoteId: 'ebook-missing',
      title: 'Library Missing',
      publisher: null,
    })

    const sorted = sortSmartScopeItems([localZeta, sourceMissing, sourceAlpha], [{ field: 'publisher', dir: 'asc' }])

    expect(sorted.map((item) => item.title)).toEqual(['Library Alpha', 'Local Zeta', 'Library Missing'])
  })

  it('sorts source-backed and filesystem items together by rating', () => {
    const localThree = makeBook({
      id: 1,
      title: 'Local Three',
      rating: 3,
    })
    const sourceFive = makeCatalogItem({
      remoteId: 'ebook-five',
      title: 'Library Five',
      rating: 5,
    })
    const sourceMissing = makeCatalogItem({
      remoteId: 'ebook-missing',
      title: 'Library Missing',
      rating: null,
    })

    const sorted = sortSmartScopeItems([localThree, sourceMissing, sourceFive], [{ field: 'rating', dir: 'desc' }])

    expect(sorted.map((item) => item.title)).toEqual(['Library Five', 'Local Three', 'Library Missing'])
  })

  it('sorts source-backed and filesystem items together by read progress', () => {
    const localThirty = makeBook({
      id: 1,
      title: 'Local Thirty',
      readingProgress: 30,
    })
    const sourceEighty = makeCatalogItem({
      remoteId: 'ebook-eighty',
      title: 'Library Eighty',
      readingProgress: 80,
    })
    const sourceMissing = makeCatalogItem({
      remoteId: 'ebook-missing',
      title: 'Library Missing',
      readingProgress: null,
    })

    const sorted = sortSmartScopeItems([localThirty, sourceMissing, sourceEighty], [{ field: 'readProgress', dir: 'desc' }])

    expect(sorted.map((item) => item.title)).toEqual(['Library Eighty', 'Local Thirty', 'Library Missing'])
  })

  it('sorts source-backed and filesystem items together by last read activity', () => {
    const localJanuary = makeBook({
      id: 1,
      title: 'Local January',
      readStatus: {
        status: 'reading',
        source: 'manual',
        startedAt: null,
        finishedAt: null,
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    })
    const sourceFebruary = makeCatalogItem({
      remoteId: 'ebook-february',
      title: 'Library February',
      lastReadAt: '2026-02-02T00:00:00.000Z',
    })
    const sourceMissing = makeCatalogItem({
      remoteId: 'ebook-missing',
      title: 'Library Missing',
      lastReadAt: null,
    })

    const sorted = sortSmartScopeItems([localJanuary, sourceMissing, sourceFebruary], [{ field: 'lastReadAt', dir: 'desc' }])

    expect(sorted.map((item) => item.title)).toEqual(['Library February', 'Local January', 'Library Missing'])
  })

  it('sorts source-backed and filesystem items together by finished date', () => {
    const localJanuary = makeBook({
      id: 1,
      title: 'Local January',
      readStatus: {
        status: 'read',
        source: 'manual',
        startedAt: null,
        finishedAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    })
    const sourceFebruary = makeCatalogItem({
      remoteId: 'ebook-february',
      title: 'Library February',
      finishedAt: '2026-02-02T00:00:00.000Z',
    })
    const sourceMissing = makeCatalogItem({
      remoteId: 'ebook-missing',
      title: 'Library Missing',
      finishedAt: null,
    })

    const sorted = sortSmartScopeItems([localJanuary, sourceMissing, sourceFebruary], [{ field: 'finishedAt', dir: 'desc' }])

    expect(sorted.map((item) => item.title)).toEqual(['Library February', 'Local January', 'Library Missing'])
  })

  it('sorts source-backed and filesystem items together by series index', () => {
    const localFive = makeBook({
      id: 1,
      title: 'Local Five',
      seriesName: 'Shared Series',
      seriesIndex: 5,
    })
    const sourceTwo = makeCatalogItem({
      remoteId: 'ebook-two',
      title: 'Library Two',
      seriesName: 'Shared Series',
      seriesIndex: 2,
    })
    const sourceMissing = makeCatalogItem({
      remoteId: 'ebook-missing',
      title: 'Library Missing',
      seriesName: 'Shared Series',
      seriesIndex: null,
    })

    const sorted = sortSmartScopeItems([localFive, sourceMissing, sourceTwo], [{ field: 'seriesIndex', dir: 'asc' }])

    expect(sorted.map((item) => item.title)).toEqual(['Library Two', 'Local Five', 'Library Missing'])
  })

  it('sorts source-backed and filesystem items together by published year', () => {
    const localOld = makeBook({
      id: 1,
      title: 'Local Old',
      publishedYear: 1999,
    })
    const sourceNew = makeCatalogItem({
      remoteId: 'ebook-new',
      title: 'Library New',
      publishedYear: 2024,
    })
    const sourceMissing = makeCatalogItem({
      remoteId: 'ebook-missing',
      title: 'Library Missing',
      publishedYear: null,
    })

    const sorted = sortSmartScopeItems([localOld, sourceMissing, sourceNew], [{ field: 'publishedYear', dir: 'desc' }])

    expect(sorted.map((item) => item.title)).toEqual(['Library New', 'Local Old', 'Library Missing'])
  })

  it('sorts source-backed and filesystem items together by page count', () => {
    const localShort = makeBook({
      id: 1,
      title: 'Local Short',
      pageCount: 220,
    })
    const sourceLong = makeCatalogItem({
      remoteId: 'ebook-long',
      title: 'Library Long',
      pageCount: 640,
    })
    const sourceMissing = makeCatalogItem({
      remoteId: 'ebook-missing',
      title: 'Library Missing',
      pageCount: null,
    })

    const sorted = sortSmartScopeItems([localShort, sourceMissing, sourceLong], [{ field: 'pageCount', dir: 'desc' }])

    expect(sorted.map((item) => item.title)).toEqual(['Library Long', 'Local Short', 'Library Missing'])
  })

  it('sorts source-backed and filesystem items together by updated time', () => {
    const localOld = makeBook({
      id: 1,
      title: 'Local Old',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
    const sourceNew = makeCatalogItem({
      remoteId: 'ebook-new',
      title: 'Library New',
      updatedAt: '2026-02-02T00:00:00.000Z',
    } as Partial<DashboardCatalogItem>)
    const sourceMissing = makeCatalogItem({
      remoteId: 'ebook-missing',
      title: 'Library Missing',
      updatedAt: null,
    } as Partial<DashboardCatalogItem>)

    const sorted = sortSmartScopeItems([localOld, sourceMissing, sourceNew], [{ field: 'updatedAt', dir: 'desc' }])

    expect(sorted.map((item) => item.title)).toEqual(['Library New', 'Local Old', 'Library Missing'])
  })

  it('sorts source-backed and filesystem items together by file size', () => {
    const localSmall = makeBook({
      id: 1,
      title: 'Local Small',
      files: [{ id: 10, format: 'epub', role: 'primary', sizeBytes: 220 }],
    })
    const sourceLarge = makeCatalogItem({
      remoteId: 'ebook-large',
      title: 'Library Large',
      fileSizeBytes: 640,
    } as Partial<DashboardCatalogItem>)
    const sourceMissing = makeCatalogItem({
      remoteId: 'ebook-missing',
      title: 'Library Missing',
      fileSizeBytes: null,
    } as Partial<DashboardCatalogItem>)

    const sorted = sortSmartScopeItems([localSmall, sourceMissing, sourceLarge], [{ field: 'fileSize', dir: 'desc' }])

    expect(sorted.map((item) => item.title)).toEqual(['Library Large', 'Local Small', 'Library Missing'])
  })

  it('sorts source-backed and filesystem items together by metadata score', () => {
    const localLower = makeBook({
      id: 1,
      title: 'Local Lower',
      metadataScore: 42,
    })
    const sourceHigher = makeCatalogItem({
      remoteId: 'ebook-higher',
      title: 'Library Higher',
      metadataScore: 86,
    })
    const sourceMissing = makeCatalogItem({
      remoteId: 'ebook-missing',
      title: 'Library Missing',
      metadataScore: null,
    })

    const sorted = sortSmartScopeItems([localLower, sourceMissing, sourceHigher], [{ field: 'metadataScore', dir: 'desc' }])

    expect(sorted.map((item) => item.title)).toEqual(['Library Higher', 'Local Lower', 'Library Missing'])
  })
})
