<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import surpriseImage from '../assets/surprise.webp'

const props = defineProps({
  open: Boolean,
  name: { type: String, default: '' },
  busy: Boolean,
  error: { type: String, default: '' },
})
const emit = defineEmits(['close', 'confirm'])
const dialog = ref(null)
const input = ref(null)
const confirmation = ref('')
const expected = computed(() => `我确认删除${props.name}`)
const allowed = computed(() => confirmation.value === expected.value && !props.busy)
let previousFocus = null

watch(() => props.open, async (open) => {
  await nextTick()
  if (!dialog.value) return
  if (open) {
    previousFocus = document.activeElement
    confirmation.value = ''
    if (!dialog.value.open) dialog.value.showModal()
    input.value?.focus()
  } else if (dialog.value.open) {
    dialog.value.close()
    if (previousFocus?.isConnected) previousFocus.focus()
  }
}, { immediate: true })
watch(() => props.name, () => { confirmation.value = '' })
function close() { if (!props.busy) emit('close') }
function confirm() { if (allowed.value) emit('confirm', confirmation.value) }
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="conversation-delete-dialog" aria-labelledby="conversation-delete-title" aria-describedby="conversation-delete-description" :aria-busy="busy" @cancel.prevent="close" @click.self="close">
      <form class="conversation-delete-dialog__card" @submit.prevent="confirm">
        <header>
          <img class="conversation-delete-dialog__illustration" :src="surpriseImage" width="96" height="96" alt="" />
          <button type="button" class="conversation-delete-dialog__close" :disabled="busy" aria-label="关闭删除确认" @click="close">×</button>
        </header>
        <h2 id="conversation-delete-title">删除这段会话？</h2>
        <p class="conversation-delete-dialog__name">{{ name }}</p>
        <p id="conversation-delete-description">会话及关联记录将被永久删除，待发送消息也会清除。此操作无法撤销。</p>
        <div class="conversation-delete-dialog__confirmation">
        <label for="conversation-delete-input">请输入以下文字以确认</label>
        <div class="conversation-delete-dialog__phrase">{{ expected }}</div>
        <input id="conversation-delete-input" ref="input" v-model="confirmation" type="text" autocomplete="off" :spellcheck="false" :disabled="busy" placeholder="在此输入确认文字" aria-describedby="conversation-delete-error" />
        <p v-if="error" id="conversation-delete-error" class="conversation-delete-dialog__error" role="alert">{{ error }}</p>
        </div>
        <footer>
          <button type="button" :disabled="busy" @click="close">保留会话</button>
          <button type="submit" class="conversation-delete-dialog__submit" :disabled="!allowed">{{ busy ? '正在删除…' : '永久删除' }}</button>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.conversation-delete-dialog { width: min(460px, calc(100vw - 40px)); max-height: calc(100dvh - 48px); padding: 0; border: 1px solid #ffffffdf; border-radius: 28px; background: radial-gradient(ellipse at 50% 0%, #fff4d9 0%, transparent 47%), #f9faf6; color: #364239; box-shadow: 0 32px 100px #16271c38, 0 8px 24px #16271c12, inset 0 1px 0 #fff; overflow: auto; }
.conversation-delete-dialog::backdrop { background: #17271e65; backdrop-filter: blur(7px); }
.conversation-delete-dialog[open] { animation: delete-dialog-enter .24s ease both; }
.conversation-delete-dialog__card { position: relative; padding: 30px; }
header { display: flex; justify-content: center; }
.conversation-delete-dialog__illustration { display: block; width: 96px; height: 96px; object-fit: contain; filter: drop-shadow(0 7px 9px #b888321a); }
button { font: inherit; cursor: pointer; }
.conversation-delete-dialog__close { position: absolute; top: 15px; right: 15px; display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid #e6e8e066; border-radius: 50%; background: #ffffff80; color: #92998e; font-size: 22px; line-height: 1; transition: color .2s, background .2s; }
.conversation-delete-dialog__close:hover:not(:disabled) { background: #fff; color: #4f5e50; }
h2 { margin: 18px 0 10px; text-align: center; font-size: 23px; font-weight: 600; letter-spacing: -.5px; }
p { margin: 10px 0; font-size: 13px; line-height: 1.75; overflow-wrap: anywhere; }
.conversation-delete-dialog__name { width: fit-content; max-width: 100%; box-sizing: border-box; margin: 0 auto 18px; padding: 4px 12px; border: 1px solid #e3e7dd; border-radius: 9px; background: #eff2e980; color: #677660; font-size: 12px; font-weight: 500; text-align: center; }
#conversation-delete-description { margin-inline: 8px; color: #647063; text-align: center; }
.conversation-delete-dialog__confirmation { margin-top: 22px; padding: 16px; border: 1px solid #e2e7de; border-radius: 16px; background: #edf1e866; box-shadow: inset 0 1px 0 #ffffff9c; }
label { display: block; margin: 0 0 7px; color: #82907d; font-size: 11px; }
.conversation-delete-dialog__phrase { margin-bottom: 12px; font-size: 13px; font-weight: 500; line-height: 1.65; overflow-wrap: anywhere; user-select: text; }
input { box-sizing: border-box; width: 100%; padding: 12px 14px; border: 1px solid #d4ded5; border-radius: 11px; background: #fff9; color: #354439; font: inherit; font-size: 13px; transition: border-color .2s, box-shadow .2s; }
input:focus { outline: none; border-color: #9cafa1; box-shadow: 0 0 0 3px #99b19f1a; }
input::placeholder { color: #a0aaa2; }
.conversation-delete-dialog__error { color: #b05d54; font-size: 12px; }
footer { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 20px; }
footer button { padding: 12px 17px; border: 1px solid #dce3db; border-radius: 12px; background: #fff8; color: #607165; font-size: 13px; transition: background .2s; }
footer button:hover:not(:disabled) { background: #fff; }
footer .conversation-delete-dialog__submit { border-color: transparent; background: #ae5e54; color: #fff; box-shadow: 0 3px 8px #974e4614; transition: opacity .2s, background .2s; }
footer .conversation-delete-dialog__submit:disabled { background: #eee4df; color: #b69b90; box-shadow: none; opacity: 1; }
footer .conversation-delete-dialog__submit:hover:not(:disabled) { background: #974e46; }
button:disabled { opacity: .42; cursor: not-allowed; }
button:focus-visible { outline: 2px solid #879f8e; outline-offset: 3px; }
@keyframes delete-dialog-enter { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .conversation-delete-dialog[open] { animation: none; } }
@media (max-width: 420px) { .conversation-delete-dialog__card { padding: 24px 20px; } }
</style>
