<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { bindPdfZoomGestures } from '../services/pdfZoomGestures.js'
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'
import 'pdfjs-dist/web/pdf_viewer.css'

const props = defineProps({ src: { type: String, default: '' }, label: { type: String, default: '合同' } })
const emit = defineEmits(['ready', 'error'])
const container = ref(null)
const pages = ref(null)
const pageNumber = ref(1)
const pageCount = ref(0)
const scale = ref(100)
const ready = ref(false)
let generation = 0
let loadingTask
let viewer
let linkService
let worker
let workerPort
let resizeObserver
let fitWidth = true
let unbindZoomGestures
let zoomFrame = null
let zoomTarget = null

function dispose() {
  cancelZoomAnimation()
  ready.value = false
  pageCount.value = 0
  pageNumber.value = 1
  scale.value = 100
  resizeObserver?.disconnect()
  resizeObserver = null
  viewer?.setDocument(null)
  linkService?.setDocument(null)
  viewer = null
  linkService = null
  const task = loadingTask
  loadingTask = null
  const previousWorker = worker
  const previousPort = workerPort
  worker = null
  workerPort = null
  Promise.resolve(task?.destroy()).catch(() => {}).finally(() => {
    previousWorker?.destroy()
    previousPort?.terminate()
  })
}

async function load(src) {
  const current = ++generation
  dispose()
  if (!src) return
  try {
    const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const { PDFViewer, EventBus, PDFLinkService } = await import('pdfjs-dist/web/pdf_viewer.mjs')
    await nextTick()
    if (current !== generation) return
    workerPort = new PdfWorker()
    worker = new pdf.PDFWorker({ port: workerPort })
    const eventBus = new EventBus()
    linkService = new PDFLinkService({ eventBus, externalLinkTarget: 2, externalLinkRel: 'noopener noreferrer' })
    viewer = new PDFViewer({ container: container.value, viewer: pages.value, eventBus, linkService, annotationMode: 1 })
    linkService.setViewer(viewer)
    eventBus.on('pagesinit', () => {
      if (current !== generation) return
      fitWidth = true
      viewer.currentScaleValue = 'page-width'
      pageCount.value = viewer.pagesCount
      ready.value = true
    })
    eventBus.on('pagerendered', ({ error }) => {
      if (current !== generation) return
      if (error) emit('error', 'PDF 页面渲染失败，请重试')
      else emit('ready')
    })
    eventBus.on('pagechanging', ({ pageNumber: number }) => { if (current === generation) pageNumber.value = number })
    eventBus.on('scalechanging', ({ scale: value }) => { if (current === generation) scale.value = Math.round(value * 100) })
    const base = `${import.meta.env.BASE_URL}pdfjs/`
    loadingTask = pdf.getDocument({ url: src, worker, cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`, isEvalSupported: false })
    const document = await loadingTask.promise
    if (current !== generation) return
    linkService.setDocument(document)
    viewer.setDocument(document)
    resizeObserver = new ResizeObserver(() => { if (ready.value && fitWidth) viewer.currentScaleValue = 'page-width' })
    resizeObserver.observe(container.value)
  } catch (error) {
    if (current !== generation) return
    ready.value = false
    emit('error', error?.name === 'PasswordException' ? 'PDF 已加密，暂不支持预览' : 'PDF 解析失败，请重新加载')
  }
}
function goToPage(value) {
  if (!ready.value) return
  cancelZoomAnimation()
  const number = Number(value)
  if (Number.isInteger(number)) viewer.currentPageNumber = Math.max(1, Math.min(pageCount.value, number))
  pageNumber.value = viewer.currentPageNumber
}
function changePage(event) {
  goToPage(event.target.value)
  event.target.value = pageNumber.value
}
function cancelZoomAnimation() {
  if (zoomFrame !== null) cancelAnimationFrame(zoomFrame)
  zoomFrame = null
  zoomTarget = null
}
function zoom(delta) {
  if (!ready.value) return
  fitWidth = false
  const target = Math.min(4, Math.max(.25, (zoomTarget ?? viewer.currentScale) + delta))
  cancelZoomAnimation()
  const startScale = viewer.currentScale
  const rect = container.value.getBoundingClientRect()
  const origin = [rect.left + rect.width / 2, rect.top + rect.height / 2]
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    viewer.updateScale({ scaleFactor: target / startScale, origin })
    return
  }
  zoomTarget = target
  const startedAt = performance.now()
  function step(now) {
    const progress = Math.min(1, (now - startedAt) / 240)
    const eased = 1 - (1 - progress) ** 3
    const nextScale = startScale + (target - startScale) * eased
    // 过渡中复用画布缩放，停下后再细化渲染，避免每帧重绘整页。
    viewer.updateScale({ scaleFactor: nextScale / viewer.currentScale, origin, drawingDelay: progress < 1 ? 150 : 0 })
    if (progress < 1) zoomFrame = requestAnimationFrame(step)
    else { zoomFrame = null; zoomTarget = null }
  }
  zoomFrame = requestAnimationFrame(step)
}
function fit() {
  if (!ready.value) return
  cancelZoomAnimation()
  fitWidth = true
  viewer.currentScaleValue = 'page-width'
}
function zoomAtPoint(factor, origin) {
  if (!ready.value || !viewer || !Number.isFinite(factor) || factor <= 0) return
  cancelZoomAnimation()
  fitWidth = false
  const nextScale = Math.min(4, Math.max(.25, viewer.currentScale * factor))
  viewer.updateScale({ scaleFactor: nextScale / viewer.currentScale, origin, drawingDelay: 150 })
}
onMounted(() => { unbindZoomGestures = bindPdfZoomGestures(container.value, zoomAtPoint) })
watch(() => props.src, load, { immediate: true })
onBeforeUnmount(() => { generation++; unbindZoomGestures?.(); dispose() })
</script>

<template>
  <div class="contract-pdf-reader">
    <header class="contract-pdf-reader__toolbar" aria-label="PDF 阅读工具栏">
      <strong :title="label">{{ label }}</strong>
      <div class="contract-pdf-reader__controls">
        <button type="button" aria-label="上一页" :disabled="!ready || pageNumber <= 1" @click="goToPage(pageNumber - 1)">‹</button>
        <input aria-label="当前页码" type="number" min="1" :max="pageCount || 1" :value="ready ? pageNumber : ''" placeholder="—" :disabled="!ready" @change="changePage" />
        <span>/ {{ pageCount || '—' }}</span>
        <button type="button" aria-label="下一页" :disabled="!ready || pageNumber >= pageCount" @click="goToPage(pageNumber + 1)">›</button>
        <i></i>
        <button type="button" aria-label="缩小" :disabled="!ready || scale <= 25" @click="zoom(-.1)">−</button>
        <span class="contract-pdf-reader__scale">{{ ready ? `${scale}%` : '—' }}</span>
        <button type="button" aria-label="放大" :disabled="!ready || scale >= 400" @click="zoom(.1)">＋</button>
        <button type="button" :disabled="!ready" @click="fit">适应宽度</button>
        <a v-if="ready" :href="src" :download="label.toLowerCase().endsWith('.pdf') ? label : `${label}.pdf`">下载</a>
      </div>
    </header>
    <div ref="container" class="contract-pdf-reader__pages" tabindex="0" aria-label="合同 PDF 页面">
      <div ref="pages" class="pdfViewer"></div>
    </div>
  </div>
</template>

<style scoped>
.contract-pdf-reader { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; background: #dfe3e1; }
.contract-pdf-reader__toolbar { position: absolute; inset: 0 0 auto; z-index: 2; height: 56px; box-sizing: border-box; display: flex; align-items: center; gap: 20px; padding: 0 20px; color: #e7ece9; background: #303935; border-bottom: 1px solid #ffffff18; }
.contract-pdf-reader__toolbar strong { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 13px; font-weight: 500; }
.contract-pdf-reader__controls { display: flex; flex-shrink: 0; align-items: center; gap: 7px; font-size: 12px; }
.contract-pdf-reader__controls button, .contract-pdf-reader__controls a { border: 0; border-radius: 6px; padding: 7px 9px; background: #ffffff10; color: inherit; font: inherit; text-decoration: none; cursor: pointer; }
.contract-pdf-reader__controls button:disabled { opacity: .35; cursor: default; }
.contract-pdf-reader__controls button:not(:disabled):hover, .contract-pdf-reader__controls a:hover { background: #ffffff24; }
.contract-pdf-reader__controls input { width: 42px; border: 1px solid #ffffff24; border-radius: 5px; padding: 5px 0; background: #202824; color: inherit; text-align: center; appearance: textfield; }
.contract-pdf-reader__controls input::-webkit-inner-spin-button { appearance: none; }
.contract-pdf-reader__controls i { height: 18px; width: 1px; margin: 0 5px; background: #ffffff24; }
.contract-pdf-reader__scale { width: 42px; text-align: center; }
.contract-pdf-reader__pages { position: absolute; inset: 56px 0 0; overflow: auto; overscroll-behavior: contain; }
@media (max-width: 640px) { .contract-pdf-reader__toolbar { padding: 0 8px; gap: 8px; } .contract-pdf-reader__toolbar strong { display: none; } .contract-pdf-reader__controls { width: 100%; justify-content: center; gap: 3px; } }
</style>
