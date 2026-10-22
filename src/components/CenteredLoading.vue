<script setup>
defineProps({ label: { type: String, default: '正在加载' } })
</script>

<template>
  <div class="centered-loading" role="status" :aria-label="label">
    <span class="centered-loading__ring" aria-hidden="true"></span>
  </div>
</template>

<style scoped>
.centered-loading { display: flex; align-items: center; justify-content: center; flex: 1; width: 100%; min-height: var(--loading-min-height, 96px); box-sizing: border-box; }
.centered-loading__ring { display: block; flex: none; width: var(--loading-size, 24px); height: var(--loading-size, 24px); box-sizing: border-box; border: 2px solid var(--loading-track, #6c8d7830); border-top-color: var(--loading-color, #60816c); border-right-color: var(--loading-color, #60816c); border-radius: 50%; animation: centered-loading-spin .85s linear infinite; }
@keyframes centered-loading-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .centered-loading__ring { animation-duration: 1.7s; } }
</style>
