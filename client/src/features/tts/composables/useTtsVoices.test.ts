import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/tts.api', () => ({
  getVoices: vi.fn<() => Promise<unknown>>(),
  getProviders: vi.fn<() => Promise<unknown>>(),
  previewVoice: vi.fn<() => Promise<void>>(),
}))

import * as ttsApi from '../api/tts.api'
import { useTtsVoices } from './useTtsVoices'
import type { TtsVoice } from '@bookorbit/types'

const JENNY: TtsVoice = {
  id: 'en-US-JennyNeural',
  shortName: 'en-US-JennyNeural',
  name: 'Jenny',
  language: 'en',
  locale: 'en-US',
  gender: 'Female',
  providerId: 'edge',
  providerName: 'Edge TTS',
}

const SONIA: TtsVoice = {
  id: 'en-GB-SoniaNeural',
  shortName: 'en-GB-SoniaNeural',
  name: 'Sonia',
  language: 'en',
  locale: 'en-GB',
  gender: 'Female',
  providerId: 'edge',
  providerName: 'Edge TTS',
}

describe('useTtsVoices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('loadVoices', () => {
    it('should load all voices', async () => {
      vi.mocked(ttsApi.getVoices).mockResolvedValue([JENNY, SONIA])

      const { loadVoices, allVoices } = useTtsVoices()
      await loadVoices()

      expect(allVoices.value).toHaveLength(2)
    })

    it('should set error on failure', async () => {
      vi.mocked(ttsApi.getVoices).mockRejectedValue(new Error('network error'))

      const { loadVoices, voicesError } = useTtsVoices()
      await loadVoices()

      expect(voicesError.value).toBe('network error')
    })

    it('should set loading false after load', async () => {
      vi.mocked(ttsApi.getVoices).mockResolvedValue([])

      const { loadVoices, voicesLoading } = useTtsVoices()
      await loadVoices()

      expect(voicesLoading.value).toBe(false)
    })
  })

  describe('loadProviders', () => {
    it('should load providers', async () => {
      vi.mocked(ttsApi.getProviders).mockResolvedValue([{ id: 'edge', name: 'Edge TTS', type: 'edge' }])

      const { loadProviders, providers } = useTtsVoices()
      await loadProviders()

      expect(providers.value).toHaveLength(1)
    })

    it('should set empty array on failure', async () => {
      vi.mocked(ttsApi.getProviders).mockRejectedValue(new Error('fail'))

      const { loadProviders, providers } = useTtsVoices()
      await loadProviders()

      expect(providers.value).toEqual([])
    })
  })

  describe('searchVoices', () => {
    it('should return all voices for empty query', async () => {
      vi.mocked(ttsApi.getVoices).mockResolvedValue([JENNY, SONIA])

      const { loadVoices, searchVoices } = useTtsVoices()
      await loadVoices()

      expect(searchVoices('')).toHaveLength(2)
    })

    it('should filter by name', async () => {
      vi.mocked(ttsApi.getVoices).mockResolvedValue([JENNY, SONIA])

      const { loadVoices, searchVoices } = useTtsVoices()
      await loadVoices()

      const results = searchVoices('jenny')
      expect(results).toHaveLength(1)
      expect(results[0]!.id).toBe('en-US-JennyNeural')
    })

    it('should filter by locale', async () => {
      vi.mocked(ttsApi.getVoices).mockResolvedValue([JENNY, SONIA])

      const { loadVoices, searchVoices } = useTtsVoices()
      await loadVoices()

      const results = searchVoices('en-GB')
      expect(results).toHaveLength(1)
      expect(results[0]!.id).toBe('en-GB-SoniaNeural')
    })

    it('should be case-insensitive', async () => {
      vi.mocked(ttsApi.getVoices).mockResolvedValue([JENNY, SONIA])

      const { loadVoices, searchVoices } = useTtsVoices()
      await loadVoices()

      const results = searchVoices('JENNY')
      expect(results).toHaveLength(1)
    })
  })

  describe('groupedVoices', () => {
    it('should group voices by language', async () => {
      vi.mocked(ttsApi.getVoices).mockResolvedValue([JENNY, SONIA])

      const { loadVoices, groupedVoices } = useTtsVoices()
      await loadVoices()

      const groups = groupedVoices.value
      // Both have language 'en' so they should be in one group
      expect(groups).toHaveLength(1)
      expect(groups[0]!.voices).toHaveLength(2)
    })

    it('should sort groups alphabetically', async () => {
      const frVoice: TtsVoice = { ...JENNY, id: 'fr-FR-DeniseNeural', language: 'fr', locale: 'fr-FR', name: 'Denise' }
      vi.mocked(ttsApi.getVoices).mockResolvedValue([frVoice, JENNY])

      const { loadVoices, groupedVoices } = useTtsVoices()
      await loadVoices()

      const groups = groupedVoices.value
      expect(groups[0]!.language).toBe('en')
      expect(groups[1]!.language).toBe('fr')
    })
  })
})
