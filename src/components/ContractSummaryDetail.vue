<script setup>
import CenteredLoading from './CenteredLoading.vue'
import { onBeforeUnmount, ref, watch } from 'vue'
import { getContractSummary } from '../services/contractSummaryApi.js'

const props = defineProps({
  documentId: { type: String, required: true },
  active: { type: Boolean, default: true },
  source: { type: Function, default: getContractSummary },
  revision: { type: Number, default: 0 },
})
const summary = ref(null)
const loading = ref(false)
const error = ref('')
let controller

async function loadSummary() {
  controller?.abort()
  if (!props.active) { loading.value = false; return }
  const request = new AbortController()
  controller = request
  loading.value = true
  error.value = ''
  summary.value = null
  try {
    const result = await props.source(props.documentId, { signal: request.signal })
    if (!request.signal.aborted && controller === request) summary.value = result
  } catch (reason) {
    if (!request.signal.aborted && controller === request) error.value = reason.message || '摘要加载失败，请重试'
  } finally {
    if (controller === request) loading.value = false
  }
}
watch(() => [props.documentId, props.active, props.revision], loadSummary, { immediate: true })
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <div class="contract-summary-detail" :aria-busy="loading">
    <Transition name="summary-detail" mode="out-in">
      <CenteredLoading v-if="loading" key="loading" class="contract-summary-detail__loading" label="正在加载合同摘要" />
      <div v-else-if="error" key="error" class="contract-summary-detail__error" role="alert">{{ error }}<button type="button" @click="loadSummary">重试</button></div>
      <p v-else key="summary" :class="{ 'contract-summary-detail__empty': summary === null }">{{ summary === null ? '暂无摘要' : summary }}</p>
    </Transition>
  </div>
</template>

<style scoped>
.contract-summary-detail { line-height: 1.9; overflow-wrap: anywhere; }
.contract-summary-detail p { margin: 0; white-space: pre-wrap; }
.contract-summary-detail__empty { color: #85968c; }
.contract-summary-detail__loading { --loading-min-height: 36px; --loading-size: 18px; }
.contract-summary-detail__error { color: #a36353; }
.contract-summary-detail__error button { margin-left: 8px; padding: 0; border: 0; background: transparent; color: #52705e; font: inherit; text-decoration: underline; cursor: pointer; }
.summary-detail-enter-active { transition: opacity .45s ease-out; }
.summary-detail-leave-active { transition: opacity .15s ease-in; }
.summary-detail-enter-from, .summary-detail-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .summary-detail-enter-active, .summary-detail-leave-active { transition: none; } }
</style>
