<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import logoUrl from '../assets/logo.webp'

const props = defineProps({
  loading: {
    type: Boolean,
    default: false,
  },
  error: {
    type: String,
    default: '',
  },
  notice: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['input', 'submit'])

const contentRef = ref(null)
const accessKey = ref('')
const localError = ref('')
const passwordVisible = ref(false)
const pressing = ref(false)
const cardHeight = ref('auto')
const heightReady = ref(false)

let resizeObserver = null
let readyFrame = 0
let pressFrame = 0
let pressTimer = 0

const inputType = computed(() => (passwordVisible.value ? 'text' : 'password'))
const displayedError = computed(() => localError.value || props.error)

function updateHeight() {
  if (!contentRef.value) return

  cardHeight.value = `${Math.ceil(contentRef.value.scrollHeight) + 2}px`
}

function clearError() {
  localError.value = ''
  emit('input')
}

function pressField() {
  window.cancelAnimationFrame(pressFrame)
  window.clearTimeout(pressTimer)
  pressing.value = false

  pressFrame = window.requestAnimationFrame(() => {
    pressing.value = true
    pressTimer = window.setTimeout(() => {
      pressing.value = false
    }, 150)
  })
}

function submit() {
  if (props.loading) return

  pressField()
  const value = accessKey.value.trim()

  if (!value) {
    localError.value = '请输入管理密钥'
    return
  }

  localError.value = ''
  emit('submit', value)
}

onMounted(() => {
  updateHeight()
  resizeObserver = new ResizeObserver(updateHeight)
  resizeObserver.observe(contentRef.value)
  readyFrame = window.requestAnimationFrame(() => {
    heightReady.value = true
  })
})

onBeforeUnmount(() => {
  window.cancelAnimationFrame(readyFrame)
  window.cancelAnimationFrame(pressFrame)
  window.clearTimeout(pressTimer)
  resizeObserver?.disconnect()
})
</script>

<template>
  <section
    class="access-key-card"
    :class="{ 'access-key-card--height-ready': heightReady }"
    :style="{ height: cardHeight }"
    aria-labelledby="access-key-title"
  >
    <div ref="contentRef" class="access-key-card__content">
      <header class="access-key-card__header">
        <div class="access-key-card__logo-wrap">
          <img
            class="access-key-card__logo"
            :src="logoUrl"
            alt="现象合同智能管理平台标志"
            draggable="false"
          />
        </div>

        <div class="access-key-card__heading">
          <h1 id="access-key-title">现象合同智能管理平台</h1>
          <div class="access-key-card__accent" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      </header>

      <form class="access-key-card__form" novalidate @submit.prevent="submit">
        <label class="access-key-card__label" for="access-key">管理密钥</label>

        <div class="access-key-card__credential">
          <span class="access-key-card__corner access-key-card__corner--top-left"></span>
          <span class="access-key-card__corner access-key-card__corner--top-right"></span>
          <span class="access-key-card__corner access-key-card__corner--bottom-left"></span>
          <span class="access-key-card__corner access-key-card__corner--bottom-right"></span>

          <div
            class="access-key-card__field"
            :class="{
              'access-key-card__field--invalid': displayedError,
              'access-key-card__field--pressing': pressing,
              'access-key-card__field--loading': loading,
            }"
          >
            <span class="access-key-card__field-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M8.25 10V7.5C8.25 5.15 9.8 3.75 12 3.75s3.75 1.4 3.75 3.75V10" />
                <rect x="5" y="10" width="14" height="10" rx="1" />
                <path d="M12 14v2.5" />
              </svg>
            </span>

            <input
              id="access-key"
              v-model="accessKey"
              class="access-key-card__input"
              :type="inputType"
              name="access-key"
              placeholder="输入管理密钥"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              :disabled="loading"
              :aria-invalid="Boolean(displayedError)"
              :aria-describedby="displayedError || notice ? 'access-key-message' : undefined"
              @input="clearError"
            />

            <button
              class="access-key-card__visibility"
              type="button"
              :disabled="loading"
              :aria-label="passwordVisible ? '隐藏密钥' : '显示密钥'"
              @click="passwordVisible = !passwordVisible"
            >
              <svg v-if="passwordVisible" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 12s3.4-5 9-5 9 5 9 5-3.4 5-9 5-9-5-9-5Z" />
                <circle cx="12" cy="12" r="2.5" />
              </svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                <path d="m4 4 16 16" />
                <path d="M10.6 7.2A9.7 9.7 0 0 1 12 7c5.6 0 9 5 9 5a16 16 0 0 1-2.1 2.5" />
                <path d="M6.3 6.4C4.2 7.8 3 9.6 3 12c0 0 3.4 5 9 5 1.4 0 2.7-.3 3.8-.8" />
                <path d="M9.9 9.8a3 3 0 0 0 4.3 4.3" />
              </svg>
            </button>

            <span class="access-key-card__decoration" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
            </span>

            <button
              class="access-key-card__submit"
              type="submit"
              :disabled="loading"
              :aria-busy="loading"
              :aria-label="loading ? '正在验证密钥' : '验证密钥并登录'"
            >
              <Transition name="access-key-submit-icon" mode="out-in">
                <span :key="loading ? 'loading' : 'idle'" class="access-key-card__submit-content">
                  <span v-if="loading" class="access-key-card__spinner"></span>
                  <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12h10M12 7l5 5-5 5" />
                    <path d="M19 4v16" />
                  </svg>
                </span>
              </Transition>
            </button>
          </div>

          <span class="access-key-card__field-glow" aria-hidden="true"></span>
          <span class="access-key-card__field-label">管理密钥</span>
          <span class="access-key-card__field-status">
            {{ loading ? '正在安全校验' : '安全校验通道已就绪' }}
          </span>
        </div>

        <Transition name="access-key-message" mode="out-in">
          <p
            v-if="displayedError"
            id="access-key-message"
            key="error"
            class="access-key-card__message access-key-card__message--error"
            role="alert"
          >
            {{ displayedError }}
          </p>
          <p
            v-else-if="notice"
            id="access-key-message"
            key="notice"
            class="access-key-card__message"
            role="status"
          >
            {{ notice }}
          </p>
        </Transition>
      </form>
    </div>
  </section>
</template>

<style scoped>
.access-key-card {
  position: relative;
  z-index: 1;
  width: min(620px, 100%);
  overflow: hidden;
  color: #18231d;
  user-select: none;
  background: linear-gradient(145deg, #ffffffc7, #f2f7ff94);
  border: 1px solid #ffffffc2;
  border-radius: 36px;
  box-shadow:
    inset 0 1px #ffffffdb,
    0 34px 90px #252d603d,
    0 8px 28px #284b5b1f;
  backdrop-filter: blur(30px) saturate(128%);
}

.access-key-card::before {
  position: absolute;
  z-index: 0;
  inset: 0;
  content: '';
  pointer-events: none;
  background:
    radial-gradient(circle at 90% 10%, #7464df2e, transparent 34%),
    radial-gradient(circle at 8% 100%, #3fc4a226, transparent 38%);
}

.access-key-card::after {
  position: absolute;
  z-index: 3;
  inset: 8px;
  content: '';
  pointer-events: none;
  border: 1px solid #ffffff4d;
  border-radius: 29px;
}

.access-key-card--height-ready {
  transition: height 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}

.access-key-card__content {
  position: relative;
  z-index: 2;
  padding: 38px 40px 40px;
}

.access-key-card__header {
  display: flex;
  gap: 22px;
  align-items: center;
  text-align: left;
}

.access-key-card__logo-wrap {
  display: grid;
  flex: none;
  place-items: center;
  width: 74px;
  height: 74px;
  background: linear-gradient(145deg, #ffffffd1, #edf5ff94);
  border: 1px solid #ffffffe0;
  border-radius: 25px;
  box-shadow:
    inset 0 1px #ffffffe6,
    0 14px 32px #374b7224;
}

.access-key-card__logo {
  width: 58px;
  height: 58px;
  object-fit: contain;
  pointer-events: none;
}

.access-key-card__heading {
  flex: 1;
  min-width: 0;
}

.access-key-card h1 {
  margin: 0;
  color: #19271f;
  font-size: clamp(29px, 4vw, 38px);
  font-weight: 900;
  line-height: 1.18;
  letter-spacing: 0.035em;
  text-shadow:
    0 1px #ffffffd1,
    0 4px 9px #36483f2e,
    0 13px 30px #5b49a733;
}

.access-key-card__accent {
  display: flex;
  gap: 6px;
  align-items: center;
  height: 5px;
  margin-top: 14px;
}

.access-key-card__accent span {
  width: 7px;
  height: 5px;
  background: #7063d870;
  border-radius: 999px;
}

.access-key-card__accent span:first-child {
  width: 52px;
  background: linear-gradient(90deg, #6659ce, #48bfa1);
}

.access-key-card__accent span:last-child {
  background: #48bfa173;
}

.access-key-card__form {
  margin-top: 34px;
}

.access-key-card__label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  white-space: nowrap;
  border: 0;
  clip: rect(0, 0, 0, 0);
}

.access-key-card__credential {
  position: relative;
  width: 100%;
  padding: 24px 0 22px;
}

.access-key-card__field {
  position: relative;
  isolation: isolate;
  transform-origin: bottom;
  display: flex;
  align-items: center;
  height: 58px;
  overflow: hidden;
  background: linear-gradient(145deg, #18181a 0%, #0c0c0b 50%, #141413 100%);
  border: 2px solid #2a2820;
  box-shadow:
    0 8px 30px #0009,
    0 0 0 1px #6b8a3a14,
    inset 0 2px 6px #00000080;
  transition:
    transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    border-color 0.4s,
    box-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    background 0.4s;
  transform: translateY(0);
}

.access-key-card__field::before {
  position: absolute;
  z-index: 2;
  inset: 0 0 auto;
  height: 2px;
  content: '';
  opacity: 0;
  background: linear-gradient(90deg, transparent, #4a5a2a 15%, #8ba859 50%, #4a5a2a 85%, transparent);
  transition: opacity 0.4s;
}

.access-key-card__field::after {
  position: absolute;
  z-index: 1;
  inset: 0;
  content: '';
  pointer-events: none;
  background: repeating-linear-gradient(0deg, transparent, transparent 3px, #00000005 3px 6px);
}

.access-key-card__field:focus-within {
  background: linear-gradient(145deg, #1c1c1d 0%, #0b0b0b 50%, #171714 100%);
  border-color: #4a5a2a;
  transform: translateY(-2px);
  box-shadow:
    0 12px 40px #000000b3,
    0 0 30px #6b8a3a1a,
    0 0 0 1px #6b8a3a4d,
    inset 0 2px 6px #00000080;
}

.access-key-card__field:focus-within::before {
  opacity: 1;
  animation: field-line-glow 2s ease-in-out infinite;
}

.access-key-card__field--pressing,
.access-key-card__field--pressing:focus-within {
  transition-duration: 80ms;
  transform: translateY(3px) scale(0.996);
  box-shadow:
    inset 0 3px 8px #000000a3,
    0 3px 12px #00000061;
}

.access-key-card__field--loading {
  border-color: #62783a;
  box-shadow:
    0 10px 34px #000000a8,
    0 0 25px #7ea34f24,
    inset 0 2px 6px #00000094;
}

.access-key-card__field--loading::before {
  opacity: 1;
  animation: field-line-glow 2s ease-in-out infinite;
}

.access-key-card__field--invalid {
  border-color: #8f3d45;
  box-shadow:
    0 10px 34px #000000a8,
    0 0 22px #c0485121,
    inset 0 2px 6px #00000094;
}

.access-key-card__field--invalid::before {
  opacity: 1;
  background: linear-gradient(90deg, transparent, #7d3039 15%, #d56c72 50%, #7d3039 85%, transparent);
}

.access-key-card__field-icon,
.access-key-card__input,
.access-key-card__visibility,
.access-key-card__decoration,
.access-key-card__submit {
  position: relative;
  z-index: 3;
}

.access-key-card__field-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 48px;
  height: 100%;
  color: #5a5a4a;
  background: linear-gradient(135deg, #2a28204d, transparent);
}

.access-key-card__field-icon::after {
  position: absolute;
  top: 50%;
  right: 0;
  width: 1px;
  height: 24px;
  content: '';
  background: linear-gradient(transparent, #3a3830, transparent);
  transform: translateY(-50%);
}

.access-key-card__field-icon svg,
.access-key-card__visibility svg,
.access-key-card__submit svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8px;
}

.access-key-card__field-icon svg {
  width: 19px;
  height: 19px;
  stroke-width: 1.8px;
}

.access-key-card__field:focus-within .access-key-card__field-icon {
  color: #8ba859;
}

.access-key-card__field:focus-within .access-key-card__field-icon svg {
  filter: drop-shadow(0 0 8px #8ba85999);
  animation: field-icon-pulse 2s ease-in-out infinite;
}

.access-key-card__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 10px;
  color: #e0e0d0;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.07em;
  background: transparent;
  border: 0;
  outline: 0;
}

.access-key-card__input::placeholder {
  color: #5a5a4a;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.1em;
}

.access-key-card__input:focus::placeholder {
  color: #71834d;
}

.access-key-card__visibility {
  display: grid;
  place-items: center;
  width: 36px;
  height: 100%;
  padding: 0;
  color: #606052;
  cursor: pointer;
  background: transparent;
  border: 0;
  transition: color 0.22s, transform 0.22s;
}

.access-key-card__visibility:hover {
  color: #afc77d;
  transform: scale(1.08);
}

.access-key-card__visibility svg {
  width: 17px;
  height: 17px;
}

.access-key-card__visibility:disabled,
.access-key-card__input:disabled {
  cursor: not-allowed;
  opacity: 0.64;
}

.access-key-card__visibility:focus-visible,
.access-key-card__submit:focus-visible {
  outline: 2px solid #b5d27e;
  outline-offset: -4px;
}

.access-key-card__decoration {
  display: flex;
  gap: 5px;
  align-items: center;
  padding: 6px 8px;
  margin-right: 8px;
  background: linear-gradient(135deg, #6b8a3a1f, #6b8a3a0d);
  border: 1px solid #6b8a3a40;
  border-radius: 2px;
}

.access-key-card__decoration::before {
  position: absolute;
  top: -8px;
  left: 5px;
  padding: 0 3px;
  color: #5a6a3a;
  font-family: Consolas, monospace;
  font-size: 7px;
  letter-spacing: 1.1px;
  content: 'SECURE';
  background: #141413;
}

.access-key-card__decoration span {
  width: 6px;
  height: 6px;
  background: radial-gradient(circle, #a0c060, #6b8a3a 50%, #3a4a1a);
  border-radius: 50%;
  box-shadow:
    0 0 6px #8ba85980,
    inset 0 -1px 3px #0000004d;
  animation: status-pulse 2s ease-in-out infinite;
}

.access-key-card__decoration span:nth-child(2) {
  width: 4px;
  height: 4px;
  animation-delay: 0.3s;
}

.access-key-card__decoration span:nth-child(3) {
  width: 7px;
  height: 7px;
  animation-delay: 0.6s;
}

.access-key-card__submit {
  display: grid;
  flex: none;
  place-items: center;
  width: 54px;
  height: 100%;
  padding: 0;
  color: #9fbc68;
  cursor: pointer;
  background: linear-gradient(145deg, #3a4a1a, #2a3a10 50%, #1a2a08);
  border: 0;
  border-left: 1px solid #4a5a2a;
  overflow: hidden;
  transition:
    background 0.3s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.18s,
    color 0.3s;
}

.access-key-card__submit::before {
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  content: '';
  background: linear-gradient(90deg, transparent, #8ba85933, transparent);
  transition: left 0.5s;
}

.access-key-card__submit::after {
  position: absolute;
  inset: 0;
  content: '';
  opacity: 0;
  background: radial-gradient(circle, #8ba85933, transparent 70%);
  transition: opacity 0.3s;
}

.access-key-card__submit:disabled {
  color: #c6dc8e;
  cursor: wait;
  opacity: 1;
}

@media (hover: hover) {
  .access-key-card__submit:hover:not(:disabled) {
    color: #d2e99d;
    background: linear-gradient(145deg, #4a5a2a, #3a4a1a 50%, #2a3a10);
    box-shadow: inset 0 0 20px #8ba8591f;
  }

  .access-key-card__submit:hover:not(:disabled)::before {
    left: 100%;
  }

  .access-key-card__submit:hover:not(:disabled)::after {
    opacity: 1;
  }

  .access-key-card__submit:hover:not(:disabled) svg {
    filter: drop-shadow(0 0 5px #c0d08080);
    transform: translateX(3px) scale(1.05);
  }
}

.access-key-card__submit:active:not(:disabled) {
  transform: scale(0.96);
}

.access-key-card__submit-content {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
}

.access-key-card__spinner {
  width: 17px;
  height: 17px;
  background: conic-gradient(#ff71ae, #ffc35c, #4ed9b7, #67a1ff, #a276ff, #ff71ae);
  border-radius: 50%;
  animation: spinner 0.8s linear infinite;
  mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 0);
}

.access-key-card__field-glow {
  position: absolute;
  bottom: 16px;
  left: 50%;
  width: 85%;
  height: 30px;
  pointer-events: none;
  opacity: 0;
  background: radial-gradient(#8ba85929, transparent 60%);
  filter: blur(6px);
  transition: opacity 0.5s;
  transform: translateX(-50%);
}

.access-key-card__field:focus-within + .access-key-card__field-glow {
  opacity: 1;
}

.access-key-card__field-label,
.access-key-card__field-status {
  position: absolute;
  display: flex;
  align-items: center;
  color: #74775e;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
}

.access-key-card__field-label {
  top: 0;
  left: 0;
}

.access-key-card__field-label::before {
  margin-right: 6px;
  color: #7d8068;
  content: '◆';
}

.access-key-card__field-status {
  right: 0;
  bottom: 0;
  font-size: 9px;
  letter-spacing: 1.25px;
}

.access-key-card__field-status::before {
  width: 5px;
  height: 5px;
  margin-right: 6px;
  content: '';
  background: #5f7937;
  border-radius: 50%;
  box-shadow: 0 0 5px #8ba85980;
  animation: status-light 1.5s ease-in-out infinite;
}

.access-key-card__field:focus-within ~ .access-key-card__field-label {
  color: #7d86bb;
}

.access-key-card__field:focus-within ~ .access-key-card__field-label::before {
  color: #919aca;
}

.access-key-card__field:focus-within ~ .access-key-card__field-status {
  color: #c8dfa0;
  text-shadow: 0 0 8px #8ba8596b;
}

.access-key-card__field:focus-within ~ .access-key-card__field-status::before {
  background: #b6d37d;
  box-shadow: 0 0 9px #b5d37dd1;
}

.access-key-card__corner {
  position: absolute;
  z-index: 4;
  width: 10px;
  height: 10px;
  pointer-events: none;
  border: 1px solid #3a3830;
}

.access-key-card__corner--top-left {
  top: 20px;
  left: -3px;
  border-right: 0;
  border-bottom: 0;
}

.access-key-card__corner--top-right {
  top: 20px;
  right: -3px;
  border-bottom: 0;
  border-left: 0;
}

.access-key-card__corner--bottom-left {
  bottom: 18px;
  left: -3px;
  border-top: 0;
  border-right: 0;
}

.access-key-card__corner--bottom-right {
  right: -3px;
  bottom: 18px;
  border-top: 0;
  border-left: 0;
}

.access-key-card__message {
  margin: 11px 4px 0;
  color: #69736e;
  font-size: 12px;
  line-height: 1.5;
}

.access-key-card__message--error {
  color: #b74151;
}

.access-key-message-enter-active,
.access-key-message-leave-active {
  transition: opacity 0.18s, transform 0.18s;
}

.access-key-message-enter-from,
.access-key-message-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.access-key-submit-icon-enter-active {
  transition:
    opacity 0.32s,
    transform 0.42s cubic-bezier(0.22, 1, 0.36, 1);
}

.access-key-submit-icon-leave-active {
  transition: opacity 0.22s, transform 0.22s;
}

.access-key-submit-icon-enter-from,
.access-key-submit-icon-leave-to {
  opacity: 0;
  transform: scale(0.72);
}

@keyframes field-line-glow {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.55); }
}

@keyframes field-icon-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}

@keyframes status-pulse {
  0%, 100% {
    opacity: 0.5;
    transform: scale(1);
    box-shadow: 0 0 6px #8ba85966;
  }
  50% {
    opacity: 1;
    transform: scale(1.3);
    box-shadow: 0 0 12px #8ba859, 0 0 20px #8ba85966;
  }
}

@keyframes status-light {
  0%, 100% {
    opacity: 0.3;
    box-shadow: 0 0 4px #8ba8594d;
  }
  50% {
    opacity: 1;
    box-shadow: 0 0 8px #8ba859cc;
  }
}

@keyframes spinner {
  to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .access-key-card {
    border-radius: 28px;
  }

  .access-key-card__content {
    padding: 30px 20px 32px;
  }

  .access-key-card__header {
    gap: 16px;
  }

  .access-key-card__logo-wrap {
    width: 64px;
    height: 64px;
    border-radius: 21px;
  }

  .access-key-card__logo {
    width: 49px;
    height: 49px;
  }

  .access-key-card h1 {
    font-size: clamp(27px, 8vw, 34px);
  }

  .access-key-card__credential {
    padding-top: 22px;
  }

  .access-key-card__field {
    height: 56px;
  }

  .access-key-card__field-icon {
    width: 43px;
  }

  .access-key-card__visibility {
    width: 34px;
  }

  .access-key-card__decoration {
    display: none;
  }

  .access-key-card__submit {
    width: 50px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .access-key-card--height-ready,
  .access-key-message-enter-active,
  .access-key-message-leave-active,
  .access-key-submit-icon-enter-active,
  .access-key-submit-icon-leave-active,
  .access-key-card__submit,
  .access-key-card__field,
  .access-key-card__field-glow {
    transition: none;
  }

  .access-key-card *,
  .access-key-card *::before,
  .access-key-card *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
</style>
