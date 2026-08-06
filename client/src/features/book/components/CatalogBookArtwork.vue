<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardCatalogItem } from '@bookorbit/types'

import {
  catalogSourceAudiobookCoverUrl,
  catalogSourceComicPageImageUrl,
  catalogSourceEbookCoverUrl,
} from '@/features/warehouse/api/catalog-source.api'
import BookCoverArtwork from './BookCoverArtwork.vue'
import BookCoverSurface from './BookCoverSurface.vue'

const props = withDefaults(
  defineProps<{
    item: DashboardCatalogItem
    interactive?: boolean
    surfaceClass?: string
  }>(),
  {
    interactive: false,
    surfaceClass: '',
  },
)

const coverAspectRatio = computed(() => (props.item.mediaType === 'audiobook' ? '1 / 1' : '2 / 3'))
const creatorsLabel = computed(() => {
  const people = props.item.authors.length > 0 ? props.item.authors : props.item.narrators
  return people.filter(Boolean).join(', ')
})
const coverUrl = computed(() => {
  if (props.item.mediaType === 'comic') return catalogSourceComicPageImageUrl(props.item.remoteId)
  if (!props.item.hasCover) return null
  if (props.item.mediaType === 'audiobook') return catalogSourceAudiobookCoverUrl(props.item.remoteId)
  return catalogSourceEbookCoverUrl(props.item.remoteId, 'medium')
})
const shouldLoadCover = computed(() => props.item.mediaType === 'comic' || props.item.hasCover)
</script>

<template>
  <BookCoverSurface
    size="mini"
    :class="surfaceClass"
    :interactive="interactive"
    :disable-spine="item.mediaType === 'audiobook'"
    :display-mode="item.mediaType === 'audiobook' ? 'fill-crop' : undefined"
    :style="{ aspectRatio: coverAspectRatio }"
  >
    <BookCoverArtwork
      :src="coverUrl"
      :has-cover="shouldLoadCover"
      :title="item.title"
      :author-line="creatorsLabel"
      :is-audio="item.mediaType === 'audiobook'"
      :seed="item.title || item.remoteId"
      :alt="item.title"
      :frame-aspect-ratio="coverAspectRatio"
      :spine="item.mediaType !== 'audiobook'"
      :mode="item.mediaType === 'audiobook' ? 'fill-crop' : undefined"
      loading="lazy"
      decoding="async"
    />
  </BookCoverSurface>
</template>
