<script setup>
import { onBeforeUnmount, ref, useId, watch } from 'vue'

const props = defineProps({
  documentId: { type: String, required: true },
  fileLevel: { type: String, default: null },
})
const expanded = ref(false)
const bubbleId = useId()
let closeTimer
function show() {
  window.clearTimeout(closeTimer)
  expanded.value = true
}
function hide() {
  window.clearTimeout(closeTimer)
  expanded.value = false
}
function scheduleHide() {
  window.clearTimeout(closeTimer)
  closeTimer = window.setTimeout(hide, 140)
}
function handleFocusOut(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) scheduleHide()
}
function handleEscape(event) {
  if (!expanded.value) return
  event.preventDefault()
  event.stopPropagation()
  hide()
}
watch(() => props.documentId, hide)
onBeforeUnmount(() => window.clearTimeout(closeTimer))
</script>

<template>
  <div class="contract-file-level" :class="{ 'is-expanded': expanded }" @mouseenter="show" @mouseleave="scheduleHide" @focusin="show" @focusout="handleFocusOut" @keydown.esc="handleEscape">
    <button class="contract-file-level__trigger" type="button" aria-label="查看文件等级" :aria-expanded="expanded" :aria-controls="bubbleId" @click="show">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M6 16v-4h3v4M11 16V8h3v8M16 16V4h3v12" /></svg>
    </button>
    <Transition name="file-level-bubble">
      <section v-if="expanded" :id="bubbleId" class="contract-file-level__bubble" aria-label="文件等级" @mouseenter="show">
        <h3>文件等级</h3>
        <p v-if="fileLevel !== null" class="contract-file-level__value selectable-content">{{ fileLevel }}</p>
        <p v-else class="contract-file-level__empty" role="status">暂无文件等级</p>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.contract-file-level { position: absolute; z-index: 4; top: 76px; left: 164px; }
.contract-file-level.is-expanded { z-index: 5; }
.contract-file-level__trigger { display: grid; place-items: center; width: 38px; height: 38px; padding: 8px; border: 1px solid #ffffffb3; border-radius: 50%; background: linear-gradient(145deg, #f0f5fb, #d5e1ef); color: #466483; box-shadow: 0 4px 14px #243c5926, inset 0 1px #fff; cursor: pointer; transition: background .18s, transform .18s; }
.contract-file-level__trigger:hover, .contract-file-level__trigger[aria-expanded="true"] { background: #e8f0fa; transform: translateY(-1px); }
.contract-file-level__trigger:focus-visible { outline: 2px solid #829fbe; outline-offset: 3px; }
.contract-file-level__trigger svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.contract-file-level__bubble { position: absolute; top: calc(100% + 12px); left: -144px; box-sizing: border-box; width: min(380px, calc(100vw - 100px)); padding: 18px; border: 1px solid #ffffffc4; border-radius: 14px; background: #f1f5faf7; color: #354960; box-shadow: 0 16px 44px #152a4433, 0 3px 8px #152a4414; backdrop-filter: blur(18px); }
.contract-file-level__bubble::before { content: ''; position: absolute; left: 0; top: -12px; width: 100%; height: 12px; }
.contract-file-level__bubble::after { content: ''; position: absolute; left: 158px; top: -5px; width: 9px; height: 9px; transform: rotate(45deg); background: #f1f5fa; border-top: 1px solid #ffffffc4; border-left: 1px solid #ffffffc4; }
.contract-file-level__bubble h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
.contract-file-level__value { max-height: min(280px, calc(100dvh - 270px)); margin: 0; overflow-y: auto; overflow-wrap: anywhere; color: #466483; font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.5; }
.contract-file-level__empty { margin: 0; color: #8194a8; font-size: 12px; line-height: 1.8; }
.file-level-bubble-enter-active, .file-level-bubble-leave-active { transition: opacity .18s ease, transform .2s ease; }
.file-level-bubble-enter-from, .file-level-bubble-leave-to { opacity: 0; transform: translateY(5px); }
@media (prefers-reduced-motion: reduce) { .contract-file-level__trigger, .file-level-bubble-enter-active, .file-level-bubble-leave-active { transition: none; } }
</style>
