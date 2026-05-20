<script setup lang="ts">
import { BookmarkCheck, SkipForward } from 'lucide-vue-next'

const props = defineProps<{ chapterIndex: number | null }>()
const emit = defineEmits<{ resume: []; startFresh: [] }>()

function handleResume() {
  emit('resume')
}

function handleStartFresh() {
  emit('startFresh')
}
</script>

<template>
  <div class="flex flex-col items-center gap-3 p-4 bg-card border border-border rounded-xl shadow-lg max-w-sm mx-auto">
    <div class="text-center">
      <div class="font-semibold text-foreground">Resume TTS?</div>
      <div class="text-sm text-muted-foreground mt-1">
        You have a saved TTS position
        <span v-if="props.chapterIndex !== null">(Chapter {{ props.chapterIndex + 1 }})</span>
      </div>
    </div>
    <div class="flex gap-3 w-full">
      <button
        class="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        @click="handleResume"
      >
        <BookmarkCheck class="w-4 h-4" />
        Resume
      </button>
      <button
        class="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent"
        @click="handleStartFresh"
      >
        <SkipForward class="w-4 h-4" />
        Start fresh
      </button>
    </div>
  </div>
</template>
