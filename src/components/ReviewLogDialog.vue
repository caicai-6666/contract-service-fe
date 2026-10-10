<script setup>
import { computed, nextTick, onBeforeUnmount, onBeforeUpdate, reactive, ref, watch } from 'vue'
import PdfPreviewOverlay from './PdfPreviewOverlay.vue'
import { createContractPdfCache } from '../models/contractPdfCache.js'
import { getDeletionReviewIds, getDeletionReviewDetail, getDeletionReviewPdf } from '../services/deletionReviewsApi.js'
import { deletionLabels } from '../models/deletionReviews.js'
import { getPendingReviewIds, getPendingReviewDetail, getPendingReviewPdf } from '../services/pendingReviewsApi.js'
import { getAuthSession } from '../services/contractApi.js'
import { deliveryLabels, reviewLabels, ingestionLabels, cleanupRemainingSeconds, formatRetention, formatReviewTime } from '../models/pendingReviews.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])
const dialog = ref(null), listElement = ref(null)
const reviewKind = ref('ingestion')
const reviewStates = reactive(Object.fromEntries(['ingestion', 'deletion'].map(kind => [kind, {
  rows: [], selectedId: '', loading: false, listError: '', removedCount: 0, loaded: false, scrollTop: 0,
}])))
function bindReviewState(field) {
  return computed({ get: () => reviewStates[reviewKind.value][field], set: value => { reviewStates[reviewKind.value][field] = value } })
}
const rows = bindReviewState('rows'), selectedId = bindReviewState('selectedId')
const currentUserName = getAuthSession()?.userName ?? ''
const onlyMyIngestionReviews = ref(true)
const detailKey = computed(() => `${reviewKind.value}:${selectedId.value || 'empty'}:${reviewKind.value === 'ingestion' && onlyMyIngestionReviews.value ? 'mine' : 'all'}`)
const visibleRows = computed(() => reviewKind.value === 'ingestion' && onlyMyIngestionReviews.value
  ? rows.value.filter(row => !row.detail || row.detail.submitted_by === currentUserName)
  : rows.value)
watch([visibleRows, selectedId], ([visible, selected]) => {
  if (!visible.some(row => row.id === selected)) selectedId.value = visible[0]?.id || ''
}, { flush: 'sync' })
const rowEnterDelays = ref(new Map())
watch(visibleRows, (visible, previous) => {
  const retained = new Set(previous.map(row => row.id))
  let inserted = 0
  rowEnterDelays.value = new Map(visible.filter(row => !retained.has(row.id)).map(row => [row.id, inserted++ * 65]))
}, { flush: 'sync' })
const rowPositions = new WeakMap()
function captureRowPositions() {
  for (const element of listElement.value?.querySelectorAll('.review-log__item') || []) {
    const bounds = element.getBoundingClientRect()
    rowPositions.set(element, { top: bounds.top - element.parentElement.getBoundingClientRect().top, width: bounds.width })
  }
}
onBeforeUpdate(captureRowPositions)
function fixLeavingRow(element) {
  const bounds = rowPositions.get(element) || { top: element.getBoundingClientRect().top - element.parentElement.getBoundingClientRect().top, width: element.getBoundingClientRect().width }
  element.style.top = `${bounds.top}px`
  element.style.width = `${bounds.width}px`
  element.inert = true
}
function resetLeavingRow(element) {
  element.style.removeProperty('top')
  element.style.removeProperty('width')
  element.inert = false
}
function enterDetail(element) {
  element.inert = false
  element.parentElement.scrollTop = 0
}
const loading = bindReviewState('loading'), listError = bindReviewState('listError'), removedCount = bindReviewState('removedCount')
const activeReviewApi = computed(() => reviewKind.value === 'deletion'
  ? { list: getDeletionReviewIds, detail: getDeletionReviewDetail }
  : { list: getPendingReviewIds, detail: getPendingReviewDetail })
function pdfCacheKey(id) { return `${reviewKind.value}:${id}` }

const refreshSpinning = ref(false)
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
watch(loading, busy => {
  if (busy) refreshSpinning.value = !motionPreference.matches
}, { flush: 'sync' })
function finishRefreshTurn() {
  if (!loading.value) refreshSpinning.value = false
}
function onMotionPreferenceChange(event) {
  if (event.matches) refreshSpinning.value = false
}
motionPreference.addEventListener('change', onMotionPreferenceChange)
const clock = ref(performance.now())
const selected = computed(() => visibleRows.value.find(row => row.id === selectedId.value))
const detail = computed(() => selected.value?.detail)
const cleanupLabels = computed(() => new Map(rows.value.map(row => {
  const remaining = cleanupRemainingSeconds(row.detail, row.receivedAt, clock.value)
  return [row.id, remaining === null ? '' : remaining === 0 ? '等待清理' : `${formatRetention(remaining)}后清理`]
})))
let request = null, timer = null
const pdfOpen = ref(false), pdfUrl = ref(''), pdfLoading = ref(false), pdfError = ref('')
const pdfCache = createContractPdfCache()
let pdfRequest = null
function closePdf() {
  pdfRequest?.abort(); pdfRequest = null
  pdfOpen.value = false; pdfLoading.value = false
  if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value)
  pdfUrl.value = ''
}
async function previewPdf({ reload = false } = {}) {
  if (!detail.value || (reviewKind.value === 'deletion' && detail.value.pdf.url === null)) return
  closePdf()
  const snapshot = detail.value
  const kind = reviewKind.value
  const id = snapshot.submission_id
  const key = pdfCacheKey(id)
  pdfOpen.value = true; pdfError.value = ''
  if (reload) pdfCache.remove(key)
  const cached = pdfCache.get(key)
  if (cached) { pdfUrl.value = URL.createObjectURL(cached); return }
  const controller = new AbortController()
  pdfRequest = controller; pdfLoading.value = true
  try {
    const blob = await (kind === 'deletion' ? getDeletionReviewPdf(snapshot, { signal: controller.signal }) : getPendingReviewPdf(id, { signal: controller.signal }))
    if (pdfRequest !== controller) return
    pdfCache.set(key, blob)
    pdfUrl.value = URL.createObjectURL(blob)
  } catch (error) {
    if (pdfRequest === controller && error.name !== 'AbortError') {
      if (error.status === 404) {
        pdfCache.remove(key)
        if (kind === 'deletion') snapshot.pdf.url = null
      }
      pdfError.value = error.status === 404 ? '该合同 PDF 已不可用，请刷新审核日志' : error.message
    }
  } finally { if (pdfRequest === controller) pdfLoading.value = false }
}
watch(selectedId, closePdf)
watch(reviewKind, closePdf)
async function loadRow(row, controller = request) {
  if (!controller || controller.signal.aborted || row.loading) return false
  row.loading = true; row.error = ''
  try {
    const result = await activeReviewApi.value.detail(row.id, { signal: controller.signal })
    if (request !== controller) return false
    if (reviewKind.value === 'deletion' && result.pdf.url === null) pdfCache.remove(pdfCacheKey(row.id))
    row.detail = result; row.receivedAt = performance.now(); clock.value = row.receivedAt
  } catch (error) {
    if (request !== controller || error.name === 'AbortError') return false
    if (error.status === 404) {
      pdfCache.remove(pdfCacheKey(row.id))
      rows.value = rows.value.filter(item => item.id !== row.id)
      removedCount.value++
      if (selectedId.value === row.id) selectedId.value = rows.value[0]?.id || ''
      return false
    } else row.error = error.message || '详情暂时无法读取，请重试'
  } finally { row.loading = false }
  return true
}
async function refresh() {
  request?.abort()
  const controller = new AbortController()
  request = controller; loading.value = true; listError.value = ''; removedCount.value = 0
  try {
    const ids = await activeReviewApi.value.list({ signal: controller.signal })
    if (request !== controller) return
    const retained = new Set(ids.map(pdfCacheKey))
    pdfCache.removeWhere(key => key.startsWith(`${reviewKind.value}:`) && !retained.has(key))
    const previous = new Map(rows.value.map(row => [row.id, row]))
    const ready = new Map(ids.filter(id => previous.has(id)).map(id => [id, previous.get(id)]))
    rows.value = ids.filter(id => ready.has(id)).map(id => ready.get(id))
    if (!ids.includes(selectedId.value)) selectedId.value = rows.value[0]?.id || ''
    // 每批五条详情全部完成后再发布，避免占位卡片入场后发生内容跳变。
    for (let offset = 0; offset < ids.length; offset += 5) {
      if (request !== controller || controller.signal.aborted) return
      const batch = ids.slice(offset, offset + 5).map(id => ({ id, detail: previous.get(id)?.detail || null, receivedAt: previous.get(id)?.receivedAt || 0, loading: false, error: '', enterDelay: 0 }))
      const results = await Promise.all(batch.map(row => loadRow(row, controller)))
      if (request !== controller || controller.signal.aborted) return
      let inserted = 0
      batch.forEach((row, index) => {
        if (results[index]) {
          if (!ready.has(row.id)) row.enterDelay = inserted++ * 65
          ready.set(row.id, row)
        } else ready.delete(row.id)
      })
      rows.value = ids.filter(id => ready.has(id)).map(id => ready.get(id))
      if (!rows.value.some(row => row.id === selectedId.value)) selectedId.value = rows.value[0]?.id || ''
      await nextTick()
    }
    if (request === controller) reviewStates[reviewKind.value].loaded = true
  } catch (error) {
    if (request === controller && error.name !== 'AbortError') listError.value = error.message || '审核列表暂时无法读取，请重试'
  } finally {
    if (request === controller) loading.value = false
  }
}
function stop() {
  request?.abort(); request = null
  loading.value = false; refreshSpinning.value = false
  clearInterval(timer); timer = null
  closePdf()
}
function startClock() {
  clock.value = performance.now()
  timer = setInterval(() => { clock.value = performance.now() }, 1000)
}
function selectReviewKind(kind) {
  if (reviewKind.value === kind) return
  const visibleKind = listElement.value?.dataset.reviewKind
  if (visibleKind) reviewStates[visibleKind].scrollTop = listElement.value.scrollTop
  stop()
  reviewKind.value = kind
  startClock()
  if (!reviewStates[kind].loaded) void refresh()
  else request = new AbortController()
}
function restoreReviewScroll(element) {
  element.inert = false
  const list = element.querySelector('.review-log__list')
  if (list) list.scrollTop = reviewStates[list.dataset.reviewKind].scrollTop
}
watch(() => props.open, async open => {
  if (open) {
    reviewKind.value = 'ingestion'
    await nextTick()
    if (!props.open || !dialog.value) return
    if (!dialog.value.open) dialog.value.showModal()
    startClock()
    void refresh()
  } else { stop(); dialog.value?.close() }
}, { flush: 'post' })
onBeforeUnmount(() => {
  stop(); dialog.value?.close()
  pdfCache.clear()
  motionPreference.removeEventListener('change', onMotionPreferenceChange)
})
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="review-log" @keydown.stop aria-labelledby="review-log-title" @cancel.self.prevent="pdfOpen ? closePdf() : emit('close')" @click.self="emit('close')">
      <div class="review-log__shell">
        <header class="review-log__header">
          <div>
            <span class="review-log__eyebrow">合同审核记录</span>
            <h2 id="review-log-title">审核日志
              <span class="review-log__count" aria-live="polite" aria-atomic="true">
                <Transition name="review-log-count" mode="out-in" appear>
                  <small v-if="open && (visibleRows.length || (!loading && !listError))" :key="visibleRows.length">{{ visibleRows.length }} 条</small>
                </Transition>
              </span>
            </h2>
          </div>
          <div class="review-log__filters" role="group" aria-label="审核类型">
            <button type="button" :class="{ 'is-active': reviewKind === 'ingestion' }" :aria-pressed="reviewKind === 'ingestion'" @click="selectReviewKind('ingestion')">入库审核</button>
            <button type="button" :class="{ 'is-active': reviewKind === 'deletion' }" :aria-pressed="reviewKind === 'deletion'" @click="selectReviewKind('deletion')">删除审核</button>
          </div>
          <div class="review-log__actions">
            <button type="button" :disabled="loading || refreshSpinning" :aria-busy="loading" aria-label="刷新审核日志" :title="loading ? '正在刷新' : '刷新审核日志'" @click="refresh">
              <svg viewBox="0 0 24 24" :class="{ 'is-spinning': refreshSpinning }" aria-hidden="true" @animationiteration="finishRefreshTurn"><path d="M19.5 14.7A8 8 0 1 1 18.1 6.9L20 9M20 4.5V9h-4.5" /></svg>
            </button>
            <button type="button" aria-label="关闭审核日志" title="关闭审核日志" @click="emit('close')">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
        </header>
        <Transition name="review-log-content" mode="out-in" @before-leave="element => { element.inert = true }" @enter="restoreReviewScroll">
          <div :key="reviewKind" class="review-log__pane">
            <p v-if="listError" class="review-log__error selectable-content" role="alert">{{ listError }}{{ rows.length ? '（保留上次读取的记录）' : '' }} <button @click="refresh" :disabled="loading">重试</button></p>
            <p v-if="removedCount" class="review-log__notice" role="status">{{ removedCount }} 条记录已不再可用，已从列表移除。</p>
            <div class="review-log__body">
              <nav ref="listElement" :data-review-kind="reviewKind" class="review-log__list" :aria-label="reviewKind === 'deletion' ? '删除申请' : '入库申请'" :aria-busy="loading">
                <div v-if="reviewKind === 'ingestion'" class="review-log__scope" role="group" aria-label="入库申请筛选">
                  <button type="button" :class="{ 'is-active': !onlyMyIngestionReviews }" :aria-pressed="!onlyMyIngestionReviews" @click="onlyMyIngestionReviews = false">全部</button>
                  <button type="button" :class="{ 'is-active': onlyMyIngestionReviews }" :aria-pressed="onlyMyIngestionReviews" @click="onlyMyIngestionReviews = true">我提交的</button>
                </div>
                <TransitionGroup v-if="open" name="review-log-row" tag="div" class="review-log__rows" appear @before-leave="fixLeavingRow" @after-leave="resetLeavingRow" @leave-cancelled="resetLeavingRow">
                  <button v-for="row in visibleRows" :key="`${reviewKind}:${row.id}`" type="button" class="review-log__item" :style="{ '--row-enter-delay': `${rowEnterDelays.get(row.id) ?? row.enterDelay ?? 0}ms` }" :class="{ 'is-selected': selectedId === row.id }" :aria-pressed="selectedId === row.id" @click="selectedId = row.id">
                    <strong>{{ row.detail?.file_name || (row.error ? '详情读取失败' : '正在读取申请…') }}</strong>
                    <span v-if="row.detail" class="review-log__item-meta">{{ reviewKind === 'deletion' ? row.detail.requested_by : row.detail.submitted_by }} · {{ formatReviewTime(row.detail.created_at) }}</span>
                    <span v-if="row.detail" class="review-log__item-footer">
                      <span class="review-log__badge" :class="`is-${row.detail.review.status}`">{{ reviewLabels[row.detail.review.status] }}</span>
                      <span v-if="cleanupLabels.get(row.id)" class="review-log__countdown" title="到期后由后台扫描清理，实际清理可能稍晚">{{ cleanupLabels.get(row.id) }}</span>
                    </span>
                    <span v-if="row.error" class="review-log__item-error">读取失败，点击查看</span>
                  </button>
                </TransitionGroup>
                <Transition name="review-log-empty">
                  <p v-if="!visibleRows.length" class="review-log__empty">{{ loading ? '正在读取审核日志…' : listError ? '审核列表暂时不可用' : reviewKind === 'ingestion' && onlyMyIngestionReviews ? '暂无我提交的入库审核记录' : '暂无保留的审核记录' }}</p>
                </Transition>
              </nav>
              <section class="review-log__detail" aria-label="审核详情">
                <Transition name="review-log-detail" mode="out-in" @before-leave="element => { element.inert = true }" @enter="enterDetail">
                  <div :key="detailKey" class="review-log__detail-body">
                    <p v-if="selected?.error" class="review-log__error" role="alert">{{ selected.error }} <button :disabled="loading || selected.loading" @click="loadRow(selected)">重试详情</button></p>
                    <div v-if="detail" class="review-log__content">
                      <header class="review-log__document"><div><h3>{{ detail.file_name }}</h3><span><template v-if="reviewKind === 'ingestion'">{{ detail.page_count }} 页 · </template>{{ formatReviewTime(detail.created_at) }} 提交</span></div><button type="button" :disabled="reviewKind === 'deletion' && detail.pdf.url === null" :title="reviewKind === 'deletion' && detail.pdf.url === null ? '原合同 PDF 已不可用' : '查看 PDF'" @click="previewPdf">{{ reviewKind === 'deletion' && detail.pdf.url === null ? 'PDF 不可用' : '查看 PDF' }}</button></header>
                      <div class="review-log__stages">
                        <div><span>送审发送</span><strong>{{ deliveryLabels[detail.delivery.status] }}</strong></div>
                        <div :class="{ 'review-log__stage--rejected': detail.review.status === 'rejected' }"><span>审核结果</span><strong :class="`is-${detail.review.status}`">{{ reviewLabels[detail.review.status] }}</strong></div>
                        <div v-if="reviewKind === 'ingestion'"><span>正式入库</span><strong :class="{ 'is-rejected': detail.ingestion.status === 'failed' }">{{ detail.review.status === 'rejected' && detail.ingestion.status === 'pending' ? '不入库' : ingestionLabels[detail.ingestion.status] }}</strong></div>
                        <div v-else><span>实际删除</span><strong :class="{ 'is-rejected': detail.deletion.status === 'failed', 'is-approved': detail.deletion.status === 'succeeded' }">{{ detail.review.status === 'rejected' && detail.deletion.status === 'pending' ? '不删除' : deletionLabels[detail.deletion.status] }}</strong></div>
                      </div>
                      <section v-if="reviewKind === 'deletion'" class="review-log__block"><h4>原合同信息</h4><dl><div><dt>上传人</dt><dd>{{ detail.uploader }}</dd></div><div><dt>原入库时间</dt><dd>{{ formatReviewTime(detail.contract_ingested_at) }}</dd></div></dl></section>
                      <section class="review-log__block"><h4>合同摘要</h4><p>{{ detail.summary ?? '尚未保存摘要' }}</p></section>
                      <section class="review-log__block"><h4>{{ reviewKind === 'deletion' ? '删除申请备注' : '入库员备注' }} <small>{{ reviewKind === 'deletion' ? detail.requested_by : detail.submitted_by }}</small></h4><p>{{ detail.note || '未填写备注' }}</p></section>
                      <section class="review-log__block"><h4>审核反馈</h4><p>{{ detail.review.note === null ? '暂无审核备注' : detail.review.note || '审核人未填写备注' }}</p><dl><div><dt>审核人</dt><dd>{{ detail.review.reviewer ?? '—' }}</dd></div><div><dt>审核时间</dt><dd>{{ formatReviewTime(detail.review.reviewed_at) }}</dd></div><div v-if="reviewKind === 'ingestion'"><dt>正式入库时间</dt><dd>{{ formatReviewTime(detail.ingestion.ingested_at) }}</dd></div><div v-else><dt>删除完成时间</dt><dd>{{ formatReviewTime(detail.deletion.completed_at) }}</dd></div></dl></section>
                      <dl class="review-log__identifiers"><div><dt>申请编号</dt><dd>{{ detail.submission_id }}</dd></div><div><dt>最近更新</dt><dd>{{ formatReviewTime(detail.updated_at) }}</dd></div></dl>
                    </div>
                    <p v-else class="review-log__empty" role="status">{{ selected?.loading ? '正在读取申请详情…' : selected?.error ? '详情暂时不可用' : '选择一条记录查看审核详情' }}</p>
                  </div>
                </Transition>
              </section>
            </div>
          </div>
        </Transition>
      </div>
      <PdfPreviewOverlay v-if="dialog" :teleport-target="dialog" :open="pdfOpen" :src="pdfUrl" :label="detail?.file_name || '待审合同'" :loading="pdfLoading" :error="pdfError" controlled-reader @close="closePdf" @retry="previewPdf({ reload: true })" />
    </dialog>
  </Teleport>
</template>

<style scoped>
.review-log { width: min(1080px, calc(100vw - 48px)); max-width: none; max-height: none; height: min(780px, calc(100dvh - 64px)); padding: 0; border: 1px solid #ffffffc9; border-radius: 24px; color: #314b3d; background: #f4f8f5; box-shadow: 0 32px 100px #142b3455; overflow: hidden; }
.review-log::backdrop { background: #10251d66; backdrop-filter: blur(8px); }
.review-log__shell { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.review-log__header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 23px 28px; border-bottom: 1px solid #526c5d1a; background: linear-gradient(130deg, #fff, #eaf2ed); }
.review-log__eyebrow { color: #7a9182; font-size: 11px; letter-spacing: .12em; }
.review-log h2 { margin: 6px 0 0; font-size: 21px; font-weight: 600; }
.review-log__count { display: inline-grid; min-width: 4ch; margin-left: 8px; vertical-align: baseline; font-size: 12px; font-weight: 400; }
.review-log__count small { grid-area: 1 / 1; color: #85968b; font-size: inherit; font-weight: inherit; font-variant-numeric: tabular-nums; white-space: nowrap; }
.review-log-count-enter-active { transition: opacity .48s ease; }
.review-log-count-leave-active { transition: opacity .22s ease; }
.review-log-count-enter-from, .review-log-count-leave-to { opacity: 0; }
.review-log button { cursor: pointer; font: inherit; } .review-log button:disabled { cursor: default; opacity: .5; } .review-log button:focus-visible { outline: 2px solid #608a73; outline-offset: 3px; }
.review-log__filters { display: flex; align-self: flex-end; gap: 4px; padding: 4px; border: 1px solid #668b7020; border-radius: 12px; background: #e4ece680; }
.review-log__filters button { padding: 9px 16px; border: 0; border-radius: 8px; background: transparent; color: #7a8b80; font-size: 12px; white-space: nowrap; transition: background .2s, color .2s, box-shadow .2s; }
.review-log__filters button:hover { color: #3d6350; background: #ffffff80; }
.review-log__filters button.is-active { color: #355c46; background: #fff; box-shadow: 0 2px 8px #28473114; }
.review-log__scope { position: sticky; top: 0; z-index: 1; display: flex; gap: 4px; margin-bottom: 12px; padding: 4px; border: 1px solid #668b7020; border-radius: 10px; background: #eaf0ec; }
.review-log__scope button { flex: 1; padding: 7px 10px; border: 0; border-radius: 7px; color: #7a8b80; background: transparent; font-size: 12px; transition: background .2s, color .2s, box-shadow .2s; }
.review-log__scope button.is-active { color: #355c46; background: #fff; box-shadow: 0 2px 8px #28473114; }
.review-log__actions { display: flex; align-items: center; flex: none; gap: 12px; margin-left: auto; }
.review-log__actions button {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #fff;
  color: #597563;
  line-height: 1;
  box-shadow: 0 2px 5px #253b3010, 0 5px 14px #253b3012;
  transition: box-shadow .2s, color .2s, background .2s, transform .2s;
}
.review-log__actions button:hover:not(:disabled) { color: #355442; background: #fafffc; box-shadow: 0 3px 7px #253b3014, 0 7px 18px #253b3018; }
.review-log__actions button:active:not(:disabled) { transform: scale(.94); box-shadow: 0 1px 4px #253b3014; }
.review-log__actions button:disabled { opacity: .7; }
.review-log__actions svg { display: block; width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; transform-origin: center; }
.review-log__pane { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.review-log-content-enter-active { transition: opacity .36s cubic-bezier(.22, 1, .36, 1); }
.review-log-content-leave-active { transition: opacity .24s ease; pointer-events: none; }
.review-log-content-enter-from, .review-log-content-leave-to { opacity: 0; }
.review-log-detail-enter-active { transition: opacity .34s ease; }
.review-log-detail-leave-active { transition: opacity .2s ease; pointer-events: none; }
.review-log-detail-enter-from, .review-log-detail-leave-to { opacity: 0; }
.review-log-empty-enter-active { transition: opacity .24s ease .24s; }
.review-log-empty-leave-active { transition: opacity .16s ease; }
.review-log-empty-enter-from, .review-log-empty-leave-to { opacity: 0; }
.review-log__body { display: grid; grid-template-columns: 290px minmax(0, 1fr); flex: 1; min-height: 0; }.review-log__list { padding: 16px 12px; overflow: auto; border-right: 1px solid #668b701f; background: #eaf0ec70; }
.review-log__item { display: grid; gap: 9px; text-align: left; width: 100%; padding: 16px; margin-bottom: 9px; border: 1px solid transparent; border-radius: 14px; background: transparent; color: inherit; transition: background .2s, border-color .2s; }
.review-log-row-enter-active { animation: review-log-row-enter .46s cubic-bezier(.22, 1, .36, 1) var(--row-enter-delay, 0ms) both; }
.review-log__rows { position: relative; }
.review-log-row-move { transition: transform .38s cubic-bezier(.22, 1, .36, 1); }
.review-log-row-leave-active { position: absolute; transition: opacity .24s ease, transform .24s ease; pointer-events: none; }
.review-log-row-leave-to { opacity: 0; transform: translateX(-28px); }
@keyframes review-log-row-enter {
  from { opacity: 0; transform: translateX(-28px); }
  to { opacity: 1; transform: translateX(0); }
}
.review-log__item:hover { background: #ffffffa8; }.review-log__item.is-selected { background: #fff; border-color: #91b29c6b; box-shadow: 0 4px 14px #4c6c5910; }.review-log__item strong { font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }.review-log__item-meta { font-size: 10px; color: #7d8d82; }
.review-log__item-footer { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.review-log__countdown { margin-left: auto; color: #7b8e81; font-size: 10px; line-height: 1.6; text-align: right; font-variant-numeric: tabular-nums; }
.review-log__badge { justify-self: start; padding: 4px 8px; background: #e8eeea; border-radius: 6px; font-size: 11px; }.review-log .is-approved { color: #3c8864; }.review-log .is-rejected { color: #c52d38; font-weight: 600; }.review-log__item-error { color: #aa6f52; font-size: 11px; }
.review-log__badge.is-rejected { background: #ffeaec; box-shadow: inset 0 0 0 1px #e3485433; }
.review-log__detail, .review-log__detail :deep(*) { -webkit-user-select: none; user-select: none; }
.review-log__detail { min-width: 0; overflow: auto; padding: 26px 28px; background: #ffffff91; }.review-log__content { display: grid; gap: 22px; }.review-log__document { display: flex; gap: 16px; align-items: start; justify-content: space-between; }.review-log h3 { font-size: 19px; font-weight: 500; margin: 0 0 8px; overflow-wrap: anywhere; }.review-log__document span { font-size: 11px; color: #84948b; }.review-log__document button, .review-log__error button { flex: none; padding: 7px 11px; border-radius: 8px; border: 1px solid #668b702c; background: #fff; color: #4f765e; font-size: 12px; }
.review-log__stages { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }.review-log__stages div { display: grid; gap: 9px; padding: 14px 12px; border-radius: 12px; background: #eaf2ed8c; }.review-log__stages span { color: #829187; font-size: 11px; }.review-log__stages strong { font-size: 12px; font-weight: 500; }
.review-log__stages .review-log__stage--rejected { background: #fff0f1; box-shadow: inset 0 0 0 1px #e3485433; }
.review-log__stage--rejected span { color: #a96369; }
.review-log h4 { margin: 0; font-size: 12px; font-weight: 600; }.review-log h4 small { margin-left: 8px; font-size: 11px; color: #899b8f; font-weight: 400; }.review-log__block > p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.8; margin: 10px 0 0; }
.review-log dl { margin: 12px 0 0; display: grid; gap: 10px; font-size: 11px; }.review-log dl > div { display: flex; gap: 16px; }.review-log dt { flex: 0 0 84px; color: #89968d; }.review-log dd { margin: 0; overflow-wrap: anywhere; }
.review-log__empty { padding: 36px 12px; color: #8c9c90; text-align: center; font-size: 12px; line-height: 1.8; }.review-log__error { margin: 12px 20px; color: #a55c4e; font-size: 12px; line-height: 1.8; }.review-log__notice { margin: 10px 24px 0; color: #7b8e81; font-size: 11px; }
.is-spinning { animation: review-log-spin .8s linear infinite; } @keyframes review-log-spin { to { transform: rotate(360deg); } }
@media (max-width: 700px) { .review-log { width: calc(100vw - 20px); height: calc(100dvh - 24px); border-radius: 16px; }.review-log__header { padding: 18px; flex-wrap: wrap; }.review-log__filters { order: 3; width: 100%; }.review-log__filters button { flex: 1; }.review-log__body { grid-template-columns: 1fr; grid-template-rows: 180px minmax(0, 1fr); }.review-log__list { border-right: 0; border-bottom: 1px solid #668b701f; }.review-log__detail { padding: 20px 16px; } }
@media (prefers-reduced-motion: reduce) { .is-spinning, .review-log-row-enter-active { animation: none; }.review-log__item, .review-log__actions button, .review-log-count-enter-active, .review-log-count-leave-active, .review-log-row-move, .review-log-row-leave-active, .review-log-content-enter-active, .review-log-content-leave-active, .review-log-detail-enter-active, .review-log-detail-leave-active, .review-log-empty-enter-active, .review-log-empty-leave-active { transition: none; } }
</style>
