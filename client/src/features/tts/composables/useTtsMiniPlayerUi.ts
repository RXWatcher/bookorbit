import { ref } from 'vue'

const isExpanded = ref(false)

export function useTtsMiniPlayerUi() {
  function setExpanded(expanded: boolean) {
    isExpanded.value = expanded
  }

  function toggleExpanded() {
    isExpanded.value = !isExpanded.value
  }

  return {
    isExpanded,
    setExpanded,
    toggleExpanded,
  }
}
