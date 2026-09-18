<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getContractNetwork, getNetworkDocuments } from '../services/contractNetworkApi.js'
import ContractSummaryDetail from './ContractSummaryDetail.vue'
import sleepImage from '../assets/sleep.webp'

const props = defineProps({ active: { type: Boolean, default: true } })
const networkContainer = ref(null)
const sidebar = ref(null)
const resizeHandle = ref(null)
const sidebarWidth = ref(null)
const displayedSidebarWidth = ref(360)
const resizeBounds = ref({ min: 360, max: 360 })
const resizing = ref(false)
const stackedPanels = ref(false)
const SIDEBAR_MIN_WIDTH = 360
const GRAPH_MIN_WIDTH = 640
const RESIZE_KEYBOARD_STEP = 24
let layoutObserver, resizePointerId = null, resizePointerOffset = 0
const canvas = ref(null)
const query = ref('')
const searchOpen = ref(false)
const highlighted = ref(-1)
const network = ref(null)
const loading = ref(false)
const error = ref('')
const detail = ref(null)
const inspection = ref(null)
const history = ref([])
const ready = ref(false)
const networkContracts = ref([])
const catalogLoading = ref(false)
const refreshSpinning = ref(false)
const catalogLoaded = ref(false)
const catalogError = ref('')
let catalogController
const center = computed(() => network.value?.nodes.find(node => node.document_id === network.value.center_document_id))
const results = computed(() => {
  const term = query.value.trim() === center.value?.file_name ? '' : query.value.trim()
  return networkContracts.value.filter(node => node.file_name.includes(term))
})
const inspectedContract = computed(() => inspection.value?.type === 'contract'
  ? network.value?.nodes.find(node => node.document_id === inspection.value.id) : null)
const inspectedRelation = computed(() => inspection.value?.type === 'relation'
  ? network.value?.edges.find(edge => edge.relation_id === inspection.value.id) : null)
const inspectionKey = computed(() => JSON.stringify({
  contract: inspectedContract.value,
  relation: inspectedRelation.value,
  names: inspectedRelation.value ? [contractName(inspectedRelation.value.source_document_id), contractName(inspectedRelation.value.target_document_id)] : [],
}))
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
let scene, scenePromise, controller, observer, disposed = false
let requestVersion = 0
let lastRequestedId = ''

function updateResizeMetrics() {
  if (!props.active || !networkContainer.value) return
  const { width } = networkContainer.value.getBoundingClientRect()
  if (!width) return
  stackedPanels.value = width < SIDEBAR_MIN_WIDTH + GRAPH_MIN_WIDTH
  resizeBounds.value = { min: SIDEBAR_MIN_WIDTH, max: Math.max(SIDEBAR_MIN_WIDTH, width - GRAPH_MIN_WIDTH) }
  if (stackedPanels.value) { finishResize(); return }
  if (sidebarWidth.value !== null) sidebarWidth.value = clampSidebarWidth(sidebarWidth.value)
  displayedSidebarWidth.value = Math.round(sidebarWidth.value ?? sidebar.value?.getBoundingClientRect().width ?? SIDEBAR_MIN_WIDTH)
}
function clampSidebarWidth(width) { return Math.min(resizeBounds.value.max, Math.max(resizeBounds.value.min, width)) }
function startResize(event) {
  if (!props.active || event.button !== 0 || !event.isPrimary) return
  updateResizeMetrics()
  if (stackedPanels.value) return
  resizePointerOffset = sidebar.value.getBoundingClientRect().right - event.clientX
  resizePointerId = event.pointerId
  resizing.value = true
  event.currentTarget.setPointerCapture(event.pointerId)
  event.preventDefault()
}
function moveResize(event) {
  if (!resizing.value || event.pointerId !== resizePointerId) return
  const left = networkContainer.value.getBoundingClientRect().left
  sidebarWidth.value = clampSidebarWidth(event.clientX - left + resizePointerOffset)
  displayedSidebarWidth.value = Math.round(sidebarWidth.value)
}
function finishResize() {
  resizing.value = false
  const pointerId = resizePointerId
  resizePointerId = null
  if (pointerId !== null && resizeHandle.value?.hasPointerCapture(pointerId)) resizeHandle.value.releasePointerCapture(pointerId)
}
function resizeWithKeyboard(event) {
  if (!props.active || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  updateResizeMetrics()
  if (stackedPanels.value) return
  const current = sidebarWidth.value ?? sidebar.value.getBoundingClientRect().width
  const target = event.key === 'Home' ? resizeBounds.value.min : event.key === 'End' ? resizeBounds.value.max
    : current + (event.key === 'ArrowLeft' ? -RESIZE_KEYBOARD_STEP : RESIZE_KEYBOARD_STEP)
  event.preventDefault()
  sidebarWidth.value = clampSidebarWidth(target)
  displayedSidebarWidth.value = Math.round(sidebarWidth.value)
}

async function ensureScene() {
  if (scene) return scene
  if (scenePromise) return scenePromise
  scenePromise = (async () => {
    const { createContractNetworkScene } = await import('../services/contractNetworkScene.js')
    if (disposed) return
    scene = createContractNetworkScene(canvas.value, {
      reducedMotion,
      onSelect: id => void select(id),
      onInspectRelation: id => { inspection.value = { type: 'relation', id } },
      onDetail: value => { detail.value = value },
    })
    scene.setData(network.value)
    scene.setActive(props.active && !document.hidden)
    observer = new ResizeObserver(() => { if (props.active) scene?.resize() })
    observer.observe(canvas.value)
    ready.value = true
    return scene
  })().finally(() => { scenePromise = null })
  return scenePromise
}
async function initialize() {
  if (!catalogLoaded.value && !catalogLoading.value) void loadCatalog()
  try { await ensureScene(); if (!lastRequestedId) error.value = '' } catch { error.value = '无法加载三维视图，请重试' }
}
function refreshCatalog() {
  if (catalogLoading.value || loading.value || refreshSpinning.value) return
  refreshSpinning.value = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  void loadCatalog()
}
function finishRefreshTurn() {
  if (!catalogLoading.value) refreshSpinning.value = false
}
async function loadCatalog() {
  catalogController?.abort()
  const request = new AbortController()
  catalogController = request
  catalogLoading.value = true; catalogError.value = ''; highlighted.value = -1
  try {
    const documents = await getNetworkDocuments({ signal: request.signal })
    if (disposed || request !== catalogController) return
    networkContracts.value = documents; catalogLoaded.value = true
  } catch (reason) {
    if (reason.name !== 'AbortError' && request === catalogController) catalogError.value = reason instanceof TypeError ? '无法连接合同目录服务，请重试' : reason.message
  } finally {
    if (request === catalogController) catalogLoading.value = false
  }
}
async function select(id, goingBack = false, refresh = false) {
  searchOpen.value = false; highlighted.value = -1
  lastRequestedId = id
  controller?.abort()
  catalogController?.abort(); catalogController = null; catalogLoading.value = false
  const version = ++requestVersion
  if (!refresh && id === center.value?.document_id && !error.value) {
    loading.value = false; query.value = center.value.file_name
    inspection.value = { type: 'contract', id }
    scene?.clearRelationSelection()
    return
  }
  controller = new AbortController()
  loading.value = true; error.value = ''; detail.value = null
  try {
    const result = await getContractNetwork(id, networkContracts.value, { signal: controller.signal })
    const instance = await ensureScene()
    if (version !== requestVersion || disposed || !instance) return
    if (!goingBack && center.value && center.value.document_id !== id) history.value.push(center.value.document_id)
    if (goingBack) history.value.pop()
    networkContracts.value = result.documents; catalogLoaded.value = true; catalogError.value = ''
    network.value = result.network
    query.value = center.value?.file_name || ''
    inspection.value = { type: 'contract', id }
    instance.setData(result.network)
  } catch (reason) {
    if (reason.name !== 'AbortError' && version === requestVersion) {
      error.value = reason instanceof TypeError ? '无法连接合同目录服务，请重试' : reason.message || '关系网加载失败，请重试'
      query.value = center.value?.file_name || ''
    }
  } finally {
    if (version === requestVersion) loading.value = false
  }
}
async function searchKeydown(event) {
  if (event.isComposing) return
  if (event.key === 'Escape') { event.preventDefault(); closeSearch(); return }
  if (catalogLoading.value) return
  if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault(); searchOpen.value = true
    if (!results.value.length) return
    highlighted.value = highlighted.value < 0
      ? (event.key === 'ArrowDown' ? 0 : results.value.length - 1)
      : (highlighted.value + (event.key === 'ArrowDown' ? 1 : -1) + results.value.length) % results.value.length
    await nextTick()
    document.getElementById(`network-option-${highlighted.value}`)?.scrollIntoView({ block: 'nearest' })
  }
  if (event.key === 'Enter' && searchOpen.value) {
    event.preventDefault()
    const result = results.value[Math.max(0, highlighted.value)]
    if (result) void select(result.document_id)
  }
}
function closeSearch() {
  searchOpen.value = false; highlighted.value = -1
}
function contractName(id) { return network.value?.nodes.find(node => node.document_id === id)?.file_name || id }
function resetInspectorScroll(element) { element.parentElement.scrollTop = 0 }
function reset() {
  controller?.abort(); requestVersion++; loading.value = false
  network.value = null; query.value = ''; history.value = []; error.value = ''; detail.value = null
  inspection.value = null; searchOpen.value = false; highlighted.value = -1; lastRequestedId = ''
  scene?.setData(null)
}
function viewport(action) { scene?.viewport(action) }
function visibilityChanged() { scene?.setActive(props.active && !document.hidden) }
function retry() { lastRequestedId ? void select(lastRequestedId) : void initialize() }
function formatBeijingTime(value) {
  return value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '—'
}
watch(() => props.active, async active => {
  if (active) { await nextTick(); updateResizeMetrics(); await initialize(); scene?.resize(); if (props.active && center.value) await select(center.value.document_id, false, true) }
  else finishResize()
  visibilityChanged()
})
onMounted(() => {
  layoutObserver = new ResizeObserver(updateResizeMetrics)
  layoutObserver.observe(networkContainer.value)
  updateResizeMetrics()
  if (props.active) void initialize()
  document.addEventListener('visibilitychange', visibilityChanged)
})
onBeforeUnmount(() => { disposed = true; finishResize(); layoutObserver?.disconnect(); catalogController?.abort(); controller?.abort(); observer?.disconnect(); scene?.destroy(); document.removeEventListener('visibilitychange', visibilityChanged) })
</script>

<template>
  <section ref="networkContainer" class="contract-network" :class="{ 'has-network': network, 'is-resizing': resizing, 'is-stacked': stackedPanels }" :style="sidebarWidth === null ? {} : { '--network-sidebar-width': `${sidebarWidth}px` }" aria-label="合同关系网">
    <aside ref="sidebar" class="network-sidebar" aria-label="合同选择与详情">
      <div class="network-selector">
        <div class="network-selector-heading"><label class="network-section-label" for="network-contract-search">{{ center ? '当前中心合同' : '选择一份中心合同' }}</label><button class="network-refresh" type="button" :disabled="catalogLoading || loading || refreshSpinning" :aria-busy="catalogLoading" aria-label="刷新合同列表" :title="catalogLoading ? '正在刷新' : '刷新合同列表'" @click="refreshCatalog"><svg viewBox="0 0 24 24" aria-hidden="true" :class="{ 'is-spinning': refreshSpinning }" @animationiteration="finishRefreshTurn" @animationcancel="refreshSpinning = false"><path d="M19.52 14.74A8 8 0 1 1 18.13 6.86L20 9M20 4.5V9h-4.5" /></svg></button></div>
        <div class="network-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
          <input id="network-contract-search" v-model="query" autocomplete="off" aria-label="搜索合同名称" role="combobox" aria-autocomplete="list" :aria-expanded="searchOpen" aria-controls="network-search-results" :aria-activedescendant="searchOpen && highlighted >= 0 ? `network-option-${highlighted}` : undefined" :title="center?.file_name" placeholder="输入合同名称" @focus="searchOpen = true" @click="searchOpen = true" @blur="closeSearch" @input="searchOpen = true; highlighted = -1" @keydown="searchKeydown" />
          <button v-if="network || query || loading" class="network-clear" aria-label="清除选择并回到待机" title="回到待机" @pointerdown.prevent @click="reset">×</button>
          <div v-if="searchOpen" id="network-search-results" class="network-results" role="listbox" @pointerdown.prevent>
            <p v-if="catalogLoading" role="status">正在加载合同列表…</p>
            <template v-else>
              <button v-for="(item, index) in results" :id="`network-option-${index}`" :key="item.document_id" type="button" role="option" :aria-selected="highlighted === index" tabindex="-1" @click="select(item.document_id)"><span>{{ item.file_name }}</span><small>{{ item.category }}</small></button>
              <p v-if="!results.length">{{ catalogError ? '合同列表加载失败' : networkContracts.length ? '未找到匹配的合同' : '暂无可选合同' }}</p>
            </template>
          </div>
        </div>
        <p v-if="catalogError" class="network-catalog-error" role="alert">{{ catalogError }}<button :disabled="catalogLoading || loading" @click="loadCatalog">重试</button></p>
        <div class="network-trail" :class="{ 'is-placeholder': !network }" :aria-hidden="!network">
          <button :disabled="!network || !history.length || loading" title="返回上一个中心合同" aria-label="返回上一个中心合同" @click="select(history.at(-1), true)"><span aria-hidden="true">←</span> 返回</button>
          <span>{{ network ? network.nodes.length - 1 : 0 }} 份关联合同</span>
        </div>
      </div>
      <section class="network-inspector" aria-label="所选对象详情" aria-live="polite">
        <Transition name="network-inspector-swap" mode="out-in" appear @enter="resetInspectorScroll">
          <div :key="inspectionKey" class="network-inspector-view">
            <div class="network-inspector-heading"><span class="network-section-label">{{ inspectedRelation ? '关联详情' : inspectedContract ? '合同信息' : '详细信息' }}</span><span v-if="inspectedContract" class="network-kind">合同</span><span v-else-if="inspectedRelation" class="network-kind">关联</span></div>
            <div v-if="inspectedContract" :key="inspectedContract.document_id" class="network-inspector-content">
              <h2>{{ inspectedContract.file_name }}</h2>
              <dl class="network-metadata">
                <div><dt>合同摘要</dt><dd><ContractSummaryDetail :document-id="inspectedContract.document_id" :active="active" /></dd></div>
                <div><dt>合同类别</dt><dd>{{ inspectedContract.category || '—' }}</dd></div>
                <div><dt>审核人</dt><dd>{{ inspectedContract.reviewer || '—' }}</dd></div>
                <div><dt>签署日期</dt><dd>{{ inspectedContract.date || '—' }}</dd></div>
                <div><dt>入库时间（北京时间）</dt><dd>{{ formatBeijingTime(inspectedContract.ingestedAt) }}</dd></div>
              </dl>
            </div>
            <div v-else-if="inspectedRelation" :key="inspectedRelation.relation_id" class="network-inspector-content">
              <div class="network-related-contracts">
                <p>{{ contractName(inspectedRelation.source_document_id) }}</p>
                <p>{{ contractName(inspectedRelation.target_document_id) }}</p>
              </div>
              <dl class="network-metadata">
                <div><dt>关系说明</dt><dd class="network-relation-description">{{ inspectedRelation.description || '暂无说明' }}</dd></div>
                <div><dt>创建人</dt><dd>{{ inspectedRelation.created_by }}</dd></div>
                <div><dt>创建时间（北京时间）</dt><dd>{{ formatBeijingTime(inspectedRelation.created_at) }}</dd></div>
              </dl>
            </div>
            <div v-else class="network-inspector-empty">
              <img :src="sleepImage" alt="暂无详情" width="80" height="80" draggable="false" />
              <p>选择合同或关联，查看详情</p>
            </div>
          </div>
        </Transition>
      </section>
      <button
        v-if="!stackedPanels"
        ref="resizeHandle"
        class="network-resize-handle"
        type="button"
        role="separator"
        aria-label="调整关系网左栏宽度"
        aria-orientation="vertical"
        :aria-valuemin="Math.round(resizeBounds.min)"
        :aria-valuemax="Math.round(resizeBounds.max)"
        :aria-valuenow="displayedSidebarWidth"
        :aria-valuetext="`左栏宽度 ${displayedSidebarWidth} 像素`"
        @pointerdown="startResize"
        @pointermove="moveResize"
        @pointerup="finishResize"
        @pointercancel="finishResize"
        @lostpointercapture="finishResize"
        @keydown="resizeWithKeyboard"
      ><span aria-hidden="true"></span></button>
    </aside>
    <div class="network-stage" aria-label="关系网视图">
      <div ref="canvas" class="network-canvas" :class="{ 'is-ready': ready, 'is-idle': !network }" aria-label="三维合同关联图"></div>
      <Transition name="network-detail"><aside v-if="detail" class="network-detail"><strong>{{ detail.title }}</strong></aside></Transition>
      <div v-if="loading || (!ready && !error)" class="network-loading" role="status" aria-label="正在加载关系网"><i></i></div>
      <div v-if="error" class="network-error" role="alert">{{ error }}<button @click="retry">重试</button></div>
      <p v-if="network && network.nodes.length === 1 && !loading" class="network-empty">暂无关联合同</p>
      <div v-if="network" class="network-tools"><button aria-label="放大关系网" title="放大" @click="viewport(1.2)">＋</button><button aria-label="缩小关系网" title="缩小" @click="viewport(1 / 1.2)">−</button><span></span><button aria-label="重置视角" title="重置视角" @click="viewport('fit')">⛶</button></div>
    </div>
  </section>
</template>

<style scoped>
.contract-network { display: grid; grid-template-columns: minmax(360px, var(--network-sidebar-width, 360px)) minmax(640px, 1fr); position: relative; height: 100%; overflow: hidden; color: #355448; background: #f6f9f7; }
.contract-network.is-resizing, .contract-network.is-resizing * { cursor: col-resize !important; user-select: none; }
.contract-network.is-resizing .network-stage { pointer-events: none; }
.network-sidebar { position: relative; display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; min-height: 0; background: #fafcfbe8; z-index: 3; }
.network-sidebar::after {
  position: absolute; z-index: 9; top: 0; right: 0; bottom: 0; width: 4px; content: ''; pointer-events: none;
  background: linear-gradient(180deg, transparent, #ffffffb8 8%, #ffffffb8 92%, transparent) 1px 0 / 1px 100% no-repeat, linear-gradient(90deg, #81968b24 0%, #ffffffdc 42%, #f8fffca3 58%, #8ba0951f 100%);
  box-shadow: -1px 0 0 #72877d12, 2px 0 8px #728c801c; opacity: .88;
  mask: linear-gradient(180deg, #000 0, #000 calc(50% - 34px), transparent calc(50% - 34px), transparent calc(50% + 34px), #000 calc(50% + 34px), #000 100%);
}
.network-resize-handle { position: absolute; z-index: 10; top: 50%; right: -7px; display: flex; align-items: center; justify-content: center; width: 18px; height: 82px; padding: 0; color: #6d7d75; cursor: col-resize; touch-action: none; background: transparent; border: 0; outline: 0; transform: translateY(-50%); }
.network-resize-handle span { width: 8px; height: 38px; background: linear-gradient(180deg, #7b70c3, #579a84); border: 1px solid #ffffffb8; border-radius: 999px; box-shadow: inset 1px 0 #ffffff5c, 0 0 0 transparent; opacity: .42; transition: width .22s, height .34s cubic-bezier(.16, 1, .3, 1), opacity .2s, box-shadow .26s, transform .26s cubic-bezier(.16, 1, .3, 1); }
.network-resize-handle:hover span, .network-resize-handle:focus-visible span, .is-resizing .network-resize-handle span { width: 10px; height: 46px; box-shadow: inset 1px 0 #ffffff8c, 0 0 10px #7168c35c, 0 0 18px #559a8442; opacity: .92; transform: scaleX(1.08); }
.network-resize-handle:active span, .is-resizing .network-resize-handle span { height: 50px; opacity: 1; }
.contract-network .network-resize-handle:focus-visible { outline: 0; }
.network-selector { position: relative; z-index: 2; padding: 34px 24px 24px; }
.network-section-label { display: block; color: #71877b; font-size: 11px; font-weight: 500; letter-spacing: .08em; }
.network-selector-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; min-height: 34px; }
.network-refresh { display: grid; place-items: center; flex: none; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 50%; background: #fff; color: #597563; box-shadow: 0 2px 5px #253b3010, 0 5px 14px #253b3012; cursor: pointer; transition: box-shadow .2s, color .2s; }
.network-refresh:disabled { cursor: default; }
.network-refresh:hover:not(:disabled) { color: #355442; box-shadow: 0 3px 7px #253b3014, 0 7px 18px #253b3018; }
.contract-network .network-refresh:focus-visible { outline: 2px solid #719480; outline-offset: 3px; }
.network-refresh svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.network-refresh svg.is-spinning { animation: network-spin .8s linear infinite; }

.network-catalog-error { margin: 12px 0 0; font-size: 11px; line-height: 1.7; color: #a36353; }.network-catalog-error button { margin-left: 6px; border: 0; background: transparent; color: inherit; text-decoration: underline; cursor: pointer; }
.network-search { display: flex; position: relative; align-items: center; gap: 10px; margin-top: 20px; padding: 0 12px; height: 46px; background: #fff; border: 1px solid #d9e4dc; border-radius: 12px; box-shadow: 0 4px 18px #365e5005; transition: border-color .18s, box-shadow .18s; }
.network-search:focus-within { border-color: #92b19e; box-shadow: 0 0 0 3px #71967f0d; }
.network-search > svg { width: 16px; height: 16px; fill: none; stroke: #779687; stroke-width: 1.6; flex-shrink: 0; }
.network-search input { width: 100%; min-width: 0; border: 0; background: transparent; outline: none; color: #355448; font: inherit; font-size: 12px; text-overflow: ellipsis; }
.network-search input::placeholder { color: #899d90; }
.network-clear { flex-shrink: 0; width: 24px; height: 24px; border: 0; border-radius: 6px; background: transparent; color: #81998b; cursor: pointer; font-size: 18px; line-height: 1; }.network-clear:hover { background: #eef3ef; color: #355448; }
.network-results { position: absolute; z-index: 5; top: 54px; left: 0; right: 0; padding: 6px; border: 1px solid #dce6df; border-radius: 12px; background: #fcfefcf5; backdrop-filter: blur(18px); box-shadow: 0 14px 32px #244b361a; max-height: min(320px, 50vh); overflow: auto; }
.network-results button { display: flex; flex-direction: column; gap: 5px; width: 100%; padding: 11px 10px; border: 0; background: transparent; color: #466252; text-align: left; border-radius: 8px; font: inherit; font-size: 12px; line-height: 1.6; cursor: pointer; }
.network-results button:hover, .network-results button[aria-selected=true] { background: #eaf1eb; }.network-results button small { color: #87998c; font-size: 10px; }.network-results p { padding: 10px; font-size: 12px; color: #8b9c90; }
.network-trail { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 15px; }
.network-trail.is-placeholder { visibility: hidden; pointer-events: none; }
.network-trail > span { font-size: 11px; color: #84968b; }.network-trail button { display: flex; align-items: center; gap: 7px; padding: 5px 7px; margin-left: -7px; border: 0; border-radius: 6px; background: transparent; color: #557762; font: inherit; font-size: 11px; cursor: pointer; }.network-trail button > span { font-size: 16px; }.network-trail button:disabled { opacity: .3; cursor: default; }.network-trail button:not(:disabled):hover { background: #edf3ee; }
.network-inspector { display: flex; flex-direction: column; min-height: 0; padding: 25px 24px; border-top: 1px solid #e2e9e4; overflow: auto; scrollbar-width: thin; scrollbar-color: #c6d5ca transparent; }
.network-inspector-view { display: flex; flex-direction: column; flex: 1 0 auto; }
.network-inspector-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 22px; margin-bottom: 27px; }
.network-kind { padding: 3px 7px; border-radius: 5px; background: #eaf0ec; color: #738b7b; font-size: 10px; }
.network-inspector-swap-enter-active { transition: opacity .38s ease-out; }
.network-inspector-swap-leave-active { transition: opacity .2s ease-in; pointer-events: none; }
.network-inspector-swap-enter-from, .network-inspector-swap-leave-to { opacity: 0; }
.network-inspector-content h2 { margin: 0 0 25px; font-size: 17px; line-height: 1.7; color: #345343; font-weight: 500; overflow-wrap: anywhere; }
.network-metadata { display: grid; gap: 24px; margin: 0; }.network-metadata dt { font-size: 11px; color: #85968c; margin-bottom: 9px; }.network-metadata dd { margin: 0; color: #4e6558; font-size: 12px; line-height: 1.9; overflow-wrap: anywhere; }
.network-relation-description { white-space: pre-wrap; }
.network-related-contracts { margin: 0 0 27px; padding-left: 20px; position: relative; }.network-related-contracts::before { position: absolute; content: ''; top: 10px; bottom: 10px; left: 3px; border-left: 1px solid #cbd9cf; }.network-related-contracts p { position: relative; margin: 0; font-size: 12px; line-height: 1.8; color: #52705e; overflow-wrap: anywhere; }.network-related-contracts p + p { margin-top: 17px; }.network-related-contracts p::before { content: ''; position: absolute; width: 5px; height: 5px; top: 7px; left: -19px; border-radius: 50%; background: #7a9a86; box-shadow: 0 0 0 3px #fafcfb; }
.network-inspector-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; padding: 16px 0; text-align: center; color: #91a197; }.network-inspector-empty img { display: block; width: 80px; height: 80px; margin: 0 auto; object-fit: contain; opacity: .72; }.network-inspector-empty p { margin: 17px 0; font-size: 11px; line-height: 1.8; }
.network-stage { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: radial-gradient(ellipse at 50% 55%, #e7f0e9b3, #f8faf9e8 72%); }
.network-canvas { position: absolute; inset: 0; opacity: 0; transition: opacity .7s; cursor: grab; }.network-canvas.is-ready { opacity: 1; }.network-canvas.is-idle { opacity: .7; cursor: default; }
.network-detail { position: absolute; z-index: 4; bottom: 60px; left: 24px; max-width: min(330px, calc(100% - 120px)); padding: 14px 16px; border: 1px solid #dbe6dd; border-radius: 12px; background: #fffffff0; box-shadow: 0 10px 30px #365e5010; pointer-events: none; backdrop-filter: blur(12px); }.network-detail strong { font-size: 13px; font-weight: 500; }
.network-detail-enter-active, .network-detail-leave-active { transition: opacity .18s, transform .18s; }.network-detail-enter-from, .network-detail-leave-to { opacity: 0; transform: translateY(5px); }
.network-loading { position: absolute; z-index: 6; left: 50%; top: 28px; transform: translateX(-50%); background: #ffffffed; padding: 10px; border-radius: 50%; }.network-loading i { display: block; width: 17px; height: 17px; border: 1.5px solid #d5e3d9; border-top-color: #60806a; border-radius: 50%; animation: network-spin .8s linear infinite; }
.network-error, .network-empty { position: absolute; bottom: 55px; left: 50%; transform: translateX(-50%); color: #819788; font-size: 12px; text-align: center; }.network-error { color: #a36353; z-index: 6; }.network-error button { margin-left: 8px; cursor: pointer; }
.network-tools { position: absolute; bottom: 30px; right: 24px; display: flex; flex-direction: column; padding: 5px; border-radius: 12px; border: 1px solid #dce7df; background: #ffffffd9; backdrop-filter: blur(12px); }.network-tools button { width: 31px; height: 31px; padding: 0; border: 0; border-radius: 7px; background: transparent; color: #6e8979; font-size: 19px; cursor: pointer; }.network-tools button:hover { background: #edf3ee; }.network-tools > span { height: 1px; margin: 4px; background: #e3ebe5; }
.contract-network button:focus-visible { outline: 2px solid #789e88; outline-offset: 2px; }
@keyframes network-spin { to { transform: rotate(360deg); } }
.contract-network.is-stacked { grid-template-columns: 1fr; grid-template-rows: minmax(200px, 38%) minmax(0, 1fr); }
.is-stacked .network-sidebar { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
.is-stacked .network-sidebar::after { top: auto; left: 0; width: auto; height: 4px; background: linear-gradient(90deg, transparent, #ffffffb8 8%, #ffffffb8 92%, transparent) 0 1px / 100% 1px no-repeat, linear-gradient(180deg, #81968b24 0%, #ffffffdc 42%, #f8fffca3 58%, #8ba0951f 100%); box-shadow: 0 -1px 0 #72877d12, 0 2px 8px #728c801c; mask: none; }
.is-stacked .network-inspector { border-top: 0; border-left: 1px solid #e2e9e4; }
@media (max-width: 1000px) { .network-selector { padding: 25px 18px; }.network-inspector { padding: 22px 18px; }.network-tools { right: 16px; } }
@media (max-width: 640px) { .network-selector { padding: 20px 12px; }.network-inspector { padding: 20px 14px; }.network-inspector-heading { margin-bottom: 14px; }.network-inspector-content h2 { font-size: 13px; margin-bottom: 15px; }.network-search { gap: 6px; padding: 0 8px; }.network-search > svg { display: none; }.network-trail { align-items: flex-start; gap: 5px; flex-direction: column; }.network-tools { bottom: 16px; }.network-results { max-height: 210px; } }
@media (prefers-reduced-motion: reduce) { .network-refresh svg.is-spinning { animation: none; } *, *::before { transition: none !important; }.network-loading i { animation-duration: 1.6s; } }
</style>
