<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { createBatchExtraction, validateBatchFiles } from '../services/batchExtraction.js'
import { convertImageFileToPdf, getSelectedFileKind } from '../services/local-file-pdf.js'
import PdfPreviewOverlay from './PdfPreviewOverlay.vue'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close', 'created', 'tasks'])
const dialog = ref(null), fileInput = ref(null), error = ref(''), running = ref(false)
const contentViewport = ref(null), contentBody = ref(null)
let heightObserver = null, heightAnimation = null
function fitContent(animate = true) {
  if (!dialog.value?.open || !contentViewport.value || !contentBody.value) return
  const viewport = contentViewport.value
  const from = viewport.getBoundingClientRect().height
  const to = Math.min(contentBody.value.getBoundingClientRect().height, window.innerHeight - 50)
  // 从当前动画的可见高度接续，快速增减文件时也不会跳回上一轮起点。
  heightAnimation?.cancel()
  heightAnimation = null
  viewport.style.height = `${to}px`
  if (!animate || Math.abs(from - to) < 1 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  heightAnimation = viewport.animate([{ height: `${from}px` }, { height: `${to}px` }], {
    duration: 360, easing: 'cubic-bezier(0.22, 0.68, 0.3, 1)',
  })
}
function fitViewport() { fitContent(false) }
onMounted(() => {
  heightObserver = new ResizeObserver(() => fitContent())
  if (contentBody.value) heightObserver.observe(contentBody.value)
  window.addEventListener('resize', fitViewport)
})
const items = reactive([])
// 创建成功会释放提交用的文件引用；本批次原文件单独保留，供再次预览。
const previewFiles = new Map(), convertedFiles = new WeakMap()
const previewOpen = ref(false), previewSrc = ref(''), previewLabel = ref('')
const previewLoading = ref(false), previewError = ref('')
let previewSequence = 0, previewItem = null, previewFocus = null
function previewPdf(file) {
  if (getSelectedFileKind(file) === 'pdf') return Promise.resolve(file)
  if (!convertedFiles.has(file)) {
    const conversion = convertImageFileToPdf(file).catch(error => {
      convertedFiles.delete(file)
      throw error
    })
    convertedFiles.set(file, conversion)
  }
  return convertedFiles.get(file)
}
function closePreview(restoreFocus = true) {
  previewSequence++
  previewOpen.value = false
  previewLoading.value = false
  if (previewSrc.value) URL.revokeObjectURL(previewSrc.value)
  previewSrc.value = ''
  if (restoreFocus && previewFocus?.isConnected) previewFocus.focus()
}
async function openPreview(item) {
  const file = previewFiles.get(item.id)
  if (!file) return
  if (!previewOpen.value) previewFocus = document.activeElement
  closePreview(false)
  const sequence = previewSequence
  previewItem = item
  previewLabel.value = item.name
  previewError.value = ''
  previewLoading.value = true
  previewOpen.value = true
  await nextTick()
  if (sequence !== previewSequence) return
  dialog.value?.querySelector('.pdf-preview__close')?.focus()
  try {
    const pdf = await previewPdf(file)
    if (sequence === previewSequence) previewSrc.value = URL.createObjectURL(pdf)
  } catch {
    if (sequence === previewSequence) previewError.value = '无法预览此文件，请检查文件内容或重新选择。'
  } finally {
    if (sequence === previewSequence) previewLoading.value = false
  }
}
function removeItem(index) {
  const [item] = items.splice(index, 1)
  if (previewItem?.id === item.id) {
    closePreview(false)
    previewItem = null
    previewFocus = null
  }
  const file = previewFiles.get(item.id)
  if (file) convertedFiles.delete(file)
  previewFiles.delete(item.id)
}
function clearPreviewFiles() {
  closePreview(false)
  previewItem = null
  previewFocus = null
  previewFiles.forEach(file => convertedFiles.delete(file))
  previewFiles.clear()
}
const batch = createBatchExtraction({
  items,
  convert: previewPdf,
  onCreated: id => emit('created', id),
})
const completed = computed(() => items.filter(item => item.runId).length)
const queued = computed(() => items.some(item => item.status === 'queued'))
const labels = { queued: '等待上传', preparing: '准备 PDF', submitting: '上传并创建任务中', failed: '未创建', uncertain: '待核对' }
function itemStatusLabel(item) {
  return item.waitingLong ? '后台仍未返回，继续等待中' : labels[item.status]
}
let previousFocus = null
watch(() => props.open, async open => {
  await nextTick()
  if (open) {
    previousFocus = document.activeElement
    if (!dialog.value.open) dialog.value.showModal()
    fitContent(false)
  } else if (dialog.value?.open) {
    closePreview(false)
    heightAnimation?.cancel()
    dialog.value.close()
    if (previousFocus?.isConnected) previousFocus.focus()
  }
}, { immediate: true })
function choose(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  if (!files.length || running.value) return
  try {
    validateBatchFiles(files)
    clearPreviewFiles()
    items.splice(0, items.length, ...files.map(file => ({ id: crypto.randomUUID(), file, name: file.name, pdf: null, status: 'queued', runId: '', error: '', attempts: 0 })))
    items.forEach(item => previewFiles.set(item.id, item.file))
    error.value = ''
  } catch (e) { error.value = e.message }
}
async function start() {
  if (running.value || !queued.value) return
  running.value = true
  try { await batch.start() } finally { running.value = false }
}
function retry(item) {
  if (running.value || item.runId) return
  item.status = 'queued'
  item.error = ''
  void start()
}
function tasks() { emit('close'); emit('tasks') }
onBeforeUnmount(() => {
  heightObserver?.disconnect()
  heightAnimation?.cancel()
  window.removeEventListener('resize', fitViewport)
  batch.dispose()
  clearPreviewFiles()
  dialog.value?.close()
})
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="batch-extraction" aria-labelledby="batch-title" @cancel.self.prevent="previewOpen ? closePreview() : emit('close')" @click.self="emit('close')">
      <button type="button" class="batch-close" aria-label="关闭批量提取" @click="emit('close')"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9" /></svg></button>
      <div ref="contentViewport" class="batch-content">
      <div ref="contentBody" class="batch-content-inner">
      <header><div><span>合同处理</span><h2 id="batch-title">批量提取</h2></div></header>
      <p class="batch-description">每批最多 5 份，创建后可在处理任务中查看进度。</p>
      <!-- 文件选择框的 cancel 会冒泡，不能将其当成外层 dialog 的关闭请求。 -->
      <input ref="fileInput" type="file" multiple accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif" hidden @change="choose" @cancel.stop />
      <button v-if="!items.length" type="button" class="batch-picker" @click="fileInput.click()"><span>＋</span><strong>选择合同文件</strong><small>PDF 或图片 · 最多 5 份</small></button>
      <ul v-else class="batch-files" aria-live="polite">
        <li v-for="(item, index) in items" :key="item.id" :class="`is-${item.status}`" @click="openPreview(item)">
          <span class="batch-number">{{ String(index + 1).padStart(2, '0') }}</span>
          <div class="batch-file"><button class="batch-preview-link" type="button" :aria-label="`预览 ${item.name}`" @click.stop="openPreview(item)"><strong :title="item.name">{{ item.name }}</strong></button><small v-if="item.status !== 'created'">{{ itemStatusLabel(item) }}</small><p v-if="item.error">{{ item.error }}</p></div>
          <button v-if="['failed', 'uncertain'].includes(item.status)" type="button" :disabled="running" @click.stop="retry(item)">{{ item.status === 'uncertain' ? '已核对，重试' : '重试' }}</button>
          <div v-else class="batch-file-action">
            <Transition name="batch-action">
              <span v-if="item.status === 'created' && item.runId" key="created" class="batch-action-state batch-success" role="img" aria-label="已进入处理队列">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path pathLength="1" d="m5.5 12 4.2 4.2L18.5 7.5" /></svg>
              </span>
              <span v-else-if="['preparing', 'submitting'].includes(item.status) || (running && item.status === 'queued')" key="loading" class="batch-action-state" role="status" :aria-label="itemStatusLabel(item)">
                <span class="three-body" aria-hidden="true"><span class="three-body__dot"></span><span class="three-body__dot"></span><span class="three-body__dot"></span></span>
              </span>
              <button v-else-if="item.status === 'queued' && !running" key="remove" type="button" class="batch-action-state" :aria-label="`移除 ${item.name}`" @click.stop="removeItem(index)">×</button>
            </Transition>
          </div>
        </li>
      </ul>
      <p v-if="error" class="batch-error" role="alert">{{ error }}</p>
      <p v-if="running" class="batch-note">关闭面板后继续提交；请勿刷新页面或退出登录。</p>
      <footer><span>{{ completed }} / {{ items.length }} 已创建</span><div><button v-if="items.length && !running" type="button" @click="fileInput.click()">重新选择</button><button v-if="completed || items.some(item => item.status === 'uncertain')" type="button" @click="tasks">处理任务</button><button class="batch-submit" type="button" :disabled="running || !queued" @click="start">{{ running ? '正在提交…' : '开始批量提取' }}</button></div></footer>
      </div>
      </div>
      <!-- 原生模态框位于 top layer，预览必须挂在其内部才能覆盖且接收交互。 -->
      <PdfPreviewOverlay v-if="dialog" :teleport-target="dialog" :open="previewOpen" :src="previewSrc" :label="previewLabel" :loading="previewLoading" :error="previewError" @close="closePreview()" @retry="openPreview(previewItem)" />
    </dialog>
  </Teleport>
</template>

<style scoped>
.batch-extraction { width: min(560px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); box-sizing: border-box; padding: 0; overflow: visible; border: 1px solid #ffffffd9; border-radius: 26px; background: linear-gradient(145deg,#fff,#f4f7f3); color: #34483b; box-shadow: 0 24px 80px #1c352c30; }
.batch-content { box-sizing: border-box; max-height: calc(100dvh - 50px); overflow: auto; border-radius: inherit; scrollbar-width: none; }
.batch-content::-webkit-scrollbar { display: none; }
.batch-content-inner { display: flow-root; box-sizing: border-box; padding: 28px; }
.batch-extraction::backdrop { background: #1c31284d; backdrop-filter: blur(5px); }
header, footer, footer>div { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
header span { font-size: 11px; color: #94a096; } h2 { margin: 5px 0 0; font-size: 22px; font-weight: 600; }
button { font: inherit; font-size: 12px; cursor: pointer; border: 1px solid #dce6dd; border-radius: 10px; padding: 9px 12px; background: #fff9; color: #4d6756; } button:disabled { opacity: .45; cursor: default; } button:focus-visible { outline: 2px solid #86a792; outline-offset: 3px; }
.batch-close { position: absolute; z-index: 2; top: -16px; right: -16px; display: grid; place-items: center; width: 38px; height: 38px; padding: 0; color: #edf4f0; background: rgb(18 30 25 / 88%); border: 1px solid #ffffff36; border-radius: 50%; box-shadow: 0 10px 28px #01030275, inset 0 1px #ffffff1f; backdrop-filter: blur(14px) saturate(.82); transition: color .2s, background .2s, border-color .2s, transform .2s; }
.batch-close:hover { color: #fff; background: rgb(43 59 52 / 94%); border-color: #ffffff5c; transform: scale(1.06); }
.batch-close:active { transform: scale(.96); }
.batch-close:focus-visible { outline: 2px solid #aaa0ed; outline-offset: 3px; }
.batch-close svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-width: 1.7px; }
@media(prefers-reduced-motion: reduce) { .batch-close { transition: none; } }
.batch-description,.batch-note { font-size: 12px; color: #87938a; line-height: 1.7; }.batch-note { margin-bottom: 0; }
.batch-picker { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; width: 100%; min-height: 172px; margin: 20px 0; border: 1px dashed #bccfbe; border-radius: 17px; background: #edf4ed66; }.batch-picker>span { font-size: 30px; }.batch-picker small { color: #92a093; }
.batch-files { list-style: none; padding: 0; margin: 20px 0; display: grid; gap: 9px; }.batch-files li { display: flex; align-items: center; gap: 12px; padding: 13px; border: 1px solid #e4ebe4; border-radius: 14px; background: #ffffffa8; }.batch-number { font-size: 12px; color: #8b9a8e; }.is-created .batch-number { color: #4f9064; }.batch-file { flex: 1; min-width: 0; }.batch-file strong { display: block; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; }.batch-file small { display: block; margin-top: 5px; font-size: 11px; color: #8b988e; }.batch-file p,.batch-error { font-size: 11px; color: #ae6d59; line-height: 1.6; }
.batch-files { grid-template-columns: minmax(0, 1fr); min-width: 0; }
.batch-files li { min-width: 0; }
.batch-files li { cursor: pointer; transition: background .2s, border-color .2s; }
.batch-files li:hover, .batch-files li:focus-within { background: #fff; border-color: #b7ccbf; }
.batch-preview-link { display: block; width: 100%; min-width: 0; padding: 0; border: 0; border-radius: 3px; background: transparent; color: inherit; text-align: left; }
.batch-number, .batch-files li > button { flex-shrink: 0; }
.batch-file p { overflow-wrap: anywhere; }
.batch-file-action { position: relative; display: grid; place-items: center; flex: 0 0 38px; width: 38px; height: 38px; }
.batch-file-action > button { width: 38px; height: 38px; padding: 0; }
.batch-action-state { position: absolute; inset: 0; display: grid; place-items: center; }
.batch-success { color: #4c9b6b; }
.batch-success svg { width: 30px; height: 30px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.batch-success path { stroke-dasharray: 1; stroke-dashoffset: 0; animation: batch-check-draw .4s ease both; }
.batch-action-enter-active, .batch-action-leave-active { transition: opacity .24s ease, transform .3s ease; }
.batch-action-enter-from { opacity: 0; transform: scale(.8); }
.batch-action-leave-to { opacity: 0; transform: scale(.85); }
.batch-action-leave-active { pointer-events: none; }
@keyframes batch-check-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@media(prefers-reduced-motion: reduce) { .batch-action-enter-active, .batch-action-leave-active { transition: none; } .batch-success path { animation: none; } }
/* From Uiverse.io by dovatgabriel */
.three-body { --uib-size: 35px; --uib-speed: .8s; --uib-color: #5D3FD3; position: relative; display: inline-block; width: var(--uib-size); height: var(--uib-size); animation: spin78236 calc(var(--uib-speed) * 2.5) infinite linear; }
.three-body__dot { position: absolute; height: 100%; width: 30%; }
.three-body__dot::after { content: ''; position: absolute; height: 0%; width: 100%; padding-bottom: 100%; background-color: var(--uib-color); border-radius: 50%; }
.three-body__dot:nth-child(1) { bottom: 5%; left: 0; transform: rotate(60deg); transform-origin: 50% 85%; }
.three-body__dot:nth-child(1)::after { bottom: 0; left: 0; animation: wobble1 var(--uib-speed) infinite ease-in-out; animation-delay: calc(var(--uib-speed) * -.3); }
.three-body__dot:nth-child(2) { bottom: 5%; right: 0; transform: rotate(-60deg); transform-origin: 50% 85%; }
.three-body__dot:nth-child(2)::after { bottom: 0; left: 0; animation: wobble1 var(--uib-speed) infinite calc(var(--uib-speed) * -.15) ease-in-out; }
.three-body__dot:nth-child(3) { bottom: -5%; left: 0; transform: translateX(116.666%); }
.three-body__dot:nth-child(3)::after { top: 0; left: 0; animation: wobble2 var(--uib-speed) infinite ease-in-out; }
@keyframes spin78236 { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes wobble1 { 0%, 100% { transform: translateY(0%) scale(1); opacity: 1; } 50% { transform: translateY(-66%) scale(.65); opacity: .8; } }
@keyframes wobble2 { 0%, 100% { transform: translateY(0%) scale(1); opacity: 1; } 50% { transform: translateY(66%) scale(.65); opacity: .8; } }
@media(prefers-reduced-motion: reduce) { .three-body, .three-body__dot::after { animation: none; } }
footer { margin-top: 22px; flex-wrap: wrap; } footer>span { font-size: 11px; color: #8a978e; }.batch-submit { background: #385e48; border-color: #385e48; color: white; }
@media(max-width: 480px) { .batch-content-inner { padding: 20px; } .batch-close { top: -8px; right: -5px; width: 34px; height: 34px; } footer>div { flex-wrap: wrap; } }
</style>
