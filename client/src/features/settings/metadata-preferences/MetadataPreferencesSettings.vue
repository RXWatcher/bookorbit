<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import type { ProviderConfigurations } from '@bookorbit/types'
import ProviderConfigPanel from './components/ProviderConfigPanel.vue'
import { useProviderConfig } from './composables/useProviderConfig'
import { useProviderThrottleRuntime } from './composables/useProviderThrottleRuntime'

const { config, statuses, saving, testingByKey, testResultsByKey, passingTestSignatureByKey, fetchConfig, saveConfig, testProvider } =
  useProviderConfig()
const { runtimeByKey, startPolling, stopPolling } = useProviderThrottleRuntime()

onMounted(() => {
  startPolling()
  void fetchConfig().catch(() => undefined)
})

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <ProviderConfigPanel
    :config="config"
    :statuses="statuses"
    :runtime-by-key="runtimeByKey"
    :saving="saving"
    :testing-by-key="testingByKey"
    :test-results-by-key="testResultsByKey"
    :passing-test-signature-by-key="passingTestSignatureByKey"
    @save="saveConfig($event as Partial<ProviderConfigurations>)"
    @test="testProvider"
  />
</template>
