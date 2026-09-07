<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, watch } from 'vue'
import { daysInMonth, updateContractDateFilter } from '../models/contractDateFilter.js'

const props = defineProps({
  value: { type: Object, required: true },
  years: { type: Array, required: true },
})
const emit = defineEmits(['change'])
const labels = { year: '年', month: '月', day: '日' }
const wheels = new Map()
const timers = new Map()
const aligningTargets = new Map()
const ITEM_HEIGHT = 32
const scrollPositions = reactive({ year: 0, month: 0, day: 0 })

function optionStyle(field, index) {
  const distance = Math.min(1, Math.abs(index * ITEM_HEIGHT - scrollPositions[field]) / ITEM_HEIGHT)
  const prominence = 1 - distance * distance * (3 - 2 * distance)
  return {
    opacity: 0.42 + prominence * 0.58,
    transform: `scale(${0.82 + prominence * 0.18})`,
  }
}
const options = computed(() => ({
  year: [null, ...props.years],
  month: [null, ...Array.from({ length: props.value.year ? 12 : 0 }, (_, index) => index + 1)],
  day: [null, ...Array.from({ length: props.value.month ? daysInMonth(props.value.year, props.value.month) : 0 }, (_, index) => index + 1)],
}))

function align(field, smooth = true) {
  const element = wheels.get(field)
  if (!element) return
  scrollPositions[field] = element.scrollTop
  const index = Math.max(0, options.value[field].indexOf(props.value[field]))
  const top = index * ITEM_HEIGHT
  if (Math.abs(element.scrollTop - top) < 1) {
    aligningTargets.delete(field)
    return
  }
  aligningTargets.set(field, top)
  element.scrollTo({
    top,
    behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant',
  })
}

function select(field, value) {
  if (isDisabled(field)) return
  clearTimeout(timers.get(field))
  if (props.value[field] === value) {
    align(field)
    return
  }
  emit('change', updateContractDateFilter(props.value, field, value))
}

function isDisabled(field) {
  return (field === 'month' && !props.value.year) || (field === 'day' && !props.value.month)
}

function settle(field) {
  clearTimeout(timers.get(field))
  const element = wheels.get(field)
  if (!element) return
  const target = aligningTargets.get(field)
  if (target !== undefined) {
    if (Math.abs(element.scrollTop - target) < 1) aligningTargets.delete(field)
    return
  }
  const values = options.value[field]
  const index = Math.max(0, Math.min(values.length - 1, Math.round(element.scrollTop / ITEM_HEIGHT)))
  if (values[index] !== props.value[field]) select(field, values[index])
  else align(field)
}

function handleScroll(field) {
  const element = wheels.get(field)
  if (element) scrollPositions[field] = element.scrollTop
  clearTimeout(timers.get(field))
  timers.set(field, setTimeout(() => settle(field), 180))
}

function interruptAlignment(field) {
  clearTimeout(timers.get(field))
  if (!aligningTargets.has(field)) return
  aligningTargets.delete(field)
  const element = wheels.get(field)
  if (element) element.scrollTo({ top: element.scrollTop, behavior: 'instant' })
}

function handleKey(field, event) {
  const values = options.value[field]
  const index = Math.max(0, values.indexOf(props.value[field]))
  const target = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: values.length - 1 }[event.key]
  if (target === undefined) return
  event.preventDefault()
  select(field, values[Math.max(0, Math.min(values.length - 1, target))])
}

// 每栏独立同步，避免某栏选择后打断其他栏的惯性滚动。
Object.keys(labels).forEach((field) => {
  watch([() => props.value[field], () => options.value[field].join(',')], (_value, previous) => {
    clearTimeout(timers.get(field))
    nextTick(() => align(field, previous?.[0] !== undefined))
  }, { immediate: true })
})
onBeforeUnmount(() => timers.forEach(clearTimeout))
</script>

<template>
  <div class="archive-date-filter" role="group" aria-label="签订日期筛选">
    <div v-for="(label, field) in labels" :key="field" class="archive-date-filter__field">
      <div class="archive-date-filter__drum" :class="{ 'is-disabled': isDisabled(field) }">
        <span class="archive-date-filter__selection" aria-hidden="true"></span>
        <div
          :ref="(element) => element ? wheels.set(field, element) : wheels.delete(field)"
          class="archive-date-filter__wheel"
          role="listbox"
          :aria-label="`签订${label}`"
          :aria-disabled="isDisabled(field)"
          :tabindex="isDisabled(field) ? -1 : 0"
          @keydown="handleKey(field, $event)"
          @scroll.passive="handleScroll(field)"
          @scrollend="settle(field)"
          @wheel.passive="interruptAlignment(field)"
          @touchstart.passive="interruptAlignment(field)"
          @pointerdown="interruptAlignment(field)"
        >
          <button
            v-for="(option, index) in options[field]"
            :key="option ?? 'all'"
            type="button"
            role="option"
            tabindex="-1"
            :aria-label="option === null ? `全部${{ year: '年份', month: '月份', day: '日期' }[field]}` : String(option)"
            :aria-selected="value[field] === option"
            :style="optionStyle(field, index)"
            :disabled="isDisabled(field)"
            @click="select(field, option)"
          >{{ option === null ? '—' : String(option).padStart(field === 'year' ? 4 : 2, '0') }}</button>
        </div>
      </div>
      <span class="archive-date-filter__label">{{ label }}</span>
    </div>
  </div>
</template>

<style scoped>
.archive-date-filter { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 12px; width: min(100%, 340px); }
.archive-date-filter__field { display: flex; align-items: center; gap: 7px; min-width: 0; }
.archive-date-filter__drum { position: relative; flex: 1; min-width: 0; overflow: hidden; border: 1px solid #cdd9ce; border-radius: 12px; background: linear-gradient(180deg, #dce5db, #f0f5eb 50%, #d9e3d7); box-shadow: inset 0 3px 7px #4b654c14, inset 0 -2px 5px #4b654c10, 0 2px 0 #c7d4c4; }
.archive-date-filter__selection { position: absolute; inset: 12px 4px auto; height: 32px; border-block: 1px solid #a6baa54d; background: #f5f9ed80; border-radius: 5px; pointer-events: none; }
.archive-date-filter__wheel { position: relative; height: 56px; padding-block: 12px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; scroll-snap-type: y mandatory; mask-image: linear-gradient(transparent, #000 22%, #000 78%, transparent); }
.archive-date-filter__wheel::-webkit-scrollbar { display: none; }
.archive-date-filter__wheel:focus { outline: none; }
.archive-date-filter__wheel button { display: block; width: 100%; height: 32px; padding: 0; border: 0; background: transparent; color: #304d35; font: inherit; font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; scroll-snap-align: center; cursor: pointer; transform-origin: center; }
.archive-date-filter__label { color: #6d826e; font-size: 12px; }
.archive-date-filter__drum.is-disabled { opacity: .45; }
.archive-date-filter__drum.is-disabled button { cursor: default; }
</style>
