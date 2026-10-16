<script setup>
import { onBeforeUnmount, ref, useId, watch } from 'vue'

const props = defineProps({
  documentId: { type: String, required: true },
  passports: { type: Array, default: null },
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
  <div class="contract-passports" :class="{ 'is-expanded': expanded }" @mouseenter="show" @mouseleave="scheduleHide" @focusin="show" @focusout="handleFocusOut" @keydown.esc="handleEscape">
    <button class="contract-passports__trigger" type="button" aria-label="查看合同通行证" :aria-expanded="expanded" :aria-controls="bubbleId" @click="show">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2.5" /><circle cx="12" cy="9" r="2.2" /><path d="M8.5 15c.5-2.8 6.5-2.8 7 0M9 18h6" /></svg>
    </button>
    <Transition name="passport-bubble">
      <section v-if="expanded" :id="bubbleId" class="contract-passports__bubble" aria-label="合同通行证" @mouseenter="show">
        <h3>通行证 <span v-if="passports?.length">{{ passports.length }}</span></h3>
        <ol v-if="passports?.length" class="contract-passports__list selectable-content" aria-label="通行证列表" tabindex="0">
          <li v-for="(passport, index) in passports" :key="index"><span class="contract-passports__index" aria-hidden="true">{{ index + 1 }}</span><span class="contract-passports__value">{{ passport }}</span></li>
        </ol>
        <p v-else class="contract-passports__empty" role="status">暂无通行证</p>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.contract-passports { position: absolute; z-index: 4; top: 76px; left: 116px; }
.contract-passports.is-expanded { z-index: 5; }
.contract-passports__trigger { display: grid; place-items: center; width: 38px; height: 38px; padding: 9px; border: 1px solid #ffffffb3; border-radius: 50%; background: linear-gradient(145deg, #f0f5fb, #d5e1ef); color: #466483; box-shadow: 0 4px 14px #243c5926, inset 0 1px #fff; cursor: pointer; transition: background .18s, transform .18s; }
.contract-passports__trigger:hover, .contract-passports__trigger[aria-expanded="true"] { background: #e8f0fa; transform: translateY(-1px); }
.contract-passports__trigger:focus-visible, .contract-passports__list:focus-visible { outline: 2px solid #829fbe; outline-offset: 3px; }
.contract-passports__trigger svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.contract-passports__bubble { position: absolute; top: calc(100% + 12px); left: -96px; box-sizing: border-box; width: min(380px, calc(100vw - 100px)); padding: 18px; border: 1px solid #ffffffc4; border-radius: 14px; background: #f1f5faf7; color: #354960; box-shadow: 0 16px 44px #152a4433, 0 3px 8px #152a4414; backdrop-filter: blur(18px); }
.contract-passports__bubble::before { content: ''; position: absolute; left: 0; top: -12px; width: 100%; height: 12px; }
.contract-passports__bubble::after { content: ''; position: absolute; left: 110px; top: -5px; width: 9px; height: 9px; transform: rotate(45deg); background: #f1f5fa; border-top: 1px solid #ffffffc4; border-left: 1px solid #ffffffc4; }
.contract-passports__bubble h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 14px; font-weight: 600; }
.contract-passports__bubble h3 span { color: #8194a8; font-size: 11px; font-weight: 400; }
.contract-passports__list { max-height: min(280px, calc(100dvh - 270px)); margin: 0; padding: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; list-style: none; }
.contract-passports__list li { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid #829fbe26; font-size: 12px; line-height: 1.7; }
.contract-passports__list li:first-child { padding-top: 0; }
.contract-passports__list li:last-child { padding-bottom: 0; border-bottom: 0; }
.contract-passports__index { flex: none; min-width: 18px; color: #8b9db0; font-size: 10px; line-height: 2; user-select: none; }
.contract-passports__value { min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.contract-passports__empty { margin: 0; color: #8194a8; font-size: 12px; line-height: 1.8; }
.passport-bubble-enter-active, .passport-bubble-leave-active { transition: opacity .18s ease, transform .2s ease; }
.passport-bubble-enter-from, .passport-bubble-leave-to { opacity: 0; transform: translateY(5px); }
@media (prefers-reduced-motion: reduce) { .contract-passports__trigger, .passport-bubble-enter-active, .passport-bubble-leave-active { transition: none; } }
</style>
