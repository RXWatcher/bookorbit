<script setup lang="ts">
import { CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types'
import CatalogBrowseView from './CatalogBrowseView.vue'
</script>

<template>
  <CatalogBrowseView
    :library-id="CLOUD_EBOOK_LIBRARY_ID"
    media-type="ebook"
    title="Books"
    subtitle="Browse ebooks ready to add to your library."
    search-label="Search ebook library"
    empty-title="No ebooks are available yet."
    empty-detail="New ebooks will appear here when they are ready."
  />
</template>
