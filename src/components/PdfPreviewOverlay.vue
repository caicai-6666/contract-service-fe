<script setup>
import ContractPdfReader from './ContractPdfReader.vue'
import PdfLoadingAnimation from './PdfLoadingAnimation.vue'
import ContractSummaryPopover from './ContractSummaryPopover.vue'
import alertListIcon from '../assets/alert-list.webp'
import pinIcon from '../assets/pin.webp'
import linkIcon from '../assets/link.webp'
import { computed, nextTick, ref, watch } from 'vue'
const props = defineProps({
  teleportTarget: { default: 'body' },
  open: { type: Boolean, default: false },
  showPin: { type: Boolean, default: false },
  pinned: { type: Boolean, default: false },
  controlledReader: { type: Boolean, default: false },
  src: { type: String, default: '' },
  label: { type: String, default: 'PDF 文档' },
  summaryDocumentId: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  retryable: { type: Boolean, default: true },
  showDelete: { type: Boolean, default: false },
  showToolbar: { type: Boolean, default: false },
  showLinks: { type: Boolean, default: false },
  showNotes: { type: Boolean, default: false },
  notesSaving: { type: Boolean, default: false },
  deleting: { type: Boolean, default: false },
  deleteError: { type: String, default: '' },
})

const deleteConfirmation = ref(false)
const actionsOpen = ref(false)
const activePanel = ref('')
const panelOpen = computed(() => Boolean(activePanel.value))
const actionsButton = ref(null)
const panelLayer = ref(null)
async function togglePanel(panelName = 'notes') {
  if (props.deleting) return
  if (activePanel.value === panelName) return closePanel()
  deleteConfirmation.value = false
  actionsOpen.value = false
  activePanel.value = panelName
  await nextTick()
  panelLayer.value?.querySelector('[tabindex="-1"]')?.focus()
}
function trapPanelFocus(event) {
  const controls = [...panelLayer.value.querySelectorAll('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter((element) => !element.closest('[inert]') && element.getClientRects().length)
  if (!controls.length) { event.preventDefault(); return }
  const first = controls[0]
  const last = controls.at(-1)
  if (!controls.includes(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    const target = event.shiftKey ? last : first
    target.focus()
  }
}
async function closePanel() {
  if (props.deleting || props.notesSaving) return
  activePanel.value = ''
  await nextTick()
  actionsButton.value?.focus()
}
const deleteButton = ref(null)
const cancelDeleteButton = ref(null)
async function openDeleteConfirmation() {
  deleteConfirmation.value = true
  await nextTick()
  cancelDeleteButton.value?.focus()
}
function cancelDelete() {
  if (props.deleting) return
  deleteConfirmation.value = false
  actionsOpen.value = false
  deleteButton.value?.focus()
}
watch([() => props.open, () => props.src], () => {
  deleteConfirmation.value = false
  actionsOpen.value = false
  activePanel.value = ''
})

const frameLoaded = ref(false)
const readerError = ref('')
const displayedError = computed(() => props.error || readerError.value)
const contentReady = computed(() => Boolean(props.src) && !props.loading && !displayedError.value && frameLoaded.value)
const waitingForPdf = computed(() => !displayedError.value && (props.loading || Boolean(props.src) && !frameLoaded.value))
watch([() => props.open, () => props.src, () => props.loading], () => {
  frameLoaded.value = false
  readerError.value = ''
}, { flush: 'sync' })

defineEmits(['close', 'retry', 'delete', 'pin'])
</script>

<template>
  <Teleport :to="teleportTarget">
    <div
      class="pdf-preview-glass"
      :class="{ 'is-active': open }"
      aria-hidden="true"
      @click="panelOpen ? closePanel() : !deleting && $emit('close')"
    ></div>

    <Transition name="pdf-preview">
      <section
        v-if="open"
        class="pdf-preview"
        role="dialog"
        aria-modal="true"
        :aria-label="`预览 ${label}`"
        @keydown.esc.prevent.stop="deleteConfirmation ? cancelDelete() : panelOpen ? closePanel() : !deleting && $emit('close')"
      >
        <div class="pdf-preview__layout">
        <div class="pdf-preview__viewer">
          <div class="pdf-preview__surface" :inert="panelOpen" :aria-hidden="panelOpen || undefined">
          <ContractPdfReader
            v-if="controlledReader"
            :src="!loading && !error ? src : ''"
            :label="label"
            @ready="frameLoaded = true"
            @error="readerError = $event"
          />
          <iframe
            v-else-if="src && !loading && !error"
            :key="src"
            :class="{ 'is-ready': contentReady }"
            :aria-hidden="!contentReady"
            :tabindex="contentReady ? 0 : -1"
            :src="`${src}#view=FitH&toolbar=1&navpanes=0`"
            :title="`${label} PDF 内容`"
            @load="frameLoaded = true"
          ></iframe>
          <Transition name="pdf-loading">
          <div v-if="!contentReady" class="pdf-preview__status" :class="{ 'has-toolbar': controlledReader }" :aria-busy="waitingForPdf">
            <PdfLoadingAnimation v-if="waitingForPdf" />
            <p>{{ label }}</p>
            <span v-if="waitingForPdf" role="status">正在加载 PDF…</span>
            <template v-else-if="displayedError">
              <span role="alert">{{ displayedError }}</span>
              <button v-if="retryable" type="button" @click="$emit('retry')">重新加载</button>
            </template>
          </div>
          </Transition>

          <ContractSummaryPopover v-if="summaryDocumentId && !panelOpen" :key="summaryDocumentId" :document-id="summaryDocumentId" />

          <button v-if="showPin && !panelOpen" type="button" class="pdf-preview__pin" :class="{ 'is-pinned': pinned }" :aria-pressed="pinned" :aria-label="pinned ? '取消引用当前合同' : '引用当前合同到会话'" :title="pinned ? '已加入会话，点击取消引用' : '引用到会话'" @click="$emit('pin')">
            <img :src="pinIcon" alt="" />
          </button>

          <!-- Interaction adapted from Uiverse.io by ElgyoshiMa91846 -->
          <div v-if="showToolbar && !loading" class="pdf-preview__actions" :class="{ 'is-open': actionsOpen || deleteConfirmation }" @mouseleave="actionsOpen = false">
          <button ref="actionsButton" class="pdf-preview__actions-toggle" type="button" aria-label="合同操作" :aria-expanded="actionsOpen || deleteConfirmation" @click="actionsOpen = !actionsOpen">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </button>
          <button
            v-if="showNotes"
            class="pdf-preview__notes-toggle"
            type="button"
            aria-label="注意事项"
            title="注意事项"
            :aria-expanded="activePanel === 'notes'"
            :disabled="deleting"
            @click="togglePanel('notes')"
          >
            <img :src="alertListIcon" alt="" aria-hidden="true" draggable="false" />
          </button>
          <button v-if="showLinks" class="pdf-preview__notes-toggle pdf-preview__links-toggle" type="button" aria-label="合同关联" title="合同关联" :aria-expanded="activePanel === 'links'" :disabled="deleting" @click="togglePanel('links')">
            <img :src="linkIcon" alt="" />
          </button>
          <button
            v-if="showDelete"
            ref="deleteButton"
            class="pdf-preview__delete"
            type="button"
            aria-label="删除合同"
            title="删除合同"
            :aria-expanded="deleteConfirmation"
            @click="deleteConfirmation ? cancelDelete() : openDeleteConfirmation()"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 5.5h13M7 5.5V3.8h6v1.7M5 5.5l.8 11h8.4l.8-11M8 8.5v5M12 8.5v5" /></svg>
          </button>
          </div>
          <Transition name="pdf-delete">
            <div v-if="showDelete && deleteConfirmation" class="pdf-preview__delete-confirm" role="group" aria-label="删除合同确认">
              <h3>删除这份合同？</h3>
              <p class="pdf-preview__delete-name">{{ label }}</p>
              <p class="pdf-preview__delete-note">将删除正式合同 PDF、检索数据和目录记录。此操作不自动备份，无法撤销。</p>
              <p v-if="deleteError" class="pdf-preview__delete-error" role="alert">{{ deleteError }}</p>
              <div class="pdf-preview__delete-actions">
                <button ref="cancelDeleteButton" type="button" :disabled="deleting" @click="cancelDelete">保留合同</button>
                <button class="pdf-preview__delete-submit" type="button" :disabled="deleting" @click="$emit('delete')">{{ deleting ? '正在删除…' : deleteError ? '重试删除' : '确认删除' }}</button>
              </div>
            </div>
          </Transition>

          <button
            class="pdf-preview__close"
            type="button"
            aria-label="关闭 PDF 预览"
            :disabled="deleting"
            autofocus
            @click="$emit('close')"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m5.5 5.5 9 9m0-9-9 9" />
            </svg>
          </button>
          </div>
          <Transition name="pdf-notes">
            <div
              v-if="panelOpen"
              ref="panelLayer"
              class="pdf-preview__notes-layer"
              role="dialog"
              aria-modal="true"
              :aria-label="activePanel === 'links' ? '合同关联' : '合同注意事项'"
              @click.self="closePanel"
              @keydown.tab="trapPanelFocus"
            >
              <div class="pdf-preview__notes-card"><slot :name="activePanel" :close="closePanel"></slot></div>
            </div>
          </Transition>
        </div>
        </div>
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
.pdf-preview-glass {
  position: fixed;
  z-index: 10000;
  inset: 0;
  pointer-events: none;
  background-color: rgb(7 12 10 / 0%);
  backdrop-filter: blur(0) saturate(1);
  opacity: 0;
  transition:
    background-color 0.36s cubic-bezier(0.22, 1, 0.36, 1),
    backdrop-filter 0.42s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.3s ease;
}

.pdf-preview-glass.is-active {
  pointer-events: auto;
  background-color: rgb(7 12 10 / 42%);
  backdrop-filter: blur(20px) saturate(0.78) brightness(0.84);
  opacity: 1;
}

.pdf-preview {
  position: fixed;
  z-index: 10001;
  inset: 0;
  display: grid;
  place-items: center;
  padding: clamp(24px, 4vw, 56px);
  pointer-events: none;
}

.pdf-preview__layout {
  display: flex;
  align-items: center;
  width: min(1180px, 100%);
  height: min(820px, 100%);
  min-height: 0;
  min-width: 0;
}
.pdf-preview__surface { width: 100%; height: 100%; border-radius: inherit; }
.pdf-preview__notes-layer {
  position: absolute;
  z-index: 5;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 32px;
  box-sizing: border-box;
  border-radius: inherit;
  background: rgb(35 48 41 / 26%);
  backdrop-filter: blur(14px) saturate(.75);
  -webkit-backdrop-filter: blur(14px) saturate(.75);
}
.pdf-preview__notes-card { display: flex; width: min(520px, 100%); max-height: 100%; min-height: 0; }
.pdf-preview__notes-card > :deep(*) { width: 100%; }
.pdf-notes-enter-active, .pdf-notes-leave-active { transition: opacity .22s ease; }
.pdf-notes-enter-active .pdf-preview__notes-card, .pdf-notes-leave-active .pdf-preview__notes-card { transition: transform .22s ease; }
.pdf-notes-enter-from, .pdf-notes-leave-to { opacity: 0; }
.pdf-notes-enter-from .pdf-preview__notes-card, .pdf-notes-leave-to .pdf-preview__notes-card { transform: translateY(8px) scale(.98); }
.pdf-preview__viewer {
  position: relative;
  flex: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  pointer-events: auto;
  background: #dfe3e1;
  border: 1px solid #ffffff52;
  border-radius: 20px;
  box-shadow:
    0 34px 100px #010302a3,
    0 4px 20px #01030252,
    inset 0 1px #ffffff66;
}

.pdf-preview__viewer iframe {
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #fff;
  border: 0;
  border-radius: inherit;
  opacity: 0;
  pointer-events: none;
  transition: opacity .8s cubic-bezier(.22, 1, .36, 1) .24s;
}

.pdf-preview__viewer iframe.is-ready { opacity: 1; pointer-events: auto; }
.pdf-preview__pin { position: absolute; z-index: 3; top: 124px; left: 20px; display: grid; place-items: center; width: 38px; height: 38px; padding: 9px; border: 1px solid #ffffffb3; border-radius: 50%; background: linear-gradient(145deg, #f0f5fb, #d5e1ef); color: #466483; box-shadow: 0 4px 14px #243c5926, inset 0 1px #fff; cursor: pointer; transition: background .18s, transform .18s; }
.pdf-preview__pin:hover { transform: translateY(-1px); }
.pdf-preview__pin.is-pinned { background: #486a84; color: #fff; }
.pdf-preview__pin:focus-visible { outline: 2px solid #829fbe; outline-offset: 3px; }
.pdf-preview__pin img { width: 17px; height: 17px; object-fit: contain; opacity: .75; }
.pdf-preview__pin.is-pinned img { filter: invert(1); opacity: 1; }
.pdf-preview__actions {
  position: absolute;
  z-index: 3;
  top: 50%;
  right: 20px;
  transform: translateY(-50%);
  width: 46px;
  height: 46px;
}
.pdf-preview__actions::before {
  content: '';
  position: absolute;
  inset: -54px 0 -54px -66px;
  visibility: hidden;
}
.pdf-preview__actions:has(.pdf-preview__links-toggle)::before { inset: -68px 0 -68px -90px; }
.pdf-preview__actions:hover::before,
.pdf-preview__actions:has(:focus-visible)::before,
.pdf-preview__actions.is-open::before { visibility: visible; }
.pdf-preview__actions-toggle,
.pdf-preview__notes-toggle,
.pdf-preview__delete {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  padding: 12px;
  border: 0;
  border-radius: 50%;
  background: linear-gradient(145deg, #eaf0e9 0%, #cad8cf 100%);
  color: #456353;
  box-shadow: inset 0 1px 0 #ffffffcc, inset 0 0 0 1px #7f9a862e,
    0 3px 10px #20392b1a;
  cursor: pointer;
  transition: background .6s, color .6s, opacity .3s, transform .3s, visibility .3s;
}
.pdf-preview__actions-toggle svg { width: 22px; height: 22px; fill: currentColor; }
.pdf-preview__actions:hover .pdf-preview__actions-toggle,
.pdf-preview__actions:has(:focus-visible) .pdf-preview__actions-toggle,
.pdf-preview__actions.is-open .pdf-preview__actions-toggle {
  background: #f1f5ef;
  color: #2e5340;
}
.pdf-preview__notes-toggle,
.pdf-preview__delete {
  position: absolute;
  top: 0;
  right: 0;
  opacity: 0;
  visibility: hidden;
  background: #fff;
  color: #bd3847;
  box-shadow: 0 2px 4px #00000033;
}
.pdf-preview__actions:hover .pdf-preview__notes-toggle,
.pdf-preview__actions:has(:focus-visible) .pdf-preview__notes-toggle,
.pdf-preview__actions.is-open .pdf-preview__notes-toggle,
.pdf-preview__actions:hover .pdf-preview__delete,
.pdf-preview__actions:has(:focus-visible) .pdf-preview__delete,
.pdf-preview__actions.is-open .pdf-preview__delete {
  opacity: 1;
  visibility: visible;
  transform: translate(var(--action-x, -68px), var(--action-y, 0px));
}
.pdf-preview__actions:has(.pdf-preview__delete) .pdf-preview__notes-toggle { --action-x: -56px; --action-y: -44px; }
.pdf-preview__actions:has(.pdf-preview__notes-toggle) .pdf-preview__delete { --action-x: -56px; --action-y: 44px; }
.pdf-preview__actions:has(.pdf-preview__links-toggle) .pdf-preview__notes-toggle { --action-x: -44px; --action-y: -60px; }
.pdf-preview__actions:has(.pdf-preview__links-toggle) .pdf-preview__links-toggle { --action-x: -78px; --action-y: 0px; }
.pdf-preview__actions:has(.pdf-preview__links-toggle) .pdf-preview__delete { --action-x: -44px; --action-y: 60px; }
.pdf-preview__notes-toggle { color: #456353; }
.pdf-preview__notes-toggle img { width: 22px; height: 22px; object-fit: contain; }
.pdf-preview__links-toggle img { width: 18px; height: 18px; }
.pdf-preview__notes-toggle[aria-expanded="true"],
.pdf-preview__notes-toggle:hover { background: #e4ece2; }
.pdf-preview__notes-toggle:disabled { opacity: .45; cursor: wait; }
.pdf-preview__delete:hover,
.pdf-preview__delete[aria-expanded="true"] { background: #bd3847; color: #fff; }
.pdf-preview__notes-toggle svg,
.pdf-preview__delete svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.pdf-preview__notes-toggle:focus-visible,
.pdf-preview__delete:focus-visible,
.pdf-preview__actions-toggle:focus-visible,
.pdf-preview__delete-actions button:focus-visible { outline: 2px solid #bfa6d5; outline-offset: 3px; }
.pdf-preview__delete-confirm {
  position: absolute;
  z-index: 4;
  top: 50%;
  right: 138px;
  width: min(310px, calc(100% - 158px));
  transform: translateY(-50%);
  padding: 20px;
  box-sizing: border-box;
  border: 1px solid #ffffffb3;
  border-radius: 16px;
  background: #f5f6f2;
  color: #30443a;
  box-shadow: 0 16px 48px #091a2340, 0 3px 8px #091a2314;
}
.pdf-preview__delete-confirm h3 { margin: 0; font-size: 16px; font-weight: 600; }
.pdf-preview__delete-name { margin: 10px 0 0; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.pdf-preview__delete-note { margin: 14px 0 18px; color: #788078; font-size: 12px; line-height: 1.6; }
.pdf-preview__delete-actions { display: flex; justify-content: flex-end; gap: 8px; }
.pdf-preview__delete-actions button { padding: 8px 12px; border: 1px solid #d9e1da; border-radius: 8px; color: #405a49; background: #edf1eb; font-size: 12px; cursor: pointer; }
.pdf-preview__delete-actions .pdf-preview__delete-submit { border-color: #a23f4b; background: #b74654; color: #fff; }
.pdf-preview__delete-actions button:disabled,
.pdf-preview__close:disabled { opacity: .55; cursor: wait; }
.pdf-preview__delete-error { color: #a13e49; font-size: 12px; line-height: 1.7; }
.pdf-delete-enter-active,
.pdf-delete-leave-active { transition: opacity .2s ease, transform .2s ease; }
.pdf-delete-enter-from,
.pdf-delete-leave-to { opacity: 0; transform: translate(5px, -50%); }
.pdf-loading-leave-active { transition: opacity .24s ease; }
.pdf-loading-leave-to { opacity: 0; }

.pdf-preview__close {
  position: absolute;
  z-index: 2;
  top: -16px;
  right: -16px;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  padding: 0;
  color: #edf4f0;
  cursor: pointer;
  background: rgb(18 30 25 / 88%);
  border: 1px solid #ffffff36;
  border-radius: 50%;
  box-shadow:
    0 10px 28px #01030275,
    inset 0 1px #ffffff1f;
  backdrop-filter: blur(14px) saturate(0.82);
  transition:
    color 0.18s,
    background 0.18s,
    border-color 0.18s,
    transform 0.26s cubic-bezier(0.16, 1, 0.3, 1);
}

.pdf-preview__status {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  height: 100%;
  padding: 24px;
  box-sizing: border-box;
  color: #40594c;
  text-align: center;
  overflow-wrap: anywhere;
}
.pdf-preview__status.has-toolbar { top: 56px; height: calc(100% - 56px); }
.pdf-preview__status p { margin: 0; font-weight: 600; }
.pdf-preview__status span { font-size: 14px; }
.pdf-preview__status button {
  padding: 8px 18px;
  border: 1px solid #9eb3a5;
  border-radius: 8px;
  color: #304e3d;
  background: #edf3ef;
  cursor: pointer;
}

.pdf-preview__close:hover {
  color: #fff;
  background: rgb(43 59 52 / 94%);
  border-color: #ffffff5c;
  transform: scale(1.06);
}

.pdf-preview__close:active { transform: scale(0.96); }

.pdf-preview__close:focus-visible {
  outline: 2px solid #aaa0ed;
  outline-offset: 3px;
}

.pdf-preview__close svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.7px;
}

.pdf-preview-enter-active,
.pdf-preview-leave-active { transition: opacity 0.28s ease; }

.pdf-preview-enter-active .pdf-preview__viewer,
.pdf-preview-leave-active .pdf-preview__viewer {
  transform-origin: 50% 52%;
  transition:
    transform 0.42s cubic-bezier(0.16, 1, 0.3, 1),
    filter 0.32s ease;
}

.pdf-preview-enter-from,
.pdf-preview-leave-to { opacity: 0; }

.pdf-preview-enter-from .pdf-preview__viewer,
.pdf-preview-leave-to .pdf-preview__viewer {
  filter: blur(4px);
  transform: translateY(18px) scale(0.975);
}

@media (max-width: 640px) {
  .pdf-preview { padding: 10px; }
  .pdf-preview__notes-layer { padding: 16px; }
  .pdf-preview__layout { height: 100%; }
  .pdf-preview__delete-confirm {
    top: calc(50% + 30px);
    right: 20px;
    width: min(310px, calc(100% - 40px));
    transform: none;
  }
  .pdf-delete-enter-from,
  .pdf-delete-leave-to { transform: translateY(-5px); }

  .pdf-preview__viewer {
    width: 100%;
    height: 100%;
    border-radius: 13px;
  }

  .pdf-preview__close {
    top: -8px;
    right: -5px;
    width: 34px;
    height: 34px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pdf-notes-enter-active, .pdf-notes-leave-active,
  .pdf-notes-enter-active .pdf-preview__notes-card, .pdf-notes-leave-active .pdf-preview__notes-card { transition: none; }
  .pdf-preview__actions-toggle { transition: none; }
  .pdf-preview__notes-toggle,
  .pdf-preview__delete,
  .pdf-delete-enter-active,
  .pdf-delete-leave-active { transition: none; }
  .pdf-preview__viewer iframe,
  .pdf-loading-leave-active { transition: none; }
  .pdf-preview-glass,
  .pdf-preview-enter-active,
  .pdf-preview-leave-active,
  .pdf-preview-enter-active .pdf-preview__viewer,
  .pdf-preview-leave-active .pdf-preview__viewer {
    transition: none;
  }
}
</style>
