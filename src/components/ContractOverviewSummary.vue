<script setup>
defineProps({ summary: { type: String, default: '' } })
</script>

<template>
  <section class="overview-summary" aria-label="合同摘要">
    <header>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4 4v13H7zM14 3.5v4h4M10 11h5M10 14h5M10 17h3" /></svg>
      <h4>合同摘要</h4>
    </header>
    <p v-if="summary" class="overview-summary__text">{{ summary }}</p>
    <p v-else class="overview-summary__empty">合同概述尚未生成，完成后将在此展示摘要。</p>
  </section>
</template>

<style scoped>
.overview-summary { padding: 20px 22px; border: 1px solid #c7b68e40; border-radius: 14px; background: linear-gradient(135deg, #fffcf4e8, #f1eadbd6); box-shadow: inset 0 1px #fff9, 0 3px 12px #66543108; }
.overview-summary header { display: flex; align-items: center; gap: 9px; margin-bottom: 12px; color: #786442; }
.overview-summary header svg { width: 20px; height: 20px; flex-shrink: 0; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.overview-summary h4 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: .04em; }
.overview-summary__text { max-height: 320px; margin: 0; padding-right: 8px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #b8a987 transparent; color: #514c41; font-size: 14px; line-height: 1.95; white-space: pre-wrap; overflow-wrap: anywhere; }
.overview-summary__empty { margin: 0; color: #887f6e; font-size: 13px; line-height: 1.8; }
@media (max-width: 640px) { .overview-summary { padding: 16px; } }
</style>
