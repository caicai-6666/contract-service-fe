<script setup>
defineProps({
  label: { type: String, required: true },
  secondaryLabel: { type: String, default: '智能提取' },
  running: { type: Boolean, default: false },
  rewinding: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['activate'])
</script>

<template>
  <div
    class="extraction-ai-control"
    :class="{ 'is-running': running, 'is-rewinding': rewinding, 'is-disabled': disabled }"
  >
    <span class="extraction-ai-control__light extraction-ai-control__light--one"></span>
    <span class="extraction-ai-control__light extraction-ai-control__light--two"></span>
    <button
      type="button"
      class="extraction-ai-control__button"
      :disabled="disabled"
      :aria-label="label"
      :aria-pressed="running"
      @click="emit('activate')"
    >
      <span class="extraction-ai-control__text extraction-ai-control__text--primary">{{ label }}</span>
      <span class="extraction-ai-control__text extraction-ai-control__text--secondary">{{ secondaryLabel }}</span>
    </button>

    <svg class="extraction-ai-control__circuit" viewBox="70 70 160 160" aria-hidden="true">
      <defs>
        <g id="extraction-ai-circuit-shape">
          <line x1="150" y1="143.58" x2="150" y2="97.31" />
          <line x1="157.98" y1="143.58" x2="157.98" y2="112.08" />
          <line x1="142.02" y1="143.58" x2="142.02" y2="118.08" />
          <line x1="130.05" y1="143.58" x2="130.05" y2="133.79" />
          <line x1="138.03" y1="143.58" x2="138.03" y2="131.83" />
          <line x1="146.01" y1="143.58" x2="146.01" y2="129.15" />
          <line x1="153.99" y1="143.58" x2="153.99" y2="129.15" />
          <line x1="161.97" y1="143.58" x2="161.97" y2="131.83" />
          <line x1="169.95" y1="143.58" x2="169.95" y2="133.79" />
          <path d="M126.06,143.58v-10.37c0-.72-.29-1.41-.8-1.92l-4.28-4.28c-.51-.51-.8-1.2-.8-1.92v-12.37" />
          <path d="M165.96,143.58v-18.37c0-.72.29-1.41.8-1.92l4.28-4.28c.51-.51.8-1.2.8-1.92v-14.37" />
          <path d="M173.94,143.58v-10.37c0-.72.29-1.41.8-1.92l4.28-4.28c.51-.51.8-1.2.8-1.92v-10.69" />
          <path d="M134.04,143.58v-20.37c0-.72-.29-1.41-.8-1.92l-4.28-4.28c-.51-.51-.8-1.2-.8-1.92v-9.37" />
          <line x1="176.04" y1="150" x2="217.32" y2="150" />
          <path d="M176.04,153.99h13.37c.72,0,1.41.29,1.92.8l4.28,4.28c.51.51,1.2.8,1.92.8h14.37" />
          <path d="M176.04,146.01h15.37c.72,0,1.41-.29,1.92-.8l4.28-4.28c.51-.51,1.2-.8,1.92-.8h9.37" />
          <line x1="123.96" y1="150" x2="82.68" y2="150" />
          <path d="M123.96,146.01h-13.37c-.72,0-1.41-.29-1.92-.8l-4.28-4.28c-.51-.51-1.2-.8-1.92-.8h-14.37" />
          <path d="M123.96,153.99h-15.37c-.72,0-1.41.29-1.92.8l-4.28,4.28c-.51.51-1.2.8-1.92.8h-9.37" />
          <line x1="150" y1="156.42" x2="150" y2="202.69" />
          <line x1="142.02" y1="156.42" x2="142.02" y2="187.92" />
          <line x1="157.98" y1="156.42" x2="157.98" y2="181.92" />
          <line x1="169.95" y1="156.42" x2="169.95" y2="166.21" />
          <line x1="161.97" y1="156.42" x2="161.97" y2="168.17" />
          <line x1="153.99" y1="156.42" x2="153.99" y2="170.85" />
          <line x1="146.01" y1="156.42" x2="146.01" y2="170.85" />
          <line x1="138.03" y1="156.42" x2="138.03" y2="168.17" />
          <line x1="130.05" y1="156.42" x2="130.05" y2="166.21" />
          <path d="M173.94,156.42v10.37c0,.72.29,1.41.8,1.92l4.28,4.28c.51.51.8,1.2.8,1.92v12.37" />
          <path d="M134.04,156.42v18.37c0,.72-.29,1.41-.8,1.92l-4.28,4.28c-.51.51-.8,1.2-.8,1.92v14.37" />
          <path d="M126.06,156.42v10.37c0,.72-.29,1.41-.8,1.92l-4.28,4.28c-.51.51-.8,1.2-.8,1.92v10.69" />
          <path d="M165.96,156.42v20.37c0,.72.29,1.41.8,1.92l4.28,4.28c.51.51.8,1.2.8,1.92v9.37" />
        </g>
      </defs>
      <use href="#extraction-ai-circuit-shape" class="extraction-ai-control__line-bg" />
      <use href="#extraction-ai-circuit-shape" class="extraction-ai-control__line" />
      <g class="extraction-ai-control__dots">
        <circle cx="150" cy="96.13" r="1.17" />
        <circle cx="157.98" cy="110.91" r="1.17" />
        <circle cx="142.02" cy="116.91" r="1.17" />
        <circle cx="157.98" cy="183.09" r="1.17" />
        <circle cx="171.83" cy="101.54" r="1.17" />
        <circle cx="179.81" cy="113.23" r="1.17" />
        <circle cx="128.17" cy="104.54" r="1.17" />
        <circle cx="120.19" cy="111.54" r="1.17" />
        <circle cx="150" cy="203.87" r="1.17" />
        <circle cx="142.02" cy="189.09" r="1.17" />
        <circle cx="128.17" cy="198.46" r="1.17" />
        <circle cx="120.19" cy="186.77" r="1.17" />
        <circle cx="171.83" cy="195.46" r="1.17" />
        <circle cx="179.81" cy="188.46" r="1.17" />
        <circle cx="210.08" cy="140.14" r="1.17" />
        <circle cx="218.49" cy="150" r="1.17" />
        <circle cx="213.08" cy="159.86" r="1.17" />
        <circle cx="89.92" cy="159.86" r="1.17" />
        <circle cx="81.51" cy="150" r="1.17" />
        <circle cx="86.92" cy="140.14" r="1.17" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.extraction-ai-control {
  --accent-1: #8d80f4;
  --accent-2: #7568df;
  --accent-3: #a99fff;
  --accent-4: #7568df66;
  --light-1: #7568df32;
  --light-2: #9b90f02b;
  --duration: 2s;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: max-content;
  height: 48px;
  isolation: isolate;
}

.extraction-ai-control.is-rewinding {
  --accent-1: #aaa5b4;
  --accent-2: #d1ccd8;
  --accent-3: #f0edf4;
  --accent-4: #aaa5b43d;
  --light-1: #aaa5b438;
  --light-2: #817b8d30;
}

.extraction-ai-control__light {
  position: absolute;
  z-index: 1;
  top: -20px;
  left: -30px;
  width: 100px;
  height: 70px;
  pointer-events: none;
  background: var(--light-1);
  border-radius: 50%;
  filter: blur(27px);
  opacity: 0.4;
  transition: opacity 3s ease, top 3s ease, left 3s ease;
}

.extraction-ai-control__light--two {
  inset: auto -20px -20px auto;
  width: 80px;
  height: 40px;
  background: var(--light-2);
  opacity: 0.25;
  transition-duration: 6s;
  z-index: -1;
}

.extraction-ai-control__button {
  position: relative;
  z-index: 3;
  isolation: isolate;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: max-content;
  min-width: 120px;
  min-height: 48px;
  padding: 0 18px;
  overflow: hidden;
  color: #b9b9c0;
  font-family: Inter, system-ui, sans-serif;
  font-size: 16px;
  font-weight: 500;
  letter-spacing: -0.5px;
  cursor: pointer;
  background:
    radial-gradient(ellipse at 50% -15%, #ffffff24 0%, transparent 48%),
    linear-gradient(180deg, #2c2c31 0%, #151519 43%, #070709 100%);
  border: 1px solid #09090b;
  border-radius: 8px;
  box-shadow:
    0 0 30px -12px var(--light-1),
    0 3px 0 #020203,
    0 5px 8px #10101842,
    inset 0 1px 0 #ffffff35,
    inset 1px 0 0 #ffffff12,
    inset -1px 0 0 #000000d4,
    inset 0 -2px 3px #000;
  transition: all 3s ease;
}

.extraction-ai-control__button::before,
.extraction-ai-control__button::after {
  position: absolute;
  pointer-events: none;
  content: '';
}

.extraction-ai-control__button::before {
  z-index: 0;
  inset: 2px;
  background:
    repeating-linear-gradient(112deg, transparent 0 3px, #ffffff08 3px 4px),
    radial-gradient(circle at 30% 20%, #ffffff0e, transparent 34%);
  border-radius: 5px;
  opacity: 0.42;
  mix-blend-mode: screen;
}

.extraction-ai-control__button::after {
  z-index: 1;
  inset: 5px;
  border: 1px solid #000000a8;
  border-radius: 4px;
  box-shadow:
    inset 0 1px 2px #000,
    0 1px 0 #ffffff12;
}

.extraction-ai-control__button:hover:not(:disabled) {
  color: #d4d2dc;
  border-color: #35313f;
}

.extraction-ai-control__button:active:not(:disabled) {
  box-shadow:
    0 0 10px var(--light-1),
    inset -1px -1px 1px 1px #000,
    inset -2px -2px 2px 1px #ffffff22,
    inset 1px 1px 1px 1px #000,
    inset 2px 2px 2px 1px #ffffff22;
}

.extraction-ai-control__button:disabled {
  cursor: not-allowed;
  opacity: 0.78;
}

.extraction-ai-control__text {
  position: absolute;
  z-index: 2;
  color: inherit;
  white-space: nowrap;
  text-shadow:
    0 -1px 1px #000,
    0 1px 0 #ffffff21;
  filter: saturate(0.78);
  transition: opacity 0.8s ease;
}

.extraction-ai-control__text--primary { opacity: 1; }
.extraction-ai-control__text--secondary { opacity: 0; font-size: 13px; }

.extraction-ai-control.is-running .extraction-ai-control__text--primary {
  opacity: 0;
}

.extraction-ai-control.is-running .extraction-ai-control__text--secondary {
  opacity: 1;
}

.extraction-ai-control__circuit {
  position: absolute;
  z-index: 1;
  width: 300px;
  height: 300px;
  overflow: visible;
  fill: none;
  pointer-events: none;
  filter: drop-shadow(0 0 0 transparent);
  transition: filter 3s ease;
}

.extraction-ai-control__line-bg {
  fill: none;
  stroke: #7568df2b;
  stroke-width: 0.5;
}

.extraction-ai-control__line {
  fill: none;
  stroke: transparent;
  stroke-width: 0;
  stroke-dasharray: 16 56;
}

.extraction-ai-control__dots {
  fill: #776e9b;
  opacity: 0.42;
}

.extraction-ai-control:hover .extraction-ai-control__dots { fill: #bbb; }

.extraction-ai-control:hover .extraction-ai-control__light {
  top: -30px;
  left: -40px;
  opacity: 0.7;
}

.extraction-ai-control:hover .extraction-ai-control__light--two {
  inset: auto -30px -30px auto;
}

.extraction-ai-control.is-running .extraction-ai-control__button {
  background-color: #1a1a1e;
  border-color: transparent;
  animation: extraction-ai-pulse var(--duration) ease-in-out infinite;
}

.extraction-ai-control.is-running .extraction-ai-control__text {
  color: #c9c4e3;
  text-shadow:
    0 -1px 1px #000,
    0 1px 0 #ffffff24,
    0 0 7px #7568df3b;
}

.extraction-ai-control.is-running .extraction-ai-control__dots {
  fill: var(--accent-1);
}

.extraction-ai-control.is-running .extraction-ai-control__dots circle {
  animation: extraction-ai-dot calc(var(--duration) * 0.5) linear infinite;
}

.extraction-ai-control.is-running .extraction-ai-control__dots circle:nth-child(odd) {
  animation-delay: calc(var(--duration) * 0.1);
}

.extraction-ai-control.is-running .extraction-ai-control__line {
  animation: extraction-ai-dash var(--duration) ease-out infinite;
}

.extraction-ai-control.is-running .extraction-ai-control__circuit {
  filter: drop-shadow(0 0 4px var(--accent-3));
}

@keyframes extraction-ai-dot {
  0%, 100% { opacity: 0.1; }
  20% { opacity: 1; }
}

@keyframes extraction-ai-pulse {
  0%, 100% {
    box-shadow:
      0 0 20px var(--light-2),
      0 3px 0 #020203,
      0 5px 8px #10101842,
      inset 0 1px 0 #ffffff35,
      inset 1px 0 0 #ffffff12,
      inset -1px 0 0 #000000d4,
      inset 0 -2px 3px #000;
    border-color: transparent;
  }
  50% {
    box-shadow:
      0 0 60px 0 var(--light-1),
      0 3px 0 #020203,
      0 5px 8px #10101842,
      inset 0 1px 0 #ffffff42,
      inset 1px 0 0 #ffffff16,
      inset -1px 0 0 #000000d4,
      inset 0 -2px 3px #000;
  }
  85% {
    border-color: var(--accent-2);
  }
}

@keyframes extraction-ai-dash {
  0% { stroke-width: 0; stroke-dashoffset: 10; stroke: var(--accent-4); }
  50% { stroke-width: 0.7; stroke-dashoffset: 88; stroke: var(--accent-2); }
  100% { stroke-width: 0; stroke-dashoffset: 166; stroke: var(--accent-4); }
}

@media (prefers-reduced-motion: reduce) {
  .extraction-ai-control *,
  .extraction-ai-control *::before,
  .extraction-ai-control *::after {
    animation: none !important;
    transition: none !important;
  }

  .extraction-ai-control.is-running .extraction-ai-control__line {
    stroke: var(--accent-2);
    stroke-width: 0.5;
  }
}
</style>
