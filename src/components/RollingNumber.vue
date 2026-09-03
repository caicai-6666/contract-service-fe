<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  value: {
    type: Number,
    required: true,
  },
})

const numeralSequence = Array.from({ length: 40 }, (_, index) => index % 10)
const wheels = ref([])
let startTimer = null
let settleTimer = null

function normalizedValue(value) {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
}

function digitsOf(value) {
  return String(normalizedValue(value)).split('').map(Number)
}

function clearAnimationTimers() {
  if (startTimer !== null) window.clearTimeout(startTimer)
  if (settleTimer !== null) window.clearTimeout(settleTimer)
  startTimer = null
  settleTimer = null
}

function updateWheels(value, previousValue) {
  clearAnimationTimers()
  const targetDigits = digitsOf(value)
  const previousDigits = digitsOf(previousValue)

  wheels.value = targetDigits.map((targetDigit, index) => {
    const previousIndex = previousDigits.length - targetDigits.length + index
    const previousDigit = previousIndex >= 0 ? previousDigits[previousIndex] : 0
    return {
      key: targetDigits.length - index - 1,
      targetDigit,
      previousDigit,
      position: 10 + previousDigit,
      animate: false,
      delay: index * 34,
    }
  })

  nextTick(() => {
    startTimer = window.setTimeout(() => {
      startTimer = null
      wheels.value = wheels.value.map((wheel) => ({
        ...wheel,
        animate: true,
        position: wheel.position
          + 10
          + ((wheel.targetDigit - wheel.previousDigit + 10) % 10),
      }))

      settleTimer = window.setTimeout(() => {
        settleTimer = null
        wheels.value = wheels.value.map((wheel) => ({
          ...wheel,
          previousDigit: wheel.targetDigit,
          position: 10 + wheel.targetDigit,
          animate: false,
        }))
      }, 1040 + targetDigits.length * 34)
    }, 170)
  })
}

watch(
  () => props.value,
  (value, previousValue) => updateWheels(value, previousValue ?? 0),
  { immediate: true },
)

onBeforeUnmount(clearAnimationTimers)
</script>

<template>
  <span class="rolling-number" :aria-label="String(normalizedValue(value))">
    <span
      v-for="wheel in wheels"
      :key="wheel.key"
      class="rolling-number__wheel"
      aria-hidden="true"
    >
      <span
        class="rolling-number__track"
        :class="{ 'is-animated': wheel.animate }"
        :style="{
          '--wheel-position': wheel.position,
          '--wheel-delay': `${wheel.delay}ms`,
        }"
      >
        <span v-for="(numeral, index) in numeralSequence" :key="index">{{ numeral }}</span>
      </span>
    </span>
  </span>
</template>

<style scoped>
.rolling-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1em;
  font-variant-numeric: tabular-nums;
}

.rolling-number__wheel {
  position: relative;
  display: block;
  width: 0.62em;
  height: 1em;
  overflow: hidden;
}

.rolling-number__track {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  width: 100%;
  transform: translate3d(0, calc(var(--wheel-position) * -1em), 0);
  will-change: transform;
}

.rolling-number__track.is-animated {
  transition: transform 0.86s cubic-bezier(0.2, 0.76, 0.24, 1) var(--wheel-delay);
}

.rolling-number__track > span {
  display: grid;
  flex: 0 0 1em;
  place-items: center;
  width: 100%;
  height: 1em;
  line-height: 1;
}

@media (prefers-reduced-motion: reduce) {
  .rolling-number__track.is-animated {
    transition: none;
  }
}
</style>
