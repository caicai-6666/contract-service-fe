<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { getContractRelations } from '../services/contractNetworkApi.js'
import { getContractDocuments } from '../services/contractLibraryApi.js'
import { createContractRelation, deleteContractRelation } from '../services/contractRelationsApi.js'
import linkIcon from '../assets/link.webp'
import TruncatedText from './TruncatedText.vue'
const props = defineProps({ documentId: { type: String, required: true }, documents: { type: Array, required: true } })
const emit = defineEmits(['close', 'saving-change'])
const links = ref([])
const availableDocuments = ref([])
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const deleting = ref(false)
const deleteError = ref('')
const busy = computed(() => saving.value || deleting.value)
const descriptionLength = computed(() => Array.from(description.value.trim()).length)
let listController
let disposed = false
watch(busy, value => emit('saving-change', value), { flush: 'sync' })
async function loadLinks() {
  if (busy.value) return
  closeSearch()
  listController?.abort()
  const request = new AbortController()
  listController = request
  loading.value = true; loadError.value = ''
  try {
    const records = await getContractRelations(props.documentId, { signal: request.signal })
    let documents = props.documents
    if (records.some(record => !documents.some(document => document.id === record.document_id))) {
      documents = await getContractDocuments({ signal: request.signal })
    }
    if (disposed || request !== listController) return
    if (records.some(record => !documents.some(document => document.id === record.document_id))) {
      throw new Error('刷新目录后仍缺少关联合同，可能已删除，请重试')
    }
    availableDocuments.value = documents
    links.value = records.map(record => ({ ...record, file_name: documents.find(document => document.id === record.document_id).name }))
  } catch (error) {
    if (!disposed && request === listController && error.name !== 'AbortError') loadError.value = error.message || '关联加载失败，请重试'
  } finally {
    if (!disposed && request === listController) loading.value = false
  }
}
const panel = ref(null)
const searchInput = ref(null)
const editing = ref(false)
const keyword = ref('')
const searchOpen = ref(false)
const searchResults = ref(null)
const searchListId = useId()
const activeIndex = ref(-1)
const searchPosition = ref({})
function closeSearch() {
  searchOpen.value = false
  activeIndex.value = -1
  searchResults.value?.hidePopover()
}
async function showSearch() {
  if (!keyword.value.trim()) return closeSearch()
  searchOpen.value = true
  await nextTick()
  if (!searchOpen.value || !searchResults.value) return
  const rect = searchInput.value.getBoundingClientRect()
  searchPosition.value = { left: `${rect.left}px`, top: `${rect.bottom + 6}px`, width: `${rect.width}px`, maxHeight: `${Math.max(60, Math.min(180, window.innerHeight - rect.bottom - 18))}px` }
  searchResults.value.showPopover()
}
function searchChanged() {
  selectedId.value = ''; formError.value = ''; activeIndex.value = -1
  void showSearch()
}
function selectDocument(document) {
  selectedId.value = document.id
  keyword.value = document.name
  formError.value = ''
  closeSearch()
}
async function searchKeydown(event) {
  if (event.isComposing) return
  if (event.key === 'Escape' && searchOpen.value) {
    event.stopPropagation(); event.preventDefault(); closeSearch(); return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    if (searchOpen.value && matches.value[activeIndex.value]) selectDocument(matches.value[activeIndex.value])
    return
  }
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
  event.preventDefault()
  await showSearch()
  if (!searchOpen.value || !matches.value.length) return
  activeIndex.value = activeIndex.value < 0
    ? (event.key === 'ArrowDown' ? 0 : matches.value.length - 1)
    : (activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + matches.value.length) % matches.value.length
  await nextTick()
  searchResults.value?.children[activeIndex.value]?.scrollIntoView({ block: 'nearest' })
}
function onScroll(event) { if (!searchResults.value?.contains(event.target)) closeSearch() }
window.addEventListener('scroll', onScroll, true)
window.addEventListener('resize', closeSearch)
onBeforeUnmount(() => { disposed = true; listController?.abort(); emit('saving-change', false); closeSearch(); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', closeSearch) })
const selectedId = ref('')
const description = ref('')
const formError = ref('')
const deleteTarget = ref(null)
const dialog = ref(null)
const cancelButton = ref(null)
let deleteTrigger
const matches = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase()
  return availableDocuments.value.filter(document => document.id !== props.documentId
    && !links.value.some(link => link.document_id === document.id)
    && (!query || document.name.toLocaleLowerCase().includes(query)))
})
const selected = computed(() => availableDocuments.value.find(document => document.id === selectedId.value))
async function startAdding() {
  if (loading.value || loadError.value || busy.value) return
  editing.value = true
  await nextTick()
  searchInput.value?.focus({ preventScroll: true })
}
function cancelAdding() {
  if (busy.value) return
  closeSearch()
  editing.value = false
  keyword.value = ''; selectedId.value = ''; description.value = ''; formError.value = ''
  panel.value?.focus()
}
async function add() {
  if (busy.value || loading.value || loadError.value) return
  if (!selected.value || selected.value.id === props.documentId || links.value.some(link => link.document_id === selectedId.value)) {
    formError.value = '请选择一份尚未关联的合同'; return
  }
  if (!descriptionLength.value || descriptionLength.value > 10000) { formError.value = '关联描述须为 1–10000 字'; return }
  const target = selected.value
  closeSearch(); saving.value = true; formError.value = ''
  try {
    const record = await createContractRelation({ document_id_a: props.documentId, document_id_b: target.id, description: description.value })
    if (disposed) return
    links.value = [{ ...record, document_id: target.id, file_name: target.name }, ...links.value]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a.relation_id.localeCompare(b.relation_id))
    saving.value = false
    cancelAdding()
  } catch (error) {
    if (!disposed) formError.value = error.message || '新增失败，请重试'
  } finally { saving.value = false }
}
async function requestDelete(link, event) {
  if (busy.value || loading.value || loadError.value) return
  deleteError.value = ''; deleteTarget.value = link; deleteTrigger = event.currentTarget
  await nextTick(); dialog.value?.showModal(); cancelButton.value?.focus()
}
function cancelDelete() { if (busy.value) return; dialog.value?.close(); deleteTarget.value = null; deleteTrigger?.focus() }
async function remove() {
  if (busy.value || !deleteTarget.value) return
  deleting.value = true; deleteError.value = ''
  try {
    await deleteContractRelation(deleteTarget.value.relation_id)
    if (disposed) return
    links.value = links.value.filter(link => link.relation_id !== deleteTarget.value.relation_id)
    dialog.value?.close(); deleteTarget.value = null; panel.value?.focus()
  } catch (error) {
    if (!disposed) deleteError.value = error.message || '删除失败，请重试'
  } finally { deleting.value = false }
}
watch(() => props.documentId, () => { links.value = []; cancelAdding(); void loadLinks() }, { immediate: true })
function formatTime(value) {
  return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}
function escape(event) {
  if (busy.value) { event.preventDefault(); event.stopPropagation(); return }
  if (!editing.value || event.isComposing) return
  event.preventDefault(); event.stopPropagation(); cancelAdding()
}
</script>

<template>
  <aside ref="panel" class="contract-links" tabindex="-1" aria-label="合同关联" @keydown.esc="escape">
    <header class="contract-links__header">
      <div><img :src="linkIcon" alt="" /><h2>合同关联</h2><small>{{ links.length }}</small></div>
      <div class="contract-links__header-actions"><button v-if="!editing" type="button" aria-label="新增关联" title="新增关联" :disabled="loading || !!loadError || busy" @click="startAdding">＋</button><button type="button" aria-label="收起合同关联" title="收起合同关联" :disabled="busy" @click="$emit('close')">×</button></div>
    </header>
    <div class="contract-links__body">
      <p v-if="loading" class="contract-links__empty" role="status"><i class="contract-links__spinner"></i> 正在加载关联…</p>
      <p v-else-if="loadError" class="contract-links__error" role="alert">{{ loadError }} <button type="button" @click="loadLinks">重试</button></p>
      <p v-else-if="!links.length" class="contract-links__empty">暂无关联，点击右上角“＋”添加。</p>
      <ol v-else>
        <li v-for="(link, index) in links" :key="link.relation_id">
          <span class="contract-links__number">{{ String(index + 1).padStart(2, '0') }}</span>
          <div class="contract-links__item">
            <TruncatedText class="contract-links__name" :text="link.file_name" />
            <TruncatedText class="contract-links__description" :text="link.description" :lines="3" />
            <div class="contract-links__item-footer">
              <div class="contract-links__meta">
                <div class="contract-links__meta-row"><span>创建人：</span><TruncatedText class="contract-links__author" :text="link.created_by" /></div>
                <div class="contract-links__meta-row"><span>创建时间：</span><time :datetime="link.created_at"><TruncatedText :text="formatTime(link.created_at)" /></time></div>
              </div>
            <button type="button" class="contract-links__delete" :aria-label="`删除与${link.file_name}的关联`" title="删除关联" :disabled="busy" @click="requestDelete(link, $event)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg></button>
            </div>
          </div>
        </li>
      </ol>
    </div>
    <div class="contract-links__reveal" :class="{ 'is-expanded': editing }" :inert="!editing" :aria-hidden="!editing">
      <div class="contract-links__clip">
        <form @submit.prevent="add">
          <h3>新增关联</h3>
          <label>关联文件 <b>必填</b><input ref="searchInput" v-model="keyword" :disabled="busy" type="search" role="combobox" aria-autocomplete="list" :aria-controls="searchListId" :aria-expanded="searchOpen" :aria-activedescendant="searchOpen && activeIndex >= 0 ? `${searchListId}-${activeIndex}` : undefined" autocomplete="off" placeholder="输入关键词搜索合同名称" @input="searchChanged" @focus="showSearch" @blur="closeSearch" @keydown="searchKeydown" /></label>
          <div :id="searchListId" ref="searchResults" popover="manual" class="contract-links__results" role="listbox" aria-label="关联文件搜索结果" :style="searchPosition" @pointerdown.prevent>
            <p v-if="!matches.length" role="status">未找到可关联的合同</p>
            <button v-for="(document, index) in matches" :id="`${searchListId}-${index}`" :key="document.id" type="button" role="option" tabindex="-1" :aria-selected="activeIndex === index || selectedId === document.id" :title="document.name" @click="selectDocument(document)"><span>{{ document.name }}</span><i v-if="selectedId === document.id">✓</i></button>
          </div>
          <label>关联描述 <b>必填</b><textarea v-model="description" :disabled="busy" rows="3" placeholder="说明两份合同之间的关系…" @input="formError = ''"></textarea></label>
          <p class="contract-links__count" :class="{ 'contract-links__error': descriptionLength > 10000 }">{{ descriptionLength }} / 10000</p>
          <p v-if="formError" class="contract-links__error" role="alert">{{ formError }}</p>
          <footer><button type="button" :disabled="busy" @click="cancelAdding">取消</button><button type="submit" class="contract-links__submit" :disabled="busy || loading || !!loadError || !selectedId || !descriptionLength || descriptionLength > 10000"><i v-if="saving" class="contract-links__spinner"></i>{{ saving ? '正在提交…' : '添加关联' }}</button></footer>
        </form>
      </div>
    </div>
    <dialog ref="dialog" aria-labelledby="delete-link-title" @cancel.prevent="cancelDelete" @keydown.esc.stop.prevent="cancelDelete" @keydown.tab.stop>
      <h3 id="delete-link-title">删除这条关联？</h3><p>仅移除文件间的关联，不删除合同文件。</p>
      <p v-if="deleteError" class="contract-links__error" role="alert">{{ deleteError }}</p>
      <footer><button ref="cancelButton" :disabled="busy" type="button" @click="cancelDelete">取消</button><button type="button" class="contract-links__danger" :disabled="busy" @click="remove"><i v-if="deleting" class="contract-links__spinner"></i>{{ deleting ? '正在删除…' : '确认删除' }}</button></footer>
    </dialog>
  </aside>
</template>

<style scoped>
.contract-links { display: flex; flex-direction: column; max-height: 100%; min-height: 0; overflow: hidden; color: #30443a; background: linear-gradient(150deg, #f9faf6f5, #edf2ebf2); border: 1px solid #ffffffb3; border-radius: 18px; box-shadow: 0 16px 48px #091a2333, inset 0 1px #fff; backdrop-filter: blur(20px); }
.contract-links:focus { outline: none; }
.contract-links__header { display: flex; flex-shrink: 0; justify-content: space-between; align-items: center; padding: 22px 20px 16px; }
.contract-links__header > div { display: flex; align-items: center; gap: 9px; }
.contract-links__header img { width: 17px; height: 17px; object-fit: contain; }
.contract-links h2 { margin: 0; font-size: 16px; font-weight: 600; }
.contract-links__header small { color: #7e8e81; font-size: 12px; }
.contract-links button { padding: 8px 12px; border: 1px solid #d0dacf; border-radius: 8px; background: #edf1eb; color: #526a55; font-size: 12px; cursor: pointer; }
.contract-links__header .contract-links__header-actions { gap: 4px; }
.contract-links .contract-links__header-actions button { display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; background: transparent; font-size: 20px; line-height: 1; }
.contract-links .contract-links__header-actions button:hover { background: #dfe7dc; }
.contract-links .contract-links__header-actions button:focus-visible { outline-offset: 3px; }
.contract-links button:disabled { opacity: .45; cursor: not-allowed; }
.contract-links button:focus-visible { outline: 2px solid #829d88; outline-offset: 2px; }
.contract-links__body { flex: 0 1 auto; min-height: 0; overflow: auto; padding: 0 20px; scrollbar-width: thin; overscroll-behavior: contain; }
.contract-links__body ol { list-style: none; padding: 0; margin: 0; }
.contract-links__body li { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 10px; padding: 18px 0; border-top: 1px solid #d8e0d9; }
.contract-links__number { color: #8a9b8c; font-size: 11px; padding-top: 2px; }
.contract-links__item { min-width: 0; }
.contract-links__name { font-size: 13px; font-weight: 600; line-height: 1.8; }
.contract-links__description { margin-top: 8px; color: #617064; font-size: 12px; line-height: 1.9; }
.contract-links__item-footer { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-top: 12px; }
.contract-links__meta { display: flex; flex-direction: column; gap: 4px; min-width: 0; color: #536658; font-size: 12px; line-height: 1.6; }
.contract-links__meta-row { display: grid; grid-template-columns: 5em minmax(0, 1fr); gap: 8px; min-width: 0; text-align: left; }
.contract-links__meta-row > span { color: #617064; }
.contract-links__author { max-width: 7em; min-width: 0; font-weight: 500; }
.contract-links__meta time { min-width: 0; color: #617064; font-variant-numeric: tabular-nums; }
.contract-links .contract-links__delete { display: flex; flex-shrink: 0; margin: 0 0 0 auto; padding: 5px; border: 0; background: transparent; color: #8c9690; }
.contract-links__delete svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; }
.contract-links .contract-links__delete:hover { color: #aa4752; background: #f2e3e4; }
.contract-links__empty { padding: 16px 0; font-size: 12px; color: #7d897e; }
.contract-links__reveal { flex-shrink: 0; display: grid; grid-template-rows: 0fr; opacity: 0; margin: 0 20px; transition: grid-template-rows .32s cubic-bezier(.22,1,.36,1), opacity .2s; }
.contract-links__reveal.is-expanded { grid-template-rows: 1fr; opacity: 1; }
.contract-links__clip { min-height: 0; overflow: hidden; }
.contract-links form { padding: 16px 0 20px; border-top: 1px solid #d8e0d9; max-height: 55dvh; overflow: auto; scrollbar-width: thin; }
.contract-links h3 { margin: 0 0 16px; font-size: 14px; }
.contract-links label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 12px; }
.contract-links b { font-size: 10px; font-weight: 400; color: #9e6769; }
.contract-links input, .contract-links textarea { box-sizing: border-box; display: block; width: 100%; padding: 10px 12px; margin-top: 8px; border: 1px solid #cad6c9; border-radius: 10px; background: #ffffffba; color: #30443a; font: inherit; line-height: 1.8; outline: none; }
.contract-links textarea { resize: vertical; }
.contract-links input:focus, .contract-links textarea:focus { border-color: #829d88; }
.contract-links__results { position: fixed; inset: auto; box-sizing: border-box; overflow: auto; margin: 0; padding: 6px; border: 1px solid #ced9cc; border-radius: 10px; background: #f8faf5f7; box-shadow: 0 10px 28px #19332426; backdrop-filter: blur(16px); scrollbar-width: thin; overscroll-behavior: contain; }
.contract-links__results:popover-open { animation: link-search-in .16s ease-out; }
@keyframes link-search-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
.contract-links__results p { padding: 4px 8px; font-size: 12px; color: #7d897e; }
.contract-links .contract-links__results button { display: flex; width: 100%; justify-content: space-between; gap: 10px; padding: 8px 10px; margin-bottom: 3px; border: 0; background: transparent; text-align: left; }
.contract-links__results button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.contract-links .contract-links__results button[aria-selected="true"] { background: #dce8db; color: #365a3e; }
.contract-links footer { display: flex; justify-content: flex-end; gap: 8px; }
.contract-links .contract-links__submit { background: #476552; border-color: #476552; color: white; }
.contract-links__count { text-align: right; font-size: 11px; color: #7d897e; }
.contract-links__spinner { display: inline-block; width: 12px; height: 12px; border: 1.5px solid currentColor; border-right-color: transparent; border-radius: 50%; vertical-align: middle; animation: link-spin .8s linear infinite; }
@keyframes link-spin { to { transform: rotate(360deg); } }
.contract-links__error { color: #a13e49; font-size: 12px; }
.contract-links dialog { box-sizing: border-box; width: min(400px, calc(100vw - 40px)); padding: 24px; border: 1px solid #ffffffc9; border-radius: 18px; background: #f5f8f2; color: #30443a; box-shadow: 0 20px 70px #091a2355; }
.contract-links dialog p { margin-bottom: 24px; font-size: 12px; line-height: 1.8; }
.contract-links dialog::backdrop { background: #10251d50; backdrop-filter: blur(5px); }
.contract-links .contract-links__danger { background: #ac4b55; border-color: #ac4b55; color: white; }
@media (prefers-reduced-motion: reduce) { .contract-links__reveal { transition: none; } .contract-links__results:popover-open { animation: none; } }
</style>
