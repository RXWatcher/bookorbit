import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Library } from '@bookorbit/types'
import { useLibraries } from '../useLibraries'

const apiMock = vi.fn<(url: string) => Promise<{ ok: boolean; json: () => Promise<unknown[]> }>>()

vi.mock('@/lib/api', () => ({
  api: (url: string) => apiMock(url),
}))

function makeLibrary(overrides: Partial<Library> = {}): Library {
  return {
    id: 3,
    name: 'Main Library',
    icon: null,
    displayOrder: 0,
    coverAspectRatio: '2/3',
    watch: false,
    autoScanCronExpression: null,
    metadataPrecedence: [],
    formatPriority: [],
    allowedFormats: [],
    organizationMode: 'book_per_file',
    excludePatterns: [],
    readingThreshold: 10,
    markAsFinishedPercentComplete: 95,
    fileNamingPattern: null,
    fileWriteEnabled: false,
    fileWriteWriteCover: false,
    fileWriteEpubEnabled: false,
    fileWriteEpubMaxFileSizeMb: 50,
    fileWriteFb2Enabled: false,
    fileWriteFb2MaxFileSizeMb: 100,
    fileWritePdfEnabled: false,
    fileWritePdfMaxFileSizeMb: 50,
    fileWriteCbxEnabled: false,
    fileWriteCbxMaxFileSizeMb: 50,
    fileWriteKindleEnabled: false,
    fileWriteKindleMaxFileSizeMb: 100,
    fileWriteAudioEnabled: false,
    fileWriteAudioMaxFileSizeMb: 50,
    fileRenameEnabled: false,
    folders: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeResponse(data?: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as Response
}

describe('useLibraries', () => {
  beforeEach(() => {
    apiMock.mockReset()
    apiMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    })
  })

  it('uses the app-visible library endpoint for source-backed libraries and an explicit opt-out for filesystem-only calls', async () => {
    await useLibraries({ includeSourceBacked: true }).refreshLibraries()
    await useLibraries().refreshLibraries()

    expect(apiMock).toHaveBeenNthCalledWith(1, '/api/v1/libraries')
    expect(apiMock).toHaveBeenNthCalledWith(2, '/api/v1/libraries?includeSourceBacked=false')
  })
})
