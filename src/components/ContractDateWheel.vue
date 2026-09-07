<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  required: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const ITEM_HEIGHT = 34
const currentYear = new Date().getFullYear()
const selected = reactive({ year: null, month: null, day: null })
const yearWheel = ref(null)
const monthWheel = ref(null)
const dayWheel = ref(null)
const settleTimers = { year: null, month: null, day: null }

const years = computed(() => {
  const firstYear = Math.min(1900, selected.year || currentYear)
  const lastYear = Math.max(currentYear + 10, selected.year || currentYear)
  return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index)
})
const months = Array.from({ length: 12 }, (_, index) => index + 1)
const dayCount = computed(() => {
  if (!selected.year || !selected.month) return 31
  return new Date(selected.year, selected.month, 0).getDate()
})
const days = computed(() => Array.from({ length: dayCount.value }, (_, index) => index + 1))

function wheelElement(type) {
  return { year: yearWheel.value, month: monthWheel.value, day: dayWheel.value }[type]
}

function setWheelElement(type, element) {
  if (type === 'year') yearWheel.value = element
  if (type === 'month') monthWheel.value = element
  if (type === 'day') dayWheel.value = element
}

function wheelValues(type) {
  return { year: years.value, month: months, day: days.value }[type]
}

function clearSettleTimer(type) {
  if (settleTimers[type] !== null) window.clearTimeout(settleTimers[type])
  settleTimers[type] = null
}

function alignWheel(type, behavior = 'auto') {
  const element = wheelElement(type)
  if (!element) return
  const valueIndex = wheelValues(type).indexOf(selected[type])
  element.scrollTo({
    top: Math.max(0, valueIndex + 1) * ITEM_HEIGHT,
    behavior,
  })
}

function emitDateIfComplete() {
  if (!selected.year || !selected.month || !selected.day) return
  const month = String(selected.month).padStart(2, '0')
  const day = String(selected.day).padStart(2, '0')
  emit('update:modelValue', `${selected.year}-${month}-${day}`)
}

function selectValue(type, value, { align = true } = {}) {
  if (props.disabled) return
  selected[type] = value
  if (!value) {
    emit('update:modelValue', '')
  } else {
    if ((type === 'year' || type === 'month') && selected.day > dayCount.value) {
      selected.day = dayCount.value
      nextTick(() => alignWheel('day'))
    }
    emitDateIfComplete()
  }
  if (align) nextTick(() => alignWheel(type, 'smooth'))
}

function handleWheelScroll(type) {
  if (props.disabled) return
  clearSettleTimer(type)
  settleTimers[type] = window.setTimeout(() => {
    settleTimers[type] = null
    const element = wheelElement(type)
    if (!element) return
    const optionIndex = Math.round(element.scrollTop / ITEM_HEIGHT) - 1
    selectValue(type, wheelValues(type)[optionIndex] ?? null, { align: false })
    alignWheel(type, 'smooth')
  }, 110)
}

watch(
  () => props.modelValue,
  (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '')
    const year = match ? Number(match[1]) : null
    const month = match ? Number(match[2]) : null
    const day = match ? Number(match[3]) : null
    const candidate = year && month && day ? new Date(Date.UTC(year, month - 1, day)) : null
    const valid = candidate
      && candidate.getUTCFullYear() === year
      && candidate.getUTCMonth() === month - 1
      && candidate.getUTCDate() === day
    selected.year = valid ? year : null
    selected.month = valid ? month : null
    selected.day = valid ? day : null
    nextTick(() => {
      alignWheel('year')
      alignWheel('month')
      alignWheel('day')
    })
  },
  { immediate: true },
)

onBeforeUnmount(() => Object.keys(settleTimers).forEach(clearSettleTimer))
</script>

<template>
  <div
    class="contract-date-wheel"
    :class="{ 'is-disabled': disabled }"
    :aria-required="required"
    aria-label="签订日期"
  >
    <div
      v-for="type in ['year', 'month', 'day']"
      :key="type"
      class="contract-date-wheel__field"
    >
      <div class="contract-date-wheel__column">
        <span class="contract-date-wheel__selection" aria-hidden="true"></span>
        <span class="contract-date-wheel__fade is-top" aria-hidden="true"></span>
        <span class="contract-date-wheel__fade is-bottom" aria-hidden="true"></span>
        <div
          :ref="(element) => setWheelElement(type, element)"
          class="contract-date-wheel__scroller"
          role="listbox"
          :aria-label="`选择${{ year: '年份', month: '月份', day: '日期' }[type]}`"
          :tabindex="disabled ? -1 : 0"
          @scroll.passive="handleWheelScroll(type)"
        >
          <button
            type="button"
            role="option"
            :aria-selected="selected[type] === null"
            :disabled="disabled"
            :class="{ 'is-selected': selected[type] === null }"
            @click="selectValue(type, null)"
          >—</button>
          <button
            v-for="value in wheelValues(type)"
            :key="value"
            type="button"
            role="option"
            :aria-selected="selected[type] === value"
            :disabled="disabled"
            :class="{ 'is-selected': selected[type] === value }"
            @click="selectValue(type, value)"
          >{{ String(value).padStart(type === 'year' ? 4 : 2, '0') }}</button>
        </div>
      </div>
      <strong>{{ { year: '年', month: '月', day: '日' }[type] }}</strong>
    </div>
  </div>
</template>

<style scoped>
.contract-date-wheel {
  position: relative;
  display: grid;
  grid-template-columns: 1.25fr 1fr 1fr;
  gap: 14px;
  width: 100%;
}

.contract-date-wheel__field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 7px;
  align-items: center;
  min-width: 0;
}

.contract-date-wheel__column {
  position: relative;
  min-width: 0;
  height: 72px;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgb(255 255 255 / 15%), transparent 22%, transparent 78%, rgb(137 111 68 / 7%)),
    linear-gradient(180deg, rgb(218 207 187 / 38%), rgb(235 226 208 / 58%) 48%, rgb(211 198 173 / 42%));
  border: 1px solid rgb(139 113 70 / 18%);
  border-radius: 12px;
  box-shadow:
    inset 0 0 0 1px rgb(255 255 255 / 32%),
    inset 0 7px 12px rgb(103 81 45 / 5%),
    inset 0 -7px 12px rgb(103 81 45 / 4%),
    0 4px 10px rgb(77 60 29 / 5%);
  transition: border-color 0.22s ease, box-shadow 0.22s ease, transform 0.22s ease;
}

.contract-date-wheel__column:focus-within {
  border-color: rgb(152 119 60 / 38%);
  box-shadow:
    inset 0 0 0 1px rgb(255 255 255 / 78%),
    inset 0 7px 12px rgb(103 81 45 / 5%),
    inset 0 -7px 12px rgb(103 81 45 / 4%),
    0 7px 18px rgb(77 60 29 / 10%);
  transform: translateY(-1px);
}

.contract-date-wheel__field > strong {
  color: #7f6c4c;
  font-size: 11px;
  font-weight: 680;
  letter-spacing: 0.04em;
}

.contract-date-wheel__scroller {
  position: relative;
  z-index: 2;
  height: 72px;
  padding-block: 19px;
  overflow: hidden auto;
  scrollbar-width: none;
  overscroll-behavior: contain;
  scroll-snap-type: y mandatory;
}

.contract-date-wheel__scroller::-webkit-scrollbar {
  display: none;
}

.contract-date-wheel__scroller:focus-visible {
  outline: none;
}

.contract-date-wheel__scroller button {
  display: block;
  width: 100%;
  height: 34px;
  padding: 0 8px;
  color: #9b958a;
  font: inherit;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  background: transparent;
  border: 0;
  opacity: 0.38;
  scroll-snap-align: center;
  transition: color 0.2s ease, font-size 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
}

.contract-date-wheel__scroller button.is-selected {
  color: #403b32;
  font-size: 15px;
  font-weight: 680;
  letter-spacing: 0.025em;
  opacity: 1;
  transform: scale(1.025);
}

.contract-date-wheel__selection {
  position: absolute;
  z-index: 1;
  top: 19px;
  right: 4px;
  left: 4px;
  height: 34px;
  background: linear-gradient(90deg, rgb(180 156 111 / 5%), rgb(247 239 222 / 54%) 28%, rgb(247 239 222 / 54%) 72%, rgb(180 156 111 / 5%));
  border-top: 1px solid rgb(137 108 58 / 14%);
  border-bottom: 1px solid rgb(137 108 58 / 17%);
  border-radius: 5px;
  box-shadow: inset 0 1px rgb(255 255 255 / 88%), 0 2px 7px rgb(94 72 31 / 4%);
}

.contract-date-wheel__selection::before,
.contract-date-wheel__selection::after {
  position: absolute;
  top: 50%;
  width: 3px;
  height: 8px;
  content: '';
  background: #b69a69;
  border-radius: 999px;
  opacity: 0.48;
  transform: translateY(-50%);
}

.contract-date-wheel__selection::before {
  left: 3px;
}

.contract-date-wheel__selection::after {
  right: 3px;
}

.contract-date-wheel__fade {
  position: absolute;
  z-index: 3;
  right: 0;
  left: 0;
  height: 18px;
  pointer-events: none;
}

.contract-date-wheel__fade.is-top {
  top: 0;
  background: linear-gradient(rgb(219 208 187 / 82%) 4%, rgb(224 214 194 / 0%));
}

.contract-date-wheel__fade.is-bottom {
  bottom: 0;
  background: linear-gradient(rgb(218 205 181 / 0%), rgb(211 198 173 / 82%) 96%);
}

@media (max-width: 520px) {
  .contract-date-wheel {
    gap: 8px;
  }

  .contract-date-wheel__field {
    gap: 4px;
  }
}

.contract-date-wheel.is-disabled {
  filter: saturate(0.7);
  opacity: 0.62;
}

.contract-date-wheel.is-disabled button {
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .contract-date-wheel__scroller {
    scroll-behavior: auto;
  }

  .contract-date-wheel__scroller button {
    transition: none;
  }

  .contract-date-wheel__column {
    transition: none;
  }
}
</style>
