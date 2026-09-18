<script setup>
import { onBeforeUnmount, ref, useId, watch } from 'vue'
import { getContractSummary } from '../services/contractSummaryApi.js'

const props = defineProps({ documentId: { type: String, required: true } })
const content = ref(null)
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
let requestController
async function load() {
  if (loading.value) return
  const controller = new AbortController()
  requestController = controller
  loading.value = true
  error.value = ''
  try {
    const summary = await getContractSummary(props.documentId, { signal: controller.signal })
    if (requestController !== controller) return
    content.value = summary
    loaded.value = true
  } catch (cause) {
    if (requestController === controller && cause.name !== 'AbortError') error.value = cause.message || '摘要加载失败，请重试'
  } finally {
    if (requestController === controller) loading.value = false
  }
}
const expanded = ref(false)
const tooltipId = useId()
let closeTimer
function show() {
  window.clearTimeout(closeTimer)
  expanded.value = true
  if (!loaded.value && !loading.value && !error.value) void load()
}
function hide() {
  window.clearTimeout(closeTimer)
  expanded.value = false
}
function handleFocusOut(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) scheduleHide()
}
function scheduleHide() {
  window.clearTimeout(closeTimer)
  closeTimer = window.setTimeout(hide, 140)
}
function handleEscape(event) {
  if (!expanded.value) return
  event.preventDefault()
  event.stopPropagation()
  hide()
}
watch(() => props.documentId, () => {
  hide()
  requestController?.abort()
  requestController = null
  content.value = null
  loading.value = false
  loaded.value = false
  error.value = ''
})
onBeforeUnmount(() => {
  window.clearTimeout(closeTimer)
  requestController?.abort()
  requestController = null
})
</script>

<template>
  <div class="contract-summary" @mouseenter="show" @mouseleave="scheduleHide" @keydown.esc="handleEscape" @focusin="show" @focusout="handleFocusOut">
    <button
      class="contract-summary__trigger"
      type="button"
      aria-label="查看合同摘要"
      :aria-expanded="expanded"
      :aria-describedby="expanded ? tooltipId : undefined"
      @focus="show"
      @click="show"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.7 8a3.3 3.3 0 0 1 6.6 0c0 2.2-3.3 2.3-3.3 4.6" /><circle cx="12" cy="17" r=".9" /></svg>
    </button>
    <Transition name="summary-bubble">
      <div v-if="expanded" :id="tooltipId" class="contract-summary__bubble" role="region" aria-label="合同摘要" @mouseenter="show" :aria-busy="loading">
        <h3>合同摘要</h3>
        <Transition name="summary-content" mode="out-in" appear>
          <div v-if="loading" key="loading" class="contract-summary__loading" role="status" aria-label="正在加载摘要">
            <span class="contract-summary__spinner" aria-hidden="true"></span>
          </div>
          <div v-else-if="error" key="error">
            <p role="alert">{{ error }}</p>
            <button class="contract-summary__retry" type="button" @click="load">重新加载</button>
          </div>
          <p v-else-if="loaded && content === null" key="empty" role="status">暂无摘要</p>
          <p v-else key="content">{{ content }}</p>
        </Transition>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.contract-summary { position: absolute; z-index: 4; top: 76px; left: 20px; }
.contract-summary__trigger { display: grid; place-items: center; width: 38px; height: 38px; padding: 8px; border: 1px solid #ffffffb3; border-radius: 50%; background: linear-gradient(145deg, #f0f5fb, #d5e1ef); color: #466483; box-shadow: 0 4px 14px #243c5926, inset 0 1px #fff; cursor: pointer; transition: background .18s, transform .18s; }
.contract-summary__trigger:hover, .contract-summary__trigger[aria-expanded="true"] { background: #e8f0fa; transform: translateY(-1px); }
.contract-summary__trigger:focus-visible { outline: 2px solid #829fbe; outline-offset: 3px; }
.contract-summary__trigger svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; }
.contract-summary__trigger circle { fill: currentColor; stroke: none; }
.contract-summary__bubble { position: absolute; top: calc(100% + 12px); left: 0; box-sizing: border-box; width: min(380px, calc(100vw - 100px)); padding: 20px; border: 1px solid #ffffffc4; border-radius: 14px; background: #f1f5faf7; color: #354960; box-shadow: 0 16px 44px #152a4433, 0 3px 8px #152a4414; backdrop-filter: blur(18px); }
.contract-summary__bubble::before { content: ''; position: absolute; top: -12px; left: 0; width: 100%; height: 12px; }
.contract-summary__bubble::after { content: ''; position: absolute; top: -5px; left: 14px; width: 9px; height: 9px; transform: rotate(45deg); background: #f1f5fa; border-top: 1px solid #ffffffc4; border-left: 1px solid #ffffffc4; }
.contract-summary__bubble h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
.contract-summary__bubble p { margin: 0; max-height: min(300px, calc(100dvh - 276px)); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.9; }
.contract-summary__loading { display: grid; place-items: center; min-height: 72px; }
.contract-summary__spinner { width: 25px; height: 25px; box-sizing: border-box; border: 2px solid #7f9cbf30; border-top-color: #6687ae; border-right-color: #6687ae; border-radius: 50%; animation: summary-loading-spin .85s linear infinite; }
@keyframes summary-loading-spin { to { transform: rotate(360deg); } }
.summary-content-enter-active { transition: opacity .55s ease, transform .55s cubic-bezier(.22, 1, .36, 1); }
.summary-content-leave-active { transition: opacity .16s ease; }
.summary-content-enter-from { opacity: 0; transform: translateY(7px); }
.summary-content-leave-to { opacity: 0; }
.contract-summary__retry { margin-top: 12px; padding: 6px 12px; border: 1px solid #b7c8dc; border-radius: 7px; background: #e3ecf7; color: #466483; cursor: pointer; }
.contract-summary__retry:focus-visible { outline: 2px solid #829fbe; outline-offset: 2px; }
.summary-bubble-enter-active, .summary-bubble-leave-active { transition: opacity .18s ease, transform .2s ease; }
.summary-bubble-enter-from, .summary-bubble-leave-to { opacity: 0; transform: translateY(5px); }
@media (prefers-reduced-motion: reduce) { .contract-summary__trigger, .summary-bubble-enter-active, .summary-bubble-leave-active, .summary-content-enter-active, .summary-content-leave-active { transition: none; } .contract-summary__spinner { animation: none; } }
</style>
