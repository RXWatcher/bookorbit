import { ref, toValue, type MaybeRefOrGetter } from 'vue'
import { fetchCatalogSourceUserState, patchCatalogSourceUserState } from '../api/catalog-source.api'
import type { WarehouseMediaType, WarehouseUserCatalogState, WarehouseUserCatalogStatePatch } from '@bookorbit/types'

type UseCatalogSourceUserStateOptions = {
  autoLoad?: boolean
}

type PendingSave = {
  version: number
  patch: WarehouseUserCatalogStatePatch
}

const LOAD_ERROR = 'Failed to load library item state'
const SAVE_ERROR = 'Failed to save library item state'
const USER_STATE_PATCH_FIELDS = ['inLibrary', 'favorite', 'rating', 'readStatus', 'progressPercent', 'positionSeconds'] as const

function toCatalogUserStatePatch(patch: WarehouseUserCatalogStatePatch): WarehouseUserCatalogStatePatch {
  return Object.fromEntries(
    USER_STATE_PATCH_FIELDS.filter((field) => patch[field] !== undefined).map((field) => [field, patch[field]]),
  ) as WarehouseUserCatalogStatePatch
}

export function useCatalogSourceUserState(
  mediaType: MaybeRefOrGetter<WarehouseMediaType>,
  remoteId: MaybeRefOrGetter<string>,
  options: UseCatalogSourceUserStateOptions = {},
) {
  const state = ref<WarehouseUserCatalogState | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  let confirmedState: WarehouseUserCatalogState | null = null
  let requestId = 0
  let mutationVersion = 0
  let latestSaveVersion = 0
  let pendingSaveCount = 0
  let pendingSaves: PendingSave[] = []
  let saveQueue: Promise<unknown> = Promise.resolve()
  let activeTargetKey: string | null = null

  function targetKey(nextMediaType: WarehouseMediaType, nextRemoteId: string): string {
    return `${nextMediaType}:${nextRemoteId}`
  }

  function recomputeOptimisticState(): void {
    state.value = pendingSaves.reduce<WarehouseUserCatalogState | null>(
      (nextState, pendingSave) => (nextState ? { ...nextState, ...pendingSave.patch } : null),
      confirmedState,
    )
  }

  function resetStateForTarget(nextMediaType: WarehouseMediaType, nextRemoteId: string): void {
    const nextTargetKey = targetKey(nextMediaType, nextRemoteId)
    if (nextTargetKey === activeTargetKey) return

    activeTargetKey = nextTargetKey
    confirmedState = null
    pendingSaves = []
    recomputeOptimisticState()
  }

  async function load(): Promise<void> {
    const currentMediaType = toValue(mediaType)
    const currentRemoteId = toValue(remoteId)
    resetStateForTarget(currentMediaType, currentRemoteId)

    const currentRequestId = ++requestId
    const mutationVersionAtStart = mutationVersion
    loading.value = true
    error.value = null

    try {
      const nextState = await fetchCatalogSourceUserState(currentMediaType, currentRemoteId)
      if (currentRequestId !== requestId || mutationVersionAtStart !== mutationVersion) return

      confirmedState = nextState
      recomputeOptimisticState()
    } catch {
      if (currentRequestId === requestId && mutationVersionAtStart === mutationVersion) {
        error.value = LOAD_ERROR
      }
    } finally {
      if (currentRequestId === requestId) {
        loading.value = false
      }
    }
  }

  async function save(patch: WarehouseUserCatalogStatePatch): Promise<WarehouseUserCatalogState> {
    const sanitizedPatch = toCatalogUserStatePatch(patch)
    const currentMediaType = toValue(mediaType)
    const currentRemoteId = toValue(remoteId)
    resetStateForTarget(currentMediaType, currentRemoteId)
    const saveVersion = ++mutationVersion
    latestSaveVersion = saveVersion
    pendingSaveCount += 1
    pendingSaves = [...pendingSaves, { version: saveVersion, patch: sanitizedPatch }]
    error.value = null
    saving.value = true

    recomputeOptimisticState()

    const saveRequest = saveQueue.then(() => patchCatalogSourceUserState(currentMediaType, currentRemoteId, sanitizedPatch))
    saveQueue = saveRequest.catch(() => undefined)

    try {
      const nextState = await saveRequest
      if (pendingSaves.some((pendingSave) => pendingSave.version === saveVersion)) {
        confirmedState = nextState
        pendingSaves = pendingSaves.filter((pendingSave) => pendingSave.version > saveVersion)
        recomputeOptimisticState()
      }
      return nextState
    } catch {
      if (pendingSaves.some((pendingSave) => pendingSave.version === saveVersion)) {
        pendingSaves = pendingSaves.filter((pendingSave) => pendingSave.version !== saveVersion)
        recomputeOptimisticState()
      }

      if (saveVersion === latestSaveVersion) {
        error.value = SAVE_ERROR
      }
      throw new Error(SAVE_ERROR)
    } finally {
      pendingSaveCount -= 1
      saving.value = pendingSaveCount > 0
    }
  }

  if (options.autoLoad !== false) {
    void load()
  }

  return {
    state,
    loading,
    saving,
    error,
    load,
    save,
  }
}
