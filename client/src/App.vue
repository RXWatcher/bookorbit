<script setup lang="ts">
import { computed, provide } from 'vue'
import { INIT_OPTIONS_KEY, THEME_KEY } from 'vue-echarts'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import { useThemeStore } from '@/stores/theme'
import { getBookorbitThemeName, initChartThemes } from '@/lib/echarts'
import ChangePasswordDialog from '@/features/auth/ChangePasswordDialog.vue'
import TtsMiniPlayer from '@/features/tts/components/TtsMiniPlayer.vue'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

const { isOpen } = useChangePasswordDialog()
const themeStore = useThemeStore()
const toasterBottomOffset = 'max(16px, var(--tts-mini-player-clearance, 0px))'
const toasterOffset = { right: '16px', bottom: toasterBottomOffset }
const toasterMobileOffset = { left: '16px', right: '16px', bottom: toasterBottomOffset }

initChartThemes()

provide(INIT_OPTIONS_KEY, { renderer: 'svg' })
provide(
  THEME_KEY,
  computed(() => getBookorbitThemeName(themeStore.theme, themeStore.accent)),
)
</script>

<template>
  <TooltipProvider :delay-duration="0">
    <router-view v-slot="{ Component, route }">
      <Transition name="page" mode="out-in">
        <component :is="Component" :key="route.matched[0]?.path ?? route.path" />
      </Transition>
    </router-view>
    <ChangePasswordDialog v-if="isOpen" />
    <TtsMiniPlayer />
    <Toaster rich-colors position="bottom-right" :visible-toasts="5" :gap="8" :offset="toasterOffset" :mobile-offset="toasterMobileOffset" />
  </TooltipProvider>
</template>
