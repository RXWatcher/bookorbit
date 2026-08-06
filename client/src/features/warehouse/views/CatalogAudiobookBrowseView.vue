<script setup lang="ts">
import { CLOUD_AUDIO_LIBRARY_ID } from '@bookorbit/types'
import CatalogBrowseView from './CatalogBrowseView.vue'
</script>

<template>
  <CatalogBrowseView
    :library-id="CLOUD_AUDIO_LIBRARY_ID"
    media-type="audiobook"
    title="Audiobooks"
    subtitle="Browse audiobooks ready to add to your library."
    search-label="Search audio library"
    empty-title="No audiobooks are available yet."
    empty-detail="New audiobooks will appear here when they are ready."
  />
</template>
