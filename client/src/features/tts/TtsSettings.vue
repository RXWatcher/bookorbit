<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Loader2, Save } from 'lucide-vue-next'
import { useTtsPreferences } from './composables/useTtsPreferences'
import { useTtsVoices } from './composables/useTtsVoices'
import TtsVoicePicker from './components/TtsVoicePicker.vue'
import TtsSpeedControl from './components/TtsSpeedControl.vue'

const { userPrefs, loadUserPreferences, saveUserPreferences } = useTtsPreferences()
const { loadProviders } = useTtsVoices()

const selectedProviderId = ref<string | null>(null)
const selectedVoiceId = ref<string | null>(null)
const selectedSpeed = ref(1.0)
const saving = ref(false)
const showVoicePicker = ref(false)

onMounted(async () => {
  await Promise.all([loadUserPreferences(), loadProviders()])
  if (userPrefs.value) {
    selectedProviderId.value = userPrefs.value.providerId
    selectedVoiceId.value = userPrefs.value.voiceId
    selectedSpeed.value = userPrefs.value.speed ?? 1.0
  }
})

async function handleSave() {
  saving.value = true
  try {
    await saveUserPreferences({
      providerId: selectedProviderId.value ?? undefined,
      voiceId: selectedVoiceId.value ?? undefined,
      speed: selectedSpeed.value,
    })
    toast.success('TTS preferences saved')
  } catch {
    toast.error('Failed to save TTS preferences')
  } finally {
    saving.value = false
  }
}

function handleVoiceSelected(voiceId: string) {
  selectedVoiceId.value = voiceId
  showVoicePicker.value = false
}

function handleProviderSelected(providerId: string) {
  selectedProviderId.value = providerId
}

function handleSpeedUpdate(speed: number) {
  selectedSpeed.value = speed
}

function handleToggleVoicePicker() {
  showVoicePicker.value = !showVoicePicker.value
}
</script>

<template>
  <div class="space-y-6 max-w-2xl">
    <div>
      <h2 class="text-xl font-semibold text-foreground">Text-to-Speech</h2>
      <p class="text-sm text-muted-foreground mt-1">Configure your default TTS voice and playback settings.</p>
    </div>

    <div class="bg-card border border-border rounded-xl p-5 space-y-5">
      <div>
        <label class="block text-sm font-medium text-foreground mb-1">Default Voice</label>
        <button
          class="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-border bg-background hover:bg-accent text-sm"
          @click="handleToggleVoicePicker"
        >
          <span v-if="selectedVoiceId" class="text-foreground">{{ selectedVoiceId }}</span>
          <span v-else class="text-muted-foreground">Select a voice...</span>
          <span class="text-muted-foreground text-xs">{{ showVoicePicker ? 'Hide' : 'Change' }}</span>
        </button>
        <div v-if="showVoicePicker" class="mt-2 border border-border rounded-xl overflow-hidden">
          <TtsVoicePicker
            :selected-provider-id="selectedProviderId"
            :selected-voice-id="selectedVoiceId"
            @update:selected-voice-id="handleVoiceSelected"
            @update:selected-provider-id="handleProviderSelected"
            @close="showVoicePicker = false"
          />
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-foreground mb-3">Default Speed</label>
        <TtsSpeedControl :speed="selectedSpeed" @update:speed="handleSpeedUpdate" />
      </div>

      <div class="flex justify-end">
        <button
          class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          :disabled="saving"
          @click="handleSave"
        >
          <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
          <Save v-else class="w-4 h-4" />
          Save
        </button>
      </div>
    </div>
  </div>
</template>
