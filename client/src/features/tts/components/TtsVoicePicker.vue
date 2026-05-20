<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Search, Volume2, Loader2, Check } from 'lucide-vue-next'
import { useTtsVoices } from '../composables/useTtsVoices'
import type { TtsVoice } from '@bookorbit/types'

const props = defineProps<{
  selectedProviderId: string | null
  selectedVoiceId: string | null
}>()

const emit = defineEmits<{
  'update:selectedVoiceId': [voiceId: string]
  'update:selectedProviderId': [providerId: string]
  close: []
}>()

const { allVoices, providers, voicesLoading, loadVoices, loadProviders, searchVoices, previewVoice } = useTtsVoices()

const searchQuery = ref('')
const activeProviderId = ref(props.selectedProviderId ?? '')
const previewingVoiceId = ref<string | null>(null)

watch(
  () => props.selectedProviderId,
  (v) => {
    activeProviderId.value = v ?? ''
  },
)

const filteredGroups = computed(() => {
  const voices = searchQuery.value ? searchVoices(searchQuery.value) : allVoices.value
  const filtered = activeProviderId.value ? voices.filter((v) => v.providerId === activeProviderId.value) : voices
  const groups: Record<string, { language: string; voices: TtsVoice[] }> = {}
  for (const voice of filtered) {
    const lang = voice.language || voice.locale || 'Unknown'
    if (!groups[lang]) groups[lang] = { language: lang, voices: [] }
    groups[lang]!.voices.push(voice)
  }
  return Object.values(groups).sort((a, b) => a.language.localeCompare(b.language))
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

void loadProviders()
void loadVoices()
</script>

<template>
  <div class="flex flex-col h-[80vh] max-h-[600px]">
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
    </div>

    <div class="flex-1 overflow-y-auto p-2">
      <div v-if="voicesLoading" class="flex items-center justify-center py-12">
        <Loader2 class="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
      <div v-else-if="filteredGroups.length === 0" class="text-center py-12 text-muted-foreground text-sm">No voices found</div>
      <div v-else class="space-y-4">
        <div v-for="group in filteredGroups" :key="group.language">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 sticky top-0 bg-card">
            {{ group.language }}
          </div>
          <div class="space-y-1">
            <div
              v-for="voice in group.voices"
              :key="voice.id"
              class="flex items-center gap-3 p-2 rounded-lg hover:bg-accent cursor-pointer"
              :class="{ 'bg-accent': props.selectedVoiceId === voice.id }"
              @click="handleSelectVoice(voice)"
            >
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium truncate">{{ voice.name }}</div>
                <div class="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{{ voice.locale }}</span>
                  <span v-if="voice.gender" class="px-1.5 py-0.5 bg-muted rounded text-xs">{{ voice.gender }}</span>
                  <span class="text-primary/70">{{ voice.providerName }}</span>
                </div>
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <button class="p-1.5 rounded-md hover:bg-background text-muted-foreground" @click.stop="handlePreview(voice)">
                  <Loader2 v-if="previewingVoiceId === voice.id" class="w-4 h-4 animate-spin" />
                  <Volume2 v-else class="w-4 h-4" />
                </button>
                <Check v-if="props.selectedVoiceId === voice.id" class="w-4 h-4 text-primary" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
