<script setup lang="ts">
import { BookmarkCheck, Play, X } from 'lucide-vue-next'

const props = defineProps<{ chapterIndex: number | null }>()
const emit = defineEmits<{ resume: []; playFromHere: []; cancel: [] }>()

function handleResume() {
  emit('resume')
}

function handlePlayFromHere() {
  emit('playFromHere')
}

function handleCancel() {
  emit('cancel')
}
</script>

<template>
  <div class="flex flex-col items-center gap-3 p-4 bg-card border border-border rounded-xl shadow-lg max-w-sm mx-auto">
    <div class="w-full flex items-start justify-between gap-2">
      <div>
        <div class="font-semibold text-foreground">Resume TTS?</div>
        <div class="text-sm text-muted-foreground mt-1">
          You have a saved TTS position
          <span v-if="props.chapterIndex !== null">(Chapter {{ props.chapterIndex + 1 }})</span>
        </div>
      </div>
      <button
        class="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        @click="handleCancel"
      >
        <X class="w-4 h-4" />
      </button>
    </div>
    <div class="flex gap-3 w-full">
      <button
        class="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        @click="handleResume"
      >
        <BookmarkCheck class="w-4 h-4" />
        Resume
      </button>
      <button
        class="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent transition-colors"
        @click="handlePlayFromHere"
      >
        <Play class="w-4 h-4" />
        Play from here
      </button>
    </div>
  </div>
</template>
