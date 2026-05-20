<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { Loader2, Search, X } from 'lucide-vue-next'
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
const selectedVoices = ref<Set<string>>(new Set(props.initialConfig.enabledVoices))

onMounted(async () => {
  try {
    allVoices.value = await ttsApi.getAllEdgeVoices()
  } finally {
    loading.value = false
  }
})

const filtered = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return allVoices.value
  return allVoices.value.filter((v) => v.name.toLowerCase().includes(q) || v.locale.toLowerCase().includes(q) || v.gender.toLowerCase().includes(q))
})

const groupedByLocale = computed(() => {
  const map = new Map<string, TtsVoice[]>()
  for (const v of filtered.value) {
    const key = v.locale
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(v)
  }
  return map
})

function handleToggleVoice(shortName: string) {
  if (selectedVoices.value.has(shortName)) {
    selectedVoices.value.delete(shortName)
  } else {
    selectedVoices.value.add(shortName)
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
    const config: TtsEdgeConfig = {
      enabled: true,
      enabledVoices: [...selectedVoices.value],
    }
    const saved = await ttsApi.updateEdgeConfig(config)
    emit('save', saved)
  } finally {
    saving.value = false
  }
}

function handleClose() {
  emit('close')
}
</script>

<template>
  <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
    <div class="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-xl">
      <div class="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
        <div>
          <h2 class="font-semibold text-foreground">Curate Edge TTS Voices</h2>
          <p class="text-xs text-muted-foreground mt-0.5">
            {{
              selectedVoices.size === 0
                ? 'No selection - all voices available to users'
                : `${selectedVoices.size} voice${selectedVoices.size === 1 ? '' : 's'} selected`
            }}
          </p>
        </div>
        <button class="p-1.5 rounded-lg hover:bg-accent" @click="handleClose">
          <X class="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <div class="p-4 border-b border-border flex-shrink-0 flex items-center gap-3">
        <div class="relative flex-1">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            v-model="search"
            placeholder="Search voices..."
            class="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button class="text-xs text-primary font-medium hover:underline" @click="handleSelectAll">All</button>
        <button class="text-xs text-muted-foreground font-medium hover:underline" @click="handleClearAll">Clear</button>
      </div>

      <div class="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        <div v-if="loading" class="flex items-center justify-center py-10">
          <Loader2 class="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
        <template v-else>
          <div v-for="[locale, voices] in groupedByLocale" :key="locale" class="space-y-1">
            <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">{{ locale }}</h4>
            <div class="space-y-0.5">
              <label
                v-for="voice in voices"
                :key="voice.shortName"
                class="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-accent cursor-pointer"
              >
                <input
                  type="checkbox"
                  :checked="selectedVoices.has(voice.shortName)"
                  class="rounded border-border text-primary focus:ring-ring"
                  @change="handleToggleVoice(voice.shortName)"
                />
                <span class="text-sm text-foreground flex-1 min-w-0 truncate">{{ voice.name }}</span>
                <span class="text-xs text-muted-foreground flex-shrink-0">{{ voice.gender }}</span>
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
          :disabled="saving"
          @click="handleSave"
        >
          <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
          Save
        </button>
      </div>
    </div>
  </div>
</template>
