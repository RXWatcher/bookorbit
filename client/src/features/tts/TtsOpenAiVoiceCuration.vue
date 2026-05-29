<script setup lang="ts">
import { computed, ref } from 'vue'
import { Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-vue-next'
import * as ttsApi from './api/tts.api'
import type { TtsDbProvider, StaticVoiceConfig } from './api/tts.api'
import { detectPreset, mergeVoices, PRESET_VOICES } from './lib/voice-presets'

const props = defineProps<{
  provider: TtsDbProvider
}>()

const emit = defineEmits<{
  save: [voices: StaticVoiceConfig[]]
  close: []
}>()

const GENDER_OPTIONS = ['', 'Male', 'Female', 'Unknown'] as const

const voices = ref<StaticVoiceConfig[]>(props.provider.staticVoices ? [...props.provider.staticVoices] : [])
const savedVoices = ref<StaticVoiceConfig[]>(props.provider.staticVoices ? [...props.provider.staticVoices] : [])

const discovering = ref(false)
const discoverError = ref<string | null>(null)

const editingIdx = ref<number | null>(null)
const editForm = ref<StaticVoiceConfig>({ id: '', name: '', shortName: '', language: '', locale: '', gender: '' })

const showAddForm = ref(false)
const addForm = ref<StaticVoiceConfig>({ id: '', name: '', shortName: '', language: '', locale: '', gender: '' })
const addError = ref<string | null>(null)

const saving = ref(false)

const presetKey = computed(() => detectPreset(props.provider.defaultModel))

const hasUnsavedChanges = computed(() => {
  if (voices.value.length !== savedVoices.value.length) return true
  return voices.value.some((v, i) => {
    const s = savedVoices.value[i]
    return (
      !s ||
      v.id !== s.id ||
      v.name !== s.name ||
      v.shortName !== s.shortName ||
      v.language !== s.language ||
      v.locale !== s.locale ||
      v.gender !== s.gender
    )
  })
})

async function handleDiscover() {
  discovering.value = true
  discoverError.value = null
  try {
    const result = await ttsApi.discoverVoices(props.provider.id)
    if (!result.supported) {
      discoverError.value = 'This provider does not expose a voice list endpoint.'
      return
    }
    voices.value = mergeVoices(voices.value, result.voices)
  } catch (e: unknown) {
    discoverError.value = e instanceof Error ? e.message : 'Failed to discover voices'
  } finally {
    discovering.value = false
  }
}

function handleLoadPreset() {
  if (!presetKey.value) return
  const preset = PRESET_VOICES[presetKey.value]
  voices.value = mergeVoices(voices.value, preset)
}

function handleStartEdit(idx: number) {
  editingIdx.value = idx
  editForm.value = { ...voices.value[idx]! }
}

function handleSaveEdit() {
  if (editingIdx.value === null) return
  const trimmedId = editForm.value.id.trim()
  const trimmedName = editForm.value.name.trim()
  if (!trimmedId || !trimmedName) return
  const duplicate = voices.value.findIndex((v, i) => i !== editingIdx.value && v.id === trimmedId)
  if (duplicate !== -1) return
  voices.value[editingIdx.value] = {
    ...editForm.value,
    id: trimmedId,
    name: trimmedName,
    shortName: editForm.value.shortName.trim() || trimmedId,
  }
  editingIdx.value = null
}

function handleCancelEdit() {
  editingIdx.value = null
}

function handleDeleteVoice(idx: number) {
  voices.value = voices.value.filter((_, i) => i !== idx)
  if (editingIdx.value === idx) editingIdx.value = null
}

function handleShowAddForm() {
  showAddForm.value = true
  addForm.value = { id: '', name: '', shortName: '', language: '', locale: '', gender: '' }
  addError.value = null
}

function handleHideAddForm() {
  showAddForm.value = false
  addError.value = null
}

function handleAddVoice() {
  const trimmedId = addForm.value.id.trim()
  const trimmedName = addForm.value.name.trim()
  if (!trimmedId || !trimmedName) {
    addError.value = 'ID and Name are required'
    return
  }
  if (voices.value.some((v) => v.id === trimmedId)) {
    addError.value = `Voice ID "${trimmedId}" already exists`
    return
  }
  voices.value.push({
    ...addForm.value,
    id: trimmedId,
    name: trimmedName,
    shortName: addForm.value.shortName.trim() || trimmedId,
  })
  showAddForm.value = false
  addError.value = null
}

async function handleSave() {
  saving.value = true
  try {
    emit('save', [...voices.value])
    savedVoices.value = [...voices.value]
  } finally {
    saving.value = false
  }
}

function handleClose() {
  if (hasUnsavedChanges.value && typeof window !== 'undefined') {
    if (!window.confirm('Discard unsaved voice changes?')) return
  }
  emit('close')
}
</script>

<template>
  <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
    <div class="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-xl">
      <!-- Header -->
      <div class="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
        <div>
          <h2 class="font-semibold text-foreground">Manage Voices - {{ provider.name }}</h2>
          <p class="text-xs text-muted-foreground mt-0.5">
            {{ voices.length }} voice{{ voices.length === 1 ? '' : 's' }} configured
            <span v-if="hasUnsavedChanges"> - Unsaved changes</span>
          </p>
        </div>
        <button class="p-1.5 rounded-lg hover:bg-accent" @click="handleClose">
          <X class="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <!-- Import / preset toolbar -->
      <div class="p-4 border-b border-border flex-shrink-0 space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
            :disabled="discovering"
            @click="handleDiscover"
          >
            <Loader2 v-if="discovering" class="w-3.5 h-3.5 animate-spin" />
            <RefreshCw v-else class="w-3.5 h-3.5" />
            Import from provider
          </button>
          <button
            v-if="presetKey"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-accent"
            @click="handleLoadPreset"
          >
            <Plus class="w-3.5 h-3.5" />
            Load {{ presetKey === 'kokoro' ? 'Kokoro' : 'OpenAI' }} preset
          </button>
        </div>
        <p v-if="discoverError" class="text-xs text-destructive">{{ discoverError }}</p>
      </div>

      <!-- Voice table -->
      <div class="flex-1 overflow-y-auto min-h-0">
        <div v-if="voices.length === 0" class="text-sm text-muted-foreground text-center py-10">
          No voices configured. Import from provider, load a preset, or add manually.
        </div>
        <template v-else>
          <div class="text-xs border-b border-border bg-muted/50">
            <div class="grid grid-cols-[1fr_1fr_80px_80px_auto] gap-2 px-4 py-2 font-medium text-muted-foreground">
              <div>ID</div>
              <div>Name</div>
              <div>Locale</div>
              <div>Gender</div>
              <div />
            </div>
          </div>
          <div class="divide-y divide-border">
            <div v-for="(voice, idx) in voices" :key="voice.id">
              <!-- Edit row -->
              <template v-if="editingIdx === idx">
                <div class="grid grid-cols-[1fr_1fr_80px_80px_auto] gap-2 px-4 py-2 items-center">
                  <input
                    v-model="editForm.id"
                    class="px-2 py-1 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <input
                    v-model="editForm.name"
                    class="px-2 py-1 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <input
                    v-model="editForm.locale"
                    placeholder="en-US"
                    class="px-2 py-1 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <select
                    v-model="editForm.gender"
                    class="px-2 py-1 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option v-for="g in GENDER_OPTIONS" :key="g" :value="g">{{ g || '—' }}</option>
                  </select>
                  <div class="flex items-center gap-1">
                    <button class="p-1 rounded text-primary hover:bg-accent text-xs font-medium" @click="handleSaveEdit">Save</button>
                    <button class="p-1 rounded text-muted-foreground hover:bg-accent text-xs" aria-label="Cancel edit" @click="handleCancelEdit">
                      <X class="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </template>
              <!-- Display row -->
              <template v-else>
                <div class="grid grid-cols-[1fr_1fr_80px_80px_auto] gap-2 px-4 py-2 items-center hover:bg-accent/20">
                  <span class="text-xs text-muted-foreground font-mono truncate" :title="voice.id">{{ voice.id }}</span>
                  <span class="text-xs text-foreground truncate" :title="voice.name">{{ voice.name }}</span>
                  <span class="text-xs text-muted-foreground">{{ voice.locale || '-' }}</span>
                  <span class="text-xs text-muted-foreground">{{ voice.gender || '-' }}</span>
                  <div class="flex items-center gap-1">
                    <button class="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent" @click="handleStartEdit(idx)">
                      <Pencil class="w-3.5 h-3.5" />
                    </button>
                    <button class="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10" @click="handleDeleteVoice(idx)">
                      <Trash2 class="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>

      <!-- Add voice form -->
      <div class="border-t border-border flex-shrink-0">
        <template v-if="showAddForm">
          <div class="p-4 space-y-2">
            <div class="grid grid-cols-[1fr_1fr_80px_80px_auto] gap-2 items-end">
              <div>
                <label class="block text-xs text-muted-foreground mb-1">ID</label>
                <input
                  v-model="addForm.id"
                  placeholder="af_heart"
                  class="w-full px-2 py-1.5 text-xs bg-background border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label class="block text-xs text-muted-foreground mb-1">Name</label>
                <input
                  v-model="addForm.name"
                  placeholder="Heart"
                  class="w-full px-2 py-1.5 text-xs bg-background border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label class="block text-xs text-muted-foreground mb-1">Locale</label>
                <input
                  v-model="addForm.locale"
                  placeholder="en-US"
                  class="w-full px-2 py-1.5 text-xs bg-background border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label class="block text-xs text-muted-foreground mb-1">Gender</label>
                <select
                  v-model="addForm.gender"
                  class="w-full px-2 py-1.5 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option v-for="g in GENDER_OPTIONS" :key="g" :value="g">{{ g || '—' }}</option>
                </select>
              </div>
              <div class="flex gap-1">
                <button
                  class="flex items-center gap-1 px-2.5 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
                  @click="handleAddVoice"
                >
                  <Plus class="w-3 h-3" />
                  Add
                </button>
                <button class="p-1.5 rounded hover:bg-accent" @click="handleHideAddForm">
                  <X class="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>
            <p v-if="addError" class="text-xs text-destructive">{{ addError }}</p>
          </div>
        </template>
        <template v-else>
          <div class="px-4 py-3">
            <button class="flex items-center gap-1.5 text-xs text-primary font-medium hover:underline" @click="handleShowAddForm">
              <Plus class="w-3.5 h-3.5" />
              Add voice manually
            </button>
          </div>
        </template>
      </div>

      <!-- Footer -->
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
          Save {{ voices.length }} voice{{ voices.length === 1 ? '' : 's' }}
        </button>
      </div>
    </div>
  </div>
</template>
