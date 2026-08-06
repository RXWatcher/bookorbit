<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import type { WarehouseAudiobookRequestSubmitPayload, WarehouseExternalAudiobookSearchResult, WarehouseRequestDetail } from '@bookorbit/types'
import { useCatalogSourceAudiobookRequests } from '@/features/warehouse/composables/useCatalogSourceAudiobookRequests'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  submitted: [request: WarehouseRequestDetail]
}>()

const { searchCandidates, searchExternal, submit } = useCatalogSourceAudiobookRequests({}, { autoLoad: false })

const title = ref('')
const author = ref('')
const searchQuery = ref('')
const searchResults = ref<WarehouseExternalAudiobookSearchResult[] | null>(null)
const searching = ref(false)
const saving = ref(false)
const searchError = ref<string | null>(null)
const submitError = ref<string | null>(null)
let searchRequestId = 0
let submitRequestId = 0

type SearchMode = 'discover' | 'candidates'

const trimmedTitle = computed(() => title.value.trim())
const trimmedSearchQuery = computed(() => searchQuery.value.trim())

function resetFormState() {
  searchRequestId += 1
  submitRequestId += 1
  title.value = ''
  author.value = ''
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

function resultAuthor(result: WarehouseExternalAudiobookSearchResult): string | undefined {
  const directAuthor = result.author?.trim()
  if (directAuthor) return directAuthor

  const authors = result.authors?.map((value) => value.trim()).filter(Boolean)
  return authors?.length ? authors.join(', ') : undefined
}

function toSubmitPayload(nextTitle: string, nextAuthor?: string | null): WarehouseAudiobookRequestSubmitPayload | null {
  const cleanTitle = nextTitle.trim()
  const cleanAuthor = nextAuthor?.trim()

  if (!cleanTitle) return null

  return {
    title: cleanTitle,
    ...(cleanAuthor ? { author: cleanAuthor } : {}),
  }
}

async function runSearch(mode: SearchMode) {
  if (!trimmedSearchQuery.value || searching.value) return

  const query = trimmedSearchQuery.value
  const currentSearchRequestId = ++searchRequestId
  searching.value = true
  searchError.value = null
  searchResults.value = null

  try {
    const page = mode === 'discover' ? await searchExternal(query) : await searchCandidates(query)
    if (currentSearchRequestId !== searchRequestId || !props.open || trimmedSearchQuery.value !== query) return

    searchResults.value = page.results
  } catch {
    if (currentSearchRequestId !== searchRequestId || !props.open || trimmedSearchQuery.value !== query) return

    searchError.value = mode === 'discover' ? 'Failed to search titles' : 'Failed to search candidates'
  } finally {
    if (currentSearchRequestId === searchRequestId) {
      searching.value = false
    }
  }
}

async function submitRequest(payload: WarehouseAudiobookRequestSubmitPayload | null) {
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

async function submitManualRequest() {
  await submitRequest(toSubmitPayload(title.value, author.value))
}

function useSearchResult(result: WarehouseExternalAudiobookSearchResult) {
  title.value = result.title.trim()
  author.value = resultAuthor(result) ?? ''
  submitError.value = null
}

async function submitSearchResult(result: WarehouseExternalAudiobookSearchResult) {
  await submitRequest(toSubmitPayload(result.title, resultAuthor(result)))
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
      <div data-testid="audiobook-request-overlay" class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="handleClose" />
      <div class="relative z-10 mx-4 w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl">
        <div class="mb-5 flex items-center justify-between">
          <h2 class="text-base font-semibold text-foreground">Request Audiobook</h2>
          <button
            type="button"
            data-testid="audiobook-request-close"
            aria-label="Close"
            class="text-muted-foreground transition-colors hover:text-foreground"
            @click="handleClose"
          >
            <X :size="18" />
          </button>
        </div>

        <div class="flex flex-col gap-5">
          <form class="flex flex-col gap-3" @submit.prevent="submitManualRequest">
            <label class="text-sm font-medium text-foreground" for="audiobook-request-title">Title</label>
            <input
              id="audiobook-request-title"
              v-model="title"
              type="text"
              placeholder="Title"
              class="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />

            <label class="text-sm font-medium text-foreground" for="audiobook-request-author">Author</label>
            <div class="flex gap-2">
              <input
                id="audiobook-request-author"
                v-model="author"
                type="text"
                placeholder="Author"
                class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                type="button"
                :disabled="!trimmedTitle || saving"
                class="h-9 shrink-0 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                @click="submitManualRequest"
              >
                Submit request
              </button>
            </div>
          </form>

          <form class="flex flex-col gap-3" @submit.prevent="runSearch('discover')">
            <label class="text-sm font-medium text-foreground" for="audiobook-request-search">Search</label>
            <input
              id="audiobook-request-search"
              v-model="searchQuery"
              type="text"
              placeholder="Title or author"
              class="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div class="inline-flex w-fit rounded-md border border-input bg-background p-1">
              <button
                type="button"
                :disabled="!trimmedSearchQuery || searching"
                class="h-8 rounded px-3 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                @click="runSearch('discover')"
              >
                Discover
              </button>
              <button
                type="button"
                :disabled="!trimmedSearchQuery || searching"
                class="h-8 rounded px-3 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                @click="runSearch('candidates')"
              >
                Candidates
              </button>
            </div>
          </form>

          <p v-if="searching" class="text-sm text-muted-foreground">Searching...</p>
          <p v-else-if="searchError" class="text-sm text-destructive">{{ searchError }}</p>
          <p v-else-if="searchResults?.length === 0" class="text-sm text-muted-foreground">No matches found</p>

          <div v-else-if="searchResults?.length" class="flex flex-col gap-2">
            <div
              v-for="(result, index) in searchResults"
              :key="`${result.title}-${result.asin ?? index}`"
              class="flex items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-foreground">{{ result.title }}</p>
                <p v-if="resultAuthor(result)" class="truncate text-xs text-muted-foreground">{{ resultAuthor(result) }}</p>
              </div>
              <div class="flex shrink-0 gap-2">
                <button
                  type="button"
                  class="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground transition-colors hover:bg-muted"
                  @click="useSearchResult(result)"
                >
                  Use
                </button>
                <button
                  type="button"
                  :disabled="saving"
                  class="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  @click="submitSearchResult(result)"
                >
                  Request
                </button>
              </div>
            </div>
          </div>

          <p v-if="submitError" class="text-sm text-destructive">{{ submitError }}</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>
