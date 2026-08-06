<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import type { WarehouseComicRequestSubmitPayload, WarehouseRequestDetail } from '@bookorbit/types'
import { useCatalogSourceComicRequests } from '@/features/warehouse/composables/useCatalogSourceComicRequests'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  submitted: [request: WarehouseRequestDetail]
}>()

const { submit } = useCatalogSourceComicRequests({}, { autoLoad: false })

const seriesTitle = ref('')
const issueNumber = ref('')
const publisher = ref('')
const year = ref('')
const saving = ref(false)
const submitError = ref<string | null>(null)
let submitRequestId = 0

const trimmedSeriesTitle = computed(() => seriesTitle.value.trim())

function resetFormState() {
  submitRequestId += 1
  seriesTitle.value = ''
  issueNumber.value = ''
  publisher.value = ''
  year.value = ''
  saving.value = false
  submitError.value = null
}

function handleClose() {
  resetFormState()
  emit('close')
}

function toSubmitPayload(): WarehouseComicRequestSubmitPayload | null {
  const cleanSeriesTitle = seriesTitle.value.trim()
  const cleanIssueNumber = issueNumber.value.trim()
  const cleanPublisher = publisher.value.trim()
  const cleanYear = String(year.value).trim()

  if (!cleanSeriesTitle) return null

  const parsedYear = cleanYear ? Number(cleanYear) : null

  return {
    seriesTitle: cleanSeriesTitle,
    ...(cleanIssueNumber ? { issueNumber: cleanIssueNumber } : {}),
    ...(cleanPublisher ? { publisher: cleanPublisher } : {}),
    ...(parsedYear !== null && Number.isInteger(parsedYear) ? { year: parsedYear } : {}),
  }
}

async function submitRequest() {
  const payload = toSubmitPayload()
  if (!payload || saving.value) return

  const currentSubmitRequestId = ++submitRequestId
  saving.value = true
  submitError.value = null

  try {
    const request = await submit(payload)
    if (currentSubmitRequestId !== submitRequestId || !props.open) return

    resetFormState()
    emit('submitted', request)
    emit('close')
  } catch {
    if (currentSubmitRequestId !== submitRequestId || !props.open) return

    submitError.value = 'Failed to submit request'
  } finally {
    if (currentSubmitRequestId === submitRequestId) {
      saving.value = false
    }
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      resetFormState()
    }
  },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div data-testid="comic-request-overlay" class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="handleClose" />
      <div class="relative z-10 mx-4 w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl">
        <div class="mb-5 flex items-center justify-between">
          <h2 class="text-base font-semibold text-foreground">Request Comic</h2>
          <button
            type="button"
            data-testid="comic-request-close"
            aria-label="Close"
            class="text-muted-foreground transition-colors hover:text-foreground"
            @click="handleClose"
          >
            <X :size="18" />
          </button>
        </div>

        <form class="flex flex-col gap-5" @submit.prevent="submitRequest">
          <div class="flex flex-col gap-3">
            <label class="text-sm font-medium text-foreground" for="comic-request-series">Series title</label>
            <input
              id="comic-request-series"
              v-model="seriesTitle"
              type="text"
              placeholder="Series title"
              class="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />

            <div class="grid gap-3 sm:grid-cols-2">
              <div class="flex flex-col gap-2">
                <label class="text-sm font-medium text-foreground" for="comic-request-issue">Issue</label>
                <input
                  id="comic-request-issue"
                  v-model="issueNumber"
                  type="text"
                  placeholder="Issue"
                  class="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-sm font-medium text-foreground" for="comic-request-year">Year</label>
                <input
                  id="comic-request-year"
                  v-model="year"
                  type="number"
                  min="1800"
                  max="3000"
                  inputmode="numeric"
                  placeholder="Year"
                  class="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <label class="text-sm font-medium text-foreground" for="comic-request-publisher">Publisher</label>
            <input
              id="comic-request-publisher"
              v-model="publisher"
              type="text"
              placeholder="Publisher"
              class="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <p v-if="submitError" class="text-sm text-destructive">{{ submitError }}</p>

          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="h-9 rounded-md border border-input bg-background px-4 text-sm text-foreground transition-colors hover:bg-muted"
              @click="handleClose"
            >
              Cancel
            </button>
            <button
              type="button"
              :disabled="!trimmedSeriesTitle || saving"
              class="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              @click="submitRequest"
            >
              Submit request
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
