<script setup>
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from 'vue'
import HandwritingPrompt from './HandwritingPrompt.vue'
import MarkdownMessage from './MarkdownMessage.vue'
defineOptions({ name: 'ContractLibraryView' })
const props = defineProps({ active: { type: Boolean, default: true } })

let conversationId = 4

const conversations = ref([
  {
    id: 1,
    name: '新对话',
    messages: [],
    replying: false,
  },
  {
    id: 2,
    name: 'Markdown 效果预览',
    messages: [
      {
        id: 2,
        role: 'user',
        content: [
          '请审查这份《软件服务合同》，重点关注：',
          '',
          '- **付款条件**是否清晰',
          '- 违约责任是否对等',
          '- 数据安全条款是否完整',
        ].join('\n'),
      },
      {
        id: 3,
        role: 'assistant',
        processingTime: '处理了 8 秒',
        processPath: [
          '读取合同审查请求与关注事项',
          '归纳付款、责任与数据安全风险',
          '生成结构化风险清单与修改建议',
        ],
        createdAt: '10:24',
        content: [
          '# 合同审查报告',
          '',
          '> 本报告为 Markdown 渲染效果示例，不构成正式法律意见。',
          '',
          '## 一、审查结论',
          '',
          '合同整体结构完整，但存在 **2 项高风险**、*2 项一般风险*。建议优先处理付款条件与数据泄露责任，~~无需修改的旧结论~~ 已在本次复核中更新。',
          '',
          '---',
          '',
          '## 二、风险清单',
          '',
          '| 风险等级 | 条款 | 发现 | 建议 |',
          '| :--- | :--- | :--- | :--- |',
          '| 高 | 第 4.2 条 | 验收期限未明确 | 补充 `5 个工作日` 的验收期限 |',
          '| 高 | 第 8.3 条 | 数据泄露责任上限过低 | 单独约定赔偿上限 |',
          '| 中 | 第 6.1 条 | 续费规则表述模糊 | 明确书面确认流程 |',
          '',
          '## 三、建议修改顺序',
          '',
          '1. **先处理高风险条款**',
          '   - 明确验收起算时间',
          '   - 补充逾期未反馈的处理方式',
          '2. **再核对责任边界**',
          '   - 数据安全责任',
          '   - 第三方索赔责任',
          '3. 完成商务条款复核',
          '',
          '## 四、推荐条款示例',
          '',
          '```text',
          '甲方应在收到验收申请后 5 个工作日内完成验收。',
          '逾期未提出书面异议的，视为验收通过。',
          '```',
          '',
          '结构化结果也可以用代码块展示：',
          '',
          '```json',
          '{',
          '  "contractId": "HT-2026-001",',
          '  "riskLevel": "high",',
          '  "riskCount": 4',
          '}',
          '```',
          '',
          '## 五、后续操作',
          '',
          '可参考[合同审查说明](https://example.com/contract-review)，或继续询问某一条款的修改方案。',
        ].join('\n'),
      },
    ],
    replying: false,
  },
  {
    id: 3,
    name: '履约节点梳理',
    messages: [
      { id: 4, role: 'user', content: '整理这份合同的关键履约节点。' },
      {
        id: 5,
        role: 'assistant',
        processingTime: '处理了 3 秒',
        processPath: ['识别履约相关条款', '按时间顺序归纳关键节点'],
        createdAt: '09:42',
        content: '接入合同后，我会提取交付、验收、付款与续约等关键时间节点。',
      },
    ],
    replying: false,
  },
  {
    id: 4,
    name: '合同归档查询',
    messages: [
      { id: 6, role: 'user', content: '查询最近归档的合同。' },
      {
        id: 7,
        role: 'assistant',
        processingTime: '处理了 2 秒',
        processPath: ['解析归档查询条件', '准备匹配归档记录'],
        createdAt: '昨天 16:18',
        content: '合同库接入后，我会在这里展示匹配的归档记录。',
      },
    ],
    replying: false,
  },
])
const prompt = ref('')
const messageListRef = ref(null)
const agentBodyRef = ref(null)
const composerInputRef = ref(null)
const attachmentInputRef = ref(null)
const selectedAttachments = ref([])
const activeConversation = ref(0)
const historyMenuOpen = ref(false)
const previewQuestion = ref(null)
const previewTop = ref(0)
const anchoredQuestionId = ref(null)
const initialMessageId = ref(null)
const initialReplyConversationIds = ref(new Set())
const enteringMessageIds = ref(new Set())
const expandedProcessIds = ref(new Set())
const copiedMessageId = ref(null)
const contractLibraryRef = ref(null)
const contractAgentRef = ref(null)
const chatPanelWidth = ref(null)
const displayedChatPanelWidth = ref(0)
const resizeBounds = ref({ min: 360, max: 360 })
const resizingChatPanel = ref(false)
const editingConversationId = ref(null)
const conversationNameDraft = ref('')
const conversationNameInputRef = ref(null)

const messages = computed(() => conversations.value[activeConversation.value].messages)
const replying = computed(() => conversations.value[activeConversation.value]?.replying ?? false)
const historyItems = computed(() => conversations.value.map((conversation) => conversation.name))
const questionMessages = computed(() => messages.value.filter((message) => message.role === 'user'))
const isInitialReplyPending = computed(() => {
  const conversationIdValue = conversations.value[activeConversation.value]?.id
  return initialReplyConversationIds.value.has(conversationIdValue)
})

const HISTORY_VISIBILITY_THRESHOLD = 3
const CONVERSATION_TITLE_MAX_LENGTH = 12
const INITIAL_REPLY_DELAY = 1400
const FOLLOW_UP_REPLY_DELAY = 650
const CHAT_PANEL_MIN_WIDTH = 360
const CABINET_PANEL_MIN_WIDTH = 480
const RESIZE_KEYBOARD_STEP = 24

const messageElements = new Map()
const messageEntryTimers = new Map()
const replyTimers = new Map()

let messageId = 7
let composerResizeFrame = 0
let initialMessageTimer = 0
let copyFeedbackTimer = 0
let libraryViewActive = false
let resizeContainerLeft = 0
let resizePointerOffset = 0

function getResizeMetrics() {
  const library = contractLibraryRef.value
  if (!library) return null

  const libraryRect = library.getBoundingClientRect()
  const columnGap = Number.parseFloat(window.getComputedStyle(library).columnGap) || 0
  const maximumWidth = Math.max(
    CHAT_PANEL_MIN_WIDTH,
    libraryRect.width - columnGap - CABINET_PANEL_MIN_WIDTH,
  )

  return {
    containerLeft: libraryRect.left,
    min: Math.min(CHAT_PANEL_MIN_WIDTH, maximumWidth),
    max: maximumWidth,
  }
}

function clampChatPanelWidth(width, metrics) {
  return Math.min(Math.max(width, metrics.min), metrics.max)
}

function updateResizeMetrics() {
  const metrics = getResizeMetrics()
  if (!metrics) return

  resizeBounds.value = { min: metrics.min, max: metrics.max }

  if (chatPanelWidth.value !== null) {
    chatPanelWidth.value = clampChatPanelWidth(chatPanelWidth.value, metrics)
  }

  displayedChatPanelWidth.value = Math.round(
    chatPanelWidth.value ?? contractAgentRef.value?.getBoundingClientRect().width ?? metrics.min,
  )
}

function startChatPanelResize(event) {
  if (window.matchMedia('(max-width: 900px)').matches) return

  const metrics = getResizeMetrics()
  if (!metrics) return

  resizeContainerLeft = metrics.containerLeft
  resizePointerOffset = (contractAgentRef.value?.getBoundingClientRect().right ?? event.clientX) - event.clientX
  resizeBounds.value = { min: metrics.min, max: metrics.max }
  resizingChatPanel.value = true
  event.currentTarget.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function resizeChatPanel(event) {
  if (!resizingChatPanel.value) return

  const width = clampChatPanelWidth(
    event.clientX - resizeContainerLeft + resizePointerOffset,
    resizeBounds.value,
  )
  chatPanelWidth.value = width
  displayedChatPanelWidth.value = Math.round(width)
}

function finishChatPanelResize(event) {
  if (!resizingChatPanel.value) return

  resizingChatPanel.value = false
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
}

function resizeChatPanelWithKeyboard(event) {
  const metrics = getResizeMetrics()
  if (!metrics) return

  const currentWidth = chatPanelWidth.value ?? contractAgentRef.value?.getBoundingClientRect().width ?? metrics.min
  let targetWidth = currentWidth

  if (event.key === 'ArrowLeft') targetWidth -= RESIZE_KEYBOARD_STEP
  else if (event.key === 'ArrowRight') targetWidth += RESIZE_KEYBOARD_STEP
  else if (event.key === 'Home') targetWidth = metrics.min
  else if (event.key === 'End') targetWidth = metrics.max
  else return

  event.preventDefault()
  chatPanelWidth.value = clampChatPanelWidth(targetWidth, metrics)
  displayedChatPanelWidth.value = Math.round(chatPanelWidth.value)
  resizeBounds.value = { min: metrics.min, max: metrics.max }
}

function createConversationTitle(content, attachments) {
  const titleSource = content || attachments[0]?.name || '附件分析'
  const firstTextLine = titleSource.split(/\r?\n/).find((line) => line.trim()) ?? titleSource
  const plainTextTitle = firstTextLine
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
  const normalizedTitle = (plainTextTitle || titleSource).replace(/\s+/g, ' ').trim()
  const titleCharacters = Array.from(normalizedTitle)

  if (titleCharacters.length <= CONVERSATION_TITLE_MAX_LENGTH) return normalizedTitle
  return `${titleCharacters.slice(0, CONVERSATION_TITLE_MAX_LENGTH).join('')}…`
}

async function startConversationRename(conversation) {
  editingConversationId.value = conversation.id
  conversationNameDraft.value = conversation.name
  historyMenuOpen.value = true
  await nextTick()
  conversationNameInputRef.value?.focus()
  conversationNameInputRef.value?.select()
}

function bindConversationNameInput(element) {
  conversationNameInputRef.value = element
}

function finishConversationRename(conversation) {
  if (editingConversationId.value !== conversation.id) return

  const nextName = conversationNameDraft.value.replace(/\s+/g, ' ').trim()
  if (nextName) {
    conversation.name = nextName
    conversation.customName = true
  }

  editingConversationId.value = null
  conversationNameDraft.value = ''
}

function cancelConversationRename() {
  editingConversationId.value = null
  conversationNameDraft.value = ''
}

function handleHistoryMouseLeave() {
  if (editingConversationId.value === null) historyMenuOpen.value = false
}

function markMessageEntering(messageIdValue) {
  const nextEnteringIds = new Set(enteringMessageIds.value)
  nextEnteringIds.add(messageIdValue)
  enteringMessageIds.value = nextEnteringIds

  window.clearTimeout(messageEntryTimers.get(messageIdValue))
  const timer = window.setTimeout(() => {
    const remainingIds = new Set(enteringMessageIds.value)
    remainingIds.delete(messageIdValue)
    enteringMessageIds.value = remainingIds
    messageEntryTimers.delete(messageIdValue)
  }, 700)
  messageEntryTimers.set(messageIdValue, timer)
}

function setInitialReplyPending(conversationIdValue, pending) {
  const nextConversationIds = new Set(initialReplyConversationIds.value)

  if (pending) {
    nextConversationIds.add(conversationIdValue)
  } else {
    nextConversationIds.delete(conversationIdValue)
  }

  initialReplyConversationIds.value = nextConversationIds
}

function formatMessageTime(date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function toggleProcessPath(messageIdValue) {
  const nextExpandedIds = new Set(expandedProcessIds.value)

  if (nextExpandedIds.has(messageIdValue)) {
    nextExpandedIds.delete(messageIdValue)
  } else {
    nextExpandedIds.add(messageIdValue)
  }

  expandedProcessIds.value = nextExpandedIds
}

async function copyMessage(message) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(message.content)
    } else {
      const copyInput = document.createElement('textarea')
      copyInput.value = message.content
      copyInput.style.position = 'fixed'
      copyInput.style.opacity = '0'
      document.body.append(copyInput)
      copyInput.select()
      const copied = document.execCommand('copy')
      copyInput.remove()
      if (!copied) throw new Error('浏览器拒绝复制消息')
    }

    copiedMessageId.value = message.id
    window.clearTimeout(copyFeedbackTimer)
    copyFeedbackTimer = window.setTimeout(() => {
      if (copiedMessageId.value === message.id) copiedMessageId.value = null
    }, 1600)
  } catch {
    copiedMessageId.value = null
  }
}

async function branchFromMessage(messageIdValue) {
  const sourceConversation = conversations.value[activeConversation.value]
  const sourceMessageIndex = sourceConversation.messages.findIndex((message) => message.id === messageIdValue)
  if (sourceMessageIndex < 0) return

  const branchedMessages = sourceConversation.messages
    .slice(0, sourceMessageIndex + 1)
    .map((message) => ({
      ...message,
      id: ++messageId,
      attachments: message.attachments?.map((attachment) => ({ ...attachment })),
      processPath: message.processPath?.slice(),
    }))
  const branchedConversation = {
    id: ++conversationId,
    name: `${sourceConversation.name.replace(/ · 分支$/, '')} · 分支`,
    customName: true,
    messages: branchedMessages,
    replying: false,
  }
  const insertIndex = conversations.value[0]?.messages.length === 0 ? 1 : 0

  conversations.value.splice(insertIndex, 0, branchedConversation)
  activeConversation.value = insertIndex
  historyMenuOpen.value = false
  previewQuestion.value = null
  anchoredQuestionId.value = null
  await nextTick()
  messageListRef.value?.scrollTo({ top: 0 })
}

async function scrollQuestionToTop(messageIdValue) {
  await nextTick()
  const list = messageListRef.value
  const message = messageElements.get(messageIdValue)
  if (!list || !message) return

  const listRect = list.getBoundingClientRect()
  const messageTop = list.scrollTop + message.getBoundingClientRect().top - listRect.top
  const topPadding = Number.parseFloat(window.getComputedStyle(list).paddingTop) || 0
  list.scrollTo({
    top: messageTop - topPadding,
    behavior: 'smooth',
  })
}

function submitPrompt() {
  const content = prompt.value.trim()
  if ((!content && !selectedAttachments.value.length) || replying.value) return

  const conversation = conversations.value[activeConversation.value]
  const isInitialMessage = conversation.messages.length === 0
  const userMessage = {
    id: ++messageId,
    role: 'user',
    content: content || '请分析已添加的附件。',
    attachments: selectedAttachments.value.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
    })),
  }

  if (isInitialMessage) {
    if (!conversation.customName) {
      conversation.name = createConversationTitle(content, selectedAttachments.value)
    }
    conversations.value.unshift({
      id: ++conversationId,
      name: '新对话',
      messages: [],
      replying: false,
    })
    activeConversation.value = conversations.value.findIndex((item) => item.id === conversation.id)
    initialMessageId.value = userMessage.id
    setInitialReplyPending(conversation.id, true)
    window.clearTimeout(initialMessageTimer)
    initialMessageTimer = window.setTimeout(() => {
      if (initialMessageId.value === userMessage.id) initialMessageId.value = null
    }, 1000)
  } else {
    markMessageEntering(userMessage.id)
  }

  conversation.messages.push(userMessage)
  anchoredQuestionId.value = userMessage.id
  prompt.value = ''
  selectedAttachments.value = []
  if (attachmentInputRef.value) attachmentInputRef.value.value = ''
  conversation.replying = true
  nextTick(collapseComposer)
  if (!isInitialMessage) scrollQuestionToTop(userMessage.id)

  window.clearTimeout(replyTimers.get(conversation.id))
  const replyTimer = window.setTimeout(() => {
    const reply = {
      id: ++messageId,
      role: 'assistant',
      processingTime: '处理了 1 秒',
      processPath: ['理解问题与当前会话上下文', '准备原型回复内容'],
      createdAt: formatMessageTime(),
      content: '已收到你的问题。当前为交互原型，接入合同数据与智能分析服务后，我会在这里返回具体结果。',
    }
    markMessageEntering(reply.id)
    conversation.messages.push(reply)
    conversation.replying = false
    setInitialReplyPending(conversation.id, false)
    replyTimers.delete(conversation.id)
  }, isInitialMessage ? INITIAL_REPLY_DELAY : FOLLOW_UP_REPLY_DELAY)
  replyTimers.set(conversation.id, replyTimer)
}

function stopReply() {
  const conversation = conversations.value[activeConversation.value]
  if (!conversation?.replying) return

  window.clearTimeout(replyTimers.get(conversation.id))
  replyTimers.delete(conversation.id)
  conversation.replying = false
  setInitialReplyPending(conversation.id, false)
}

function handleComposerKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey) return

  event.preventDefault()
  submitPrompt()
}

function resizeComposer() {
  const input = composerInputRef.value
  if (!input) return

  window.cancelAnimationFrame(composerResizeFrame)
  const currentHeight = input.getBoundingClientRect().height
  input.style.transition = 'none'
  input.style.height = '0px'
  const contentHeight = input.scrollHeight
  const targetHeight = Math.min(Math.max(contentHeight, 64), 160)
  input.style.height = `${currentHeight}px`
  input.style.overflowY = contentHeight > 160 ? 'auto' : 'hidden'
  input.getBoundingClientRect()
  input.style.removeProperty('transition')

  composerResizeFrame = window.requestAnimationFrame(() => {
    input.style.height = `${targetHeight}px`
  })
}

function collapseComposer() {
  const input = composerInputRef.value
  if (!input) return

  window.cancelAnimationFrame(composerResizeFrame)
  input.style.overflowY = 'hidden'
  composerResizeFrame = window.requestAnimationFrame(() => {
    input.style.height = '64px'
  })
}

function selectAttachments() {
  attachmentInputRef.value?.click()
}

function handleAttachmentChange(event) {
  selectedAttachments.value = Array.from(event.target.files ?? [])
}

async function selectConversation(index) {
  activeConversation.value = index
  historyMenuOpen.value = false
  previewQuestion.value = null
  anchoredQuestionId.value = null
  await nextTick()
  messageListRef.value?.scrollTo({ top: 0 })
}

function bindMessageElement(element, messageIdValue) {
  if (element) {
    messageElements.set(messageIdValue, element)
  } else {
    messageElements.delete(messageIdValue)
  }
}

function scrollToMessage(messageIdValue) {
  const list = messageListRef.value
  const message = messageElements.get(messageIdValue)
  if (!list || !message) return

  const messageTop = list.scrollTop + message.getBoundingClientRect().top - list.getBoundingClientRect().top
  list.scrollTo({
    top: messageTop - list.clientHeight / 2 + message.clientHeight / 2,
    behavior: 'smooth',
  })
}

function showQuestionPreview(message, event) {
  const body = agentBodyRef.value
  if (!body) return

  const bodyRect = body.getBoundingClientRect()
  const markerRect = event.currentTarget.getBoundingClientRect()
  const markerCenter = markerRect.top - bodyRect.top + markerRect.height / 2
  previewTop.value = Math.min(Math.max(markerCenter, 42), bodyRect.height - 42)
  previewQuestion.value = message
}

function getAttachmentCount(message) {
  return message.attachments?.length ?? message.attachmentCount ?? 0
}

function handleHistoryFocusOut(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    historyMenuOpen.value = false
  }
}

async function activateLibraryView() {
  if (libraryViewActive) return
  libraryViewActive = true
  await nextTick()
  updateResizeMetrics()
  window.addEventListener('resize', updateResizeMetrics)
}

function deactivateLibraryView() {
  if (!libraryViewActive) return
  libraryViewActive = false
  window.removeEventListener('resize', updateResizeMetrics)
}

onMounted(() => {
  if (props.active) activateLibraryView()
})

onActivated(activateLibraryView)
onDeactivated(deactivateLibraryView)
watch(() => props.active, (active) => {
  if (active) activateLibraryView()
  else deactivateLibraryView()
})

onBeforeUnmount(() => {
  deactivateLibraryView()
  window.clearTimeout(initialMessageTimer)
  window.clearTimeout(copyFeedbackTimer)
  window.cancelAnimationFrame(composerResizeFrame)
  replyTimers.forEach((timer) => window.clearTimeout(timer))
  replyTimers.clear()
  messageEntryTimers.forEach((timer) => window.clearTimeout(timer))
  messageEntryTimers.clear()
})
</script>

<template>
  <section
    ref="contractLibraryRef"
    class="contract-library"
    :class="{ 'is-resizing': resizingChatPanel }"
    :style="chatPanelWidth === null ? undefined : { '--contract-agent-width': `${chatPanelWidth}px` }"
    aria-label="合同库工作台"
  >
    <section ref="contractAgentRef" class="contract-agent" aria-labelledby="contract-agent-title">
      <header
        class="contract-agent__header"
        :class="{ 'is-menu-open': historyMenuOpen }"
        @mouseenter="historyMenuOpen = true"
        @mouseleave="handleHistoryMouseLeave"
        @focusin="historyMenuOpen = true"
        @focusout="handleHistoryFocusOut"
      >
        <button
          class="contract-agent__history-trigger"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="historyMenuOpen"
        >
          <h2 id="contract-agent-title">{{ historyItems[activeConversation] }}</h2>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m7 10 5 5 5-5" />
          </svg>
        </button>

        <div class="contract-agent__history-menu" role="menu" aria-label="选择历史对话">
          <div
            v-for="(conversation, index) in conversations"
            :key="conversation.id"
            class="contract-agent__history-item"
            :class="{ 'is-active': activeConversation === index, 'is-editing': editingConversationId === conversation.id }"
          >
            <template v-if="editingConversationId === conversation.id">
              <input
                :ref="bindConversationNameInput"
                v-model="conversationNameDraft"
                type="text"
                maxlength="40"
                aria-label="修改对话名称"
                @click.stop
                @keydown.enter.prevent="finishConversationRename(conversation)"
                @keydown.esc.prevent="cancelConversationRename"
                @blur="finishConversationRename(conversation)"
              />
              <button
                class="contract-agent__history-confirm"
                type="button"
                aria-label="保存对话名称"
                @mousedown.prevent
                @click.stop="finishConversationRename(conversation)"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="m4 10.5 3.5 3.5L16 5.5" />
                </svg>
              </button>
            </template>

            <template v-else>
              <button
                class="contract-agent__history-option"
                type="button"
                role="menuitem"
                @click="selectConversation(index)"
              >
                <span>{{ conversation.name }}</span>
                <i aria-hidden="true"></i>
              </button>
              <button
                class="contract-agent__history-rename"
                type="button"
                :aria-label="`重命名对话：${conversation.name}`"
                @click.stop="startConversationRename(conversation)"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="m12.7 4.1 3.2 3.2M4 16l2.8-.6 8.4-8.4a1.8 1.8 0 0 0 0-2.5 1.8 1.8 0 0 0-2.5 0l-8.4 8.4L4 16Z" />
                </svg>
              </button>
            </template>
          </div>
        </div>
      </header>

      <div
        ref="agentBodyRef"
        class="contract-agent__body"
      >
        <aside
          class="contract-agent__history"
          :aria-label="questionMessages.length >= HISTORY_VISIBILITY_THRESHOLD ? '当前对话问题定位' : undefined"
          :aria-hidden="questionMessages.length < HISTORY_VISIBILITY_THRESHOLD"
        >
          <div
            v-if="questionMessages.length >= HISTORY_VISIBILITY_THRESHOLD"
            class="contract-agent__history-track"
            :class="{ 'is-long': questionMessages.length > 12 }"
          >
            <button
              v-for="(message, index) in questionMessages"
              :key="message.id"
              type="button"
              :aria-label="`定位到当前对话第 ${index + 1} 个问题`"
              @click="scrollToMessage(message.id)"
              @mouseenter="showQuestionPreview(message, $event)"
              @focus="showQuestionPreview(message, $event)"
              @mouseleave="previewQuestion = null"
              @blur="previewQuestion = null"
            >
              <span aria-hidden="true"></span>
            </button>
          </div>
        </aside>

        <Transition name="question-preview">
          <div
            v-if="previewQuestion"
            class="contract-agent__question-preview"
            :style="{ top: `${previewTop}px` }"
            role="tooltip"
          >
            <p>{{ previewQuestion.content }}</p>
            <span v-if="getAttachmentCount(previewQuestion)">
              共 {{ getAttachmentCount(previewQuestion) }} 个附件
            </span>
          </div>
        </Transition>

        <div class="contract-agent__main">
          <Transition name="contract-agent-empty">
            <div v-if="!messages.length" class="contract-agent__empty">
              <HandwritingPrompt />
            </div>
          </Transition>

          <div
            ref="messageListRef"
            class="contract-agent__messages"
            aria-live="polite"
          >
            <article
              v-for="message in messages"
              :key="message.id"
              :ref="(element) => bindMessageElement(element, message.id)"
              class="contract-agent__message"
              :class="[
                `contract-agent__message--${message.role}`,
                {
                  'is-new-conversation-entry': message.id === initialMessageId,
                  'is-message-entry': enteringMessageIds.has(message.id),
                },
              ]"
            >
              <div v-if="message.role === 'assistant'" class="contract-agent__response">
                <div class="contract-agent__response-header">
                  <span>{{ message.processingTime || '处理完成' }}</span>
                  <button
                    v-if="message.processPath?.length"
                    type="button"
                    :aria-expanded="expandedProcessIds.has(message.id)"
                    :aria-controls="`process-path-${message.id}`"
                    @click="toggleProcessPath(message.id)"
                  >
                    {{ expandedProcessIds.has(message.id) ? '收起处理路径' : '查看处理路径' }}
                    <svg
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                      :class="{ 'is-expanded': expandedProcessIds.has(message.id) }"
                    >
                      <path d="m6.5 8 3.5 3.5L13.5 8" />
                    </svg>
                  </button>
                </div>

                <Transition name="process-path">
                  <div
                    v-if="message.processPath?.length && expandedProcessIds.has(message.id)"
                    :id="`process-path-${message.id}`"
                    class="contract-agent__process-path-collapse"
                  >
                    <div>
                      <ol class="contract-agent__process-path">
                        <li v-for="step in message.processPath" :key="step">
                          <i aria-hidden="true"></i>
                          <span>{{ step }}</span>
                        </li>
                      </ol>
                    </div>
                  </div>
                </Transition>

                <MarkdownMessage
                  class="contract-agent__message-content"
                  :content="message.content"
                />

                <footer class="contract-agent__message-actions" aria-label="回复操作">
                  <button
                    type="button"
                    class="contract-agent__copy-action"
                    :class="{ 'is-copied': copiedMessageId === message.id }"
                    :aria-label="copiedMessageId === message.id ? '已复制' : '复制回复'"
                    @click="copyMessage(message)"
                  >
                    <Transition name="copy-icon" mode="out-in">
                      <svg
                        v-if="copiedMessageId !== message.id"
                        key="copy"
                        viewBox="0 0 20 20"
                        aria-hidden="true"
                      >
                        <rect x="6.5" y="6.5" width="9" height="9" rx="2" />
                        <path d="M13.5 6.5v-1a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
                      </svg>
                      <svg v-else key="copied" viewBox="0 0 20 20" aria-hidden="true">
                        <path d="m4 10.5 3.5 3.5L16 5.5" />
                      </svg>
                    </Transition>
                  </button>
                  <button
                    type="button"
                    aria-label="从此回复创建分支"
                    @click="branchFromMessage(message.id)"
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <circle cx="5" cy="4" r="1.75" />
                      <circle cx="15" cy="6" r="1.75" />
                      <circle cx="5" cy="16" r="1.75" />
                      <path d="M5 5.75v8.5M6.75 10h2.5A5.75 5.75 0 0 0 15 4.25" />
                    </svg>
                  </button>
                  <time v-if="message.createdAt">{{ message.createdAt }}</time>
                </footer>
              </div>

              <MarkdownMessage
                v-else
                class="contract-agent__message-content"
                :content="message.content"
              />
            </article>

            <article
              v-if="replying"
              class="contract-agent__message contract-agent__message--assistant contract-agent__message--typing-entry"
              :class="{ 'is-initial-reply': isInitialReplyPending }"
            >
              <div class="contract-agent__typing" aria-label="智能助手正在回复">
                <i></i><i></i><i></i>
              </div>
            </article>

            <span
              v-if="anchoredQuestionId"
              class="contract-agent__scroll-space"
              aria-hidden="true"
            ></span>
          </div>

          <form class="contract-agent__composer" @submit.prevent="submitPrompt">
            <textarea
              ref="composerInputRef"
              v-model="prompt"
              rows="1"
              placeholder="询问合同相关问题…"
              aria-label="输入合同相关问题"
              :disabled="replying"
              @input="resizeComposer"
              @keydown="handleComposerKeydown"
            ></textarea>

            <div class="contract-agent__composer-actions">
              <button
                class="contract-agent__composer-action contract-agent__composer-action--attach"
                type="button"
                :disabled="replying"
                aria-label="添加附件"
                @click="selectAttachments"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span v-if="selectedAttachments.length" aria-hidden="true">
                  {{ selectedAttachments.length }}
                </span>
              </button>

              <input
                ref="attachmentInputRef"
                class="contract-agent__attachment-input"
                type="file"
                multiple
                tabindex="-1"
                @change="handleAttachmentChange"
              />

              <button
                class="contract-agent__composer-action contract-agent__composer-action--send"
                :class="{ 'is-stop': replying }"
                :type="replying ? 'button' : 'submit'"
                :disabled="!replying && !prompt.trim() && !selectedAttachments.length"
                :aria-label="replying ? '停止回复' : '发送消息'"
                @click="replying && stopReply()"
              >
                <Transition name="send-state" mode="out-in">
                  <svg v-if="!replying" key="send" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 19V5" />
                    <path d="m6.5 10.5 5.5-5.5 5.5 5.5" />
                  </svg>
                  <svg v-else key="stop" class="contract-agent__stop-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="5" y="5" width="14" height="14" rx="2" />
                  </svg>
                </Transition>
              </button>
            </div>
          </form>
        </div>
      </div>

      <button
        class="contract-agent__resize-handle"
        type="button"
        role="separator"
        aria-label="调整对话窗口宽度"
        aria-orientation="vertical"
        :aria-valuemin="Math.round(resizeBounds.min)"
        :aria-valuemax="Math.round(resizeBounds.max)"
        :aria-valuenow="displayedChatPanelWidth"
        :aria-valuetext="`对话窗口宽度 ${displayedChatPanelWidth} 像素`"
        @pointerdown="startChatPanelResize"
        @pointermove="resizeChatPanel"
        @pointerup="finishChatPanelResize"
        @pointercancel="finishChatPanelResize"
        @keydown="resizeChatPanelWithKeyboard"
      >
        <span aria-hidden="true"></span>
      </button>
    </section>

    <section class="contract-library-reserved" aria-label="合同库预留区域"></section>
  </section>
</template>

<style scoped>
.contract-library {
  position: relative;
  display: grid;
  grid-template-columns: minmax(360px, var(--contract-agent-width, 0.82fr)) minmax(480px, 1.18fr);
  gap: 0;
  height: 100%;
  min-height: 0;
}

.contract-library.is-resizing {
  cursor: col-resize;
  user-select: none;
}

.contract-agent,
.contract-library-reserved {
  min-width: 0;
  min-height: 0;
}

.contract-agent {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  overflow: visible;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.contract-agent::after {
  position: absolute;
  z-index: 9;
  top: 0;
  right: 0;
  bottom: 0;
  width: 4px;
  content: '';
  pointer-events: none;
  background:
    linear-gradient(180deg, transparent, #ffffffb8 8%, #ffffffb8 92%, transparent) 1px 0 / 1px 100% no-repeat,
    linear-gradient(90deg, #81968b24 0%, #ffffffdc 42%, #f8fffca3 58%, #8ba0951f 100%);
  box-shadow:
    -1px 0 0 #72877d12,
    2px 0 8px #728c801c;
  opacity: 0.88;
  -webkit-mask: linear-gradient(
    180deg,
    #000 0,
    #000 calc(50% - 34px),
    transparent calc(50% - 34px),
    transparent calc(50% + 34px),
    #000 calc(50% + 34px),
    #000 100%
  );
  mask: linear-gradient(
    180deg,
    #000 0,
    #000 calc(50% - 34px),
    transparent calc(50% - 34px),
    transparent calc(50% + 34px),
    #000 calc(50% + 34px),
    #000 100%
  );
}

.contract-agent__resize-handle {
  position: absolute;
  z-index: 10;
  top: 50%;
  right: -7px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 82px;
  padding: 0;
  color: #6d7d75;
  cursor: col-resize;
  touch-action: none;
  background: transparent;
  border: 0;
  outline: 0;
  transform: translateY(-50%);
}

.contract-agent__resize-handle span {
  width: 8px;
  height: 38px;
  background: linear-gradient(180deg, #7b70c3, #579a84);
  border: 1px solid #ffffffb8;
  border-radius: 999px;
  box-shadow:
    inset 1px 0 #ffffff5c,
    0 0 0 transparent;
  opacity: 0.42;
  transition:
    width 0.22s,
    height 0.34s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.2s,
    box-shadow 0.26s,
    transform 0.26s cubic-bezier(0.16, 1, 0.3, 1);
}

.contract-agent__resize-handle:hover span,
.contract-agent__resize-handle:focus-visible span,
.contract-library.is-resizing .contract-agent__resize-handle span {
  width: 10px;
  height: 46px;
  box-shadow:
    inset 1px 0 #ffffff8c,
    0 0 10px #7168c35c,
    0 0 18px #559a8442;
  opacity: 0.92;
  transform: scaleX(1.08);
}

.contract-agent__resize-handle:active span,
.contract-library.is-resizing .contract-agent__resize-handle span {
  height: 50px;
  opacity: 1;
}

.contract-agent__body {
  position: relative;
  display: grid;
  flex: 1;
  grid-template-columns: 28px minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
}

.contract-agent__history {
  display: grid;
  min-height: 0;
  padding: 8px 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-width: none;
  background: transparent;
}

.contract-agent__history-track {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  margin-block: auto;
  transform: translateY(-42px);
}

.contract-agent__history-track.is-long {
  margin-top: 18px;
  margin-bottom: 18px;
  transform: none;
}

.contract-agent__history::-webkit-scrollbar {
  display: none;
}

.contract-agent__history button {
  display: grid;
  flex: 0 0 18px;
  place-items: center;
  width: 100%;
  height: 18px;
  padding: 0;
  cursor: pointer;
  background: transparent;
  border: 0;
}

.contract-agent__history button span {
  width: 7px;
  height: 1px;
  background: #a5ada9;
  border-radius: 999px;
  transition:
    width 0.36s cubic-bezier(0.16, 1, 0.3, 1),
    height 0.2s,
    background-color 0.28s,
    box-shadow 0.28s,
    transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}

.contract-agent__history button:hover span {
  width: 18px;
  height: 2px;
  background: linear-gradient(90deg, #7d75bc, #4d8d7a);
  box-shadow: 0 0 8px #7063d866;
  transform: scaleY(1.15);
}

.contract-agent__history button:focus-visible {
  outline: 2px solid #7063d85c;
  outline-offset: -4px;
}

.contract-agent__question-preview {
  position: absolute;
  z-index: 8;
  left: 34px;
  width: min(230px, calc(100% - 36px));
  padding: 10px 12px;
  pointer-events: none;
  background: #26352fee;
  border: 1px solid #ffffff1f;
  border-radius: 11px;
  box-shadow: 0 12px 28px #1f30283b;
  transform: translateY(-50%);
}

.contract-agent__question-preview p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: #f4f8f6;
  font-size: 11px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.contract-agent__question-preview span {
  display: block;
  margin-top: 6px;
  color: #b9cec4;
  font-size: 9px;
}

.question-preview-enter-active,
.question-preview-leave-active {
  transition: opacity 0.16s, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.question-preview-enter-from,
.question-preview-leave-to {
  opacity: 0;
  transform: translate(-5px, -50%);
}

.contract-agent__main {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.contract-agent__header {
  position: absolute;
  z-index: 5;
  top: 0;
  right: 0;
  left: 0;
  display: flex;
  align-items: center;
  min-height: 50px;
  padding: 7px 18px;
  background: #fafcfc;
  border-bottom: 1px solid #ffffff8f;
  border-radius: 0;
  box-shadow: 0 8px 24px #34463d0b;
}

.contract-agent__history-trigger {
  display: flex;
  gap: 7px;
  align-items: center;
  max-width: 100%;
  padding: 7px 8px;
  color: #26332c;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 9px;
}

.contract-agent__history-trigger h2 {
  overflow: hidden;
  margin: 0;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.02em;
}

.contract-agent__history-trigger svg {
  flex: none;
  width: 15px;
  height: 15px;
  fill: none;
  stroke: #818b85;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8px;
  transition: transform 0.25s;
}

.contract-agent__history-trigger:focus-visible {
  outline: 2px solid #7063d852;
  outline-offset: 1px;
}

.contract-agent__header.is-menu-open .contract-agent__history-trigger svg {
  transform: rotate(180deg);
}

.contract-agent__history-menu {
  position: absolute;
  top: calc(100% - 4px);
  left: 18px;
  width: min(240px, calc(100% - 36px));
  padding: 7px;
  visibility: hidden;
  opacity: 0;
  background: #ffffffed;
  border: 1px solid #ffffff;
  border-radius: 14px;
  box-shadow:
    0 18px 40px #263a3026,
    inset 0 1px #ffffff;
  backdrop-filter: blur(18px);
  transition:
    opacity 0.2s,
    visibility 0.2s,
    transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
  transform: translateY(-7px) scale(0.98);
}

.contract-agent__header.is-menu-open .contract-agent__history-menu {
  visibility: visible;
  opacity: 1;
  transform: translateY(0) scale(1);
}

.contract-agent__history-item {
  display: flex;
  align-items: center;
  min-width: 0;
  width: 100%;
  min-height: 36px;
  color: #68736d;
  background: transparent;
  border-radius: 9px;
  transition: color 0.2s, background-color 0.2s;
}

.contract-agent__history-item:hover,
.contract-agent__history-item:focus-within {
  color: #2d3b33;
  background: #eef2f0;
}

.contract-agent__history-item.is-active {
  color: #433b7d;
  background: #efedff;
}

.contract-agent__history-option {
  display: flex;
  flex: 1;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  padding: 9px 5px 9px 10px;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 9px;
}

.contract-agent__history-option:focus-visible {
  outline: 2px solid #7063d84a;
  outline-offset: -2px;
}

.contract-agent__history-option span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contract-agent__history-option i {
  flex: none;
  width: 5px;
  height: 5px;
  background: currentColor;
  border-radius: 50%;
  opacity: 0;
}

.contract-agent__history-item.is-active .contract-agent__history-option i {
  opacity: 1;
}

.contract-agent__history-rename,
.contract-agent__history-confirm {
  display: grid;
  flex: 0 0 28px;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  margin-right: 4px;
  color: #7d8782;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  transition: color 0.18s, background-color 0.18s, opacity 0.18s;
}

.contract-agent__history-rename {
  opacity: 0;
}

.contract-agent__history-item:hover .contract-agent__history-rename,
.contract-agent__history-rename:focus-visible {
  opacity: 1;
}

.contract-agent__history-rename:hover,
.contract-agent__history-rename:focus-visible,
.contract-agent__history-confirm:hover,
.contract-agent__history-confirm:focus-visible {
  color: #405047;
  background: #ffffffb8;
  outline: 0;
}

.contract-agent__history-rename svg,
.contract-agent__history-confirm svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.45;
}

.contract-agent__history-item input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 4px 8px;
  margin-left: 5px;
  color: #334139;
  font: inherit;
  font-size: 12px;
  background: #ffffffd9;
  border: 1px solid #bbb4ed;
  border-radius: 7px;
  outline: 0;
  box-shadow: 0 0 0 2px #7063d814;
}

.contract-agent__messages {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 17px;
  min-height: 0;
  padding: 72px 20px 24px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
}

.contract-agent__messages::-webkit-scrollbar {
  display: none;
}

.contract-agent__scroll-space {
  flex: 0 0 calc(100% - 72px);
  min-height: 120px;
  pointer-events: none;
}

.contract-agent__message {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  width: 100%;
  max-width: 100%;
}

.contract-agent__message.is-new-conversation-entry {
  animation: contract-agent-message-rise 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.32s both;
}

.contract-agent__message.is-message-entry {
  animation: contract-agent-message-enter 0.46s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.contract-agent__message--typing-entry {
  animation: contract-agent-typing-enter 0.32s ease-out 0.5s both;
}

.contract-agent__message--typing-entry.is-initial-reply {
  animation-delay: 0.96s;
}

.contract-agent__empty {
  position: absolute;
  z-index: 1;
  inset: 50px 16px 151px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  text-align: center;
}

.contract-agent-empty-leave-active {
  transition:
    opacity 0.24s cubic-bezier(0.4, 0, 1, 1),
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.contract-agent-empty-leave-to {
  opacity: 0;
  transform: translateY(-82px) scale(0.97);
}

.contract-agent__message-content {
  width: 100%;
  min-width: 0;
  color: #435049;
}

.contract-agent__message--user {
  align-self: flex-end;
  width: auto;
  max-width: 86%;
}

.contract-agent__message--user .contract-agent__message-content {
  width: auto;
  padding: 9px 13px;
  color: #35423b;
  background: #edf0ee;
  border-radius: 16px 16px 5px;
}

.contract-agent__message--assistant .contract-agent__message-content {
  padding: 0 2px;
}

.contract-agent__response {
  width: 100%;
  min-width: 0;
}

.contract-agent__response-header {
  display: flex;
  gap: 9px;
  align-items: center;
  min-height: 25px;
  margin: 0 2px 10px;
  color: #8a948f;
  font-size: 11px;
}

.contract-agent__response-header > span {
  white-space: nowrap;
}

.contract-agent__response-header button {
  display: flex;
  gap: 3px;
  align-items: center;
  padding: 3px 5px;
  color: #77817c;
  font: inherit;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  transition: color 0.18s, background-color 0.18s;
}

.contract-agent__response-header button:hover,
.contract-agent__response-header button:focus-visible {
  color: #3f4d46;
  background: #edf1ef;
  outline: 0;
}

.contract-agent__response-header svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.contract-agent__response-header svg.is-expanded {
  transform: rotate(180deg);
}

.contract-agent__process-path-collapse {
  display: grid;
  grid-template-rows: 1fr;
  opacity: 1;
}

.contract-agent__process-path-collapse > div {
  min-height: 0;
  overflow: hidden;
}

.contract-agent__process-path {
  position: relative;
  padding: 3px 0 3px 15px;
  margin: 0 2px 15px 5px;
  color: #747f79;
  font-size: 11px;
  line-height: 1.6;
  list-style: none;
  border-left: 1px solid #d5dcd8;
}

.contract-agent__process-path li {
  position: relative;
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.contract-agent__process-path li + li {
  margin-top: 5px;
}

.contract-agent__process-path i {
  position: absolute;
  top: 0.65em;
  left: -18px;
  width: 5px;
  height: 5px;
  background: #a8b1ac;
  border: 1px solid #fafcfc;
  border-radius: 50%;
  transform: translateY(-50%);
}

.process-path-enter-active,
.process-path-leave-active {
  transition:
    grid-template-rows 0.38s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.24s ease-out;
}

.process-path-enter-from,
.process-path-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
}

.contract-agent__message-actions {
  display: flex;
  gap: 2px;
  align-items: center;
  min-height: 28px;
  margin: 8px 0 0;
  color: #8d9691;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-2px);
  transition:
    opacity 0.18s,
    transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.contract-agent__message--assistant:hover .contract-agent__message-actions,
.contract-agent__message--assistant:focus-within .contract-agent__message-actions {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.contract-agent__message-actions button {
  display: grid;
  place-items: center;
  width: 27px;
  height: 27px;
  padding: 0;
  color: inherit;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  transition: color 0.18s, background-color 0.18s;
}

.contract-agent__message-actions button:hover,
.contract-agent__message-actions button:focus-visible {
  color: #3f4d46;
  background: #e9eeeb;
  outline: 0;
}

.contract-agent__message-actions .contract-agent__copy-action.is-copied {
  color: #4f7d68;
  background: #e4eee9;
  animation: contract-agent-copy-confirm 0.38s cubic-bezier(0.16, 1, 0.3, 1);
}

.contract-agent__message-actions svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.45;
}

.copy-icon-enter-active {
  transition:
    opacity 0.18s ease-out,
    transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}

.copy-icon-leave-active {
  transition:
    opacity 0.12s ease-in,
    transform 0.14s ease-in;
}

.copy-icon-enter-from {
  opacity: 0;
  transform: scale(0.55) rotate(-12deg);
}

.copy-icon-leave-to {
  opacity: 0;
  transform: scale(0.72) rotate(8deg);
}

.contract-agent__message-actions time {
  margin-left: 4px;
  font-size: 10px;
  white-space: nowrap;
}

@media (hover: none) {
  .contract-agent__message-actions {
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }
}

.contract-agent__typing {
  display: flex;
  gap: 4px;
  align-items: center;
  min-height: 24px;
  padding-inline: 2px;
}

.contract-agent__typing i {
  width: 5px;
  height: 5px;
  background: #766bd0;
  border-radius: 50%;
  animation: contract-agent-typing 0.9s ease-in-out infinite alternate;
}

.contract-agent__typing i:nth-child(2) { animation-delay: 0.15s; }
.contract-agent__typing i:nth-child(3) { animation-delay: 0.3s; }

.contract-agent__composer {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 14px;
  margin: 0 16px 16px;
  background: #ffffffb8;
  border: 1px solid #ffffffed;
  border-radius: 19px;
  box-shadow:
    inset 0 1px #ffffff,
    0 10px 28px #34473e14;
}

.contract-agent__composer textarea {
  width: 100%;
  height: 64px;
  min-height: 64px;
  max-height: 160px;
  padding: 5px 3px;
  color: #34413a;
  resize: none;
  overflow-y: hidden;
  background: transparent;
  border: 0;
  outline: 0;
  transition: height 0.26s cubic-bezier(0.16, 1, 0.3, 1);
}

.contract-agent__composer textarea::placeholder {
  color: #9aa39e;
}

.contract-agent__composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.contract-agent__attachment-input {
  display: none;
}

.contract-agent__composer-action {
  position: relative;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  cursor: pointer;
  border-radius: 50%;
  transition:
    color 0.22s,
    background-color 0.22s,
    box-shadow 0.22s,
    opacity 0.2s;
}

.contract-agent__composer-action--attach {
  color: #56635c;
  background: #eef2f0;
  border: 1px solid #dfe6e2;
}

.contract-agent__composer-action--attach span {
  position: absolute;
  top: -4px;
  right: -4px;
  display: grid;
  place-items: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  color: #ffffff;
  font-size: 9px;
  font-weight: 700;
  background: #7063d8;
  border: 2px solid #ffffff;
  border-radius: 999px;
}

.contract-agent__composer-action--send {
  color: #f4fbf7;
  background: #2d4b3e;
  border: 0;
  box-shadow: 0 8px 18px #28473a2b;
}

.contract-agent__composer-action--attach:hover:not(:disabled) {
  color: #344c41;
  background-color: #dfe9e4;
}

.contract-agent__composer-action--send:hover:not(:disabled) {
  background-color: #416b59;
  box-shadow: 0 8px 20px #31594738;
}

.contract-agent__composer-action--send.is-stop:hover {
  background-color: #3a5e4f;
}

.contract-agent__composer-action:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.contract-agent__composer-action:focus-visible {
  outline: 3px solid #7063d857;
  outline-offset: 2px;
}

.contract-agent__composer-action svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7px;
}

.contract-agent__composer-action .contract-agent__stop-icon rect {
  fill: currentColor;
  stroke: none;
}

.send-state-enter-active {
  transition:
    opacity 0.16s ease-out,
    transform 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}

.send-state-leave-active {
  transition:
    opacity 0.1s ease-in,
    transform 0.12s ease-in;
}

.send-state-enter-from {
  opacity: 0;
  transform: scale(0.55);
}

.send-state-leave-to {
  opacity: 0;
  transform: scale(0.72);
}

.contract-library-reserved {
  position: relative;
  isolation: isolate;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.contract-library-reserved::after {
  display: none;
}

@keyframes contract-agent-typing {
  to {
    opacity: 0.32;
    transform: translateY(-3px);
  }
}

@keyframes contract-agent-copy-confirm {
  45% {
    transform: scale(0.86);
  }

  100% {
    transform: scale(1);
  }
}

@keyframes contract-agent-message-rise {
  from {
    opacity: 0;
    transform: translateY(clamp(180px, 34vh, 300px)) scale(0.96);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes contract-agent-message-enter {
  from {
    opacity: 0;
    transform: translateY(28px) scale(0.98);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes contract-agent-typing-enter {
  from {
    opacity: 0;
    transform: translateY(12px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 900px) {
  .contract-library {
    grid-template-rows: minmax(600px, 1fr) minmax(360px, 0.7fr);
    grid-template-columns: 1fr;
    height: auto;
  }

  .contract-agent {
    border: 0;
  }

  .contract-agent::after {
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
    width: auto;
    height: 4px;
    background:
      linear-gradient(90deg, transparent, #ffffffb8 8%, #ffffffb8 92%, transparent) 0 1px / 100% 1px no-repeat,
      linear-gradient(180deg, #81968b24 0%, #ffffffdc 42%, #f8fffca3 58%, #8ba0951f 100%);
    box-shadow:
      0 -1px 0 #72877d12,
      0 2px 8px #728c801c;
    -webkit-mask: none;
    mask: none;
  }

  .contract-agent__resize-handle {
    display: none;
  }
}

@media (max-width: 640px) {
  .contract-library {
    grid-template-rows: minmax(560px, calc(100dvh - 126px)) 320px;
  }

  .contract-agent,
  .contract-library-reserved {
    border-radius: 0;
  }

  .contract-agent__body {
    grid-template-columns: 24px minmax(0, 1fr);
  }

  .contract-agent__history-track {
    transform: translateY(-28px);
  }

  .contract-agent__history-track.is-long {
    transform: none;
  }

  .contract-agent__question-preview {
    left: 29px;
    width: min(205px, calc(100% - 30px));
  }

  .contract-agent__history {
    padding-block: 7px;
  }

  .contract-agent__header {
    min-height: 46px;
    padding: 5px 13px;
    border-radius: 0;
  }

  .contract-agent__history-menu {
    left: 13px;
    width: min(220px, calc(100% - 26px));
  }

  .contract-agent__messages {
    padding: 64px 15px 20px;
  }

  .contract-agent__empty {
    inset: 46px 12px 146px;
  }

  .contract-agent__composer {
    margin: 0 11px 11px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .contract-agent-empty-leave-active {
    transition: none;
  }

  .contract-agent__message.is-new-conversation-entry,
  .contract-agent__message.is-message-entry,
  .contract-agent__message--typing-entry {
    opacity: 1;
    transform: none;
    animation: none;
  }

  .contract-agent__typing i {
    animation: none;
  }

  .contract-agent__composer button {
    transition: none;
  }

  .contract-agent__composer textarea {
    transition: none;
  }

  .contract-agent__response-header svg,
  .contract-agent__message-actions,
  .contract-agent__resize-handle span,
  .copy-icon-enter-active,
  .copy-icon-leave-active,
  .send-state-enter-active,
  .send-state-leave-active,
  .process-path-enter-active,
  .process-path-leave-active {
    transition: none;
  }

  .contract-agent__message-actions .contract-agent__copy-action.is-copied {
    animation: none;
  }

  .question-preview-enter-active,
  .question-preview-leave-active {
    transition: none;
  }
}
</style>
