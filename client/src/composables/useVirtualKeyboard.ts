import { onMounted, onUnmounted, ref } from 'vue'

/**
 * Tracks the height of the virtual keyboard using the visualViewport API.
 * On iOS/Android, when the on-screen keyboard opens, the visual viewport shrinks.
 * Returns the keyboard height in pixels (0 when hidden).
 */
export function useVirtualKeyboard() {
  const keyboardHeight = ref(0)

  function update() {
    if (!window.visualViewport) return
    const height = Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop)
    keyboardHeight.value = Math.round(height)
  }

  onMounted(() => {
    if (!window.visualViewport) return
    window.visualViewport.addEventListener('resize', update)
    window.visualViewport.addEventListener('scroll', update)
    update()
  })

  onUnmounted(() => {
    if (!window.visualViewport) return
    window.visualViewport.removeEventListener('resize', update)
    window.visualViewport.removeEventListener('scroll', update)
  })

  return { keyboardHeight }
}
