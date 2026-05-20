<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Headphones, Pause, Play, ChevronUp } from 'lucide-vue-next'
import { useTtsPlayer } from '../composables/useTtsPlayer'
import { useTtsMiniPlayerUi } from '../composables/useTtsMiniPlayerUi'
import { useTtsVoices } from '../composables/useTtsVoices'
import TtsMiniPlayerExpanded from './TtsMiniPlayerExpanded.vue'

const { playbackState, currentBook, currentBlockIndex, currentChapterIndex, speed, currentProviderId, currentVoiceId, togglePlayPause } =
  useTtsPlayer()

const { isExpanded, setExpanded, toggleExpanded } = useTtsMiniPlayerUi()
const { allVoices, loadVoices } = useTtsVoices()
const isVisible = computed(() => playbackState.value !== 'idle')
const selectedVoice = computed(() =>
  allVoices.value.find((voice) => voice.id === currentVoiceId.value && voice.providerId === currentProviderId.value),
)
const compactMeta = computed(() => {
  const voiceName = selectedVoice.value?.name ?? currentVoiceId.value
  return [`Ch ${currentChapterIndex.value + 1}`, `Sent ${currentBlockIndex.value + 1}`, voiceName, `${speed.value}x`].filter(Boolean).join(' - ')
})

onMounted(() => {
  if (allVoices.value.length === 0) void loadVoices()
})

function handleToggleExpand() {
  toggleExpanded()
}
</script>

<template>
  <Transition name="slide-up">
    <div v-if="isVisible" class="tts-mini-player fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(480px,calc(100vw-16px))]">
      <div class="bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        <div class="flex items-center gap-2 px-3 py-2.5">
          <div
            class="flex-shrink-0 w-8 h-10 rounded bg-muted overflow-hidden flex items-center justify-center cursor-pointer"
            @click="handleToggleExpand"
          >
            <img v-if="currentBook?.coverUrl" :src="currentBook.coverUrl" :alt="currentBook?.title" class="w-full h-full object-cover" />
            <Headphones v-else class="w-4 h-4 text-muted-foreground" />
          </div>

          <div class="flex-1 min-w-0 cursor-pointer" @click="handleToggleExpand">
            <div class="text-sm font-medium truncate text-foreground">{{ currentBook?.title ?? 'TTS Playback' }}</div>
            <div class="text-xs text-muted-foreground truncate">{{ compactMeta }}</div>
          </div>

          <div class="flex items-center gap-1.5 flex-shrink-0">
            <button
              class="p-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              :disabled="playbackState === 'loading'"
              @click="togglePlayPause"
            >
              <Pause v-if="playbackState === 'playing'" class="w-4 h-4" />
              <Play v-else class="w-4 h-4" />
            </button>
            <button class="p-1.5 rounded-md hover:bg-accent text-muted-foreground" @click="handleToggleExpand">
              <ChevronUp class="w-4 h-4 transition-transform" :class="{ 'rotate-180': isExpanded }" />
            </button>
          </div>
        </div>

        <div v-if="playbackState === 'loading'" class="h-0.5 bg-muted overflow-hidden">
          <div class="h-full bg-primary animate-pulse w-1/2" />
        </div>
        <div v-if="playbackState === 'error'" class="px-3 pb-2 text-xs text-destructive">Playback error - tap play to retry</div>
      </div>

      <TtsMiniPlayerExpanded v-if="isExpanded" @close="setExpanded(false)" />
    </div>
  </Transition>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition:
    transform 0.3s ease,
    opacity 0.3s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateX(-50%) translateY(100%);
  opacity: 0;
}
</style>
