<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'

const props = defineProps({ text: { type: String, required: true }, lines: { type: Number, default: 1 }, maxCharacters: { type: Number, default: 0 } })
const displayText = computed(() => {
  const characters = Array.from(props.text)
  return props.maxCharacters > 0 && characters.length > props.maxCharacters
    ? `${characters.slice(0, props.maxCharacters).join('')}…` : props.text
})
const textElement = ref(null)
const bubble = ref(null)
const truncated = ref(false)
const visible = ref(false)
const bubbleId = useId()
const position = ref({})
let observer
let hideTimer

function hide() {
  clearTimeout(hideTimer)
  bubble.value?.hidePopover()
  visible.value = false
}
function measure() {
  const element = textElement.value
  truncated.value = displayText.value !== props.text || Boolean(element && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1))
  hide()
}
async function show() {
  clearTimeout(hideTimer)
  if (!truncated.value || visible.value) return
  visible.value = true
  const rect = textElement.value.getBoundingClientRect()
  const width = Math.min(380, window.innerWidth - 24)
  const side = rect.left >= width + 20 ? 'left'
    : window.innerWidth - rect.right >= width + 20 ? 'right' : null
  const roomBelow = window.innerHeight - rect.bottom - 20
  const roomAbove = rect.top - 20
  const below = roomBelow >= Math.min(200, roomAbove)
  const left = side === 'left' ? rect.left - width - 8
    : side === 'right' ? rect.right + 8
      : Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
  position.value = {
    width: `${width}px`,
    maxHeight: `${Math.max(60, Math.min(360, side ? window.innerHeight - 24 : below ? roomBelow : roomAbove))}px`,
    left: `${left}px`,
    top: '0px',
  }
  await nextTick()
  if (!visible.value || !bubble.value) return
  bubble.value.showPopover()
  const height = bubble.value.getBoundingClientRect().height
  const top = side ? rect.top + (rect.height - height) / 2 : below ? rect.bottom + 8 : rect.top - height - 8
  position.value.top = `${Math.max(12, Math.min(top, window.innerHeight - height - 12))}px`
}
function keepOpen() { clearTimeout(hideTimer) }
function scheduleHide() { clearTimeout(hideTimer); hideTimer = window.setTimeout(hide, 140) }
function handleEscape(event) {
  if (!visible.value) return
  event.preventDefault()
  event.stopPropagation()
  hide()
}
function handleScroll(event) {
  if (!bubble.value?.contains(event.target)) hide()
}
watch(() => [props.text, props.maxCharacters], async () => { await nextTick(); measure() })
onMounted(() => {
  observer = new ResizeObserver(measure)
  observer.observe(textElement.value)
  window.addEventListener('scroll', handleScroll, true)
  window.addEventListener('resize', hide)
})
onBeforeUnmount(() => {
  clearTimeout(hideTimer)
  observer?.disconnect()
  window.removeEventListener('scroll', handleScroll, true)
  window.removeEventListener('resize', hide)
})
</script>

<template>
  <span class="truncated-text" @mouseenter="show" @mouseleave="scheduleHide" @keydown.esc="handleEscape">
    <span ref="textElement" class="truncated-text__value" :class="{ 'is-multiline': lines > 1, 'is-truncated': truncated }" :style="{ '--text-lines': lines }" :tabindex="truncated ? 0 : undefined" :aria-describedby="visible ? bubbleId : undefined" @focus="show" @blur="scheduleHide" @click="show">{{ displayText }}</span>
    <span :id="bubbleId" ref="bubble" popover="manual" role="tooltip" class="truncated-text__bubble" :style="position" @mouseenter="keepOpen" @mouseleave="scheduleHide">{{ text }}</span>
  </span>
</template>

<style scoped>
.truncated-text { display: block; min-width: 0; }
.truncated-text__value { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.truncated-text__value.is-multiline { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: var(--text-lines); white-space: pre-wrap; overflow-wrap: anywhere; }
.truncated-text__value.is-truncated { cursor: help; }
.truncated-text__value:focus-visible { outline: 2px solid #829d88; outline-offset: 3px; border-radius: 3px; }
.truncated-text__bubble { position: fixed; inset: auto; margin: 0; box-sizing: border-box; padding: 14px 16px; overflow: auto; overscroll-behavior: contain; border: 1px solid #ffffffb3; border-radius: 12px; background: #f8faf5f7; color: #30443a; box-shadow: 0 12px 36px #17291f33, 0 2px 6px #17291f14; backdrop-filter: blur(16px); font: 13px/1.85 system-ui, sans-serif; white-space: pre-wrap; overflow-wrap: anywhere; text-align: left; scrollbar-width: thin; }
.truncated-text__bubble:popover-open { animation: text-bubble-in .16s ease-out; }
@keyframes text-bubble-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .truncated-text__bubble:popover-open { animation: none; } }
</style>
