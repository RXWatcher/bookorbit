<script setup lang="ts">
import { ref } from 'vue'
import { X, Pause, Play, SkipForward, SkipBack, Headphones, Moon, Gauge } from 'lucide-vue-next'
import { useTtsPlayer } from '../composables/useTtsPlayer'
import TtsSpeedControl from './TtsSpeedControl.vue'
import TtsSleepTimerPicker from './TtsSleepTimerPicker.vue'

const emit = defineEmits<{ close: [] }>()

const {
  playbackState,
  currentBook,
  currentBlockIndex,
  currentChapterIndex,
  speed,
  sleepTimer,
  togglePlayPause,
  nextBlock,
  prevBlock,
  stopPlayback,
  setSpeed,
} = useTtsPlayer()

const showSpeedControl = ref(false)
const showSleepTimer = ref(false)

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
}

function handleToggleSleepTimer() {
  showSleepTimer.value = !showSleepTimer.value
  showSpeedControl.value = false
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

    <div class="flex items-center justify-center gap-4">
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

    <div class="flex items-center justify-between">
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm hover:bg-accent text-foreground"
        :class="{ 'bg-accent': showSpeedControl }"
        @click="handleToggleSpeed"
      >
        <Gauge class="w-4 h-4" />
        <span>{{ speed }}x</span>
      </button>
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm hover:bg-accent text-foreground"
        :class="{ 'bg-accent': showSleepTimer || sleepTimer.activeMinutes.value !== null }"
        @click="handleToggleSleepTimer"
      >
        <Moon class="w-4 h-4" />
        <span v-if="sleepTimer.activeMinutes.value !== null && sleepTimer.remainingSeconds.value !== null">
          {{ Math.ceil(sleepTimer.remainingSeconds.value / 60) }}m
        </span>
        <span v-else>Sleep</span>
      </button>
      <button class="px-3 py-1.5 rounded-lg text-sm hover:bg-accent text-destructive" @click="handleStop">Stop</button>
    </div>

    <TtsSpeedControl v-if="showSpeedControl" :speed="speed" @update:speed="setSpeed" />
    <TtsSleepTimerPicker v-if="showSleepTimer" :sleep-timer="sleepTimer" />
  </div>
</template>
