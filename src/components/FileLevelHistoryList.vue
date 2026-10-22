<script setup>
import { fileLevelHistoryLabels } from '../models/fileLevelHistory.js'
import { formatReviewTime } from '../models/pendingReviews.js'
import CenteredLoading from './CenteredLoading.vue'
import EmptyState from './EmptyState.vue'

defineProps({
  records: { type: Array, required: true },
  enterDelays: { type: Map, default: () => new Map() },
  loading: Boolean,
  failed: Boolean,
})
</script>

<template>
  <section class="level-history" :class="{ 'is-empty': !records.length }" aria-label="文件权限变更记录" :aria-busy="loading">
    <TransitionGroup name="level-history-row" tag="ol" class="level-history__list" appear>
      <li v-for="(record, index) in records" :key="record.id" class="level-history__item" :style="{ '--row-delay': `${Math.min(enterDelays.get(record.id) ?? index * 65, 390)}ms` }">
        <header class="level-history__header">
          <span class="level-history__document" :title="record.documentId"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6M8 13h8M8 17h5" /></svg><span>合同</span><strong>{{ record.documentId.slice(0, 12) }}…{{ record.documentId.slice(-8) }}</strong></span>
          <time :datetime="record.createdAt">{{ formatReviewTime(record.createdAt) }}</time>
        </header>
        <div class="level-history__change">
          <div class="level-history__level"><span>原等级</span><strong>{{ record.previousLevel ?? '未知' }}</strong></div>
          <svg class="level-history__arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6" /></svg>
          <div class="level-history__level level-history__level--new"><span>{{ record.status === 'applied' ? '新等级' : '申请等级' }}</span><strong>{{ record.newLevel }}</strong></div>
          <span class="level-history__status" :class="`is-${record.status}`">{{ fileLevelHistoryLabels[record.status] }}</span>
        </div>
        <p class="level-history__note">{{ record.note || '未填写变更备注' }}</p>
        <footer class="level-history__meta"><span>操作人：{{ record.reviewer || '未记录' }}</span><span>处理时间：<time :datetime="record.processedAt">{{ formatReviewTime(record.processedAt) }}</time></span></footer>
      </li>
    </TransitionGroup>
    <Transition name="content-state" mode="out-in" appear>
      <CenteredLoading v-if="!records.length && loading" key="loading" label="正在读取变更记录" />
      <p v-else-if="!records.length && failed" key="error" class="level-history__empty" role="status">变更记录暂时不可用</p>
      <EmptyState v-else-if="!records.length" key="empty" />
    </Transition>
  </section>
</template>

<style scoped>
.level-history { min-width: 0; }
.level-history.is-empty { display: flex; flex-direction: column; min-height: 100%; }
.level-history__list { margin: 0; padding: 0; list-style: none; }
.level-history__item { margin-bottom: 14px; padding: 20px 22px; border: 1px solid #668b7024; border-radius: 16px; color: #344e40; background: #ffffffc4; box-shadow: 0 4px 16px #314d3b06; }
.level-history__header, .level-history__document, .level-history__change, .level-history__meta { display: flex; align-items: center; }
.level-history__header { justify-content: space-between; flex-wrap: wrap; gap: 10px 20px; }
.level-history__document { min-width: 0; gap: 9px; color: #6e8578; font-size: 11px; }
.level-history__document svg { width: 18px; height: 18px; flex: none; fill: none; stroke: #708e7b; stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
.level-history__document strong { min-width: 0; color: #4d6858; font-size: 12px; font-weight: 500; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
.level-history__header time { color: #819286; font-size: 11px; font-variant-numeric: tabular-nums; }
.level-history__change { gap: 20px; margin: 20px 0 16px; }
.level-history__level { display: grid; gap: 6px; min-width: 0; flex: 1; }
.level-history__level > span { color: #819286; font-size: 10px; }
.level-history__level strong { color: #71867a; font-size: 23px; font-weight: 500; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.level-history__level--new strong { color: #3d6b50; }
.level-history__arrow { width: 22px; height: 22px; flex: none; fill: none; stroke: #9bb1a2; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.level-history__status { margin-left: auto; padding: 6px 10px; border-radius: 8px; background: #e9f3ed; color: #4d7a5e; font-size: 11px; flex: none; }
.level-history__status.is-skipped_missing { background: #fbf0de; color: #a37a3e; }
.level-history__note { max-height: 12em; margin: 0; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.85; color: #566d5f; scrollbar-width: thin; }
.level-history__meta { justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; margin-top: 16px; padding-top: 13px; border-top: 1px solid #668b7017; color: #819286; font-size: 10px; line-height: 1.6; overflow-wrap: anywhere; }
.level-history__empty { padding: 50px 12px; color: #8b9b90; text-align: center; font-size: 12px; }
.level-history-row-enter-active { transition: opacity .28s ease var(--row-delay), transform .34s cubic-bezier(.22, 1, .36, 1) var(--row-delay); }
.level-history-row-leave-active { transition: opacity .16s ease; }
.level-history-row-enter-from { opacity: 0; transform: translateX(-22px); }
.level-history-row-leave-to { opacity: 0; }
.level-history-row-move { transition: transform .3s ease; }
@media (max-width: 600px) { .level-history__item { padding: 16px; } .level-history__change { display: grid; grid-template-columns: minmax(0, 1fr) 22px minmax(0, 1fr); gap: 14px; } .level-history__status { grid-column: 1 / -1; justify-self: start; margin-left: 0; } }
@media (prefers-reduced-motion: reduce) { .level-history-row-enter-active, .level-history-row-leave-active, .level-history-row-move { transition: none; } }
</style>
