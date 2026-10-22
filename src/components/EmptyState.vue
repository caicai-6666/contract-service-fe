<script setup>
import emptyImage from '../assets/empty.webp'
import sleepImage from '../assets/sleep.webp'

defineProps({ variant: { type: String, default: 'list', validator: value => ['list', 'detail'].includes(value) } })
</script>

<template>
  <div class="empty-state" :class="{ 'is-detail': variant === 'detail' }" role="status" :aria-label="variant === 'detail' ? '暂无详情' : undefined">
    <img :src="variant === 'detail' ? sleepImage : emptyImage" alt="" aria-hidden="true" draggable="false" />
    <p v-if="variant === 'list'">空空如也</p>
  </div>
</template>

<style scoped>
.empty-state { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 12px; width: 100%; min-height: var(--empty-min-height, 176px); padding: var(--empty-padding, 24px 12px); box-sizing: border-box; }
.empty-state img { display: block; width: var(--empty-image-size, 88px); height: var(--empty-image-size, 88px); object-fit: contain; user-select: none; pointer-events: none; }
.empty-state.is-detail img { width: 80px; height: 80px; opacity: .65; }
.empty-state p { margin: 0; color: #8b9b90; font-size: 11px; line-height: 1.6; letter-spacing: .08em; }
</style>
