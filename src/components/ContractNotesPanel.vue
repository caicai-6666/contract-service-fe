<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import alertListIcon from '../assets/alert-list.webp'
import TruncatedText from './TruncatedText.vue'
import { CONTRACT_NOTE_MAX_LENGTH, normalizeContractNoteContent } from '../models/contractNotes.js'

const props = defineProps({
  documentId: { type: String, required: true },
  source: { type: Object, required: true },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'saving-change'])
const notes = ref([])
const loading = ref(false)
const error = ref('')
const editing = ref(false)
const draft = ref('')
const saving = ref(false)
const confirming = ref(false)
const deleting = ref(false)
const busy = computed(() => saving.value || deleting.value)
const deleteTarget = ref(null)
const deleteError = ref('')
const deleteDialog = ref(null)
const cancelDeleteButton = ref(null)
let deleteTrigger = null
async function requestDelete(note, event) {
  if (busy.value || props.disabled) return
  deleteTarget.value = note
  deleteError.value = ''
  deleteTrigger = event.currentTarget
  await nextTick()
  deleteDialog.value?.showModal()
  cancelDeleteButton.value?.focus()
}
function cancelDelete() {
  if (deleting.value) return
  deleteDialog.value?.close()
  deleteTarget.value = null
  deleteError.value = ''
  deleteTrigger?.focus()
  deleteTrigger = null
}
async function confirmDelete() {
  if (!deleteTarget.value || busy.value || props.disabled) return
  deleting.value = true
  deleteError.value = ''
  const current = generation
  const noteId = deleteTarget.value.note_id
  try {
    await props.source.remove(props.documentId, noteId)
    if (current !== generation) return
    notes.value = notes.value.filter((note) => note.note_id !== noteId)
    deleteDialog.value?.close()
    deleteTarget.value = null
    deleteTrigger = null
    await nextTick()
    panel.value?.focus()
  } catch (cause) {
    if (current === generation) deleteError.value = cause.message || '删除失败，请重试'
  } finally { deleting.value = false }
}
let confirmationTimer
watch(confirming, (value) => {
  window.clearTimeout(confirmationTimer)
  if (value) confirmationTimer = window.setTimeout(() => { confirming.value = false }, 3000)
}, { flush: 'sync' })
watch(draft, () => { confirming.value = false }, { flush: 'sync' })
watch(busy, (value) => emit('saving-change', value), { flush: 'sync' })
const saveError = ref('')
const input = ref(null)
const panel = ref(null)
const length = computed(() => [...draft.value.trim()].length)
const valid = computed(() => length.value > 0 && length.value <= CONTRACT_NOTE_MAX_LENGTH)
let generation = 0
let loadController

async function load() {
  loadController?.abort()
  const controller = new AbortController()
  loadController = controller
  const current = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = await props.source.list(props.documentId, { signal: controller.signal })
    if (current === generation) notes.value = result
  } catch (cause) {
    if (cause.name === 'AbortError') return
    if (current === generation) error.value = cause.message || '注意事项加载失败，请重试'
  } finally {
    if (current === generation) loading.value = false
  }
}
watch(() => props.documentId, () => {
  deleteDialog.value?.close()
  deleteTarget.value = null
  deleteError.value = ''
  notes.value = []
  confirming.value = false
  editing.value = false
  draft.value = ''
  saveError.value = ''
  void load()
}, { immediate: true })
onBeforeUnmount(() => { generation++; loadController?.abort(); window.clearTimeout(confirmationTimer); emit('saving-change', false) })

async function startAdding() {
  if (props.disabled || busy.value || loading.value || error.value) return
  confirming.value = false
  editing.value = true
  await nextTick()
  input.value?.focus({ preventScroll: true })
}
function cancel() {
  if (busy.value) return
  confirming.value = false
  editing.value = false
  draft.value = ''
  saveError.value = ''
  panel.value?.focus()
}
function handleEscape(event) {
  if (!editing.value || event.isComposing) return
  event.stopPropagation()
  event.preventDefault()
  cancel()
}
async function save() {
  if (!editing.value || busy.value || props.disabled || loading.value || error.value) return
  saveError.value = ''
  let content
  try { content = normalizeContractNoteContent(draft.value) }
  catch (cause) { saveError.value = cause.message; return }
  if (!confirming.value) { confirming.value = true; return }
  confirming.value = false
  saving.value = true
  const current = generation
  try {
    const note = await props.source.create(props.documentId, { content })
    if (current !== generation) return
    notes.value = [...notes.value, note].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.note_id.localeCompare(b.note_id))
    editing.value = false
    draft.value = ''
    await nextTick()
    panel.value?.focus()
  } catch (cause) {
    if (current === generation) saveError.value = cause.message || '新增结果未确认，请核对列表后再重试'
  } finally { saving.value = false }
}
function formatTime(value) {
  return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}
</script>

<template>
  <aside ref="panel" class="contract-notes" tabindex="-1" aria-label="合同注意事项" @keydown.esc="handleEscape">
    <header class="contract-notes__header">
      <div class="contract-notes__heading"><img class="contract-notes__icon" :src="alertListIcon" alt="" aria-hidden="true" draggable="false" /><h2>注意事项</h2><span class="contract-notes__count">{{ notes.length }}</span></div>
      <div class="contract-notes__header-actions">
        <button v-if="!editing" type="button" aria-label="新增注意事项" title="新增注意事项" :disabled="disabled || busy || loading || Boolean(error)" @click="startAdding">＋</button>
        <button type="button" aria-label="收起注意事项" title="收起注意事项" :disabled="disabled || busy" @click="$emit('close')">×</button>
      </div>
    </header>
    <p class="contract-notes__intro">人工补充意见，非合同原文或已核实事实。</p>
    <div class="contract-notes__body" :aria-busy="loading">
      <p v-if="loading" class="contract-notes__empty" role="status">正在加载注意事项…</p>
      <div v-else-if="error" class="contract-notes__empty" role="alert">{{ error }}<button type="button" @click="load">重新加载</button></div>
      <p v-else-if="!notes.length" class="contract-notes__empty">暂无注意事项，点击右上角“＋”添加。</p>
      <ol v-else class="contract-notes__list">
        <li v-for="(note, index) in notes" :key="note.note_id" class="contract-notes__item">
          <span class="contract-notes__number">{{ String(index + 1).padStart(2, '0') }}</span>
          <div class="contract-notes__item-main">
            <TruncatedText class="contract-notes__content" :text="note.content" :lines="3" />
            <div class="contract-notes__item-footer">
            <div class="contract-notes__meta">
              <div class="contract-notes__meta-row"><span class="contract-notes__meta-label">审核人：</span><TruncatedText class="contract-notes__author" :text="note.author_name" /></div>
              <div class="contract-notes__meta-row"><span class="contract-notes__meta-label">审核时间：</span><time :datetime="note.created_at"><TruncatedText :text="formatTime(note.created_at)" /></time></div>
            </div>
            <button type="button" class="contract-notes__delete" aria-label="删除这条注意事项" title="删除注意事项" :disabled="disabled || busy" @click="requestDelete(note, $event)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg>
            </button>
            </div>
          </div>
        </li>
      </ol>
    </div>
      <div
        class="contract-notes__editor-reveal"
        :class="{ 'is-expanded': editing }"
        :inert="!editing"
        :aria-hidden="!editing"
      >
      <div class="contract-notes__editor-clip">
      <form class="contract-notes__editor" @submit.prevent="save">
        <label for="contract-note-content">新增注意事项</label>
        <textarea id="contract-note-content" ref="input" v-model="draft" rows="5" placeholder="记录需要关注或进一步核实的内容…" :disabled="busy || disabled" :aria-invalid="length > CONTRACT_NOTE_MAX_LENGTH" aria-describedby="contract-note-length" @input="saveError = ''"></textarea>
        <span id="contract-note-length" class="contract-notes__length" :class="{ 'is-invalid': length > CONTRACT_NOTE_MAX_LENGTH }">{{ length }} / {{ CONTRACT_NOTE_MAX_LENGTH }}</span>
        <p v-if="saveError" class="contract-notes__error" role="alert">{{ saveError }}</p>
        <div class="contract-notes__editor-actions">
          <button type="button" :disabled="busy" @click="cancel">取消</button>
          <button class="contract-notes__submit" :class="{ 'is-confirming': confirming }" type="submit" :disabled="!valid || busy || disabled" :aria-busy="saving" :aria-label="saving ? '正在添加…' : confirming ? '确认提交' : '添加注意事项'">
            <Transition name="note-submit-label" mode="out-in">
              <span :key="saving ? 'saving' : confirming ? 'confirming' : 'idle'" class="contract-notes__submit-label" aria-hidden="true">
                <span v-if="saving" class="contract-notes__spinner"></span>
                {{ saving ? '正在添加…' : confirming ? '确认提交' : '添加注意事项' }}
              </span>
            </Transition>
          </button>
        </div>
      </form>
      </div>
      </div>
    <dialog ref="deleteDialog" class="contract-notes__delete-dialog" aria-labelledby="note-delete-title" aria-describedby="note-delete-description" @cancel.prevent="cancelDelete" @keydown.esc.stop.prevent="cancelDelete" @keydown.tab.stop>
      <template v-if="deleteTarget">
        <h3 id="note-delete-title">删除这条注意事项？</h3>
        <p id="note-delete-description">确认后将移除这条注意事项，此操作无法撤销。</p>
        <p v-if="deleteError" class="contract-notes__error" role="alert">{{ deleteError }}</p>
        <footer>
          <button ref="cancelDeleteButton" type="button" :disabled="deleting" @click="cancelDelete">取消</button>
          <button type="button" class="contract-notes__confirm-delete" :disabled="deleting || disabled" :aria-busy="deleting" @click="confirmDelete"><span v-if="deleting" class="contract-notes__spinner"></span>{{ deleting ? '正在删除…' : '确认删除' }}</button>
        </footer>
      </template>
    </dialog>
  </aside>
</template>

<style scoped>
.contract-notes { display: flex; flex-direction: column; max-height: 100%; min-height: 0; color: #30443a; background: linear-gradient(150deg, #f9faf6f5, #edf2ebf2); border: 1px solid #ffffffb3; border-radius: 18px; box-shadow: 0 16px 48px #091a2333, inset 0 1px #fff; backdrop-filter: blur(20px); overflow: hidden; }
.contract-notes__header { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 22px 20px 0; gap: 10px; }
.contract-notes__heading { display: flex; align-items: center; gap: 9px; }
.contract-notes h2 { font-size: 16px; font-weight: 600; margin: 0; }
.contract-notes__icon { display: block; width: 20px; height: 20px; flex-shrink: 0; object-fit: contain; }
.contract-notes__count { color: #7e8e81; font-size: 12px; font-variant-numeric: tabular-nums; }
.contract-notes__intro { flex-shrink: 0; margin: 12px 20px 16px; color: #7d897e; font-size: 11px; line-height: 1.8; }
.contract-notes__body { flex: 0 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 20px; scrollbar-width: thin; scrollbar-color: #bfccbf transparent; }
.contract-notes__list { list-style: none; margin: 0; padding: 0; }
.contract-notes__item { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 10px; padding: 18px 0; border-top: 1px solid #d8e0d9; }
.contract-notes__number { padding-top: 2px; color: #8a9b8c; font-size: 11px; font-variant-numeric: tabular-nums; }
.contract-notes__item-main { min-width: 0; }
.contract-notes__item-footer { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-top: 12px; }
.contract-notes__content { margin: 0; font-size: 13px; line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; }
.contract-notes__meta { display: flex; flex-direction: column; gap: 4px; width: 200px; max-width: 100%; min-width: 0; margin: 0; color: #536658; font-size: 12px; line-height: 1.6; }
.contract-notes__meta-row { display: grid; grid-template-columns: 5em minmax(0, 1fr); gap: 8px; min-width: 0; text-align: left; }
.contract-notes__meta-label { flex-shrink: 0; color: #617064; }
.contract-notes__author { max-width: 7em; min-width: 0; font-weight: 500; }
.contract-notes__meta time { min-width: 0; color: #617064; font-variant-numeric: tabular-nums; }
.contract-notes__empty { padding: 16px 0; color: #7d897e; font-size: 12px; line-height: 1.8; }
.contract-notes__editor-reveal { flex-shrink: 0; margin: 0 20px; display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows .32s cubic-bezier(.22, 1, .36, 1), opacity .2s ease; }
.contract-notes__editor-reveal.is-expanded { grid-template-rows: 1fr; opacity: 1; }
.contract-notes__editor-clip { min-height: 0; overflow: hidden; }
.contract-notes__editor { display: flex; flex-direction: column; padding: 16px 0 20px; border-top: 1px solid #d8e0d9; }
.contract-notes__editor label { font-size: 13px; font-weight: 600; margin-bottom: 12px; }
.contract-notes__editor textarea { box-sizing: border-box; width: 100%; min-height: 120px; resize: vertical; padding: 12px; border: 1px solid #cad6c9; border-radius: 10px; background: #ffffffba; color: #30443a; font: inherit; font-size: 13px; line-height: 1.8; }
.contract-notes__editor textarea::placeholder { color: #97a193; }
.contract-notes__length { align-self: flex-end; margin: 7px 0 12px; font-size: 10px; color: #849080; }
.contract-notes__editor-actions { display: flex; justify-content: flex-end; gap: 8px; }
.contract-notes button { padding: 8px 12px; border: 1px solid #d0dacf; border-radius: 8px; background: #edf1eb; color: #526a55; font-size: 12px; cursor: pointer; }
.contract-notes__spinner { width: 12px; height: 12px; border: 2px solid #ffffff55; border-top-color: #fff; border-radius: 50%; animation: notes-submit-spin .7s linear infinite; }
@keyframes notes-submit-spin { to { transform: rotate(360deg); } }
.contract-notes .contract-notes__submit { display: inline-flex; align-items: center; justify-content: center; width: 128px; height: 36px; box-sizing: border-box; overflow: hidden; background: #476552; border-color: #476552; color: white; transition: background-color .14s ease, border-color .14s ease, color .14s ease; }
.contract-notes .contract-notes__submit.is-confirming { background: #edb34b; border-color: #dda039; color: #503809; }
.contract-notes__submit-label { display: inline-flex; align-items: center; justify-content: center; gap: 7px; white-space: nowrap; }
.note-submit-label-enter-active { animation: note-label-rise-in .12s ease-out both; }
.note-submit-label-leave-active { animation: note-label-rise-out .08s ease-in both; }
@keyframes note-label-rise-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes note-label-rise-out { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-10px); } }
.contract-notes__header-actions { display: flex; gap: 4px; }
.contract-notes .contract-notes__header-actions button { display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; background: transparent; font-size: 20px; line-height: 1; }
.contract-notes .contract-notes__header-actions button:hover { background: #dfe7dc; }
.contract-notes button:disabled { opacity: .45; cursor: not-allowed; }
.contract-notes button:focus-visible { outline: 2px solid #829d88; outline-offset: 3px; }
.contract-notes__editor textarea:focus { outline: none; border-color: #829d88; }
.contract-notes__error, .contract-notes__length.is-invalid { color: #a13e49; font-size: 12px; }
.contract-notes:focus { outline: none; }
.contract-notes .contract-notes__delete { flex-shrink: 0; display: grid; place-items: center; width: 28px; height: 28px; padding: 5px; border: 0; background: transparent; color: #8c9690; }
.contract-notes .contract-notes__delete:hover { color: #aa4752; background: #f2e3e4; }
.contract-notes__delete svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.contract-notes__delete-dialog { box-sizing: border-box; width: min(400px, calc(100vw - 40px)); max-height: calc(100dvh - 64px); padding: 24px; border: 1px solid #ffffffc9; border-radius: 18px; background: #f5f8f2; color: #30443a; box-shadow: 0 20px 70px #091a2355; }
.contract-notes__delete-dialog::backdrop { background: #10251d50; backdrop-filter: blur(5px); }
.contract-notes__delete-dialog h3 { margin: 0 0 12px; font-size: 16px; }
.contract-notes__delete-dialog p { font-size: 12px; line-height: 1.8; }
.contract-notes__delete-dialog footer { margin-top: 24px; display: flex; justify-content: flex-end; gap: 8px; }
.contract-notes .contract-notes__confirm-delete { display: inline-flex; align-items: center; gap: 7px; background: #ac4b55; border-color: #ac4b55; color: white; }
@media (prefers-reduced-motion: reduce) {
  .contract-notes__editor-reveal { transition: none; }
  .contract-notes__spinner { animation: none; }
  .contract-notes .contract-notes__submit { transition: none; }
  .note-submit-label-enter-active, .note-submit-label-leave-active { animation: none; }
}
</style>
