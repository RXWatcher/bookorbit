import { onUnmounted, ref } from 'vue'

export function useVisibility() {
  const headerVisible = ref(false)
  const footerVisible = ref(false)
  const isPinned = ref(false)

  let isVisibilityLocked = false
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (!isPinned.value && !isVisibilityLocked) {
        headerVisible.value = false
        footerVisible.value = false
      }
    }, 3000)
  }

  function handleMiddleTap() {
    if (isVisibilityLocked) return

    isPinned.value = !isPinned.value
    headerVisible.value = isPinned.value
    footerVisible.value = isPinned.value
    if (!isPinned.value) {
      if (hideTimer) clearTimeout(hideTimer)
    }
  }

  function showHeader() {
    if (isVisibilityLocked) {
      headerVisible.value = true
      return
    }

    if (!isPinned.value) {
      headerVisible.value = true
      scheduleHide()
    }
  }

  function showFooter() {
    if (isVisibilityLocked) {
      footerVisible.value = true
      return
    }

    if (!isPinned.value) {
      footerVisible.value = true
      scheduleHide()
    }
  }

  function hideOverlays(force = false) {
    if (isVisibilityLocked && !force) return

    if (hideTimer) clearTimeout(hideTimer)
    isPinned.value = false
    headerVisible.value = false
    footerVisible.value = false
  }

  function setVisibilityLock(locked: boolean) {
    isVisibilityLocked = locked

    if (hideTimer) clearTimeout(hideTimer)

    if (locked) {
      headerVisible.value = true
      return
    }

    if (isPinned.value) {
      headerVisible.value = true
      footerVisible.value = true
      return
    }

    headerVisible.value = false
    footerVisible.value = false
  }

  onUnmounted(() => {
    if (hideTimer) clearTimeout(hideTimer)
  })

  return { headerVisible, footerVisible, isPinned, handleMiddleTap, showHeader, showFooter, hideOverlays, setVisibilityLock }
}
