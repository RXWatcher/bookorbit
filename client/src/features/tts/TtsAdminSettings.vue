<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { CheckCircle2, Loader2, Plus, TestTube, Trash2, WifiOff } from 'lucide-vue-next'
import * as ttsApi from './api/tts.api'
import TtsEdgeVoiceCuration from './TtsEdgeVoiceCuration.vue'
import type { TtsDbProvider, TtsEdgeConfig } from './api/tts.api'

const loading = ref(true)
const providers = ref<TtsDbProvider[]>([])
const edgeConfig = ref<TtsEdgeConfig>({ enabled: true, enabledVoices: [] })
const showEdgeCuration = ref(false)
const testingId = ref<number | null>(null)
const testResults = ref<Record<number, { ok: boolean; msg: string }>>({})
const deletingId = ref<number | null>(null)

const showAddForm = ref(false)
const addForm = ref({ name: '', baseUrl: '', apiKey: '', defaultModel: '' })
const addingProvider = ref(false)

const editingId = ref<number | null>(null)
const editForm = ref({ name: '', baseUrl: '', apiKey: '', defaultModel: '', enabled: true })

onMounted(async () => {
  await load()
})

async function load() {
  loading.value = true
  try {
    const [pList, eCfg] = await Promise.all([ttsApi.getAdminProviders(), ttsApi.getEdgeConfig()])
    providers.value = pList
    edgeConfig.value = eCfg
  } catch {
    toast.error('Failed to load TTS configuration')
  } finally {
    loading.value = false
  }
}

async function toggleEdge() {
  const updated = { ...edgeConfig.value, enabled: !edgeConfig.value.enabled }
  try {
    edgeConfig.value = await ttsApi.updateEdgeConfig(updated)
    toast.success(`Edge TTS ${edgeConfig.value.enabled ? 'enabled' : 'disabled'}`)
  } catch {
    toast.error('Failed to update Edge TTS config')
  }
}

function handleOpenEdgeCuration() {
  showEdgeCuration.value = true
}

function handleCloseEdgeCuration() {
  showEdgeCuration.value = false
}

async function handleEdgeConfigSaved(config: TtsEdgeConfig) {
  edgeConfig.value = config
  showEdgeCuration.value = false
  toast.success('Edge TTS voice list updated')
}

async function handleTestProvider(id: number) {
  testingId.value = id
  try {
    const result = await ttsApi.testProvider(id)
    testResults.value[id] = { ok: result.connected, msg: result.connected ? `${result.voiceCount} voices` : (result.error ?? 'Connection failed') }
  } catch (e: unknown) {
    testResults.value[id] = { ok: false, msg: e instanceof Error ? e.message : 'Unknown error' }
  } finally {
    testingId.value = null
  }
}

async function handleDeleteProvider(id: number) {
  if (!confirm('Delete this TTS provider?')) return
  deletingId.value = id
  try {
    await ttsApi.deleteProvider(id)
    providers.value = providers.value.filter((p) => p.id !== id)
    toast.success('Provider deleted')
  } catch {
    toast.error('Failed to delete provider')
  } finally {
    deletingId.value = null
  }
}

function handleStartEdit(provider: TtsDbProvider) {
  editingId.value = provider.id
  editForm.value = {
    name: provider.name,
    baseUrl: provider.baseUrl ?? '',
    apiKey: provider.apiKey ?? '',
    defaultModel: provider.defaultModel ?? '',
    enabled: provider.enabled,
  }
}

function handleCancelEdit() {
  editingId.value = null
}

async function handleSaveEdit(id: number) {
  try {
    const updated = await ttsApi.updateProvider(id, editForm.value)
    const idx = providers.value.findIndex((p) => p.id === id)
    if (idx !== -1) providers.value[idx] = updated
    editingId.value = null
    toast.success('Provider updated')
  } catch {
    toast.error('Failed to update provider')
  }
}

function handleShowAddForm() {
  showAddForm.value = true
  addForm.value = { name: '', baseUrl: '', apiKey: '', defaultModel: '' }
}

function handleHideAddForm() {
  showAddForm.value = false
}

async function handleAddProvider() {
  if (!addForm.value.name.trim() || !addForm.value.baseUrl.trim()) {
    toast.error('Name and base URL are required')
    return
  }
  addingProvider.value = true
  try {
    const created = await ttsApi.addProvider(addForm.value)
    providers.value.push(created)
    showAddForm.value = false
    toast.success('Provider added')
  } catch {
    toast.error('Failed to add provider')
  } finally {
    addingProvider.value = false
  }
}

async function toggleProviderEnabled(provider: TtsDbProvider) {
  try {
    const updated = await ttsApi.updateProvider(provider.id, { enabled: !provider.enabled })
    const idx = providers.value.findIndex((p) => p.id === provider.id)
    if (idx !== -1) providers.value[idx] = updated
  } catch {
    toast.error('Failed to update provider')
  }
}
</script>

<template>
  <div class="space-y-6">
    <div v-if="loading" class="flex items-center justify-center py-12">
      <Loader2 class="w-6 h-6 animate-spin text-muted-foreground" />
    </div>

    <template v-else>
      <!-- Edge TTS card -->
      <div class="bg-card border border-border rounded-xl p-5 space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-semibold text-foreground">Microsoft Edge TTS</h3>
            <p class="text-sm text-muted-foreground">Built-in neural TTS using Microsoft Edge. No API key required.</p>
          </div>
          <button
            :class="['relative inline-flex h-6 w-11 items-center rounded-full transition-colors', edgeConfig.enabled ? 'bg-primary' : 'bg-border']"
            @click="toggleEdge"
          >
            <span
              :class="[
                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                edgeConfig.enabled ? 'translate-x-6' : 'translate-x-1',
              ]"
            />
          </button>
        </div>
        <div v-if="edgeConfig.enabled" class="border-t border-border pt-3 flex items-center justify-between">
          <div class="text-sm text-muted-foreground">
            {{ edgeConfig.enabledVoices.length === 0 ? 'All voices available' : `${edgeConfig.enabledVoices.length} voices curated` }}
          </div>
          <button class="text-sm font-medium text-primary hover:text-primary/80 underline" @click="handleOpenEdgeCuration">Curate voices</button>
        </div>
      </div>

      <!-- OpenAI-compatible providers -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold text-foreground">OpenAI-Compatible Providers</h3>
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
            @click="handleShowAddForm"
          >
            <Plus class="w-3.5 h-3.5" />
            Add provider
          </button>
        </div>

        <div v-if="showAddForm" class="bg-card border border-border rounded-xl p-4 space-y-3">
          <h4 class="text-sm font-medium text-foreground">New provider</h4>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs text-muted-foreground mb-1">Name</label>
              <input
                v-model="addForm.name"
                placeholder="Kokoro TTS"
                class="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label class="block text-xs text-muted-foreground mb-1">Base URL</label>
              <input
                v-model="addForm.baseUrl"
                placeholder="http://localhost:8880/v1"
                class="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label class="block text-xs text-muted-foreground mb-1">API Key (optional)</label>
              <input
                v-model="addForm.apiKey"
                type="password"
                placeholder="sk-..."
                class="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label class="block text-xs text-muted-foreground mb-1">Default model (optional)</label>
              <input
                v-model="addForm.defaultModel"
                placeholder="tts-1"
                class="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          <div class="flex items-center gap-2 pt-1">
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
              :disabled="addingProvider"
              @click="handleAddProvider"
            >
              <Loader2 v-if="addingProvider" class="w-3.5 h-3.5 animate-spin" />
              <Plus v-else class="w-3.5 h-3.5" />
              Add
            </button>
            <button
              class="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-accent"
              @click="handleHideAddForm"
            >
              Cancel
            </button>
          </div>
        </div>

        <div
          v-if="providers.length === 0 && !showAddForm"
          class="text-sm text-muted-foreground py-3 text-center border border-dashed border-border rounded-xl"
        >
          No custom providers configured.
        </div>

        <div v-for="provider in providers" :key="provider.id" class="bg-card border border-border rounded-xl p-4 space-y-3">
          <template v-if="editingId === provider.id">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs text-muted-foreground mb-1">Name</label>
                <input
                  v-model="editForm.name"
                  class="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label class="block text-xs text-muted-foreground mb-1">Base URL</label>
                <input
                  v-model="editForm.baseUrl"
                  class="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label class="block text-xs text-muted-foreground mb-1">API Key</label>
                <input
                  v-model="editForm.apiKey"
                  type="password"
                  class="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label class="block text-xs text-muted-foreground mb-1">Default model</label>
                <input
                  v-model="editForm.defaultModel"
                  class="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <div class="flex items-center gap-2 pt-1">
              <button
                class="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
                @click="handleSaveEdit(provider.id)"
              >
                Save
              </button>
              <button
                class="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-accent"
                @click="handleCancelEdit"
              >
                Cancel
              </button>
            </div>
          </template>
          <template v-else>
            <div class="flex items-start justify-between gap-3">
              <div class="space-y-0.5 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-sm text-foreground">{{ provider.name }}</span>
                  <span
                    :class="[
                      'text-xs px-1.5 py-0.5 rounded font-medium',
                      provider.enabled ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground',
                    ]"
                    >{{ provider.enabled ? 'Enabled' : 'Disabled' }}</span
                  >
                </div>
                <p class="text-xs text-muted-foreground truncate">{{ provider.baseUrl }}</p>
                <div v-if="testResults[provider.id]" class="flex items-center gap-1 mt-1">
                  <CheckCircle2 v-if="testResults[provider.id]?.ok" class="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                  <WifiOff v-else class="w-3.5 h-3.5 text-destructive flex-shrink-0" />
                  <span :class="['text-xs', testResults[provider.id]?.ok ? 'text-green-600 dark:text-green-400' : 'text-destructive']">
                    {{ testResults[provider.id]?.msg }}
                  </span>
                </div>
              </div>
              <div class="flex items-center gap-1.5 flex-shrink-0">
                <button
                  class="p-1.5 rounded text-muted-foreground hover:text-primary hover:bg-accent"
                  title="Toggle enabled"
                  @click="toggleProviderEnabled(provider)"
                >
                  <span class="text-xs font-medium">{{ provider.enabled ? 'Disable' : 'Enable' }}</span>
                </button>
                <button
                  class="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
                  title="Test connection"
                  @click="handleTestProvider(provider.id)"
                >
                  <Loader2 v-if="testingId === provider.id" class="w-4 h-4 animate-spin" />
                  <TestTube v-else class="w-4 h-4" />
                </button>
                <button class="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent" @click="handleStartEdit(provider)">
                  <span class="text-xs">Edit</span>
                </button>
                <button
                  class="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  @click="handleDeleteProvider(provider.id)"
                >
                  <Loader2 v-if="deletingId === provider.id" class="w-4 h-4 animate-spin" />
                  <Trash2 v-else class="w-4 h-4" />
                </button>
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>

    <TtsEdgeVoiceCuration v-if="showEdgeCuration" :initial-config="edgeConfig" @save="handleEdgeConfigSaved" @close="handleCloseEdgeCuration" />
  </div>
</template>
