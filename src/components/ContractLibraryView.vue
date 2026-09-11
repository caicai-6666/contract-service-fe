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
import ContractArchivePanel from './ContractArchivePanel.vue'
import PdfPreviewOverlay from './PdfPreviewOverlay.vue'
import DeleteConversationDialog from './DeleteConversationDialog.vue'
import onlineSearchImage from '../assets/online-search.webp'
import localSearchImage from '../assets/local-search.webp'
import { taskProgressPresentation } from '../models/communicationProgress.js'
import { getSelectedFileKind, convertImageFileToPdf } from '../services/local-file-pdf.js'
import { clipboardFiles } from '../services/clipboardFiles.js'
import { canPreviewCommunicationFile, getCommunicationPdf } from '../services/communicationResourceApi.js'
import { createCommunicationSession, newConversation } from '../services/communicationSession.js'
import { createMessageScrollFollower } from '../services/messageScrollFollower.js'
import { createHistoryPullRefresh } from '../services/historyPullRefresh.js'
import { validateTurnInput, turnTimingLabel, turnStartTime, hasStartedFinal, shouldCollapseTurnProcess, copyableTurnMessage, canInterruptTurn } from '../models/communicationTurn.js'
defineOptions({ name: 'ContractLibraryView' })
const props = defineProps({ active: { type: Boolean, default: true } })

const communication = createCommunicationSession()
const { conversations, restoring, listLoading, listError } = communication
const prompt = ref('')
const messageListRef = ref(null)
const messageContentRef = ref(null)
let messageScrollFollower = null
let disposeHistoryPull = null
const historyPullDistance = ref(0)
const conversationVisible = ref(false)
let revealRevision = 0
const agentBodyRef = ref(null)
const composerInputRef = ref(null)
const attachmentInputRef = ref(null)
const selectedAttachments = ref([])
const convertingAttachments = ref(false)
const attachmentNotices = ref([])
const attachmentSourceKeys = new WeakMap()
const attachmentNoticeTimers = new Map()
let attachmentNoticeId = 0
let attachmentSelectionDisposed = false
const attachmentPreviewFile = ref(null)
const attachmentPreviewUrl = ref('')
const attachmentPreviewError = ref('')
const attachmentPreviewLoading = ref(false)
let attachmentPreviewRequest = null
const activeConversation = computed({
  get: () => Math.max(0, conversations.value.findIndex((c) => c.id === communication.selectedConversationId.value)),
  set: (index) => { communication.selectedConversationId.value = conversations.value[index]?.id },
})
const historyMenuOpen = ref(false)
const previewQuestion = ref(null)
const previewTop = ref(0)
const initialMessageId = ref(null)
const enteringMessageIds = ref(new Set())
const expandedProcessIds = ref(new Set())
const copiedMessageId = ref(null)
const contractLibraryRef = ref(null)
const contractAgentRef = ref(null)
const chatPanelWidth = ref(null)
const displayedChatPanelWidth = ref(0)
const resizeBounds = ref({ min: 360, max: 360 })
const resizingChatPanel = ref(false)
const stackedPanels = ref(false)
let libraryResizeObserver = null
const editingConversationId = ref(null)
const conversationNameDraft = ref('')
const conversationNameInputRef = ref(null)
const conversationToDelete = ref(null)
const conversationDeleteError = ref('')

const currentConversation = computed(() => conversations.value[activeConversation.value] || conversations.value[0])
const messages = computed(() => currentConversation.value.messages)
const replying = computed(() => conversations.value[activeConversation.value]?.replying ?? false)
const currentTurn = computed(() => {
  const turn = currentConversation.value.turns.at(-1)
  return messages.value.some((message) => message.fromHistory && message.turnId === turn?.turn_id) ? undefined : turn
})
const displayTurns = computed(() => {
  const archived = new Set(messages.value.filter((message) => message.fromHistory).map((message) => message.turnId))
  return [...(currentConversation.value.history?.turns ?? []).filter((turn) => archived.has(turn.turn_id)), ...currentConversation.value.turns.filter((turn) => !archived.has(turn.turn_id))]
})
const messageDisplayStates = ref(new Map())
const startTimeReference = ref(Date.now())
const turnStartTimes = computed(() => new Map(displayTurns.value.map(turn => [turn.turn_id, turnStartTime(turn, startTimeReference.value)])))
function updateMessageDisplay(messageId, state) {
  messageDisplayStates.value.set(messageId, state)
}
function canCopyMessage(message) {
  const state = messageDisplayStates.value.get(message.id)
  if (!state?.complete) return false
  const turn = displayTurns.value.find((item) => item.turn_id === message.turnId)
  const last = copyableTurnMessage(turn, state.text)
  return Boolean(last && message.id === `${turn.turn_id}:${last.message_id}`)
}
const expandedTurnProcesses = ref(new Set())
const startedFinalTurns = computed(() => new Set(displayTurns.value.filter(hasStartedFinal).map((turn) => turn.turn_id)))
const collapsedProcessTurns = computed(() => new Set(displayTurns.value.filter(shouldCollapseTurnProcess).map((turn) => turn.turn_id)))
const processToggleTurns = computed(() => new Set(messages.value
  .filter((message) => message.messageKind === 'intermediate' && collapsedProcessTurns.value.has(message.turnId))
  .map((message) => message.turnId)))

const messageSections = computed(() => {
  const sections = []
  for (const message of messages.value) {
    const process = message.messageKind === 'intermediate'
    const previous = sections.at(-1)
    if (process && previous?.process && previous.turnId === message.turnId) previous.messages.push(message)
    else sections.push({ id: message.id, turnId: message.turnId, process, messages: [message] })
  }
  return sections
})

function processIsCollapsed(section) {
  return section.process && collapsedProcessTurns.value.has(section.turnId) && !expandedTurnProcesses.value.has(section.turnId)
}

watch(() => displayTurns.value.filter((turn) => turn.status === 'cancelled').map((turn) => turn.turn_id), (ids, previous = []) => {
  const newlyStopped = ids.filter((id) => !previous.includes(id))
  if (!newlyStopped.length) return
  const expanded = new Set(expandedTurnProcesses.value)
  newlyStopped.forEach((id) => expanded.delete(id))
  expandedTurnProcesses.value = expanded
  // 停止后的收尾和折叠不再追到空白末尾，保留当前阅读位置。
  messageScrollFollower?.pause()
})

function toggleTurnProcess(turnId) {
  messageScrollFollower?.holdLayout()
  const expanded = new Set(expandedTurnProcesses.value)
  if (expanded.has(turnId)) expanded.delete(turnId)
  else expanded.add(turnId)
  expandedTurnProcesses.value = expanded
}

const progressImages = { 'online-search': onlineSearchImage, 'local-search': localSearchImage }
const thinkingActivity = { type: 'thinking', text: '正在思考', thinking: true }
const tailActivity = computed(() => {
  if (currentConversation.value.submitting) return thinkingActivity
  if (!replying.value || ['recovering', 'disconnected'].includes(currentTurn.value?.connection)) return null
  if (hasStartedFinal(currentTurn.value)) return null
  const progress = currentTurn.value?.active_progress
  // 检索状态从开始就留在消息序列中，结束只变灰，不在尾部再渲染一份。
  if (progress) return progress.type === 'thinking' ? thinkingActivity : null
  if (!messages.value.some((message) => message.status === 'streaming')) return thinkingActivity
  return null
})
const processingClock = ref(Date.now())
let processingTimer = null
watch(
  () => [props.active, currentTurn.value?.turn_id, currentTurn.value?.status, currentTurn.value?.activated_at],
  () => {
    window.clearInterval(processingTimer)
    processingTimer = null
    processingClock.value = Date.now()
    if (props.active && currentTurn.value?.status === 'processing' && currentTurn.value.activated_at) {
      processingTimer = window.setInterval(() => { processingClock.value = Date.now() }, 1000)
    }
  },
  { immediate: true },
)

function messageTimingLabel(message) {
  const turn = displayTurns.value.find((item) => item.turn_id === message.turnId)
  if (turn?.history && turn.processing_duration_ms === null && turn.status === 'cancelled') return '已手动停止'
  return turnTimingLabel(turn, processingClock.value)
}
const composerBusy = computed(() => !conversationVisible.value || convertingAttachments.value || currentConversation.value.cancelling || currentConversation.value.deleting || currentConversation.value.renaming)
const taskPending = computed(() => currentConversation.value.submitting || replying.value)
const stopMode = computed(() => taskPending.value && !prompt.value.trim() && !selectedAttachments.value.length)
const canInterrupt = computed(() => !currentConversation.value.submitting && !currentConversation.value.cancelling && canInterruptTurn(currentTurn.value))
const turnLabels = { failed: '本轮处理失败', expired: '轮次激活已超时，请重新发送' }
const historyItems = computed(() => conversations.value.map((conversation) => conversation.name))
const questionMessages = computed(() => messages.value.filter((message) => message.role === 'user'))

const HISTORY_VISIBILITY_THRESHOLD = 3
const CONVERSATION_TITLE_MAX_LENGTH = 12
const CHAT_PANEL_MIN_WIDTH = 360
const CABINET_PANEL_MIN_WIDTH = 640
const RESIZE_KEYBOARD_STEP = 24

const messageElements = new Map()
const messageEntryTimers = new Map()
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
  if (!libraryRect.width) return null
  stackedPanels.value = libraryRect.width < CHAT_PANEL_MIN_WIDTH + CABINET_PANEL_MIN_WIDTH + columnGap
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
  if (stackedPanels.value) return

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
  if (stackedPanels.value) return
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

async function finishConversationRename(conversation) {
  if (editingConversationId.value !== conversation.id || conversation.renaming) return
  try {
    await communication.renameConversation(conversation, conversationNameDraft.value)
    editingConversationId.value = null
    conversationNameDraft.value = ''
  } catch (error) {
    if (error.name !== 'AbortError') showAttachmentNotice('修改名称失败', error.message)
  }
}

function deleteConversation(conversation) {
  if (!conversation.registered || conversation.deleting || conversation.renaming || conversation.submitting || conversation.cancelling) return
  conversationToDelete.value = conversation
  conversationDeleteError.value = ''
  historyMenuOpen.value = false
}

function closeConversationDelete() {
  if (conversationToDelete.value?.deleting) return
  conversationToDelete.value = null
  conversationDeleteError.value = ''
}

async function confirmConversationDelete(confirmation) {
  const conversation = conversationToDelete.value
  if (!conversation || conversation.deleting || confirmation !== `我确认删除${conversation.name}`) return
  conversationDeleteError.value = ''
  try {
    await communication.deleteConversation(conversation)
    closeConversationDelete()
  } catch (error) {
    if (error.name !== 'AbortError') conversationDeleteError.value = error.message
  }
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
  if (!canCopyMessage(message)) return
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


watch(() => [currentConversation.value, messages.value.findLast((message) => message.role === 'user' && !message.fromHistory)?.id], async ([conversation, messageId], previous) => {
  if (!messageId || restoring.value || !props.active || conversation !== previous?.[0] || messageId === previous?.[1]) return
  await nextTick()
  if (currentConversation.value === conversation) messageScrollFollower?.pin(messageElements.get(messageId))
}, { flush: 'post' })

async function submitPrompt() {
  const content = prompt.value
  const files = [...selectedAttachments.value]
  const conversation = currentConversation.value
  if ((!content.trim() && !files.length) || composerBusy.value || restoring.value) return
  try {
    validateTurnInput(content, files)
  } catch (error) {
    showAttachmentNotice('无法发送', error.message)
    return
  }
  const isInitialMessage = conversation.messages.length === 0
  const isNewConversation = !conversation.registered
  const userMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content,
    attachments: files.map((file) => ({ name: file.name, size: file.size, type: file.type })),
  }
  if (conversation.submitting || conversation.replying || conversation.queue.length) {
    communication.enqueue(conversation, content, files, userMessage)
    clearComposerDraft()
    return
  }
  if (isInitialMessage) {
    initialMessageId.value = userMessage.id
    window.clearTimeout(initialMessageTimer)
    initialMessageTimer = window.setTimeout(() => {
      if (initialMessageId.value === userMessage.id) initialMessageId.value = null
    }, 1000)
  } else markMessageEntering(userMessage.id)
  clearComposerDraft()
  try {
    const turn = await communication.submit(conversation, content, files, userMessage)
    if (!turn) return
    if (isInitialMessage) {
      if (isNewConversation && !conversation.customName) conversation.name = createConversationTitle(content, files)
      if (!conversations.value.some((c) => !c.registered)) conversations.value.unshift(newConversation())
      activeConversation.value = conversations.value.findIndex((item) => item.id === conversation.id)
    }
    communication.persist()
    if (isNewConversation) {
      void communication.refreshConversations()
      void communication.loadHistory(conversation)
    }
  } catch (error) {
    if (currentConversation.value === conversation && !prompt.value && !selectedAttachments.value.length) {
      prompt.value = content
      selectedAttachments.value = files
    }
    if (error.name !== 'AbortError') showAttachmentNotice('消息未发送', error.message)
  }
}

function clearComposerDraft() {
  prompt.value = ''
  selectedAttachments.value = []
  if (attachmentInputRef.value) attachmentInputRef.value.value = ''
  nextTick(collapseComposer)
}

async function steerQueuedMessage(item) {
  try {
    await communication.sendQueued(currentConversation.value, item, { steer: true })
  } catch (error) {
    if (error.name !== 'AbortError') showAttachmentNotice('队列消息未发送', error.message)
  }
}

async function stopReply() {
  if (!canInterrupt.value || composerBusy.value) return
  const conversation = currentConversation.value
  const follow = messageScrollFollower?.isFollowing()
  messageScrollFollower?.pause()
  try {
    await communication.cancel(conversation)
    await nextTick()
    if (currentConversation.value === conversation && conversation.turns.at(-1)?.status === 'cancelled' && follow) restoreLastQuestionPosition()
  } catch (error) {
    if (currentConversation.value === conversation && follow) messageScrollFollower?.resume()
    if (error.name !== 'AbortError') showAttachmentNotice('停止失败', error.message || '请重试')
  }
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

async function handleAttachmentChange(event) {
  const files = Array.from(event.target.files ?? [])
  // 清空原生选择值，移除后仍可再次选择同一文件。
  event.target.value = ''
  await addAttachments(files)
}

function handleComposerPaste(event) {
  const files = clipboardFiles(event.clipboardData)
  if (!files.length) return
  // 混合粘贴保留浏览器原生的文字插入、选区替换与撤销行为，不解析 HTML 或本地路径。
  if (!event.clipboardData.getData('text/plain')) event.preventDefault()
  void addAttachments(files)
}

async function addAttachments(files) {
  if (!files.length) return
  if (composerBusy.value || restoring.value) {
    showAttachmentNotice('暂时无法添加附件', '请等待当前操作完成后重新粘贴或选择文件')
    return
  }
  convertingAttachments.value = true
  try {
    // 逐份处理，避免多张大图同时解码造成内存峰值。
    for (const file of files) {
      if (attachmentSelectionDisposed) return
      const sourceKey = JSON.stringify([file.name, file.size, file.lastModified])
      if (selectedAttachments.value.some((selected) => attachmentSourceKeys.get(selected) === sourceKey)) continue
      const kind = getSelectedFileKind(file)
      if (!kind) {
        showAttachmentNotice(file.name, '无法转为 PDF：暂不支持此文件格式')
        continue
      }
      try {
        const pdfFile = kind === 'pdf' ? file : await convertImageFileToPdf(file)
        if (attachmentSelectionDisposed) return
        try {
          validateTurnInput('', [...selectedAttachments.value, pdfFile])
        } catch (error) {
          showAttachmentNotice(file.name, error.message)
          continue
        }
        attachmentSourceKeys.set(pdfFile, sourceKey)
        selectedAttachments.value.push(pdfFile)
      } catch {
        if (!attachmentSelectionDisposed) showAttachmentNotice(file.name, '转换 PDF 失败，请检查文件后重试')
      }
    }
  } finally {
    convertingAttachments.value = false
  }
}

function dismissAttachmentNotice(id) {
  window.clearTimeout(attachmentNoticeTimers.get(id))
  attachmentNoticeTimers.delete(id)
  attachmentNotices.value = attachmentNotices.value.filter((notice) => notice.id !== id)
}

function showAttachmentNotice(name, message) {
  const id = ++attachmentNoticeId
  attachmentNotices.value.push({ id, name, message })
  attachmentNoticeTimers.set(id, window.setTimeout(() => dismissAttachmentNotice(id), 6000))
}

function removeAttachment(index) {
  if (selectedAttachments.value[index] === attachmentPreviewFile.value) closeAttachmentPreview()
  selectedAttachments.value.splice(index, 1)
}

function closeAttachmentPreview() {
  attachmentPreviewRequest?.abort()
  attachmentPreviewRequest = null
  attachmentPreviewLoading.value = false
  attachmentPreviewFile.value = null
  if (attachmentPreviewUrl.value) URL.revokeObjectURL(attachmentPreviewUrl.value)
  attachmentPreviewUrl.value = ''
  attachmentPreviewError.value = ''
}

async function previewSentAttachment(file, message) {
  if (!canPreviewCommunicationFile(file, message.turnStatus)) return
  closeAttachmentPreview()
  const controller = new AbortController()
  attachmentPreviewRequest = controller
  attachmentPreviewFile.value = file
  attachmentPreviewLoading.value = true
  const conversationId = currentConversation.value.id
  try {
    const blob = await getCommunicationPdf(conversationId, file.fileId, { signal: controller.signal })
    if (controller.signal.aborted || attachmentPreviewRequest !== controller || currentConversation.value.id !== conversationId) return
    attachmentPreviewUrl.value = URL.createObjectURL(blob)
  } catch (error) {
    if (!controller.signal.aborted && attachmentPreviewRequest === controller) attachmentPreviewError.value = error.message || '无法读取会话附件'
  } finally {
    if (attachmentPreviewRequest === controller) attachmentPreviewLoading.value = false
  }
}

watch(() => currentConversation.value.id, closeAttachmentPreview)

function previewAttachment(file) {
  closeAttachmentPreview()
  attachmentPreviewFile.value = file
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    attachmentPreviewError.value = '暂不支持此格式的预览，目前仅支持 PDF。'
    return
  }
  try {
    // 固定预览媒体类型，避免浏览器将本地附件作为可执行 HTML 打开。
    attachmentPreviewUrl.value = URL.createObjectURL(file.slice(0, file.size, 'application/pdf'))
  } catch {
    attachmentPreviewError.value = '无法打开此附件，请移除后重新选择。'
  }
}

function prepareAttachmentLeave(element) {
  element.style.width = `${element.getBoundingClientRect().width}px`
}

async function selectConversation(index) {
  if (currentConversation.value.submitting || restoring.value) return
  const revision = ++revealRevision
  conversationVisible.value = false
  messageScrollFollower?.clearPin()
  activeConversation.value = index
  communication.persist()
  historyMenuOpen.value = false
  previewQuestion.value = null
  const conversation = currentConversation.value
  await communication.loadHistory(conversation)
  if (conversation.historyLoading) await new Promise((resolve) => {
    const stop = watch(() => conversation.historyLoading, (loading) => { if (!loading) { stop(); resolve() } })
  })
  await revealPositionedConversation(conversation, revision)
}

async function revealPositionedConversation(conversation, revision) {
  await nextTick()
  const current = () => revision === revealRevision && currentConversation.value === conversation
  if (!current()) return
  restoreLastQuestionPosition()
  setupHistoryPull()
  // 隐藏状态下完成最小高度、ResizeObserver 和滚动定位，再开始整体淡入。
  await new Promise((resolve) => requestAnimationFrame(resolve))
  if (!current()) return
  restoreLastQuestionPosition()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  if (current()) conversationVisible.value = true
}

function restoreLastQuestionPosition() {
  const message = messages.value.findLast((item) => item.role === 'user')
  if (message) messageScrollFollower?.pin(messageElements.get(message.id), { follow: false })
  else messageScrollFollower?.resume()
}

const canLoadEarlierHistory = computed(() => currentConversation.value.historyLoaded && currentConversation.value.history?.hasMore
  && !currentConversation.value.historyLoading && !currentConversation.value.historyNeedsOpen && !currentConversation.value.deleting)

function loadEarlierHistory() {
  if (!canLoadEarlierHistory.value) return
  messageScrollFollower?.pause()
  return communication.loadHistory(currentConversation.value, true)
}

async function retryHistory() {
  if (!currentConversation.value.historyRetryEarlier || currentConversation.value.historyNeedsOpen || !currentConversation.value.historyLoaded) {
    const conversation = currentConversation.value
    const revision = ++revealRevision
    conversationVisible.value = false
    await communication.loadHistory(conversation)
    return revealPositionedConversation(conversation, revision)
  }
  return loadEarlierHistory()
}

function setupHistoryPull() {
  disposeHistoryPull?.()
  if (!messageListRef.value || !props.active) return
  disposeHistoryPull = createHistoryPullRefresh(messageListRef.value, {
    canLoad: () => canLoadEarlierHistory.value,
    load: loadEarlierHistory,
    onDistance: (distance) => { historyPullDistance.value = distance },
  })
}

watch(() => [currentConversation.value.id, currentConversation.value.history], async ([conversationId, history], previous) => {
  if (!history || !props.active) return
  const list = messageListRef.value
  if (!list) return
  const preserve = previous?.[0] === conversationId && currentConversation.value.historyChangeKind === 'earlier'
  const listTop = list.getBoundingClientRect().top
  const anchor = preserve ? [...list.querySelectorAll('[data-message-id]')].find((element) => {
    const rect = element.getBoundingClientRect()
    return rect.height > 0 && rect.bottom > listTop && rect.top < listTop + list.clientHeight
  }) : null
  const offset = anchor?.getBoundingClientRect().top - listTop
  const oldTop = list.scrollTop
  if (preserve) messageScrollFollower?.pause()
  await nextTick()
  if (currentConversation.value.id !== conversationId || currentConversation.value.history !== history) return
  if (preserve) {
    if (anchor?.isConnected) list.scrollTop += anchor.getBoundingClientRect().top - list.getBoundingClientRect().top - offset
    else list.scrollTop = oldTop
  }
})

function bindMessageElement(element, messageIdValue) {
  if (element) {
    messageElements.set(messageIdValue, element)
  } else {
    messageElements.delete(messageIdValue)
  }
}

function scrollToMessage(messageIdValue) {
  messageScrollFollower?.pause()
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
  messageScrollFollower = createMessageScrollFollower(messageListRef.value, messageContentRef.value)
  setupHistoryPull()
  libraryResizeObserver = new ResizeObserver(updateResizeMetrics)
  libraryResizeObserver.observe(contractLibraryRef.value)
  window.addEventListener('resize', updateResizeMetrics)
}

function deactivateLibraryView() {
  closeConversationDelete()
  closeAttachmentPreview()
  if (!libraryViewActive) return
  libraryViewActive = false
  disposeHistoryPull?.()
  disposeHistoryPull = null
  messageScrollFollower?.dispose()
  messageScrollFollower = null
  libraryResizeObserver?.disconnect()
  libraryResizeObserver = null
  window.removeEventListener('resize', updateResizeMetrics)
}

onMounted(() => {
  const revision = ++revealRevision
  void communication.restore().then(async () => {
    await revealPositionedConversation(currentConversation.value, revision)
  })
  if (props.active) activateLibraryView()
})

onActivated(activateLibraryView)
onDeactivated(deactivateLibraryView)
watch(() => props.active, (active) => {
  if (active) activateLibraryView()
  else deactivateLibraryView()
})

onBeforeUnmount(() => {
  revealRevision += 1
  window.clearInterval(processingTimer)
  communication.dispose()
  attachmentSelectionDisposed = true
  attachmentNoticeTimers.forEach((timer) => window.clearTimeout(timer))
  attachmentNoticeTimers.clear()
  deactivateLibraryView()
  window.clearTimeout(initialMessageTimer)
  window.clearTimeout(copyFeedbackTimer)
  window.cancelAnimationFrame(composerResizeFrame)
  messageEntryTimers.forEach((timer) => window.clearTimeout(timer))
  messageEntryTimers.clear()
})
</script>

<template>
  <section
    ref="contractLibraryRef"
    class="contract-library"
    :class="{ 'is-resizing': resizingChatPanel, 'is-stacked': stackedPanels }"
    :style="{ '--contract-archive-min-width': `${CABINET_PANEL_MIN_WIDTH}px`, ...(chatPanelWidth === null ? {} : { '--contract-agent-width': `${chatPanelWidth}px` }) }"
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
          <div v-if="listLoading || listError" class="communication-history-notice" role="status">
            <span>{{ listLoading ? '正在加载会话…' : listError }}</span>
            <button v-if="listError && !listLoading" type="button" @click.stop="communication.refreshConversations()">重试</button>
          </div>
          <div
            v-for="(conversation, index) in conversations"
            :key="conversation.id"
            class="contract-agent__history-item"
            :class="{ 'is-active': activeConversation === index, 'is-editing': editingConversationId === conversation.id, 'has-actions': conversation.registered }"
          >
            <template v-if="editingConversationId === conversation.id">
              <input
                :ref="bindConversationNameInput"
                v-model="conversationNameDraft"
                type="text"
                maxlength="200"
                :disabled="conversation.renaming"
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
                :disabled="conversation.renaming"
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
                v-if="conversation.registered"
                class="contract-agent__history-rename"
                type="button"
                :disabled="conversation.deleting || conversation.submitting || conversation.renaming"
                :aria-label="`重命名对话：${conversation.name}`"
                @click.stop="startConversationRename(conversation)"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="m12.7 4.1 3.2 3.2M4 16l2.8-.6 8.4-8.4a1.8 1.8 0 0 0 0-2.5 1.8 1.8 0 0 0-2.5 0l-8.4 8.4L4 16Z" />
                </svg>
              </button>
              <button
                v-if="conversation.registered"
                class="contract-agent__history-delete"
                type="button"
                :disabled="conversation.deleting || conversation.renaming || conversation.submitting || conversation.cancelling"
                :aria-label="`删除对话：${conversation.name}`"
                :title="conversation.deleting ? '正在删除…' : '删除会话'"
                @click.stop="deleteConversation(conversation)"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 5.5h13M7.5 5.5v-2h5v2M5 5.5l.7 11h8.6l.7-11M8 8.5v5M12 8.5v5" /></svg>
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
          <TransitionGroup v-if="active" tag="div" name="attachment-notice" class="attachment-notices" aria-live="polite" aria-relevant="additions">
            <div v-for="notice in attachmentNotices" :key="notice.id" class="attachment-notice">
              <div><strong :title="notice.name">{{ notice.name }}</strong><span>{{ notice.message }}</span></div>
              <button type="button" aria-label="关闭提示" @click="dismissAttachmentNotice(notice.id)">×</button>
            </div>
          </TransitionGroup>
          <Transition name="contract-agent-empty">
            <div v-if="conversationVisible && !messages.length && !currentConversation.submitting && !currentConversation.registered" class="contract-agent__empty">
              <HandwritingPrompt />
            </div>
          </Transition>

          <div
            ref="messageListRef"
            class="contract-agent__messages"
            :class="{ 'is-positioning': !conversationVisible }"
            :inert="!conversationVisible"
            :aria-hidden="!conversationVisible || undefined"
            tabindex="0"
            aria-label="对话消息"
            aria-live="polite"
          >
            <div ref="messageContentRef" class="contract-agent__messages-content">
            <div v-if="currentConversation.registered" class="communication-history-control" role="status">
              <span v-if="currentConversation.historyLoading">正在加载历史…</span>
              <template v-else-if="currentConversation.historyError">
                <span>{{ currentConversation.historyError }}</span><button type="button" @click="retryHistory">{{ currentConversation.historyNeedsOpen ? '重新打开' : '重试' }}</button>
              </template>
              <button v-else-if="canLoadEarlierHistory" type="button" @click="loadEarlierHistory">
                <span aria-hidden="true" :style="{ transform: `rotate(${historyPullDistance >= 64 ? 180 : 0}deg)` }">↓</span>
                {{ historyPullDistance >= 64 ? '松开加载更早记录' : '下拉或点击加载更早记录' }}
              </button>
              <span v-else-if="currentConversation.historyLoaded && !messages.length">暂无已归档的历史记录</span>
            </div>
            <div
              v-for="section in messageSections"
              :key="section.id"
              :class="section.process ? ['communication-process-region', { 'is-collapsed': processIsCollapsed(section) }] : 'communication-message-section'"
              :inert="processIsCollapsed(section)"
              :aria-hidden="processIsCollapsed(section) || undefined"
            >
            <div :class="section.process ? 'communication-process-region__content' : 'communication-message-section'">
            <template v-for="message in section.messages" :key="message.id">
            <article
              :ref="(element) => bindMessageElement(element, message.id)"
              class="contract-agent__message"
              :data-message-id="message.id"
              :class="[
                `contract-agent__message--${message.role}`,
                {
                  'is-new-conversation-entry': message.id === initialMessageId,
                  'is-message-entry': enteringMessageIds.has(message.id),
                },
              ]"
            >
              <div v-if="message.settledProgress" class="communication-step" :class="{ 'communication-step--settled': !message.progressActive }">
                <img class="communication-progress-icon" :src="progressImages[message.settledProgress.type]" width="18" height="18" alt="" aria-hidden="true" />
                <span>{{ taskProgressPresentation(message.settledProgress).text }}</span>
              </div>
              <div v-else-if="message.historyError" class="communication-status" role="alert"><p class="is-error">{{ message.content }}</p></div>
              <div v-else-if="message.role === 'assistant'" class="contract-agent__response">
                <div v-if="message.operationLabel || message.processPath?.length" class="contract-agent__response-header">
                  <span v-if="message.operationLabel">{{ message.operationLabel }}</span>
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
                  :stream-state="message.status"
                  stabilize-height
                  :animate="active && !message.fromHistory"
                  @display-state="updateMessageDisplay(message.id, $event)"
                />

                <footer v-if="canCopyMessage(message)" class="contract-agent__message-actions" aria-label="回复操作" @mouseenter="startTimeReference = Date.now()" @focusin="startTimeReference = Date.now()">
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
                  <time v-if="turnStartTimes.get(message.turnId)" :datetime="turnStartTimes.get(message.turnId).datetime" :title="`开始处理时间：${turnStartTimes.get(message.turnId).fullLabel}`" :aria-label="`开始处理时间：${turnStartTimes.get(message.turnId).fullLabel}`">{{ turnStartTimes.get(message.turnId).label }}</time>
                </footer>
              </div>

              <template v-else>
                <ul v-if="message.attachments?.length" class="contract-agent__sent-files" aria-label="已上传的文件">
                  <li v-for="(file, index) in message.attachments" :key="index" :title="file.name">
                    <component :is="canPreviewCommunicationFile(file, message.turnStatus) ? 'button' : 'span'"
                      class="contract-agent__sent-file-content"
                      :type="canPreviewCommunicationFile(file, message.turnStatus) ? 'button' : undefined"
                      :aria-label="canPreviewCommunicationFile(file, message.turnStatus) ? `预览附件：${file.name}` : undefined"
                      @click="previewSentAttachment(file, message)">
                    <span class="contract-agent__sent-file-icon"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11.5 2.5h-6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-10zm0 0v4h4M7.5 10h5M7.5 13h5" /></svg></span>
                    <div class="contract-agent__sent-file-info"><span>{{ file.name }}</span><small>PDF 文档</small></div>
                    </component>
                  </li>
                </ul>
                <MarkdownMessage
                  v-if="message.content?.trim()"
                  class="contract-agent__message-content"
                  :content="message.content"
                />
              </template>
              <span v-if="message.role === 'user' && ['failed', 'expired'].includes(message.turnStatus)" class="communication-message-status">{{ turnLabels[message.turnStatus] }}</span>
              <ul v-if="message.references?.length" class="communication-references" aria-label="引用合同">
                <li v-for="(reference, index) in message.references" :key="index" :title="reference.document_id">
                  <a v-if="reference.type === 'web'" :href="reference.location" target="_blank" rel="noopener noreferrer">{{ reference.location }}</a>
                  <span v-else-if="reference.type === 'contract'" :title="reference.location">合同引用 · {{ reference.location }}</span>
                  <template v-else>合同 {{ reference.document_id?.slice(0, 12) }}…<template v-if="reference.page_number"> · 第 {{ reference.page_number }} 页</template></template>
                </li>
              </ul>
            </article>
            <Transition name="turn-timing">
              <div v-if="message.role === 'user' && (messageTimingLabel(message) || processToggleTurns.has(message.turnId))" class="communication-turn-timing" aria-live="off">
                <div class="communication-turn-timing__content">
                  <div class="communication-turn-timing__row">
                    <span v-if="messageTimingLabel(message)">{{ messageTimingLabel(message) }}</span>
                    <button
                      v-if="processToggleTurns.has(message.turnId)"
                      type="button"
                      class="communication-process-toggle"
                      :aria-expanded="expandedTurnProcesses.has(message.turnId)"
                      :aria-label="expandedTurnProcesses.has(message.turnId) ? '收起处理过程' : '展开处理过程'"
                      :title="expandedTurnProcesses.has(message.turnId) ? '收起处理过程' : '展开处理过程'"
                      @click="toggleTurnProcess(message.turnId)"
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true" :class="{ 'is-expanded': expandedTurnProcesses.has(message.turnId) }"><path d="m6 4 4 4-4 4" /></svg>
                    </button>
                  </div>
                  <hr aria-hidden="true" />
                </div>
              </div>
            </Transition>
            </template>
            </div>
            </div>

            <div v-if="restoring" class="communication-status" role="status">正在恢复对话…</div>
            <div v-if="currentTurn" class="communication-status" aria-live="polite">
              <p v-if="replying && !currentConversation.submitting && ['recovering', 'disconnected'].includes(currentTurn.connection)">{{ currentTurn.connection === 'recovering' ? '连接中断，正在恢复…' : '连接已断开，轮次状态待确认' }}</p>
              <p v-if="currentTurn.error" class="is-error" role="alert">{{ currentTurn.error.message }}</p>
              <template v-if="currentTurn.connection === 'disconnected'">
                <p class="is-error">{{ currentTurn.connectionError }}</p>
                <button v-if="!currentTurn.unavailable" type="button" @click="communication.connect(currentConversation, currentTurn, true)">恢复连接</button>
              </template>
            </div>

            <Transition name="tail-activity" mode="out-in">
              <article
                v-if="tailActivity"
                :key="tailActivity.type"
                class="contract-agent__message contract-agent__message--assistant communication-thinking"
                :class="{ 'is-thinking': tailActivity.thinking }"
              >
                <div :class="tailActivity.thinking ? 'contract-agent__thinking' : 'communication-step'" role="status">
                  <img v-if="progressImages[tailActivity.type]" class="communication-progress-icon" :src="progressImages[tailActivity.type]" width="18" height="18" alt="" aria-hidden="true" />
                  <span>{{ tailActivity.text }}</span>
                </div>
              </article>
            </Transition>

            </div>
          </div>

          <form class="contract-agent__composer" @submit.prevent="submitPrompt">
            <div class="contract-agent__composer-accessories">
            <TransitionGroup tag="ul" name="queued-prompt" class="contract-agent__prompt-queue" aria-label="待发送消息">
              <li v-for="item in currentConversation.queue" :key="item.id" class="contract-agent__queued-prompt">
                <div class="contract-agent__queued-content">
                  <span :title="item.text || item.files.map((file) => file.name).join('、')">{{ item.text.trim() || item.files[0]?.name }}</span>
                  <small v-if="item.files.length">{{ item.files.length }} 个附件</small>
                  <small v-if="item.error" class="is-error" :title="item.error">发送失败，等待重试</small>
                </div>
                <button
                  type="button"
                  class="contract-agent__queue-steer"
                  :disabled="currentConversation.submitting || currentConversation.cancelling || (replying && !canInterrupt)"
                  :title="taskPending ? canInterrupt ? '立即提交这条问题，替代当前轮次' : '当前任务暂不允许调整方向' : '立即发送这条排队消息'"
                  @click="steerQueuedMessage(item)"
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 16v-4a5 5 0 0 1 5-5h5M11 3l4 4-4 4" /></svg>
                  {{ item.sending ? '发送中' : taskPending ? '调整方向' : '立即发送' }}
                </button>
                <button type="button" class="contract-agent__queue-remove" :disabled="item.sending" aria-label="移除这条待发送消息" @click="communication.removeQueued(currentConversation, item.id)">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6M11 5l-6 6" /></svg>
                </button>
              </li>
            </TransitionGroup>
            <TransitionGroup
              tag="ul"
              name="attachment-chip"
              class="contract-agent__attachments"
              aria-label="已选附件"
              @before-leave="prepareAttachmentLeave"
            >
              <li v-for="(file, index) in selectedAttachments" :key="attachmentSourceKeys.get(file)" class="contract-agent__attachment">
                <button
                  type="button"
                  class="contract-agent__attachment-name"
                  :title="file.name"
                  :aria-label="`预览附件：${file.name}`"
                  @click="previewAttachment(file)"
                >{{ file.name }}</button>
                <button
                  type="button"
                  class="contract-agent__attachment-remove"
                  :aria-label="`移除附件：${file.name}`"
                  :title="`移除 ${file.name}`"
                  @click="removeAttachment(index)"
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6M11 5l-6 6" /></svg>
                </button>
              </li>
            </TransitionGroup>
            </div>
            <textarea
              ref="composerInputRef"
              v-model="prompt"
              rows="1"
              placeholder="询问合同相关问题…"
              aria-label="输入合同相关问题"
              :disabled="restoring || currentConversation.deleting || currentConversation.renaming"
              @input="resizeComposer"
              @keydown="handleComposerKeydown"
              @paste="handleComposerPaste"
            ></textarea>

            <div class="contract-agent__composer-actions">
              <button
                class="contract-agent__composer-action contract-agent__composer-action--attach"
                type="button"
                :disabled="composerBusy || restoring"
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

              <span v-if="convertingAttachments || currentConversation.cancelling" class="contract-agent__conversion-status" role="status">{{ convertingAttachments ? '正在转换为 PDF…' : '正在停止…' }}</span>

              <button
                class="contract-agent__composer-action contract-agent__composer-action--send"
                :class="{ 'is-stop': stopMode }"
                :type="stopMode ? 'button' : 'submit'"
                :disabled="composerBusy || restoring || (stopMode && !canInterrupt) || (!replying && !prompt.trim() && !selectedAttachments.length)"
                :aria-label="stopMode ? '停止回复' : taskPending || currentConversation.queue.length ? '加入消息队列' : '发送消息'"
                :title="stopMode ? canInterrupt ? '停止回复' : '当前任务暂不允许停止' : taskPending || currentConversation.queue.length ? '加入队列，等待当前轮次完成' : '发送消息'"
                @click="stopMode && stopReply()"
              >
                <Transition name="send-state" mode="out-in">
                  <svg v-if="!stopMode" key="send" viewBox="0 0 24 24" aria-hidden="true">
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

    <ContractArchivePanel :active="active" />
    <DeleteConversationDialog
      :open="Boolean(conversationToDelete)"
      :name="conversationToDelete?.name || ''"
      :busy="Boolean(conversationToDelete?.deleting)"
      :error="conversationDeleteError"
      @close="closeConversationDelete"
      @confirm="confirmConversationDelete"
    />
    <PdfPreviewOverlay
      :open="Boolean(attachmentPreviewFile)"
      :src="attachmentPreviewUrl"
      :label="attachmentPreviewFile?.name || ''"
      :error="attachmentPreviewError"
      :loading="attachmentPreviewLoading"
      :retryable="false"
      @close="closeAttachmentPreview"
    />
  </section>
</template>

<style scoped>
.communication-history-control { display: flex; flex: none; justify-content: center; align-items: center; gap: 8px; color: #90998f; font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.communication-history-control:empty { display: none; }
.communication-history-control button { display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px; border: 0; border-radius: 8px; background: transparent; color: #788c7d; font: inherit; cursor: pointer; }
.communication-history-control button:hover { background: #edf2eb; }
.communication-history-control button > span { display: inline-block; transition: transform .2s ease; }
.contract-agent__history-delete { display: grid; place-items: center; flex: none; width: 26px; height: 28px; padding: 4px; border: 0; border-radius: 6px; background: transparent; color: #92978f; cursor: pointer; opacity: 0; transition: opacity .18s ease, color .18s ease, background-color .18s ease; }
.contract-agent__history-item:hover .contract-agent__history-delete, .contract-agent__history-item:focus-within .contract-agent__history-delete { opacity: 1; }
.contract-agent__history-delete:hover { color: #b05c58; background: #f8eae8; }
.contract-agent__history-delete svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.contract-agent__history-item button:disabled { cursor: wait; }
.communication-history-notice { display: flex; align-items: center; gap: 8px; padding: 10px 12px; color: #78847b; font-size: 12px; }
.communication-history-notice span { flex: 1; overflow-wrap: anywhere; }
.communication-history-notice button { flex: none; border: 0; background: transparent; color: #466851; cursor: pointer; }
.communication-process-toggle {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 5px;
  padding: 3px 0;
  color: #829087;
  font-size: 12px;
  background: transparent;
  border: 0;
  cursor: pointer;
}
.communication-process-toggle:hover { color: #405b4a; }
.communication-process-toggle svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; transition: transform 0.2s ease; }
.communication-process-toggle svg.is-expanded { transform: rotate(90deg); }
.communication-message-section { display: contents; }
.communication-process-region {
  display: grid;
  grid-template-rows: 1fr;
  flex: 0 0 auto;
  min-width: 0;
  transition:
    grid-template-rows 0.42s cubic-bezier(0.22, 1, 0.36, 1),
    margin-bottom 0.42s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.28s ease;
}
.communication-process-region__content {
  display: flex;
  flex-direction: column;
  gap: 17px;
  min-height: 0;
  overflow: hidden;
}
.communication-process-region.is-collapsed {
  grid-template-rows: 0fr;
  margin-bottom: -17px;
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .communication-process-region,
  .communication-process-toggle svg { transition: none; }
}
.communication-step,
.contract-agent__response-header > span {
  color: #344c3e;
  font-size: 14px;
  font-weight: 600;
  line-height: 24px;
  overflow-wrap: anywhere;
}
.tail-activity-enter-active,
.tail-activity-leave-active { transition: opacity 0.16s ease; }
.tail-activity-enter-from,
.tail-activity-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .tail-activity-enter-active,
  .tail-activity-leave-active { transition: none; }
}
.communication-turn-timing {
  display: grid;
  grid-template-rows: 1fr;
  flex: 0 0 auto;
  width: 100%;
  color: #879189;
  font-size: 12px;
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
}
.communication-turn-timing__content { min-height: 0; overflow: hidden; }
.communication-turn-timing__row { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; }
.communication-turn-timing__row .communication-process-toggle { align-self: auto; padding-block: 0; }
.turn-timing-enter-active,
.turn-timing-leave-active {
  transition:
    grid-template-rows 0.4s cubic-bezier(0.22, 1, 0.36, 1),
    margin-bottom 0.4s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.3s ease;
}
.turn-timing-enter-from,
.turn-timing-leave-to {
  grid-template-rows: 0fr;
  margin-bottom: -17px;
  opacity: 0;
}
.communication-status:empty { display: none; }
.communication-thinking.is-thinking {
  margin-top: -9px;
}
.communication-step { margin-inline: 2px; display: flex; align-items: center; gap: 8px; }
.communication-progress-icon { display: block; flex: 0 0 18px; object-fit: contain; }
.communication-step--settled { color: #9ca59f; font-weight: 400; }
.communication-step--settled .communication-progress-icon { opacity: .55; filter: grayscale(1); }
.communication-step.communication-step--settled > span { animation: none; }
@media (prefers-reduced-motion: reduce) {
  .turn-timing-enter-active,
  .turn-timing-leave-active { transition: none; }
}
.communication-turn-timing hr {
  margin: 9px 0 0;
  border: 0;
  border-top: 1px solid #dce3de;
}
.communication-status {
  color: #7b8880;
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.communication-status p { margin: 4px 0; }
.communication-references { padding-left: 18px; margin: 6px 0; }
.communication-status .is-error { color: #ad625a; }
.communication-status button {
  padding: 5px 10px;
  color: #476955;
  background: #edf2ee;
  border: 1px solid #d7e1da;
  border-radius: 8px;
  cursor: pointer;
}
.communication-message-status { display: block; margin: 5px 2px 0; color: #879189; font-size: 11px; text-align: right; }
.communication-references { color: #829087; font-size: 11px; overflow-wrap: anywhere; }

.attachment-notices {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 4;
  display: grid;
  gap: 8px;
  width: min(420px, calc(100% - 32px));
  max-height: min(40%, 320px);
  overflow-y: auto;
  pointer-events: none;
}

.attachment-notice {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  color: #98544e;
  background: #fff5f1;
  border: 1px solid #efdcd5;
  border-radius: 12px;
  pointer-events: auto;
}

.attachment-notice > div { flex: 1; min-width: 0; }
.attachment-notice strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.attachment-notice span { display: block; margin-top: 3px; font-size: 12px; }
.attachment-notice button { padding: 4px; border: 0; background: transparent; color: inherit; font-size: 20px; cursor: pointer; }
.attachment-notice-enter-active, .attachment-notice-leave-active { transition: opacity 0.22s, transform 0.22s; }
.attachment-notice-enter-from, .attachment-notice-leave-to { opacity: 0; transform: translateY(-8px); }
.contract-agent__conversion-status { color: #829287; font-size: 12px; }
@media (prefers-reduced-motion: reduce) {
  .attachment-notice-enter-active, .attachment-notice-leave-active { transition: none; }
}

.contract-library {
  position: relative;
  display: grid;
  grid-template-columns: minmax(360px, var(--contract-agent-width, 0.82fr)) minmax(var(--contract-archive-min-width), 1.18fr);
  gap: 0;
  height: 100%;
  min-height: 0;
}

.contract-library.is-resizing {
  cursor: col-resize;
  user-select: none;
}

.contract-agent {
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
  overflow: hidden;
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
  position: relative;
  flex: none;
  flex-shrink: 0;
  z-index: 5;
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
  position: relative;
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
  padding: 9px 26px 9px 10px;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 9px;
}

.contract-agent__history-item.has-actions .contract-agent__history-option { padding-right: 68px; }
.contract-agent__history-item > .contract-agent__history-rename,
.contract-agent__history-item > .contract-agent__history-delete {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
}
.contract-agent__history-item > .contract-agent__history-rename { right: 32px; margin-right: 0; }
.contract-agent__history-item > .contract-agent__history-delete { right: 5px; }
.contract-agent__history-item:is(:hover, :focus-within) > .contract-agent__history-rename,
.contract-agent__history-item:is(:hover, :focus-within) > .contract-agent__history-delete { pointer-events: auto; }

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
  position: absolute;
  right: 15px;
  top: calc(50% - 2.5px);
  flex: none;
  width: 5px;
  height: 5px;
  background: currentColor;
  border-radius: 50%;
  opacity: 0;
  transition: opacity .18s ease;
}

.contract-agent__history-item.is-active .contract-agent__history-option i {
  opacity: 1;
}
.contract-agent__history-item.has-actions:is(:hover, :focus-within) .contract-agent__history-option i { opacity: 0; }

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
.contract-agent__history-item:focus-within .contract-agent__history-rename {
  opacity: 1;
}

@media (hover: none) {
  .contract-agent__history-item > .contract-agent__history-rename,
  .contract-agent__history-item > .contract-agent__history-delete { opacity: 1; pointer-events: auto; }
  .contract-agent__history-item.has-actions .contract-agent__history-option i { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .contract-agent__history-option i,
  .contract-agent__history-item > .contract-agent__history-rename,
  .contract-agent__history-item > .contract-agent__history-delete { transition: none; }
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
  opacity: 1;
  transition: opacity .35s ease;
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-anchor: none;
  overscroll-behavior: contain;
  scrollbar-width: none;
}
.contract-agent__messages.is-positioning { opacity: 0; transition: none; pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .contract-agent__messages { transition: none; } }

.contract-agent__messages::-webkit-scrollbar {
  display: none;
}

.contract-agent__messages-content {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 17px;
  min-height: var(--message-pinned-height, 100%);
  box-sizing: border-box;
  padding: 24px 20px 16px;
}

.contract-agent__messages-content::before {
  content: '';
  flex: none;
  margin-top: auto;
}
.contract-agent__messages-content.is-question-pinned::before { margin-top: 0; }

.contract-agent__message {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  width: 100%;
  max-width: 100%;
}

.contract-agent__message.is-new-conversation-entry {
  animation: contract-agent-message-appear 0.5s ease both;
}

.contract-agent__message.is-message-entry {
  animation: contract-agent-message-enter 0.46s cubic-bezier(0.16, 1, 0.3, 1) both;
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
}

.contract-agent__message-content {
  width: 100%;
  min-width: 0;
  color: #435049;
}

.contract-agent__message--user {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  align-self: flex-end;
  width: auto;
  max-width: 86%;
}

.contract-agent__message--user .contract-agent__message-content {
  width: auto;
  padding: 10px 15px;
  color: #fff;
  background: #171717;
  border-radius: 16px;
}

.contract-agent__sent-files {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 100%;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.contract-agent__sent-files li {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 228px;
  max-width: 100%;
  padding: 10px 12px;
  border: 1px solid #e0e2e0;
  border-radius: 14px;
  background: #fafbfa;
  color: #333936;
  font-size: 13px;
  line-height: 18px;
}
.contract-agent__sent-files svg {
  flex: none;
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.contract-agent__sent-file-content { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; border: 0; padding: 0; background: transparent; color: inherit; font: inherit; text-align: left; }
button.contract-agent__sent-file-content { cursor: pointer; border-radius: 5px; }
button.contract-agent__sent-file-content:hover { color: #397053; }
button.contract-agent__sent-file-content:focus-visible { outline: 2px solid #719780; outline-offset: 4px; }
.contract-agent__sent-file-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 38px;
  border-radius: 8px;
  background: #eeefee;
  color: #636963;
}
.contract-agent__sent-file-info { min-width: 0; }
.contract-agent__sent-file-info > span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.contract-agent__sent-file-info small { display: block; margin-top: 3px; color: #868b87; font-size: 11px; }

.contract-agent__message--user :deep(h1),
.contract-agent__message--user :deep(h2),
.contract-agent__message--user :deep(h3),
.contract-agent__message--user :deep(h4),
.contract-agent__message--user :deep(code),
.contract-agent__message--user :deep(th) {
  color: #fff;
}

.contract-agent__message--user :deep(a) {
  color: #b9d5ff;
}

.contract-agent__message--user :deep(blockquote) {
  color: #d4d4d4;
  border-left-color: #666;
}

.contract-agent__message--user :deep(code),
.contract-agent__message--user :deep(pre),
.contract-agent__message--user :deep(th) {
  background: #303030;
}

.contract-agent__message--user :deep(pre code) {
  background: transparent;
}

.contract-agent__message--user :deep(th),
.contract-agent__message--user :deep(td),
.contract-agent__message--user :deep(hr) {
  border-color: #505050;
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
  min-height: 24px;
  margin: 0 2px 10px;
  color: #8a948f;
  font-size: 11px;
}

.contract-agent__response-header > span {
  min-width: 0;
  white-space: normal;
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

.contract-agent__thinking {
  min-height: 24px;
  padding-inline: 2px;
  color: #95a098;
  font-size: 13px;
  line-height: 24px;
}

.contract-agent__thinking,
.communication-step > span {
  animation: contract-agent-thinking-highlight 2.8s ease-in-out infinite;
}

.contract-agent__composer {
  position: relative;
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

.contract-agent__composer-accessories {
  position: absolute;
  right: 0;
  bottom: calc(100% + 4px);
  left: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.contract-agent__prompt-queue {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 158px;
  padding: 0 2px;
  margin: 0;
  overflow-y: auto;
  list-style: none;
  scrollbar-width: thin;
}
.contract-agent__prompt-queue:empty { display: none; }
.contract-agent__queued-prompt {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
  padding: 9px 10px 9px 13px;
  background: #f3f5f3;
  border: 1px solid #dfe5df;
  border-radius: 13px;
  box-shadow: 0 3px 10px #253d2d08;
}
.contract-agent__queued-content { flex: 1; min-width: 0; color: #59665d; font-size: 12px; }
.contract-agent__queued-content > span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.contract-agent__queued-content small { display: inline-block; margin: 3px 8px 0 0; color: #8a968e; font-size: 10px; }
.contract-agent__queued-content small.is-error { color: #ad625a; }
.contract-agent__queue-steer,
.contract-agent__queue-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  gap: 4px;
  padding: 5px 7px;
  color: #5a6d60;
  font-size: 11px;
  background: transparent;
  border: 0;
  border-radius: 7px;
  cursor: pointer;
}
.contract-agent__queue-steer { background: #e6ece7; }
.contract-agent__queue-steer:hover:not(:disabled) { color: #2e4e3a; background: #dce6dd; }
.contract-agent__queue-remove { padding: 5px 3px; color: #929b95; }
.contract-agent__queue-remove:hover:not(:disabled) { color: #b25b53; background: #f4e4e1; }
.contract-agent__queue-steer:disabled,
.contract-agent__queue-remove:disabled { cursor: default; opacity: 0.45; }
.contract-agent__queue-steer svg,
.contract-agent__queue-remove svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.queued-prompt-enter-active,
.queued-prompt-leave-active,
.queued-prompt-move { transition: opacity 0.2s ease, transform 0.25s ease; }
.queued-prompt-enter-from,
.queued-prompt-leave-to { opacity: 0; transform: translateY(5px); }
@media (prefers-reduced-motion: reduce) {
  .queued-prompt-enter-active,
  .queued-prompt-leave-active,
  .queued-prompt-move { transition: none; }
}
.contract-agent__attachments {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  min-width: 0;
  padding: 2px 14px 4px;
  margin: 0;
  overflow-x: auto;
  overflow-y: hidden;
  list-style: none;
  scrollbar-width: none;
  -webkit-mask-image: linear-gradient(to right, transparent, #000 14px, #000 calc(100% - 14px), transparent);
  mask-image: linear-gradient(to right, transparent, #000 14px, #000 calc(100% - 14px), transparent);
}

.contract-agent__attachments::-webkit-scrollbar {
  display: none;
}

.contract-agent__attachments:empty {
  display: none;
}

.attachment-chip-enter-active {
  transition:
    transform 0.4s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.3s ease;
}

.attachment-chip-enter-from {
  opacity: 0;
  transform: translateX(28px);
}

.attachment-chip-leave-active {
  box-sizing: border-box;
  overflow: hidden;
  pointer-events: none;
  transition:
    width 0.3s cubic-bezier(0.22, 1, 0.36, 1),
    padding 0.3s cubic-bezier(0.22, 1, 0.36, 1),
    margin 0.3s cubic-bezier(0.22, 1, 0.36, 1),
    border-width 0.3s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.18s ease;
}

.contract-agent__attachment.attachment-chip-leave-to {
  width: 0 !important;
  padding-inline: 0;
  margin-right: -6px;
  border-inline-width: 0;
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .attachment-chip-enter-active,
  .attachment-chip-leave-active {
    transition: none;
  }
}

.contract-agent__attachment {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: min(180px, 100%);
  padding: 4px 5px 4px 10px;
  color: #53685b;
  background: #edf2ee;
  border: 1px solid #dce6de;
  border-radius: 9px;
}

.contract-agent__attachment-name {
  min-width: 0;
  padding: 0;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  overflow: hidden;
  font-size: 12px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contract-agent__attachment-name:hover {
  color: #2e6447;
}

.contract-agent__attachment-name:focus-visible {
  outline: 2px solid #789886;
  outline-offset: 1px;
  border-radius: 3px;
}

.contract-agent__attachment-remove {
  display: grid;
  flex: 0 0 22px;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: #829287;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  transition: color 0.18s, background-color 0.18s;
}

.contract-agent__attachment-remove:hover {
  color: #b75353;
  background: #f6e5e3;
}

.contract-agent__attachment-remove:focus-visible {
  outline: 2px solid #789886;
  outline-offset: 1px;
}

.contract-agent__attachment-remove svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.5;
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

@keyframes contract-agent-thinking-highlight {
  0%, 25%, 100% { color: #95a098; }
  48%, 58% { color: #405b4a; }
}

@keyframes contract-agent-copy-confirm {
  45% {
    transform: scale(0.86);
  }

  100% {
    transform: scale(1);
  }
}

@keyframes contract-agent-message-appear {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
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

  .contract-library.is-stacked {
    /* 滚动视口不能由消息最小高度反向撑大，否则置顶预留会循环增长。 */
    grid-template-rows: max(600px, calc(100dvh - 180px)) 680px;
    grid-template-columns: 1fr;
    height: auto;
  }

  .contract-library.is-stacked .contract-agent {
    border: 0;
  }

  .contract-library.is-stacked .contract-agent::after {
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

  .contract-library.is-stacked .contract-agent__resize-handle {
    display: none;
  }
@media (max-width: 640px) {
  .contract-library {
    grid-template-rows: minmax(560px, calc(100dvh - 126px)) 720px;
  }

  .contract-agent {
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

  .contract-agent__messages-content {
    padding: 24px 15px 16px;
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
  .contract-agent__message.is-message-entry {
    opacity: 1;
    transform: none;
    animation: none;
  }

  .contract-agent__thinking,
  .communication-step > span {
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
