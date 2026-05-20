<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { X, Pause, Play, SkipForward, SkipBack, Headphones, Moon, Gauge, Mic2, Loader2 } from 'lucide-vue-next'
import { useTtsPlayer } from '../composables/useTtsPlayer'
import { useTtsPreferences } from '../composables/useTtsPreferences'
import { useTtsVoices } from '../composables/useTtsVoices'
import TtsSpeedControl from './TtsSpeedControl.vue'
import TtsSleepTimerPicker from './TtsSleepTimerPicker.vue'
import TtsVoicePicker from './TtsVoicePicker.vue'

const emit = defineEmits<{ close: [] }>()

const {
  playbackState,
  currentBook,
  currentBlockIndex,
  currentChapterIndex,
  speed,
  currentProviderId,
  currentVoiceId,
  sleepTimer,
  togglePlayPause,
  nextBlock,
  prevBlock,
  stopPlayback,
  setSpeed,
  setVoice,
} = useTtsPlayer()
const { saveBookPreferences, saveUserPreferences } = useTtsPreferences()
const { allVoices, voicesLoading, loadVoices } = useTtsVoices()

const showSpeedControl = ref(false)
const showSleepTimer = ref(false)
const showVoicePicker = ref(false)
const savingBookVoice = ref(false)
const savingDefaultVoice = ref(false)

const selectedVoice = computed(() =>
  allVoices.value.find((voice) => voice.id === currentVoiceId.value && voice.providerId === currentProviderId.value),
)
const selectedVoiceLabel = computed(() => selectedVoice.value?.name ?? (currentVoiceId.value || 'Choose voice'))
const selectedVoiceMeta = computed(() => {
  if (!selectedVoice.value) return currentProviderId.value || 'No provider selected'
  return [selectedVoice.value.locale, selectedVoice.value.gender, selectedVoice.value.providerName].filter(Boolean).join(' - ')
})

onMounted(() => {
  if (allVoices.value.length === 0) void loadVoices()
})

function handleCollapse() {
  emit('close')
}

function handleStop() {
  stopPlayback()
  emit('close')
}

function handleToggleSpeed() {
  showSpeedControl.value = !showSpeedControl.value
  showSleepTimer.value = false
  showVoicePicker.value = false
}

function handleToggleSleepTimer() {
  showSleepTimer.value = !showSleepTimer.value
  showSpeedControl.value = false
  showVoicePicker.value = false
}

function handleToggleVoicePicker() {
  showVoicePicker.value = !showVoicePicker.value
  showSpeedControl.value = false
  showSleepTimer.value = false
}

function handleVoiceSelected(voiceId: string) {
  const voice = allVoices.value.find((item) => item.id === voiceId)
  if (!voice) return
  setVoice(voice.providerId, voice.id)
}

function handleProviderSelected(providerId: string) {
  const matchingVoice = allVoices.value.find((voice) => voice.providerId === providerId)
  if (matchingVoice && !currentVoiceId.value) {
    setVoice(matchingVoice.providerId, matchingVoice.id)
  }
}

async function handleSaveBookVoice() {
  if (!currentBook.value || !currentProviderId.value || !currentVoiceId.value) return
  savingBookVoice.value = true
  try {
    await saveBookPreferences(currentBook.value.bookId, {
      providerId: currentProviderId.value,
      voiceId: currentVoiceId.value,
    })
    toast.success('Voice saved for this book')
  } catch {
    toast.error('Failed to save book voice')
  } finally {
    savingBookVoice.value = false
  }
}

async function handleSaveDefaultVoice() {
  if (!currentProviderId.value || !currentVoiceId.value) return
  savingDefaultVoice.value = true
  try {
    await saveUserPreferences({
      providerId: currentProviderId.value,
      voiceId: currentVoiceId.value,
    })
    toast.success('Default TTS voice updated')
  } catch {
    toast.error('Failed to update default voice')
  } finally {
    savingDefaultVoice.value = false
  }
}
</script>

<template>
  <div class="bg-card border border-border border-t-0 rounded-b-xl shadow-2xl p-4 space-y-4">
    <div class="flex items-start gap-3">
      <div class="flex-shrink-0 w-16 h-20 rounded-lg bg-muted overflow-hidden flex items-center justify-center">
        <img v-if="currentBook?.coverUrl" :src="currentBook.coverUrl" :alt="currentBook?.title" class="w-full h-full object-cover" />
        <Headphones v-else class="w-8 h-8 text-muted-foreground" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-semibold text-foreground truncate">{{ currentBook?.title ?? 'TTS Playback' }}</div>
        <div class="text-sm text-muted-foreground">{{ currentBook?.author ?? '' }}</div>
        <div class="text-xs text-muted-foreground mt-1">Chapter {{ currentChapterIndex + 1 }} - Sentence {{ currentBlockIndex + 1 }}</div>
      </div>
      <button class="p-1.5 rounded-md hover:bg-accent text-muted-foreground" @click="handleCollapse">
        <X class="w-4 h-4" />
      </button>
    </div>

    <div class="flex items-center justify-center gap-4 py-1">
      <button class="p-2 rounded-lg hover:bg-accent text-foreground disabled:opacity-50" :disabled="playbackState === 'loading'" @click="prevBlock">
        <SkipBack class="w-5 h-5" />
      </button>
      <button
        class="p-3 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 w-12 h-12 flex items-center justify-center"
        :disabled="playbackState === 'loading'"
        @click="togglePlayPause"
      >
        <Pause v-if="playbackState === 'playing'" class="w-6 h-6" />
        <Play v-else class="w-6 h-6" />
      </button>
      <button class="p-2 rounded-lg hover:bg-accent text-foreground disabled:opacity-50" :disabled="playbackState === 'loading'" @click="nextBlock">
        <SkipForward class="w-5 h-5" />
      </button>
    </div>

    <div class="grid grid-cols-3 gap-2">
      <button
        class="flex min-w-0 items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm hover:bg-accent text-foreground border border-transparent"
        :class="{ 'bg-accent border-border': showVoicePicker }"
        @click="handleToggleVoicePicker"
      >
        <Mic2 class="w-4 h-4 flex-shrink-0" />
        <span class="truncate">{{ selectedVoice ? selectedVoice.name : 'Voice' }}</span>
      </button>
      <button
        class="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm hover:bg-accent text-foreground border border-transparent"
        :class="{ 'bg-accent border-border': showSpeedControl }"
        @click="handleToggleSpeed"
      >
        <Gauge class="w-4 h-4" />
        <span>{{ speed }}x</span>
      </button>
      <button
        class="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm hover:bg-accent text-foreground border border-transparent"
        :class="{ 'bg-accent border-border': showSleepTimer || sleepTimer.activeMinutes.value !== null }"
        @click="handleToggleSleepTimer"
      >
        <Moon class="w-4 h-4" />
        <span v-if="sleepTimer.activeMinutes.value !== null && sleepTimer.remainingSeconds.value !== null">
          {{ Math.ceil(sleepTimer.remainingSeconds.value / 60) }}m
        </span>
        <span v-else>Sleep</span>
      </button>
    </div>

    <div v-if="showVoicePicker" class="space-y-3 pt-2 border-t border-border">
      <div class="rounded-lg border border-border bg-background/60 p-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current voice</div>
            <div class="truncate text-sm font-semibold text-foreground">{{ selectedVoiceLabel }}</div>
            <div class="truncate text-xs text-muted-foreground">{{ selectedVoiceMeta }}</div>
          </div>
          <Loader2 v-if="voicesLoading" class="w-4 h-4 animate-spin text-muted-foreground flex-shrink-0" />
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            class="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-50"
            :disabled="savingBookVoice || !currentVoiceId"
            @click="handleSaveBookVoice"
          >
            <Loader2 v-if="savingBookVoice" class="w-3.5 h-3.5 animate-spin" />
            Save for this book
          </button>
          <button
            class="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-50"
            :disabled="savingDefaultVoice || !currentVoiceId"
            @click="handleSaveDefaultVoice"
          >
            <Loader2 v-if="savingDefaultVoice" class="w-3.5 h-3.5 animate-spin" />
            Set default
          </button>
        </div>
        <div class="mt-2 text-xs text-muted-foreground">Voice changes apply after the current sentence.</div>
      </div>

      <div class="overflow-hidden rounded-xl border border-border">
        <TtsVoicePicker
          :selected-provider-id="currentProviderId"
          :selected-voice-id="currentVoiceId"
          height-class="h-[min(52vh,360px)]"
          @update:selected-voice-id="handleVoiceSelected"
          @update:selected-provider-id="handleProviderSelected"
          @close="showVoicePicker = false"
        />
      </div>
    </div>
    <TtsSpeedControl v-if="showSpeedControl" :speed="speed" @update:speed="setSpeed" />
    <TtsSleepTimerPicker v-if="showSleepTimer" :sleep-timer="sleepTimer" />

    <div class="flex items-center justify-between border-t border-border pt-3">
      <div class="text-xs text-muted-foreground">
        <span class="font-medium text-foreground">{{ speed }}x</span>
        <span> - {{ selectedVoiceLabel }}</span>
      </div>
      <button class="px-3 py-1.5 rounded-lg text-sm hover:bg-accent text-destructive" @click="handleStop">Stop</button>
    </div>
  </div>
</template>
