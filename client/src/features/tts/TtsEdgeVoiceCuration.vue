<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from 'vue'
import { Loader2, Search, Volume2, Square, X } from 'lucide-vue-next'
import * as ttsApi from './api/tts.api'
import type { TtsEdgeConfig } from './api/tts.api'
import type { TtsVoice } from '@bookorbit/types'

const props = defineProps<{
  initialConfig: TtsEdgeConfig
}>()

const emit = defineEmits<{
  save: [config: TtsEdgeConfig]
  close: []
}>()

const allVoices = ref<TtsVoice[]>([])
const loading = ref(true)
const saving = ref(false)
const search = ref('')
const languageFilter = ref('')
const countryFilter = ref('')
const selectedVoices = ref<Set<string>>(new Set(props.initialConfig.enabledVoices))
const persistedSelectedVoices = ref<Set<string>>(new Set(props.initialConfig.enabledVoices))
const previewingVoiceId = ref<string | null>(null)
const playingVoiceId = ref<string | null>(null)
let previewAudio: HTMLAudioElement | null = null
let previewAudioUrl: string | null = null

type CuratedVoice = {
  voice: TtsVoice
  displayName: string
  languageName: string
  countryName: string
  localeLabel: string
}

const languageDisplayNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'language' }) : null
const regionDisplayNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null

onMounted(async () => {
  try {
    allVoices.value = await ttsApi.getAllEdgeVoices()
  } finally {
    loading.value = false
  }
})

const curatedVoices = computed<CuratedVoice[]>(() => allVoices.value.map((voice) => mapCuratedVoice(voice)))

const languageOptions = computed(() =>
  [...new Set(curatedVoices.value.map((v) => v.languageName))].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
)

const countryOptions = computed(() => {
  const source = languageFilter.value ? curatedVoices.value.filter((v) => v.languageName === languageFilter.value) : curatedVoices.value
  return [...new Set(source.map((v) => v.countryName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
})

watch(countryOptions, (nextCountries) => {
  if (countryFilter.value && !nextCountries.includes(countryFilter.value)) {
    countryFilter.value = ''
  }
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return curatedVoices.value.filter((entry) => {
    if (languageFilter.value && entry.languageName !== languageFilter.value) return false
    if (countryFilter.value && entry.countryName !== countryFilter.value) return false
    if (!q) return true
    const searchable = [
      entry.displayName,
      entry.localeLabel,
      entry.languageName,
      entry.countryName,
      entry.voice.shortName,
      entry.voice.name,
      entry.voice.locale,
      entry.voice.gender,
    ]
    return searchable.some((value) => value.toLowerCase().includes(q))
  })
})

const groupedByLocale = computed(() => {
  const map = new Map<string, CuratedVoice[]>()
  for (const v of filtered.value) {
    const key = v.localeLabel
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(v)
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' })))
})

const hasUnsavedChanges = computed(() => !areSetsEqual(selectedVoices.value, persistedSelectedVoices.value))
const selectedVisibleCount = computed(() => filtered.value.filter((entry) => selectedVoices.value.has(entry.voice.shortName)).length)

const activeFilterChips = computed(() => {
  const chips: Array<{ key: 'search' | 'language' | 'country'; label: string }> = []
  if (search.value.trim()) chips.push({ key: 'search', label: `Search: ${search.value.trim()}` })
  if (languageFilter.value) chips.push({ key: 'language', label: `Language: ${languageFilter.value}` })
  if (countryFilter.value) chips.push({ key: 'country', label: `Country: ${countryFilter.value}` })
  return chips
})

function mapCuratedVoice(voice: TtsVoice): CuratedVoice {
  const parsed = parseLanguageCountryFromFriendlyName(voice.name) ?? parseLanguageCountryFromLocale(voice.locale)
  const displayName = formatVoiceDisplayName(voice)
  const languageName = parsed.languageName
  const countryName = parsed.countryName
  return {
    voice,
    displayName,
    languageName,
    countryName,
    localeLabel: countryName ? `${languageName} (${countryName})` : languageName,
  }
}

function formatVoiceDisplayName(voice: TtsVoice): string {
  const base = voice.name.split(' - ')[0] ?? voice.name
  const withoutMicrosoft = base.replace(/^Microsoft\s+/i, '')
  const withoutNatural = withoutMicrosoft.replace(/\s+Online\s+\(Natural\)\s*$/i, '')
  return withoutNatural.trim() || voice.shortName
}

function parseLanguageCountryFromFriendlyName(name: string): { languageName: string; countryName: string } | null {
  const separator = name.lastIndexOf(' - ')
  if (separator < 0) return null
  const localePart = name.slice(separator + 3).trim()
  const countryStart = localePart.lastIndexOf(' (')
  if (countryStart < 0 || !localePart.endsWith(')')) return null
  const languageName = localePart.slice(0, countryStart).trim()
  const countryName = localePart.slice(countryStart + 2, -1).trim()
  if (!languageName || !countryName) return null
  return { languageName, countryName }
}

function parseLanguageCountryFromLocale(locale: string): { languageName: string; countryName: string } {
  let languageCode = locale
  let regionCode = ''
  try {
    const parsed = new Intl.Locale(locale)
    languageCode = parsed.language ?? locale
    regionCode = parsed.region ?? ''
  } catch {
    const [language = locale, region = ''] = locale.split('-')
    languageCode = language
    regionCode = region
  }
  const languageName = languageDisplayNames?.of(languageCode) ?? languageCode
  const countryName = regionCode ? (regionDisplayNames?.of(regionCode) ?? regionCode) : ''
  return { languageName, countryName }
}

function handleToggleVoice(shortName: string) {
  if (selectedVoices.value.has(shortName)) {
    selectedVoices.value.delete(shortName)
  } else {
    selectedVoices.value.add(shortName)
  }
  selectedVoices.value = new Set(selectedVoices.value)
}

function handleToggleGroup(voices: CuratedVoice[]) {
  const state = getGroupSelectionState(voices)
  if (state === 'all') {
    for (const entry of voices) {
      selectedVoices.value.delete(entry.voice.shortName)
    }
  } else {
    for (const entry of voices) {
      selectedVoices.value.add(entry.voice.shortName)
    }
  }
  selectedVoices.value = new Set(selectedVoices.value)
}

function handleSelectFiltered() {
  for (const entry of filtered.value) {
    selectedVoices.value.add(entry.voice.shortName)
  }
  selectedVoices.value = new Set(selectedVoices.value)
}

function handleClearFiltered() {
  for (const entry of filtered.value) {
    selectedVoices.value.delete(entry.voice.shortName)
  }
  selectedVoices.value = new Set(selectedVoices.value)
}

function handleSelectAll() {
  selectedVoices.value = new Set(allVoices.value.map((v) => v.shortName))
}

function handleClearAll() {
  selectedVoices.value = new Set()
}

async function handleSave() {
  saving.value = true
  try {
    stopPreview()
    const config: TtsEdgeConfig = {
      enabled: true,
      enabledVoices: [...selectedVoices.value],
    }
    const saved = await ttsApi.updateEdgeConfig(config)
    selectedVoices.value = new Set(saved.enabledVoices)
    persistedSelectedVoices.value = new Set(saved.enabledVoices)
    emit('save', saved)
  } finally {
    saving.value = false
  }
}

async function handlePreview(entry: CuratedVoice) {
  const voice = entry.voice
  if (previewingVoiceId.value === voice.shortName) return
  if (playingVoiceId.value === voice.shortName) {
    stopPreview()
    return
  }
  stopPreview()
  previewingVoiceId.value = voice.shortName
  try {
    const response = await ttsApi.previewVoice(voice.providerId, voice.id)
    if (!response.ok) throw new Error('Preview failed')
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    previewAudio = audio
    previewAudioUrl = url
    playingVoiceId.value = voice.shortName
    audio.onended = () => clearPreviewAudio()
    audio.onpause = () => clearPreviewAudio()
    await audio.play()
  } catch {
    clearPreviewAudio()
  } finally {
    previewingVoiceId.value = null
  }
}

function stopPreview() {
  if (previewAudio) {
    previewAudio.pause()
  }
  clearPreviewAudio()
  previewingVoiceId.value = null
}

function clearPreviewAudio() {
  if (previewAudioUrl) {
    URL.revokeObjectURL(previewAudioUrl)
  }
  previewAudio = null
  previewAudioUrl = null
  playingVoiceId.value = null
}

function getGroupSelectionState(voices: CuratedVoice[]): 'none' | 'some' | 'all' {
  if (voices.length === 0) return 'none'
  let selectedInGroup = 0
  for (const entry of voices) {
    if (selectedVoices.value.has(entry.voice.shortName)) selectedInGroup += 1
  }
  if (selectedInGroup === 0) return 'none'
  if (selectedInGroup === voices.length) return 'all'
  return 'some'
}

function handleRemoveFilterChip(key: 'search' | 'language' | 'country') {
  if (key === 'search') search.value = ''
  if (key === 'language') languageFilter.value = ''
  if (key === 'country') countryFilter.value = ''
}

function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

function handleClose() {
  if (hasUnsavedChanges.value && typeof window !== 'undefined') {
    const shouldDiscard = window.confirm('Discard unsaved voice curation changes?')
    if (!shouldDiscard) return
  }
  stopPreview()
  emit('close')
}

onUnmounted(() => {
  stopPreview()
})
</script>

<template>
  <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
    <div class="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-xl">
      <div class="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
        <div>
          <h2 class="font-semibold text-foreground">Curate Edge TTS Voices</h2>
          <p class="text-xs text-muted-foreground mt-0.5">
            {{ selectedVoices.size }} selected / {{ filtered.length }} visible
            <span v-if="selectedVoices.size === 0"> · All voices available to users</span>
            <span v-if="hasUnsavedChanges"> · Unsaved changes</span>
          </p>
        </div>
        <button class="p-1.5 rounded-lg hover:bg-accent" @click="handleClose">
          <X class="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <div class="p-4 border-b border-border flex-shrink-0 space-y-3">
        <div class="flex items-center gap-3">
          <div class="relative flex-1">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              v-model="search"
              placeholder="Search voices..."
              class="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button class="text-xs text-primary font-medium hover:underline" @click="handleSelectAll">Select all</button>
          <button class="text-xs text-muted-foreground font-medium hover:underline" @click="handleClearAll">Clear all</button>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <select
            v-model="languageFilter"
            class="min-w-44 px-3 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All languages</option>
            <option v-for="language in languageOptions" :key="language" :value="language">{{ language }}</option>
          </select>
          <select
            v-model="countryFilter"
            class="min-w-44 px-3 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All countries</option>
            <option v-for="country in countryOptions" :key="country" :value="country">{{ country }}</option>
          </select>
          <button
            class="text-xs text-primary font-medium hover:underline disabled:opacity-40"
            :disabled="filtered.length === 0"
            @click="handleSelectFiltered"
          >
            Select filtered
          </button>
          <button
            class="text-xs text-muted-foreground font-medium hover:underline disabled:opacity-40"
            :disabled="filtered.length === 0 || selectedVisibleCount === 0"
            @click="handleClearFiltered"
          >
            Clear filtered
          </button>
        </div>
        <div v-if="activeFilterChips.length > 0" class="flex flex-wrap gap-2">
          <button
            v-for="chip in activeFilterChips"
            :key="chip.key"
            class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-accent text-foreground hover:bg-accent/80"
            @click="handleRemoveFilterChip(chip.key)"
          >
            {{ chip.label }}
            <X class="w-3 h-3" />
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-4 pb-4 min-h-0">
        <div v-if="loading" class="flex items-center justify-center py-10">
          <Loader2 class="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
        <template v-else>
          <div v-for="[locale, voices] in groupedByLocale" :key="locale" class="space-y-1 border-b border-border/30 last:border-b-0">
            <div class="sticky top-0 z-10 -mx-4 px-4 py-1 bg-card border-b border-border/50">
              <label class="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  :checked="getGroupSelectionState(voices) === 'all'"
                  :indeterminate.prop="getGroupSelectionState(voices) === 'some'"
                  class="rounded border-border text-primary focus:ring-ring"
                  @change="handleToggleGroup(voices)"
                />
                <span class="text-xs font-semibold text-muted-foreground">{{ locale }}</span>
                <span class="text-[11px] text-muted-foreground/90"
                  >{{ voices.filter((entry) => selectedVoices.has(entry.voice.shortName)).length }}/{{ voices.length }}</span
                >
              </label>
            </div>
            <div class="space-y-0.5">
              <label
                v-for="voice in voices"
                :key="voice.voice.shortName"
                class="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-accent cursor-pointer"
              >
                <input
                  type="checkbox"
                  :checked="selectedVoices.has(voice.voice.shortName)"
                  class="rounded border-border text-primary focus:ring-ring"
                  @change="handleToggleVoice(voice.voice.shortName)"
                />
                <span class="text-sm text-foreground flex-1 min-w-0 truncate">{{ voice.displayName }}</span>
                <button
                  type="button"
                  class="p-1.5 rounded-md hover:bg-background text-muted-foreground flex-shrink-0"
                  :aria-label="playingVoiceId === voice.voice.shortName ? `Stop preview for ${voice.displayName}` : `Preview ${voice.displayName}`"
                  @click.prevent.stop="handlePreview(voice)"
                >
                  <Loader2 v-if="previewingVoiceId === voice.voice.shortName" class="w-3.5 h-3.5 animate-spin" />
                  <Square v-else-if="playingVoiceId === voice.voice.shortName" class="w-3.5 h-3.5" />
                  <Volume2 v-else class="w-3.5 h-3.5" />
                </button>
                <span class="text-xs text-muted-foreground flex-shrink-0">{{ voice.voice.gender }}</span>
              </label>
            </div>
          </div>
          <div v-if="filtered.length === 0" class="text-sm text-muted-foreground text-center py-6">No voices match your search.</div>
        </template>
      </div>

      <div class="flex justify-end gap-3 p-4 border-t border-border flex-shrink-0">
        <button class="px-4 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-accent" @click="handleClose">
          Cancel
        </button>
        <button
          class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          :disabled="saving || !hasUnsavedChanges"
          @click="handleSave"
        >
          <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
          Save
        </button>
      </div>
    </div>
  </div>
</template>
