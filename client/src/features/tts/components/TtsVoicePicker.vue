<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Search, Volume2, Loader2, Check } from 'lucide-vue-next'
import { useTtsVoices } from '../composables/useTtsVoices'
import type { TtsVoice } from '@bookorbit/types'
import { formatVoiceDisplayName } from '../lib/voice-display'

const props = withDefaults(
  defineProps<{
    selectedProviderId: string | null
    selectedVoiceId: string | null
    heightClass?: string
  }>(),
  {
    heightClass: 'h-[80vh] max-h-[600px]',
  },
)

const emit = defineEmits<{
  'update:selectedVoiceId': [voiceId: string]
  'update:selectedProviderId': [providerId: string]
  close: []
}>()

const { allVoices, providers, voicesLoading, loadVoices, loadProviders, previewVoice } = useTtsVoices()

const searchQuery = ref('')
const activeProviderId = ref(props.selectedProviderId ?? '')
const previewingVoiceId = ref<string | null>(null)
const languageFilter = ref('')
const countryFilter = ref('')

type VoiceListEntry = {
  voice: TtsVoice
  displayName: string
  languageName: string
  countryName: string
  localeLabel: string
}

const languageDisplayNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'language' }) : null
const regionDisplayNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null

watch(
  () => props.selectedProviderId,
  (v) => {
    activeProviderId.value = v ?? ''
  },
)

const entries = computed<VoiceListEntry[]>(() =>
  allVoices.value.map((voice) => {
    const parsed = parseLanguageCountryFromFriendlyName(voice.name) ?? parseLanguageCountryFromLocale(voice.locale)
    const languageName = parsed.languageName
    const countryName = parsed.countryName
    return {
      voice,
      displayName: formatVoiceDisplayName(voice),
      languageName,
      countryName,
      localeLabel: countryName ? `${languageName} (${countryName})` : languageName,
    }
  }),
)

const languageOptions = computed(() =>
  [...new Set(entries.value.map((entry) => entry.languageName))].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
)

const countryOptions = computed(() => {
  const source = languageFilter.value ? entries.value.filter((entry) => entry.languageName === languageFilter.value) : entries.value
  return [...new Set(source.map((entry) => entry.countryName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
})

watch(countryOptions, (nextCountries) => {
  if (countryFilter.value && !nextCountries.includes(countryFilter.value)) {
    countryFilter.value = ''
  }
})

const filteredEntries = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return entries.value.filter((entry) => {
    if (activeProviderId.value && entry.voice.providerId !== activeProviderId.value) return false
    if (languageFilter.value && entry.languageName !== languageFilter.value) return false
    if (countryFilter.value && entry.countryName !== countryFilter.value) return false
    if (!q) return true
    return (
      entry.displayName.toLowerCase().includes(q) ||
      entry.languageName.toLowerCase().includes(q) ||
      entry.countryName.toLowerCase().includes(q) ||
      entry.localeLabel.toLowerCase().includes(q) ||
      entry.voice.name.toLowerCase().includes(q) ||
      entry.voice.locale.toLowerCase().includes(q) ||
      entry.voice.providerName.toLowerCase().includes(q)
    )
  })
})

const filteredGroups = computed(() => {
  const groups = new Map<string, VoiceListEntry[]>()
  for (const entry of filteredEntries.value) {
    const key = entry.localeLabel
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(entry)
  }
  return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' })))
})

async function handlePreview(voice: TtsVoice) {
  previewingVoiceId.value = voice.id
  try {
    await previewVoice(voice.providerId, voice.id)
  } finally {
    previewingVoiceId.value = null
  }
}

function handleSelectVoice(voice: TtsVoice) {
  emit('update:selectedVoiceId', voice.id)
  emit('update:selectedProviderId', voice.providerId)
}

function handleSearchInput(event: Event) {
  searchQuery.value = (event.target as HTMLInputElement).value
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

void loadProviders()
void loadVoices()
</script>

<template>
  <div class="flex flex-col" :class="props.heightClass">
    <div class="p-4 border-b border-border space-y-3">
      <div class="relative">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search voices..."
          class="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          :value="searchQuery"
          @input="handleSearchInput"
        />
      </div>
      <div class="flex gap-2 overflow-x-auto pb-1">
        <button
          class="px-3 py-1 rounded-full text-sm flex-shrink-0 border transition-colors"
          :class="activeProviderId === '' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'"
          @click="activeProviderId = ''"
        >
          All
        </button>
        <button
          v-for="provider in providers"
          :key="provider.id"
          class="px-3 py-1 rounded-full text-sm flex-shrink-0 border transition-colors"
          :class="activeProviderId === provider.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'"
          @click="activeProviderId = provider.id"
        >
          {{ provider.name }}
        </button>
      </div>
      <div class="flex flex-wrap items-center gap-2">
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
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-2">
      <div v-if="voicesLoading" class="flex items-center justify-center py-12">
        <Loader2 class="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
      <div v-else-if="filteredGroups.size === 0" class="text-center py-12 text-muted-foreground text-sm">No voices found</div>
      <div v-else class="space-y-4">
        <div v-for="[locale, voices] in filteredGroups" :key="locale">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 sticky top-0 bg-card">
            {{ locale }}
          </div>
          <div class="space-y-1">
            <div
              v-for="entry in voices"
              :key="entry.voice.id"
              class="flex items-center gap-3 p-2 rounded-lg hover:bg-accent cursor-pointer"
              :class="{ 'bg-accent': props.selectedVoiceId === entry.voice.id }"
              @click="handleSelectVoice(entry.voice)"
            >
              <div class="text-sm font-medium truncate flex-1 min-w-0">{{ entry.displayName }}</div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <span v-if="entry.voice.gender" class="text-xs text-muted-foreground">{{ entry.voice.gender }}</span>
                <button class="p-1.5 rounded-md hover:bg-background text-muted-foreground" @click.stop="handlePreview(entry.voice)">
                  <Loader2 v-if="previewingVoiceId === entry.voice.id" class="w-4 h-4 animate-spin" />
                  <Volume2 v-else class="w-4 h-4" />
                </button>
                <Check v-if="props.selectedVoiceId === entry.voice.id" class="w-4 h-4 text-primary" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
