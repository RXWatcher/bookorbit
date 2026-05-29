import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import TtsOpenAiVoiceCuration from './TtsOpenAiVoiceCuration.vue'
import type { TtsDbProvider, StaticVoiceConfig } from './api/tts.api'
import * as ttsApi from './api/tts.api'

const BASE_PROVIDER: TtsDbProvider = {
  id: 1,
  name: 'Kokoro TTS',
  type: 'openai-compatible',
  enabled: true,
  baseUrl: 'http://localhost:8000/v1',
  apiKey: null,
  defaultModel: 'kokoro',
  displayOrder: 0,
  staticVoices: null,
}

const SAVED_VOICES: StaticVoiceConfig[] = [
  { id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' },
  { id: 'am_adam', name: 'Adam', shortName: 'am_adam', language: 'English', locale: 'en-US', gender: 'Male' },
]

function mountCuration(provider: TtsDbProvider = BASE_PROVIDER) {
  return mount(TtsOpenAiVoiceCuration, {
    props: { provider },
    global: { stubs: { teleport: true } },
  })
}

describe('TtsOpenAiVoiceCuration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('initialization', () => {
    it('shows empty state when provider has no static voices', () => {
      const wrapper = mountCuration()
      expect(wrapper.text()).toContain('No voices configured')
    })

    it('shows saved voices when provider has static voices', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      expect(wrapper.text()).toContain('Heart')
      expect(wrapper.text()).toContain('Adam')
    })

    it('shows voice count in header', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      expect(wrapper.text()).toContain('2 voices configured')
    })

    it('shows Load Kokoro preset button for kokoro model', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, defaultModel: 'kokoro' })
      expect(wrapper.text()).toContain('Load Kokoro preset')
    })

    it('shows Load OpenAI preset button for openai model', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, defaultModel: 'tts-1' })
      expect(wrapper.text()).toContain('Load OpenAI preset')
    })

    it('does not show preset button when model is unknown', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, defaultModel: null })
      expect(wrapper.text()).not.toContain('Load Kokoro preset')
      expect(wrapper.text()).not.toContain('Load OpenAI preset')
    })
  })

  describe('Import from provider', () => {
    it('calls discoverVoices and merges new voices', async () => {
      vi.spyOn(ttsApi, 'discoverVoices').mockResolvedValue({
        supported: true,
        voices: [
          { id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' },
          { id: 'af_bella', name: 'Bella', shortName: 'af_bella', language: 'English', locale: 'en-US', gender: 'Female' },
        ],
      })
      const wrapper = mountCuration()
      await wrapper.find('button[class*="border-border"]').trigger('click')
      await vi.waitFor(() => expect(ttsApi.discoverVoices).toHaveBeenCalledWith(1))
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('Heart')
      expect(wrapper.text()).toContain('Bella')
    })

    it('shows error when provider returns unsupported', async () => {
      vi.spyOn(ttsApi, 'discoverVoices').mockResolvedValue({ supported: false, voices: [] })
      const wrapper = mountCuration()
      await wrapper.find('button[class*="border-border"]').trigger('click')
      await vi.waitFor(() => expect(ttsApi.discoverVoices).toHaveBeenCalled())
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('does not expose a voice list endpoint')
    })

    it('shows error on network failure', async () => {
      vi.spyOn(ttsApi, 'discoverVoices').mockRejectedValue(new Error('ECONNREFUSED'))
      const wrapper = mountCuration()
      await wrapper.find('button[class*="border-border"]').trigger('click')
      await vi.waitFor(() => expect(ttsApi.discoverVoices).toHaveBeenCalled())
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('ECONNREFUSED')
    })

    it('deduplicates voices by ID when merging', async () => {
      vi.spyOn(ttsApi, 'discoverVoices').mockResolvedValue({
        supported: true,
        voices: [{ id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' }],
      })
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      await wrapper.find('button[class*="border-border"]').trigger('click')
      await vi.waitFor(() => expect(ttsApi.discoverVoices).toHaveBeenCalled())
      await wrapper.vm.$nextTick()
      const cells = wrapper.findAll('span.font-mono')
      const ids = cells.map((c) => c.text())
      const heartCount = ids.filter((id) => id === 'af_heart').length
      expect(heartCount).toBe(1)
    })
  })

  describe('Load preset', () => {
    it('loads Kokoro preset voices', async () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, defaultModel: 'kokoro', staticVoices: null })
      const presetBtn = wrapper.findAll('button').find((b) => b.text().includes('Load Kokoro preset'))
      await presetBtn!.trigger('click')
      expect(wrapper.text()).toContain('af_heart')
      expect(wrapper.text()).toContain('bm_lewis')
    })

    it('merges preset with existing voices without duplicates', async () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, defaultModel: 'kokoro', staticVoices: [SAVED_VOICES[0]!] })
      const presetBtn = wrapper.findAll('button').find((b) => b.text().includes('Load Kokoro preset'))
      await presetBtn!.trigger('click')
      const cells = wrapper.findAll('span.font-mono')
      const ids = cells.map((c) => c.text())
      const heartCount = ids.filter((id) => id === 'af_heart').length
      expect(heartCount).toBe(1)
      expect(ids.length).toBe(12)
    })
  })

  describe('Add voice manually', () => {
    it('shows add form when clicking Add voice manually', async () => {
      const wrapper = mountCuration()
      await wrapper.find('button[class*="text-primary"]').trigger('click')
      expect(wrapper.find('input[placeholder="af_heart"]').exists()).toBe(true)
    })

    it('adds a voice to the list', async () => {
      const wrapper = mountCuration()
      await wrapper.find('button[class*="text-primary"]').trigger('click')
      await wrapper.find('input[placeholder="af_heart"]').setValue('custom_voice')
      await wrapper.find('input[placeholder="Heart"]').setValue('Custom Voice')
      const addBtn = wrapper.findAll('button').find((b) => b.text().trim() === 'Add')
      await addBtn!.trigger('click')
      expect(wrapper.text()).toContain('custom_voice')
      expect(wrapper.text()).toContain('Custom Voice')
    })

    it('shows error for duplicate ID', async () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      await wrapper.find('button[class*="text-primary"]').trigger('click')
      await wrapper.find('input[placeholder="af_heart"]').setValue('af_heart')
      await wrapper.find('input[placeholder="Heart"]').setValue('Duplicate')
      const addBtn = wrapper.findAll('button').find((b) => b.text().trim() === 'Add')
      await addBtn!.trigger('click')
      expect(wrapper.text()).toContain('already exists')
    })

    it('shows error for missing ID or name', async () => {
      const wrapper = mountCuration()
      await wrapper.find('button[class*="text-primary"]').trigger('click')
      const addBtn = wrapper.findAll('button').find((b) => b.text().trim() === 'Add')
      await addBtn!.trigger('click')
      expect(wrapper.text()).toContain('ID and Name are required')
    })
  })

  describe('Edit voice', () => {
    it('enters edit mode on pencil click', async () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      const editBtns = wrapper.findAll('button[class*="hover:text-foreground"]')
      await editBtns[0]!.trigger('click')
      expect(wrapper.find('input').exists()).toBe(true)
    })

    it('cancels edit mode without saving', async () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      const editBtns = wrapper.findAll('button[class*="hover:text-foreground"]')
      await editBtns[0]!.trigger('click')
      const cancelBtn = wrapper.find('button[aria-label="Cancel edit"]')
      await cancelBtn.trigger('click')
      expect(wrapper.find('input').exists()).toBe(false)
      expect(wrapper.text()).toContain('Heart')
    })
  })

  describe('Delete voice', () => {
    it('removes a voice from the list', async () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      const deleteBtns = wrapper.findAll('button[class*="hover:text-destructive"]')
      await deleteBtns[0]!.trigger('click')
      expect(wrapper.text()).not.toContain('af_heart')
    })
  })

  describe('Save', () => {
    it('emits save with current voices', async () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      const editBtns = wrapper.findAll('button[class*="hover:text-foreground"]')
      await editBtns[0]!.trigger('click')
      await wrapper.find('input').setValue('af_heart_v2')
      const saveRowBtn = wrapper.findAll('button').find((b) => b.text().trim() === 'Save' && !b.classes().includes('bg-primary'))
      await saveRowBtn!.trigger('click')
      const saveFooterBtn = wrapper.find('button.bg-primary')
      await saveFooterBtn.trigger('click')
      const emitted = wrapper.emitted('save')
      expect(emitted).toBeTruthy()
      expect(emitted![0]).toBeTruthy()
    })

    it('Save button is disabled when there are no unsaved changes', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      const saveBtn = wrapper.find('button.bg-primary')
      expect((saveBtn.element as HTMLButtonElement).disabled).toBe(true)
    })
  })

  describe('Close', () => {
    it('emits close immediately when no unsaved changes', async () => {
      const wrapper = mountCuration()
      const closeBtn = wrapper.find('button.rounded-lg.hover\\:bg-accent')
      await closeBtn.trigger('click')
      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('emits close on Cancel button click (no changes)', async () => {
      const wrapper = mountCuration()
      const cancelBtn = wrapper.findAll('button').find((b) => b.text() === 'Cancel')
      await cancelBtn!.trigger('click')
      expect(wrapper.emitted('close')).toBeTruthy()
    })
  })
})
