<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import type { WarehouseEbookRequestSubmitPayload, WarehouseExternalBookSearchResult, WarehouseRequestDetail } from '@bookorbit/types'
import { useCatalogSourceRequests } from '@/features/warehouse/composables/useCatalogSourceRequests'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  submitted: [request: WarehouseRequestDetail]
}>()

const { searchExternal, submit } = useCatalogSourceRequests({}, { autoLoad: false })

const isbn = ref('')
const searchQuery = ref('')
const searchResults = ref<WarehouseExternalBookSearchResult[] | null>(null)
const searching = ref(false)
const saving = ref(false)
const searchError = ref<string | null>(null)
const submitError = ref<string | null>(null)
let searchRequestId = 0
let submitRequestId = 0

const trimmedIsbn = computed(() => isbn.value.trim())
const trimmedSearchQuery = computed(() => searchQuery.value.trim())

function resetFormState() {
  searchRequestId += 1
  submitRequestId += 1
  isbn.value = ''
  searchQuery.value = ''
  searchResults.value = null
  searching.value = false
  saving.value = false
  searchError.value = null
  submitError.value = null
}

function handleClose() {
  resetFormState()
  emit('close')
}

async function runSearch() {
  if (!trimmedSearchQuery.value || searching.value) return

  const query = trimmedSearchQuery.value
  const currentSearchRequestId = ++searchRequestId
  searching.value = true
  searchError.value = null
  searchResults.value = null

  try {
    const page = await searchExternal(query)
    if (currentSearchRequestId !== searchRequestId || !props.open || trimmedSearchQuery.value !== query) return

    searchResults.value = page.results
  } catch {
    if (currentSearchRequestId !== searchRequestId || !props.open || trimmedSearchQuery.value !== query) return

    searchError.value = 'Failed to search titles'
  } finally {
    if (currentSearchRequestId === searchRequestId) {
      searching.value = false
    }
  }
}

async function submitRequest(payload: WarehouseEbookRequestSubmitPayload) {
  if (saving.value) return

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

async function submitManualRequest() {
  if (!trimmedIsbn.value) return

  await submitRequest({ isbn: trimmedIsbn.value })
}

async function submitSearchResult(result: WarehouseExternalBookSearchResult) {
  const resultIsbn = result.isbn?.trim()
  const title = result.title.trim()
  const author = result.author?.trim()

  if (!title) return

  await submitRequest({
    searchResult: {
      title,
      ...(author ? { author } : {}),
      ...(resultIsbn ? { isbn: resultIsbn } : {}),
    },
    ...(resultIsbn ? { isbn: resultIsbn } : {}),
  })
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
      <div data-testid="ebook-request-overlay" class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="handleClose" />
      <div class="relative z-10 mx-4 w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl">
        <div class="mb-5 flex items-center justify-between">
          <h2 class="text-base font-semibold text-foreground">Request Book</h2>
          <button
            type="button"
            data-testid="ebook-request-close"
            aria-label="Close"
            class="text-muted-foreground transition-colors hover:text-foreground"
            @click="handleClose"
          >
            <X :size="18" />
          </button>
        </div>

        <div class="flex flex-col gap-5">
          <form class="flex flex-col gap-3" @submit.prevent="submitManualRequest">
            <label class="text-sm font-medium text-foreground" for="ebook-request-isbn">ISBN</label>
            <div class="flex gap-2">
              <input
                id="ebook-request-isbn"
                v-model="isbn"
                type="text"
                placeholder="ISBN"
                class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                type="button"
                :disabled="!trimmedIsbn || saving"
                class="h-9 shrink-0 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                @click="submitManualRequest"
              >
                Submit request
              </button>
            </div>
          </form>

          <form class="flex flex-col gap-3" @submit.prevent="runSearch">
            <label class="text-sm font-medium text-foreground" for="ebook-request-search">Search</label>
            <div class="flex gap-2">
              <input
                id="ebook-request-search"
                v-model="searchQuery"
                type="text"
                placeholder="Title, author, or ISBN"
                class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                type="button"
                :disabled="!trimmedSearchQuery || searching"
                class="h-9 shrink-0 rounded-md border border-input bg-background px-4 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                @click="runSearch"
              >
                Search
              </button>
            </div>
          </form>

          <p v-if="searching" class="text-sm text-muted-foreground">Searching...</p>
          <p v-else-if="searchError" class="text-sm text-destructive">{{ searchError }}</p>
          <p v-else-if="searchResults?.length === 0" class="text-sm text-muted-foreground">No matches found</p>

          <div v-else-if="searchResults?.length" class="flex flex-col gap-2">
            <div
              v-for="(result, index) in searchResults"
              :key="`${result.title}-${result.isbn ?? index}`"
              class="flex items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-foreground">{{ result.title }}</p>
                <p v-if="result.author" class="truncate text-xs text-muted-foreground">{{ result.author }}</p>
                <p v-if="result.isbn" class="truncate text-xs text-muted-foreground">{{ result.isbn }}</p>
              </div>
              <button
                type="button"
                :disabled="saving"
                class="h-8 shrink-0 rounded-md border border-input bg-background px-3 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                @click="submitSearchResult(result)"
              >
                Request
              </button>
            </div>
          </div>

          <p v-if="submitError" class="text-sm text-destructive">{{ submitError }}</p>

          <div class="flex justify-end">
            <button
              type="button"
              class="h-9 rounded-md border border-input bg-background px-4 text-sm text-foreground transition-colors hover:bg-muted"
              @click="handleClose"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
