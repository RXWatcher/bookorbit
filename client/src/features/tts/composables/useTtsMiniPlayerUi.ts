import { ref } from 'vue'

const isExpanded = ref(false)
const isReaderFooterVisible = ref(false)

export function useTtsMiniPlayerUi() {
  function setExpanded(expanded: boolean) {
    isExpanded.value = expanded
  }

  function toggleExpanded() {
    isExpanded.value = !isExpanded.value
  }

  function setReaderFooterVisible(visible: boolean) {
    isReaderFooterVisible.value = visible
  }

  return {
    isExpanded,
    isReaderFooterVisible,
    setExpanded,
    toggleExpanded,
    setReaderFooterVisible,
  }
}
