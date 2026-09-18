<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { deleteContractDocument, getContractCategories, getContractDocuments } from '../services/contractLibraryApi.js'
import { filterContractDocuments, formatIngestionDate, resolveDocumentCategories } from '../models/contractDocuments.js'
import { getAuthSession } from '../services/contractApi.js'
import ContractArchiveDateFilter from './ContractArchiveDateFilter.vue'
import PdfPreviewOverlay from './PdfPreviewOverlay.vue'
import ContractLinksPanel from './ContractLinksPanel.vue'
import ContractNotesPanel from './ContractNotesPanel.vue'
import { getContractNotes, createContractNote, deleteContractNote } from '../services/contractNotesApi.js'
import { createContractPdfCache } from '../models/contractPdfCache.js'
import { getContractPdf } from '../services/contractResourceApi.js'

const props = defineProps({ active: { type: Boolean, default: true }, pinnedContractIds: { type: Array, default: () => [] } })
const emit = defineEmits(['pin-contract'])
const archiveRef = ref(null)
const initialRequestsSettled = ref(false)
const archiveReady = ref(false)
let revealFrame = null
const notesSaving = ref(false)
const notesSource = { list: getContractNotes, create: createContractNote, remove: deleteContractNote }
const linksSaving = ref(false)
const previewDocument = ref(null)
const previewUrl = ref('')
const previewLoading = ref(false)
const previewError = ref('')
const deletionPending = ref(false)
const deletionError = ref('')
let disposed = false
let previewController = null
const pdfCache = createContractPdfCache()

function closePreview() {
  if (deletionPending.value && !disposed) return
  previewController?.abort()
  previewController = null
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
  previewDocument.value = null
  previewLoading.value = false
  previewError.value = ''
  deletionError.value = ''
}

async function deletePreviewDocument() {
  if (deletionPending.value || !previewDocument.value) return
  const documentId = previewDocument.value.id
  const fileUri = previewDocument.value.fileUri
  deletionPending.value = true
  deletionError.value = ''
  // 删除不因弹窗关闭而取消；中途断开不能代表服务端已停止清理。
  documentController?.abort()
  documentController = null
  documentsLoading.value = false
  try {
    await deleteContractDocument(documentId)
    pdfCache.remove(fileUri)
    if (disposed) return
    documentModels.value = documentModels.value.filter((document) => document.id !== documentId)
    if (selectedYear.value && !documentModels.value.some((document) => document.date?.startsWith(selectedYear.value))) {
      updateDateFilter({ year: null, month: null, day: null })
    }
    deletionPending.value = false
    closePreview()
    await loadDocuments()
  } catch (error) {
    if (!disposed) deletionError.value = error instanceof TypeError
      ? '网络中断，删除结果未确认。请重试同一合同或刷新目录核对。'
      : error.message || '删除失败，请重试'
  } finally {
    deletionPending.value = false
  }
}

async function openPreview(document, { reload = false } = {}) {
  closePreview()
  previewDocument.value = document
  if (reload) pdfCache.remove(document.fileUri)
  const cached = pdfCache.get(document.fileUri)
  if (cached) { previewUrl.value = URL.createObjectURL(cached); return }
  previewLoading.value = true
  const controller = new AbortController()
  previewController = controller
  try {
    const blob = await getContractPdf(document.fileUri, { signal: controller.signal })
    if (previewController !== controller) return
    pdfCache.set(document.fileUri, blob)
    previewUrl.value = URL.createObjectURL(blob)
  } catch (error) {
    if (previewController !== controller || error?.name === 'AbortError') return
    previewError.value = error instanceof TypeError ? '无法连接合同资源服务，请重试' : error.message || 'PDF 加载失败'
  } finally {
    if (previewController === controller) previewLoading.value = false
  }
}
const currentReviewerName = getAuthSession()?.userName ?? ''
const reviewerScope = ref('all')
const documentModels = ref([])
const documentsLoading = ref(true)
const documentsLoaded = ref(false)
const documentsError = ref('')
let documentController = null
const selectedCategoryId = ref(null)
const categoryModels = ref([])
const categoryLoading = ref(true)
const categoryError = ref('')
const categoryListRef = ref(null)
const categoryEdgeFade = ref({ left: 0, right: 0 })
let categoryResizeObserver = null
let categoryController = null
const selectedCategory = computed(() => categoryModels.value.find((category) => category.categoryId === selectedCategoryId.value) ?? null)
const contracts = computed(() => documentModels.value.map((document) => resolveDocumentCategories(document, categoryModels.value)))
const years = computed(() => [...new Set(documentModels.value.filter((document) => document.date).map((document) => document.date.slice(0, 4)))].sort())
const selectedYear = ref('')
const selectedMonth = ref('')
const selectedDay = ref('')
const dateFilter = computed(() => ({ year: selectedYear.value ? Number(selectedYear.value) : null, month: selectedMonth.value || null, day: selectedDay.value || null }))
const resultsRef = ref(null)
const categories = computed(() => {
  const counts = new Map()
  for (const contract of contracts.value) {
    for (const code of contract.categoryCodes) counts.set(code, (counts.get(code) || 0) + 1)
  }
  const sorted = [...categoryModels.value].sort((left, right) => (
    (counts.get(right.code) || 0) - (counts.get(left.code) || 0)
    || left.categoryId - right.categoryId
  ))
  return [{ categoryId: null, code: null, name: '全部合同' }, ...sorted]
})
const filteredContracts = computed(() => filterContractDocuments(contracts.value, {
  categoryCode: selectedCategory.value?.code ?? null,
  year: selectedYear.value,
  month: selectedMonth.value,
  day: selectedDay.value,
  reviewer: reviewerScope.value === 'mine' ? currentReviewerName : null,
}).sort((left, right) => (right.date ?? '').localeCompare(left.date ?? '')))
const contractGroups = computed(() => {
  const groups = new Map()
  filteredContracts.value.forEach((contract) => {
    const key = contract.date?.slice(0, 7) ?? 'undated'
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: key === 'undated' ? '' : `${key.slice(0, 4)} 年 ${Number(key.slice(5))} 月`,
        contracts: [],
      })
    }
    groups.get(key).contracts.push(contract)
  })
  return [...groups.values()]
})
const selectedTimeLabel = computed(() => {
  const year = selectedYear.value ? `${selectedYear.value} 年` : '全部年份'
  return `${year}${selectedMonth.value ? ` · ${selectedMonth.value} 月` : ''}${selectedDay.value ? ` · ${selectedDay.value} 日` : ''}`
})

const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
const reducedMotion = ref(motionPreference.matches)
const refreshSpinning = ref(false)
let refreshTransitionPending = false
let resultsLeaveFinished = false
async function refreshDocuments() {
  if (documentsLoading.value || refreshSpinning.value) return
  refreshSpinning.value = !reducedMotion.value
  refreshTransitionPending = true
  resultsLeaveFinished = reducedMotion.value
  if (!reducedMotion.value) resultsVisible.value = false
  await loadDocuments()
  if (disposed) return
  if (resultsLeaveFinished) {
    refreshTransitionPending = false
    revealLatestResults()
  }
}
function onResultsLeft() {
  resultsLeaveFinished = true
  if (refreshTransitionPending && documentsLoading.value) return
  refreshTransitionPending = false
  if (!resultsVisible.value) revealLatestResults()
}
function finishRefreshTurn() {
  if (!documentsLoading.value) refreshSpinning.value = false
}
watch(reducedMotion, (reduced) => {
  if (reduced) refreshSpinning.value = false
})
const resultsVisible = ref(true)

function resultSnapshot() {
  let entryIndex = 0
  return {
    groups: contractGroups.value.map((group) => ({
      ...group,
      entryIndex: group.label ? entryIndex++ : 0,
      contracts: group.contracts.map((contract) => ({ ...contract, entryIndex: entryIndex++ })),
    })),
    emptyMessage: documentsLoading.value && !documentsLoaded.value ? '正在加载合同…' : documentsError.value || (documentModels.value.length ? '暂无匹配合同' : '暂无已入库合同'),
  }
}

const displayedResults = ref(resultSnapshot())

function resultEntryStyle(index) {
  return { '--result-entry-delay': `${Math.min(index * 45, 360)}ms` }
}

function markVisibleLeavingResults(element) {
  const viewport = resultsRef.value?.getBoundingClientRect()
  if (!viewport) return
  element.querySelectorAll('.contract-archive__item, .contract-archive__group-title, .contract-archive__empty').forEach((item) => {
    const bounds = item.getBoundingClientRect()
    item.classList.toggle('is-leaving-visible', bounds.bottom > viewport.top && bounds.top < viewport.bottom)
  })
}

function revealLatestResults() {
  displayedResults.value = resultSnapshot()
  if (resultsRef.value) resultsRef.value.scrollTop = 0
  resultsVisible.value = true
}

function updateMotionPreference(event) {
  reducedMotion.value = event.matches
}
motionPreference.addEventListener('change', updateMotionPreference)

function updateDateFilter(value) {
  selectedYear.value = value.year === null ? '' : String(value.year)
  selectedMonth.value = value.month ?? ''
  selectedDay.value = value.day ?? ''
}

async function loadCategories() {
  categoryController?.abort()
  const controller = new AbortController()
  categoryController = controller
  categoryLoading.value = true
  categoryError.value = ''
  try {
    const models = await getContractCategories({ signal: controller.signal })
    if (categoryController !== controller) return
    categoryModels.value = models
    if (!models.some((category) => category.categoryId === selectedCategoryId.value)) selectedCategoryId.value = null
  } catch (error) {
    if (categoryController !== controller || error?.name === 'AbortError') return
    categoryError.value = error instanceof TypeError ? '无法连接合同类别服务，请重试' : error.message || '合同类别加载失败'
  } finally {
    if (categoryController === controller) {
      categoryLoading.value = false
      categoryController = null
    }
  }
}

async function loadDocuments() {
  if (deletionPending.value) return
  documentController?.abort()
  const controller = new AbortController()
  documentController = controller
  documentsLoading.value = true
  documentsError.value = ''
  try {
    const models = await getContractDocuments({ signal: controller.signal })
    if (documentController !== controller) return
    pdfCache.retain(models.map(document => document.fileUri))
    documentModels.value = models
    documentsLoaded.value = true
    if (selectedYear.value && !models.some((document) => document.date?.startsWith(selectedYear.value))) {
      updateDateFilter({ year: null, month: null, day: null })
    }
  } catch (error) {
    if (documentController !== controller || error?.name === 'AbortError') return
    documentsError.value = error instanceof TypeError ? '无法连接合同目录服务，请重试' : error.message || '合同目录加载失败'
  } finally {
    if (documentController === controller) {
      documentsLoading.value = false
      documentController = null
    }
  }
}

watch(() => props.active, (active) => {
  if (!active) closePreview()
})

function updateCategoryEdgeFade() {
  const list = categoryListRef.value
  if (!list) return
  const maxScroll = Math.max(0, list.scrollWidth - list.clientWidth)
  const scrollLeft = Math.min(maxScroll, Math.max(0, list.scrollLeft))
  categoryEdgeFade.value = {
    left: Math.min(36, scrollLeft),
    right: Math.min(36, maxScroll - scrollLeft),
  }
}

watch(categoryListRef, (list) => {
  categoryResizeObserver?.disconnect()
  categoryResizeObserver = null
  if (!list) return
  categoryResizeObserver = new ResizeObserver(updateCategoryEdgeFade)
  categoryResizeObserver.observe(list)
  updateCategoryEdgeFade()
}, { flush: 'post' })

onMounted(async () => {
  await Promise.all([loadCategories(), loadDocuments()])
  if (!disposed) initialRequestsSettled.value = true
})

watch(initialRequestsSettled, async (settled) => {
  if (!settled || archiveReady.value || disposed) return
  await nextTick()
  if (disposed) return
  // 直接观察真实布局，不依赖可能在热更新或恢复时漏发的父级入场事件。
  let previousBounds = null
  let stableFrames = 0
  function checkLayout() {
    if (disposed) return
    const rect = archiveRef.value?.getBoundingClientRect()
    const bounds = rect && [rect.x, rect.y, rect.width, rect.height]
    if (rect?.width > 0 && rect?.height > 0 && previousBounds
      && bounds.every((value, index) => Math.abs(value - previousBounds[index]) < .1)) stableFrames++
    else stableFrames = 0
    previousBounds = bounds
    if (stableFrames >= 3) {
      updateCategoryEdgeFade()
      revealFrame = null
      archiveReady.value = true
      return
    }
    revealFrame = requestAnimationFrame(checkLayout)
  }
  revealFrame = requestAnimationFrame(checkLayout)
})
onBeforeUnmount(() => {
  disposed = true
  pdfCache.clear()
  if (revealFrame !== null) cancelAnimationFrame(revealFrame)
  closePreview()
  motionPreference.removeEventListener('change', updateMotionPreference)
  categoryResizeObserver?.disconnect()
  categoryController?.abort()
  categoryController = null
  documentController?.abort()
  documentController = null
})

watch(() => JSON.stringify(contractGroups.value), () => {
  if (refreshTransitionPending) return
  // 退场期间保留旧内容，结束时再读取最新筛选结果，避免快速切换闪现中间态。
  if (!archiveReady.value || reducedMotion.value) revealLatestResults()
  else resultsVisible.value = false
})
watch([documentsLoading, documentsError], () => {
  // 加载提示更新不重播整张列表；刷新期间保留已有内容与滚动位置。
  displayedResults.value.emptyMessage = resultSnapshot().emptyMessage
})
</script>

<template>
  <section ref="archiveRef" class="contract-archive" :class="{ 'is-ready': archiveReady }" :inert="!archiveReady" aria-label="合同档案">
    <div class="contract-archive__filters">
      <header class="contract-archive__header">
        <div class="contract-archive__title">
          <h2>合同档案</h2>
          <span v-if="documentsLoaded" class="contract-archive__count" role="status" :aria-label="`${selectedCategory?.name || '全部合同'}，${selectedTimeLabel}，${filteredContracts.length} 份合同`">{{ filteredContracts.length }} 份</span>
        </div>
        <button
          class="contract-archive__refresh"
          type="button"
          :disabled="documentsLoading || refreshSpinning"
          :aria-busy="documentsLoading"
          aria-label="刷新合同列表"
          :title="documentsLoading ? '正在刷新' : '刷新合同列表'"
          @click="refreshDocuments"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" :class="{ 'is-spinning': refreshSpinning }" @animationiteration="finishRefreshTurn">
            <path d="M19.52 14.74A8 8 0 1 1 18.13 6.86L20 9M20 4.5V9h-4.5" />
          </svg>
        </button>
      </header>

      <div v-if="categoryLoading" class="contract-archive__category-notice" role="status">正在加载合同类别…</div>
      <div v-else-if="categoryError" class="contract-archive__category-notice" role="alert">
        <span>{{ categoryError }}</span>
        <button type="button" @click="loadCategories">重试</button>
      </div>
      <div v-else-if="!categoryModels.length" class="contract-archive__category-notice" role="status">暂无合同类别</div>
      <div
        v-if="!categoryLoading && !categoryError"
        ref="categoryListRef"
        class="contract-archive__categories"
        :style="{ '--category-fade-left': `${categoryEdgeFade.left}px`, '--category-fade-right': `${categoryEdgeFade.right}px` }"
        role="group"
        aria-label="合同类型"
        @scroll.passive="updateCategoryEdgeFade"
      >
        <button
          v-for="category in categories"
          :key="category.categoryId ?? 'all'"
          class="contract-archive__folder"
          type="button"
          :aria-pressed="selectedCategoryId === category.categoryId"
          :aria-label="category.name"
          @click="selectedCategoryId = category.categoryId"
        >
          <span class="contract-archive__folder-papers" aria-hidden="true">
            <span v-for="paper in 3" :key="paper" class="contract-archive__folder-paper" :style="{ '--paper-index': paper - 1 }"></span>
          </span>
          <span class="contract-archive__folder-cover" aria-hidden="true"></span>
          <span class="contract-archive__folder-name">{{ category.name }}</span>
        </button>
      </div>

      <div class="contract-archive__time">
        <span class="contract-archive__time-label">签订时间</span>
        <ContractArchiveDateFilter :value="dateFilter" :years="years.map(Number)" @change="updateDateFilter" />
        <div class="contract-archive__reviewer-scope" role="radiogroup" aria-label="按入库审核员筛选">
          <label>
            <input v-model="reviewerScope" type="radio" name="archive-reviewer-scope" value="all" />
            <span>全部</span>
          </label>
          <label>
            <input v-model="reviewerScope" type="radio" name="archive-reviewer-scope" value="mine" />
            <span>我审核入库</span>
          </label>
        </div>
      </div>
    </div>

    <div ref="resultsRef" class="contract-archive__results" tabindex="0" aria-label="筛选后的合同列表" :aria-busy="documentsLoading">
      <div v-if="documentsError" class="contract-archive__category-notice" role="alert">
        <span>{{ documentsError }}{{ documentsLoaded ? '（当前保留上次加载的目录）' : '' }}</span>
        <button type="button" :disabled="documentsLoading" @click="loadDocuments">重试</button>
      </div>
      <Transition
        name="archive-results"
        :css="archiveReady && !reducedMotion"
        :duration="reducedMotion ? 0 : { enter: 880, leave: 220 }"
        @before-leave="markVisibleLeavingResults"
        @after-leave="onResultsLeft"
      >
      <div v-if="resultsVisible" class="contract-archive__result-content">
      <section v-for="group in displayedResults.groups" :key="group.key" class="contract-archive__group" :aria-label="group.label || undefined">
        <h3 v-if="group.label" class="contract-archive__group-title" :style="resultEntryStyle(group.entryIndex)">{{ group.label }}</h3>
        <ul class="contract-archive__list">
          <li v-for="contract in group.contracts" :key="contract.id" class="contract-archive__item" :style="resultEntryStyle(contract.entryIndex)">
            <button class="contract-archive__preview-trigger" type="button" :aria-label="`预览 ${contract.name}`" @click="openPreview(contract)"></button>
            <div class="contract-archive__info">
              <h4>{{ contract.name }}</h4>
              <p class="contract-archive__identity">
                <span class="contract-archive__category-tag">{{ contract.type }}</span>
                <span class="contract-archive__reviewer"><span>审核人</span>{{ contract.reviewer || '—' }}</span>
              </p>
            </div>
            <dl class="contract-archive__metadata">
              <div><dt>签署日期</dt><dd><time v-if="contract.date" :datetime="contract.date">{{ contract.date }}</time><span v-else>—</span></dd></div>
              <div><dt>入库日期</dt><dd><time :datetime="contract.ingestedAt">{{ formatIngestionDate(contract.ingestedAt) }}</time></dd></div>
            </dl>
          </li>
        </ul>
      </section>
      <div v-if="!displayedResults.groups.length && !documentsError" class="contract-archive__empty">
        <p>{{ displayedResults.emptyMessage }}</p>
      </div>
      </div>
      </Transition>
    </div>
  </section>
  <PdfPreviewOverlay
    controlled-reader
    show-pin
    :pinned="pinnedContractIds.includes(previewDocument?.id)"
    @pin="previewDocument && emit('pin-contract', previewDocument)"
    show-toolbar
    show-notes
    show-links
    :notes-saving="notesSaving || linksSaving"
    show-delete
    :open="active && Boolean(previewDocument)"
    :src="previewUrl"
    :label="previewDocument?.name || '合同'"
    :summary-document-id="previewDocument?.id || ''"
    :loading="previewLoading"
    :error="previewError"
    :deleting="deletionPending"
    :delete-error="deletionError"
    @delete="deletePreviewDocument"
    @close="closePreview"
    @retry="openPreview(previewDocument, { reload: true })"
  >
    <template #links="{ close }">
      <ContractLinksPanel v-if="previewDocument" :key="previewDocument.id" :document-id="previewDocument.id" :documents="contracts" @saving-change="linksSaving = $event" @close="close" />
    </template>
    <template #notes="{ close }">
      <ContractNotesPanel
        v-if="previewDocument"
        :document-id="previewDocument.id"
        :source="notesSource"
        @close="close"
        @saving-change="notesSaving = $event"
        :disabled="deletionPending"
      />
    </template>
  </PdfPreviewOverlay>
</template>

<style scoped>
.contract-archive {
  -webkit-user-select: none;
  user-select: none;
  opacity: 0;
  transition: opacity .65s ease;
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  color: #2b4236;
}
.contract-archive.is-ready { opacity: 1; }

.contract-archive__filters {

  flex: none;

  padding: 26px 28px 0;

}
.contract-archive__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 28px;
}
.contract-archive__header h2 {
  margin: 0;
  font-size: 23px;
  font-weight: 600;
  letter-spacing: 2px;
}
.contract-archive .contract-archive__refresh {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  padding: 0;
  color: #597563;
  border: 0;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 5px #253b3010, 0 5px 14px #253b3012;
  cursor: pointer;
  transition: box-shadow .2s, color .2s;
}
.contract-archive__refresh:disabled { cursor: default; }
.contract-archive__refresh:hover:not(:disabled) { color: #355442; box-shadow: 0 3px 7px #253b3014, 0 7px 18px #253b3018; }
.contract-archive__refresh:focus-visible { outline: 2px solid #719480; outline-offset: 3px; }
.contract-archive__refresh svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.contract-archive__refresh svg.is-spinning { animation: archive-refresh-turn .8s linear infinite; }
@keyframes archive-refresh-turn { to { transform: rotate(360deg); } }
.contract-archive__title {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.contract-archive button, .contract-archive select {
  font: inherit;
  color: inherit;
}
.contract-archive button {
  cursor: pointer;
}
.contract-archive button:focus-visible, .contract-archive select:focus-visible, .contract-archive__results:focus-visible {
  outline: 2px solid #5c8870;
  outline-offset: 3px;
}
.contract-archive__categories {
  --category-fade-left: 0px;
  --category-fade-right: 0px;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(145px, calc((100% - 42px) / 4));
  gap: 14px;
  overflow-x: auto;
  padding: 34px 4px 14px;
  margin-top: -20px;
  margin-bottom: 12px;
  scrollbar-width: thin;
  scrollbar-color: #b8c8bd transparent;
  -webkit-mask-image: linear-gradient(to right, transparent, #000 var(--category-fade-left), #000 calc(100% - var(--category-fade-right)), transparent);
  mask-image: linear-gradient(to right, transparent, #000 var(--category-fade-left), #000 calc(100% - var(--category-fade-right)), transparent);
}
.contract-archive__category-notice {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 70px;
  color: #677b6e;
  font-size: 13px;
}
.contract-archive__category-notice button {
  padding: 6px 12px;
  border: 1px solid #d2dccf;
  border-radius: 7px;
  background: #f1f5ee;
}
.contract-archive__folder {
  position: relative;
  isolation: isolate;
  perspective: 600px;
  min-width: 0;
  min-height: 80px;
  padding: 16px 13px 13px;
  text-align: left;
  background: linear-gradient(155deg, #fcfdf9 0%, #f1f5ee 55%, #e7eee4 100%);
  border: 1px solid #d2dccf;
  border-radius: 4px 13px 13px 13px;
  box-shadow:
    inset 0 1px 0 #ffffff,
    inset 1px 0 0 #ffffffb3,
    inset 0 -1px 0 #d6e0d1,
    0 4px 0 #ced8ca,
    0 5px 0 #b9c8b6,
    0 9px 12px -5px #415a3c36;
  transform: translateY(-2px);
  transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
}
.contract-archive__folder::before {
  position: absolute;
  top: -6px;
  left: -1px;
  width: 36%;
  height: 6px;
  content: '';
  background: linear-gradient(180deg, #fcfdf9, #f7faf3);
  border: 1px solid #d2dccf;
  border-bottom: 0;
  border-radius: 5px 6px 0 0;
  box-shadow: inset 0 1px 0 #ffffff;
  transition: border-color .2s ease;
}
.contract-archive__folder::after {
  position: absolute;
  z-index: -1;
  inset: 5px 6px 7px;
  content: '';
  pointer-events: none;
  border: 1px solid #ffffff80;
  border-radius: 3px 9px 9px 9px;
}
.contract-archive__folder-papers {
  position: absolute;
  z-index: 1;
  inset: 0;
  pointer-events: none;
}
.contract-archive__folder-paper {
  position: absolute;
  top: 9px;
  left: calc(13% + var(--paper-index) * 5%);
  width: 65%;
  height: 55px;
  background: linear-gradient(150deg, #fffefa, #eff2e9);
  border: 1px solid #ccd5c7;
  border-radius: 4px 4px 2px 2px;
  box-shadow: 0 -2px 5px #40563712;
  transform: translateY(0) rotate(0deg);
  transition: transform .42s cubic-bezier(.22, .8, .25, 1);
  transition-delay: calc(var(--paper-index) * 35ms);
}
.contract-archive__folder-paper::after {
  position: absolute;
  inset: 9px 10px auto;
  height: 12px;
  content: '';
  background: repeating-linear-gradient(to bottom, #c5d0bc80 0 1px, transparent 1px 5px);
}
.contract-archive__folder-cover {
  position: absolute;
  z-index: 2;
  inset: -1px;
  pointer-events: none;
  background: inherit;
  border: 1px solid #d2dccf;
  border-radius: inherit;
  box-shadow: inset 0 1px 0 #ffffff, inset 0 -2px 0 #d6e0d1, 0 -1px 3px #4056370d;
  transform-origin: center bottom;
  transform: rotateX(0deg);
  transition: transform .38s ease, box-shadow .38s ease, border-color .2s ease;
}
.contract-archive__folder[aria-pressed='true'] .contract-archive__folder-paper {
  transform: translateY(calc(-22px - var(--paper-index) * 5px)) rotate(calc(-5deg + var(--paper-index) * 5deg));
}
.contract-archive__folder[aria-pressed='true'] .contract-archive__folder-cover {
  transform: rotateX(-16deg);
  border-color: #8ea488;
  box-shadow: inset 0 1px 0 #f8fff1, inset 0 -2px 0 #b9cbb1, 0 -3px 6px #40563718;
}
.contract-archive__folder:hover:not([aria-pressed='true']) {
  transform: translateY(-4px);
  box-shadow:
    inset 0 1px 0 #ffffff,
    inset 1px 0 0 #ffffffb3,
    inset 0 -1px 0 #d6e0d1,
    0 5px 0 #ced8ca,
    0 6px 0 #b9c8b6,
    0 13px 16px -6px #415a3c40;
}
.contract-archive__folder[aria-pressed='true'] {
  background: linear-gradient(155deg, #e9f1e5, #dce8d7 58%, #d2dfcd);
  border-color: #8ea488;
  box-shadow:
    inset 0 2px 3px #57714a1c,
    inset 0 -1px 0 #ffffff9c,
    0 1px 0 #9caf95,
    0 2px 0 #829a7b,
    0 4px 6px -3px #415a3c30;
  transform: translateY(1px);
}
.contract-archive__folder[aria-pressed='true']::before {
  background: linear-gradient(180deg, #eaf2e5, #e5eedf);
  border-color: #8ea488;
}
.contract-archive__folder:active {
  transform: translateY(2px);
  box-shadow:
    inset 0 2px 4px #57714a26,
    inset 0 -1px 0 #ffffff80,
    0 1px 0 #9caf95,
    0 2px 3px #415a3c20;
}
.contract-archive__folder-name {
  position: relative;
  z-index: 3;
  font-size: 14px;
  font-weight: 600;
  display: block;
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.contract-archive__time {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  white-space: nowrap;
  overflow-x: auto;
  gap: 12px 20px;
  padding: 16px 0;
  border-top: 1px solid #dce4de;
  border-bottom: 1px solid #dce4de;
}
.contract-archive__time-label {
  flex: none;
  color: #677b6e;
  font-size: 12px;
}
.contract-archive__time :deep(.archive-date-filter) {
  flex: 0 0 340px;
}
/* From Uiverse.io by abdo_6865；两段式紧凑尺寸，保留原版选中配色。 */
.contract-archive__reviewer-scope {
  display: flex;
  flex: none;
  margin-left: auto;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.12);
  border-radius: 20px;
}
.contract-archive__reviewer-scope label {
  position: relative;
  padding: 10px 14px;
  cursor: pointer;
  background: linear-gradient(to bottom, #ffffff, #e9edf2);
  transition: 0.3s;
  font-weight: bold;
  font-size: 13px;
  color: #1a1a1a;
}
.contract-archive__reviewer-scope input {
  position: absolute;
  opacity: 0;
}
.contract-archive__reviewer-scope label:first-child:has(input:checked) {
  box-shadow:
    0 0 5px rgba(26, 123, 208, 0.2) inset,
    0 4px 12px rgba(0, 47, 255, 0.18),
    0 1px 0 rgba(255, 255, 255, 0.85) inset;
  background: linear-gradient(150deg, #ffffff, #c4dcfa);
  color: #1a7bd0;
}
.contract-archive__reviewer-scope label:first-child:hover {
  box-shadow:
    0 0 8px rgba(26, 123, 208, 0.25) inset,
    0 5px 14px rgba(0, 47, 255, 0.22),
    0 1px 0 rgba(255, 255, 255, 0.9) inset;
}
.contract-archive__reviewer-scope label:last-child:has(input:checked) {
  box-shadow:
    0 0 5px rgba(155, 89, 182, 0.2) inset,
    0 4px 12px rgba(155, 89, 182, 0.18),
    0 1px 0 rgba(255, 255, 255, 0.85) inset;
  background: linear-gradient(150deg, #fdf9ff, #edc9e4);
  color: #8e44ad;
}
.contract-archive__reviewer-scope label:last-child:hover {
  box-shadow:
    0 0 8px rgba(155, 89, 182, 0.25) inset,
    0 5px 14px rgba(142, 68, 173, 0.22),
    0 1px 0 rgba(255, 255, 255, 0.9) inset;
}
.contract-archive__reviewer-scope label:first-child {
  border-radius: 20px 0 0 20px;
}
.contract-archive__reviewer-scope label:last-child {
  border-radius: 0 20px 20px 0;
}
.contract-archive__reviewer-scope label:has(input:focus-visible) {
  outline: 2px solid #7867ab;
  outline-offset: 3px;
}
.contract-archive__count {
  flex: none;
  color: #6c7d72;
  font-size: 12px;
  font-weight: 400;
}
.contract-archive__results {
  flex: 1;
  min-height: 0;
  padding: 16px 28px 24px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #b8c8bd transparent;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
}
.archive-results-leave-active {
  pointer-events: none;
}
.archive-results-leave-active .is-leaving-visible {
  transition: opacity 220ms ease, transform 220ms cubic-bezier(.4, 0, 1, 1);
}
.archive-results-leave-to .is-leaving-visible {
  opacity: 0;
  transform: translateY(-22px);
}
.archive-results-enter-active .contract-archive__group-title,
.archive-results-enter-active .contract-archive__item,
.archive-results-enter-active .contract-archive__empty {
  animation: archive-result-rise 520ms cubic-bezier(.16, 1, .3, 1) both;
  animation-delay: var(--result-entry-delay, 0ms);
}
@keyframes archive-result-rise {
  from { opacity: 0; transform: translateY(28px); }
  to { opacity: 1; transform: translateY(0); }
}
.contract-archive__group + .contract-archive__group {
  margin-top: 22px;
}
.contract-archive__group-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 7px 0 11px;
  color: #728277;
  font-size: 12px;
  font-weight: 400;
}
.contract-archive__group-title::after {
  flex: 1;
  height: 1px;
  content: '';
  background: #dce4de;
}
.contract-archive__list {
  display: grid;
  gap: 9px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.contract-archive__item {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 12px 20px;
  background: linear-gradient(115deg, #f5f8f5 0%, #f0f5f2 58%, #eaf1ee 100%);
  border: 1px solid rgba(114, 144, 126, .2);
  border-radius: 13px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .9),
    inset 0 -1px 0 rgba(111, 140, 123, .04),
    0 2px 3px rgba(39, 67, 49, .025), 0 6px 16px -10px rgba(39, 67, 49, .16);
  transition: border-color 220ms ease, box-shadow 220ms ease;
}
.contract-archive__item::before {
  position: absolute;
  top: 19px;
  bottom: 19px;
  left: -1px;
  width: 2px;
  border-radius: 2px;
  background: linear-gradient(180deg, #b5c9ba, #819e8c);
  content: '';
  pointer-events: none;
}
.contract-archive__preview-trigger {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  border-radius: inherit;
  background: transparent;
  cursor: pointer;
}
.contract-archive__preview-trigger:focus-visible {
  outline: 2px solid #719480;
  outline-offset: 3px;
}
@media (hover: hover) {
  .contract-archive__item:hover {
    border-color: rgba(104, 142, 119, .4);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .95),
      0 3px 5px rgba(39, 67, 49, .035), 0 9px 20px -10px rgba(39, 67, 49, .19);
  }
}
.contract-archive__info {
  min-width: 0;
}
.contract-archive__info h4 {
  margin: 0;
  overflow-wrap: anywhere;
  color: #263f34;
  font-size: 15px;
  line-height: 1.55;
  font-weight: 600;
  letter-spacing: .15px;
}
.contract-archive__metadata {
  display: grid;
  gap: 4px;
  margin: 0;
}
.contract-archive__metadata > div {
  display: grid;
  grid-template-columns: auto 10ch;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}
.contract-archive__metadata dt {
  color: #718378;
  font-size: 11px;
  white-space: nowrap;
}
.contract-archive__metadata dd {
  margin: 0;
  color: #435d50;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: .3px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.contract-archive__identity {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 14px;
  margin: 5px 0 0;
  color: #526b5d;
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.contract-archive__category-tag {
  padding: 0 7px;
  color: #4e6d59;
  font-size: 11px;
  line-height: 20px;
  background: #e3ece4;
  border-radius: 5px;
  box-shadow: inset 0 0 0 1px rgba(106, 140, 115, .09);
}
.contract-archive__reviewer {
  display: inline-flex;
  gap: 6px;
  min-width: 0;
}
.contract-archive__reviewer > span {
  flex: none;
  color: #788a7e;
  font-size: 11px;
}
.contract-archive__item time {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.contract-archive__empty {
  padding: 44px 12px;
  text-align: center;
  color: #657b6c;
}
.contract-archive__empty p {
  margin: 12px 0 8px;
  font-size: 14px;
}

@container (max-width: 560px) {
  .contract-archive__filters {
    padding: 22px 18px 0;
  }
  .contract-archive__results {
    padding-inline: 18px;
  }
  .contract-archive__folder {
    padding-inline: 10px;
  }
  .contract-archive__item {
    padding: 12px 16px;
  }
}

@container (max-width: 410px) {
  .contract-archive__item {
    grid-template-columns: minmax(0, 1fr);
  }
  .contract-archive__metadata {
    justify-self: end;
  }
  .contract-archive__header h2 {
    font-size: 21px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .contract-archive__refresh { transition: none; }
  .contract-archive__refresh svg.is-spinning { animation: none; }
  .contract-archive { transition: none; }
  .contract-archive__item { transition: none; }
  .contract-archive__reviewer-scope label { transition: none; }
  .contract-archive__folder,
  .contract-archive__folder::before,
  .contract-archive__folder-paper,
  .contract-archive__folder-cover {
    transition: none;
  }
}
</style>
