<script setup lang="ts">
import { computed, ref } from 'vue'
import { Headphones, Pause, Play, X, SkipForward, SkipBack, ChevronUp } from 'lucide-vue-next'
import { useTtsPlayer } from '../composables/useTtsPlayer'
import TtsMiniPlayerExpanded from './TtsMiniPlayerExpanded.vue'

const { playbackState, currentBook, currentBlockIndex, currentChapterIndex, speed, togglePlayPause, nextBlock, prevBlock, stopPlayback } =
  useTtsPlayer()

const isExpanded = ref(false)
const isVisible = computed(() => playbackState.value !== 'idle')

function handleToggleExpand() {
  isExpanded.value = !isExpanded.value
}

function handleClose() {
  stopPlayback()
  isExpanded.value = false
}
</script>

<template>
  <Transition name="slide-up">
    <div v-if="isVisible" class="tts-mini-player fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(480px,calc(100vw-16px))]">
      <div class="bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        <div class="flex items-center gap-2 px-3 py-2">
          <div
            class="flex-shrink-0 w-8 h-10 rounded bg-muted overflow-hidden flex items-center justify-center cursor-pointer"
            @click="handleToggleExpand"
          >
            <img v-if="currentBook?.coverUrl" :src="currentBook.coverUrl" :alt="currentBook?.title" class="w-full h-full object-cover" />
            <Headphones v-else class="w-4 h-4 text-muted-foreground" />
          </div>

          <div class="flex-1 min-w-0 cursor-pointer" @click="handleToggleExpand">
            <div class="text-sm font-medium truncate text-foreground">{{ currentBook?.title ?? 'TTS Playback' }}</div>
            <div class="text-xs text-muted-foreground">Chapter {{ currentChapterIndex + 1 }} - Block {{ currentBlockIndex + 1 }} - {{ speed }}x</div>
          </div>

          <div class="flex items-center gap-1 flex-shrink-0">
            <button
              class="p-1.5 rounded-md hover:bg-accent text-foreground disabled:opacity-50"
              :disabled="playbackState === 'loading'"
              @click="prevBlock"
            >
              <SkipBack class="w-4 h-4" />
            </button>
            <button
              class="p-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              :disabled="playbackState === 'loading'"
              @click="togglePlayPause"
            >
              <Pause v-if="playbackState === 'playing'" class="w-4 h-4" />
              <Play v-else class="w-4 h-4" />
            </button>
            <button
              class="p-1.5 rounded-md hover:bg-accent text-foreground disabled:opacity-50"
              :disabled="playbackState === 'loading'"
              @click="nextBlock"
            >
              <SkipForward class="w-4 h-4" />
            </button>
            <button class="p-1.5 rounded-md hover:bg-accent text-muted-foreground" @click="handleToggleExpand">
              <ChevronUp class="w-4 h-4 transition-transform" :class="{ 'rotate-180': isExpanded }" />
            </button>
            <button class="p-1.5 rounded-md hover:bg-accent text-muted-foreground" @click="handleClose">
              <X class="w-4 h-4" />
            </button>
          </div>
        </div>

        <div v-if="playbackState === 'loading'" class="h-0.5 bg-muted overflow-hidden">
          <div class="h-full bg-primary animate-pulse w-1/2" />
        </div>
        <div v-if="playbackState === 'error'" class="px-3 pb-2 text-xs text-destructive">Playback error - tap play to retry</div>
      </div>

      <TtsMiniPlayerExpanded v-if="isExpanded" @close="isExpanded = false" />
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
