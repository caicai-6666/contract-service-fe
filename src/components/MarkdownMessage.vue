<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import MarkdownIt from 'markdown-it'
import { createStreamText } from '../models/streamText.js'

const props = defineProps({
  content: {
    type: String,
    required: true,
  },
  streamState: { type: String, default: '' },
  animate: { type: Boolean, default: true },
  stabilizeHeight: { type: Boolean, default: false },
})

const displayedContent = ref(props.content)
const contentRef = ref(null)
const reservedHeight = ref(0)
let heightObserver = null
let measuredWidth = 0
let reserveStreamHeight = props.stabilizeHeight && props.streamState === 'streaming'

function measureContentHeight() {
  const element = contentRef.value
  if (!element || !props.stabilizeHeight) return
  if (props.streamState === 'streaming') reserveStreamHeight = true
  if (!reserveStreamHeight) return
  const { width, height } = element.getBoundingClientRect()
  if (!width) return
  // Markdown 重排只能扩展本轮占位；缩短的部分成为后续文字可复用的缓冲。
  // 用户调整栏宽时重新测量，避免保留窄栏时的过大空白。
  if (Math.abs(width - measuredWidth) > 1) reservedHeight.value = 0
  measuredWidth = width
  reservedHeight.value = Math.max(reservedHeight.value, Math.ceil(height) + 24)
}
const emit = defineEmits(['display-state'])
function reportDisplayState() {
  emit('display-state', { text: displayedContent.value, complete: displayedContent.value === props.content })
}
watch(() => [displayedContent.value, props.content, props.streamState], reportDisplayState, { flush: 'post' })
let revealer = null
let motionPreference = null
let wasStreaming = props.streamState === 'streaming'

function updateDisplay() {
  if (!revealer) { displayedContent.value = props.content; return }
  const smooth = props.animate && !motionPreference?.matches
    && (props.streamState === 'streaming' || (props.streamState === 'completed' && wasStreaming))
  revealer.update(props.content, { immediate: !smooth })
  wasStreaming = props.streamState === 'streaming'
}

onMounted(() => {
  if (props.stabilizeHeight) {
    heightObserver = new ResizeObserver(measureContentHeight)
    heightObserver.observe(contentRef.value)
    measureContentHeight()
  }
  reportDisplayState()
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  revealer = createStreamText({
    initial: displayedContent.value,
    onChange: (text) => { displayedContent.value = text },
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
  })
  motionPreference.addEventListener('change', updateDisplay)
})
watch(() => [props.content, props.streamState, props.animate], updateDisplay)
onBeforeUnmount(() => {
  heightObserver?.disconnect()
  revealer?.stop()
  motionPreference?.removeEventListener('change', updateDisplay)
})

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: true,
})

const defaultLinkRenderer = markdown.renderer.rules.link_open

markdown.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noopener noreferrer')

  return defaultLinkRenderer
    ? defaultLinkRenderer(tokens, index, options, environment, renderer)
    : renderer.renderToken(tokens, index, options)
}

const renderedBlocks = computed(() => {
  const environment = {}
  const tokens = markdown.parse(displayedContent.value, environment)
  const blocks = []
  for (const token of tokens) {
    if (token.level === 0 && token.nesting !== -1) blocks.push([])
    blocks.at(-1)?.push(token)
  }
  return blocks.map((block) => markdown.renderer.render(block, markdown.options, environment))
})
</script>

<template>
  <div class="markdown-message" :style="reservedHeight ? { minHeight: `${reservedHeight}px` } : undefined">
    <div ref="contentRef" class="markdown-message__content">
      <div v-for="(html, index) in renderedBlocks" :key="index" class="markdown-message__block" v-html="html"></div>
    </div>
  </div>
</template>

<style scoped>
.markdown-message {
  min-width: 0;
  color: inherit;
  font-size: 13px;
  line-height: 1.75;
  overflow-wrap: anywhere;
}

.markdown-message__block { display: contents; }
.markdown-message__content { display: flow-root; }

.markdown-message__content :deep(> .markdown-message__block:first-child > :first-child) {
  margin-top: 0;
}

.markdown-message__content :deep(> .markdown-message__block:last-child > :last-child) {
  margin-bottom: 0;
}

.markdown-message :deep(p) {
  margin: 0 0 0.78em;
}

.markdown-message :deep(h1),
.markdown-message :deep(h2),
.markdown-message :deep(h3),
.markdown-message :deep(h4) {
  margin: 1.25em 0 0.55em;
  color: #26332c;
  font-weight: 650;
  line-height: 1.35;
}

.markdown-message :deep(h1) { font-size: 1.35em; }
.markdown-message :deep(h2) { font-size: 1.2em; }
.markdown-message :deep(h3),
.markdown-message :deep(h4) { font-size: 1.05em; }

.markdown-message :deep(ul),
.markdown-message :deep(ol) {
  padding-left: 1.55em;
  margin: 0.65em 0 0.85em;
}

.markdown-message :deep(li + li) {
  margin-top: 0.3em;
}

.markdown-message :deep(blockquote) {
  padding: 0.15em 0 0.15em 0.9em;
  margin: 0.8em 0;
  color: #6d7772;
  border-left: 3px solid #cfd6d2;
}

.markdown-message :deep(a) {
  color: #4e63a8;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

.markdown-message :deep(code) {
  padding: 0.14em 0.38em;
  color: #33443c;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 0.9em;
  background: #e9eeeb;
  border-radius: 5px;
}

.markdown-message :deep(pre) {
  max-width: 100%;
  padding: 13px 15px;
  margin: 0.85em 0;
  overflow-x: auto;
  color: #e9f0ec;
  background: #25312c;
  border-radius: 10px;
}

.markdown-message :deep(pre code) {
  padding: 0;
  color: inherit;
  background: transparent;
  border-radius: 0;
}

.markdown-message :deep(table) {
  display: block;
  max-width: 100%;
  margin: 0.85em 0;
  overflow-x: auto;
  border-spacing: 0;
  border-collapse: collapse;
}

.markdown-message :deep(th),
.markdown-message :deep(td) {
  min-width: 88px;
  padding: 7px 10px;
  text-align: left;
  border: 1px solid #dce2df;
}

.markdown-message :deep(th) {
  color: #334139;
  font-weight: 650;
  background: #f0f3f1;
}

.markdown-message :deep(hr) {
  margin: 1.1em 0;
  border: 0;
  border-top: 1px solid #dce2df;
}
</style>
