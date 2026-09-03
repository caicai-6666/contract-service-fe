<script setup>
defineProps({
  open: { type: Boolean, default: false },
  src: { type: String, default: '' },
  label: { type: String, default: 'PDF 文档' },
})

defineEmits(['close'])
</script>

<template>
  <Teleport to="body">
    <div
      class="pdf-preview-glass"
      :class="{ 'is-active': open }"
      aria-hidden="true"
      @click="$emit('close')"
    ></div>

    <Transition name="pdf-preview">
      <section
        v-if="open"
        class="pdf-preview"
        role="dialog"
        aria-modal="true"
        :aria-label="`预览 ${label}`"
      >
        <div class="pdf-preview__viewer">
          <iframe
            :src="`${src}#view=FitH&toolbar=1&navpanes=0`"
            :title="`${label} PDF 内容`"
          ></iframe>

          <button
            class="pdf-preview__close"
            type="button"
            aria-label="关闭 PDF 预览"
            autofocus
            @click="$emit('close')"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m5.5 5.5 9 9m0-9-9 9" />
            </svg>
          </button>
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

.pdf-preview__viewer {
  position: relative;
  width: min(1180px, 100%);
  height: min(820px, 100%);
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
}

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
  .pdf-preview-glass,
  .pdf-preview-enter-active,
  .pdf-preview-leave-active,
  .pdf-preview-enter-active .pdf-preview__viewer,
  .pdf-preview-leave-active .pdf-preview__viewer {
    transition: none;
  }
}
</style>
