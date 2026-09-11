import { ref } from 'vue'
import { modelCommunicationHistory, mergeCommunicationHistory } from '../models/communicationHistory.js'
import { getCommunicationHistory } from './communicationApi.js'
import { renameCommunicationConversation, deleteCommunicationConversation, validateConversationName } from './communicationApi.js'
import { getAuthSession } from './contractApi.js'
import { listCommunicationConversations, createCommunicationConversation, createCommunicationTurn, getCommunicationSnapshot, cancelCommunicationTurn, streamCommunicationEvents } from './communicationApi.js'
import { createTurnState, applyTurnEvent, applyTurnSnapshot, TERMINAL_TURN_STATUSES, validateTurnInput, turnDisplayMessages, settleTurnProgress, canInterruptTurn, sequence } from '../models/communicationTurn.js'

export function newConversation() {
  return { id: crypto.randomUUID(), registered: false, name: '新对话', messages: [], turns: [], queue: [], queuePaused: false, replying: false, submitting: false, cancelling: false }
}

export function createCommunicationSession() {
  const conversations = ref([newConversation()])
  const selectedConversationId = ref(conversations.value[0].id)
  const restoring = ref(true)
  const listLoading = ref(false)
  const listError = ref('')
  const streams = new Map()
  const lifetime = new AbortController()
  let storageKey = ''
  let disposed = false
  let listRevision = 0

  function persist() {
    if (!storageKey || disposed) return
    try {
      // 只保存本标签页的定位信息与用户展示记录；模型输出通过快照恢复，不保存文件字节。
      const records = conversations.value.map((c) => ({
        id: c.id, registered: c.registered, name: c.name, createdAt: c.createdAt, customName: c.customName,
        messages: c.localUsers ?? c.messages.filter((m) => m.role === 'user' && !m.fromHistory && !m.pendingSubmission),
        turns: c.turns.map((t) => ({ conversation_id: c.id, turn_id: t.turn_id, status: t.status })),
      }))
      window.sessionStorage.setItem(storageKey, JSON.stringify({ selectedConversationId: selectedConversationId.value, conversations: records }))
    } catch { /* 会话存储不可用时，仅保留当前页面内的对话。 */ }
  }

  function sync(conversation, save = true) {
    if (conversation.removed) return
    const users = [...new Map([...(conversation.localUsers ?? []), ...conversation.messages.filter((m) => m.role === 'user' && !m.fromHistory && !m.pendingSubmission)].map((message) => [message.id, message])).values()]
    conversation.localUsers = users
    const localMessages = users.flatMap((user) => {
      const turn = conversation.turns.find((t) => t.turn_id === user.turnId)
      if (!turn) return [user]
      user.turnStatus = turn.status
      return [user, ...turnDisplayMessages(turn).map((m) => ({
        id: `${turn.turn_id}:${m.message_id}`, turnId: turn.turn_id,
        role: 'assistant', content: m.text, messageKind: m.message_kind,
        status: m.status, references: m.references,
        operationLabel: m.operation || '',
        settledProgress: m.progress,
        progressActive: m.progressActive,
      }))]
    })
    conversation.messages = mergeCommunicationHistory(conversation.history, localMessages, conversation.turns)
    if (conversation.pendingMessage) conversation.messages.push(conversation.pendingMessage)
    conversation.replying = conversation.turns.some((t) => !TERMINAL_TURN_STATUSES.has(t.status) && !t.unavailable)
    if (save) persist()
    scheduleQueue(conversation)
  }

  function enqueue(conversation, text, files, userMessage) {
    validateTurnInput(text, files)
    conversation.queue.push({ id: crypto.randomUUID(), text, files: [...files], userMessage, error: '', sending: false })
    scheduleQueue(conversation)
  }

  function removeQueued(conversation, id) {
    const index = conversation.queue.findIndex((item) => item.id === id)
    if (index >= 0 && !conversation.queue[index].sending) conversation.queue.splice(index, 1)
  }

  async function sendQueued(conversation, item, { steer = false } = {}) {
    if (disposed || conversation.removed || conversation.deleting || conversation.renaming || conversation.submitting || conversation.cancelling || item.sending || !conversation.queue.includes(item)) return
    if (!steer && conversation.replying) return
    item.sending = true
    item.error = ''
    try {
      const turn = await submit(conversation, item.text, item.files, item.userMessage)
      if (!turn) return
      const index = conversation.queue.findIndex((entry) => entry.id === item.id)
      if (index >= 0) conversation.queue.splice(index, 1)
      conversation.queuePaused = false
    } catch (error) {
      conversation.queuePaused = true
      item.error = error.message || '发送失败，请手动重试'
      throw error
    } finally {
      item.sending = false
      scheduleQueue(conversation)
    }
  }

  function scheduleQueue(conversation) {
    if (disposed || conversation.removed || conversation.deleting || conversation.renaming || conversation.queuePaused || conversation.submitting || conversation.cancelling
      || conversation.replying || conversation.turns.at(-1)?.status !== 'completed' || !conversation.queue.length) return
    queueMicrotask(() => {
      if (disposed || conversation.removed || conversation.deleting || conversation.renaming || conversation.queuePaused || conversation.replying || conversation.submitting || conversation.cancelling) return
      const item = conversation.queue[0]
      if (item && !item.sending) void sendQueued(conversation, item).catch(() => {})
    })
  }

  async function snapshot(conversation, turn, signal = lifetime.signal) {
    const data = await getCommunicationSnapshot(conversation.id, turn.turn_id, { signal })
    if (disposed || conversation.removed || signal.aborted) return
    applyTurnSnapshot(turn, data)
    turn.unavailable = false
    sync(conversation)
  }

  function delay(ms, signal) {
    return new Promise((resolve) => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
      const timer = setTimeout(finish, ms)
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted) finish()
    })
  }

  async function connect(conversation, turn, recover = false) {
    streams.get(turn.turn_id)?.abort()
    const controller = new AbortController()
    streams.set(turn.turn_id, controller)
    let failures = 0
    try {
      while (!disposed && !controller.signal.aborted) {
        try {
          turn.connection = recover ? 'recovering' : 'connecting'
          if (recover) await snapshot(conversation, turn, controller.signal)
          if (TERMINAL_TURN_STATUSES.has(turn.status)) { turn.connection = ''; break }
          recover = false
          turn.connectionError = ''
          let replayNeeded = false
          await streamCommunicationEvents(conversation.id, turn.turn_id, {
            signal: controller.signal, lastEventId: turn.last_sequence,
            onOpen() {
              if (!controller.signal.aborted && !disposed) turn.connection = 'connected'
            },
            onEvent(frame) {
              if (controller.signal.aborted || disposed) return false
              const outcome = applyTurnEvent(turn, frame)
              if (outcome === 'recover') { replayNeeded = true; return false }
              if (outcome === 'unavailable') {
                turn.connectionError = frame.data.message || '轮次事件已不可用，请恢复快照'
                turn.connection = 'disconnected'
                return false
              }
              turn.connection = 'connected'
              sync(conversation, frame.event === 'turn.status')
              return !TERMINAL_TURN_STATUSES.has(turn.status)
            },
          })
          if (TERMINAL_TURN_STATUSES.has(turn.status)) { turn.connection = ''; break }
          if (turn.connection === 'disconnected') break
          recover = replayNeeded
          throw new Error('对话连接已断开，正在恢复')
        } catch (error) {
          if (controller.signal.aborted || disposed) break
          if ([401, 404, 422].includes(error.status)) {
            turn.connectionError = error.status === 404 ? '该轮次已清理或不可访问，无法恢复。可以发送新一轮消息。' : error.message
            turn.unavailable = error.status === 404
            turn.connection = 'disconnected'
            sync(conversation)
            break
          }
          recover = true
          turn.connectionError = error.message || '连接失败'
          if (++failures >= 5) { turn.connection = 'disconnected'; break }
          turn.connection = 'recovering'
          await delay(Math.min(1000 * 2 ** (failures - 1), 8000), controller.signal)
        }
      }
    } finally {
      if (streams.get(turn.turn_id) === controller) streams.delete(turn.turn_id)
    }
  }

  async function submit(conversation, text, files, userMessage) {
    if (conversation.removed || conversation.deleting || conversation.renaming || conversation.submitting || conversation.cancelling) throw new Error('当前请求尚未完成，请稍候')
    const old = conversation.turns.findLast((t) => !TERMINAL_TURN_STATUSES.has(t.status) && !t.unavailable)
    if (old && !canInterruptTurn(old)) throw new Error('当前任务暂不允许调整方向，请等待可打断信号')
    conversation.submitting = true
    // 注册前只投影用户输入，不伪造服务端轮次或激活时间，也不写入恢复缓存。
    conversation.pendingMessage = { ...userMessage, pendingSubmission: true }
    sync(conversation, false)
    try {
      const isNew = !conversation.registered
      const created = isNew
        ? await createCommunicationConversation({ text, files, name: conversation.customName ? conversation.name : undefined, signal: lifetime.signal })
        : await createCommunicationTurn(conversation.id, { text, files, supersedesTurnId: old?.turn_id, signal: lifetime.signal })
      if (disposed) return null
      const turn = createTurnState(created)
      turn.localSession = true
      if (typeof created.conversation_id !== 'string' || !created.conversation_id || typeof created.turn_id !== 'string' || !created.turn_id || (!isNew && created.conversation_id !== conversation.id) || created.status !== 'pending_activation') throw new Error('创建轮次响应不匹配')
      if (isNew) {
        const selected = selectedConversationId.value === conversation.id
        conversation.id = created.conversation_id
        conversation.registered = true
        if (selected) selectedConversationId.value = conversation.id
      }
      if (old) {
        streams.get(old.turn_id)?.abort()
        settleTurnProgress(old)
        old.status = 'superseded'
        old.can_interrupt = false
        old.context_status = 'user_goal_adjusted'
        old.superseded_by_turn_id = turn.turn_id
        old.messages.forEach((m) => { if (m.status === 'streaming') m.status = 'interrupted' })
        // 替代响应只描述新轮次；旧流提前关闭时用快照补齐旧轮次的权威结束时间。
        if (old.processing_duration_ms == null) void snapshot(conversation, old).catch(() => {})
      }
      conversation.turns.push(turn)
      conversation.queuePaused = false
      conversation.pendingMessage = null
      conversation.messages.push({ ...userMessage, turnId: turn.turn_id })
      sync(conversation)
      // 立即激活，不等待 UI 入场动画或用户再次点击。
      void connect(conversation, conversation.turns.at(-1))
      return turn
    } catch (error) {
      conversation.queuePaused = true
      if (error.status === 409 && old) {
        await snapshot(conversation, old).catch(() => {})
      }
      if (!error.status && error.name !== 'AbortError') {
        throw new Error(`${error.message || '网络异常'}。提交结果可能未确认，请勿连续重复提交。`)
      }
      throw error
    } finally {
      conversation.pendingMessage = null
      conversation.submitting = false
      sync(conversation)
    }
  }

  async function cancel(conversation) {
    const turn = conversation.turns.findLast((t) => !TERMINAL_TURN_STATUSES.has(t.status) && !t.unavailable)
    if (!turn || conversation.cancelling || conversation.submitting) return
    if (!canInterruptTurn(turn)) throw new Error('当前任务暂不允许停止，请等待可打断信号')
    conversation.queuePaused = true
    conversation.cancelling = true
    try {
      const data = await cancelCommunicationTurn(conversation.id, turn.turn_id, { signal: lifetime.signal })
      if (disposed) return
      applyTurnSnapshot(turn, data)
      streams.get(turn.turn_id)?.abort()
      sync(conversation)
    } catch (error) {
      if (error.status === 409) {
        await snapshot(conversation, turn)
        if (TERMINAL_TURN_STATUSES.has(turn.status)) return
      }
      throw error
    } finally { conversation.cancelling = false }
  }

  async function renameConversation(conversation, name) {
    if (conversation.renaming || conversation.deleting || conversation.submitting || conversation.removed) throw new Error('当前会话操作尚未完成')
    validateConversationName(name)
    conversation.renaming = true
    listRevision += 1
    try {
      if (conversation.registered) {
        const item = await renameCommunicationConversation(conversation.id, name, { signal: lifetime.signal })
        if (disposed) return
        Object.assign(conversation, item)
      } else conversation.name = name.trim()
      conversation.customName = true
      persist()
    } finally { conversation.renaming = false; listRevision += 1; scheduleQueue(conversation) }
  }

  async function deleteConversation(conversation) {
    if (conversation.deleting || conversation.renaming || conversation.submitting || conversation.cancelling || conversation.removed) throw new Error('当前会话操作尚未完成')
    conversation.deleting = true
    listRevision += 1
    try {
      if (conversation.registered) await deleteCommunicationConversation(conversation.id, { signal: lifetime.signal })
      if (disposed) return
      conversation.removed = true
      conversation.turns.forEach((turn) => streams.get(turn.turn_id)?.abort())
      conversation.queue.splice(0)
      conversations.value = conversations.value.filter((item) => item.id !== conversation.id)
      if (!conversations.value.some((item) => !item.registered)) conversations.value.unshift(newConversation())
      if (selectedConversationId.value === conversation.id) selectedConversationId.value = conversations.value[0].id
      persist()
    } finally { conversation.deleting = false; listRevision += 1; scheduleQueue(conversation) }
  }

  async function refreshConversations() {
    if (listLoading.value || disposed || conversations.value.some((conversation) => conversation.deleting || conversation.renaming)) return
    listLoading.value = true
    listError.value = ''
    const revision = listRevision
    const registeredAtRequest = new Set(conversations.value.filter((conversation) => conversation.registered).map((conversation) => conversation.id))
    try {
      const items = await listCommunicationConversations({ signal: lifetime.signal })
      if (disposed || revision !== listRevision) return
      const cached = new Map(conversations.value.map((conversation) => [conversation.id, conversation]))
      const drafts = conversations.value.filter((conversation) => !conversation.registered)
      if (!drafts.length) drafts.push(newConversation())
      const registered = items.map((item) => {
        const conversation = cached.get(item.id) || newConversation()
        Object.assign(conversation, item, { registered: true })
        return conversation
      })
      const retained = new Set(registered.map((conversation) => conversation.id))
      const newlyCreated = conversations.value.filter((conversation) => conversation.registered && !registeredAtRequest.has(conversation.id) && !retained.has(conversation.id))
      newlyCreated.forEach((conversation) => retained.add(conversation.id))
      // 服务端列表为准；移除本地记录只断开订阅，不取消后台任务。
      for (const conversation of conversations.value) {
        if (conversation.registered && !retained.has(conversation.id)) conversation.turns.forEach((turn) => streams.get(turn.turn_id)?.abort())
      }
      conversations.value = [...drafts, ...newlyCreated, ...registered]
      if (!conversations.value.some((conversation) => conversation.id === selectedConversationId.value)) selectedConversationId.value = drafts[0].id
      persist()
    } catch (error) {
      if (!disposed && error.name !== 'AbortError') listError.value = error.message || '会话列表加载失败'
    } finally { listLoading.value = false }
  }

  async function loadHistory(conversation, earlier = false) {
    if (!conversation?.registered || conversation.removed || conversation.deleting || conversation.historyLoading || disposed) return false
    if (earlier && (!conversation.historyLoaded || !conversation.history?.hasMore || conversation.historyNeedsOpen)) return false
    conversation.historyLoading = true
    conversation.historyError = ''
    conversation.historyRetryEarlier = earlier
    const revision = listRevision
    try {
      const data = await getCommunicationHistory(conversation.id, { earlier, signal: lifetime.signal })
      const history = modelCommunicationHistory(data, conversation.id)
      if (disposed || conversation.removed) return false
      conversation.historyChangeKind = earlier ? 'earlier' : 'open'
      conversation.history = history
      conversation.historyLoaded = true
      conversation.historyNeedsOpen = false
      if (revision === listRevision && !conversation.renaming) Object.assign(conversation, { name: history.name, createdAt: history.createdAt })
      // 新历史携带真实游标，恢复活动任务而不重新注册；已有 SSE 不被历史覆盖。
      const resumed = []
      for (const turn of history.turns) {
        const existing = conversation.turns.find(item => item.turn_id === turn.turn_id)
        // 历史顶层是当前权限；忽略比已接收 SSE 更早的响应，避免迟到数据重新开放操作。
        if (existing && !TERMINAL_TURN_STATUSES.has(existing.status)
          && (turn.last_sequence == null || sequence(turn.last_sequence) >= sequence(existing.last_sequence))) existing.can_interrupt = turn.can_interrupt
        if (!['pending_activation', 'processing'].includes(turn.status) || turn.event_source !== 'recorded'
          || existing) continue
        const user = history.messages.find(message => message.role === 'user' && message.turnId === turn.turn_id)
        if (!user) continue
        Object.assign(turn, { history: false, localSession: true })
        conversation.turns.push(turn)
        conversation.messages.push({ ...user, fromHistory: false })
        resumed.push(turn.turn_id)
      }
      sync(conversation)
      resumed.forEach(id => { void connect(conversation, conversation.turns.find(turn => turn.turn_id === id)) })
      return true
    } catch (error) {
      if (!disposed && !conversation.removed && error.name !== 'AbortError') {
        if (error.status === 409) conversation.historyNeedsOpen = true
        conversation.historyError = error.status === 409 ? '历史驻留已失效或记录冲突，请重新打开历史后重试。' : error.message || '历史加载失败'
      }
      return false
    } finally { conversation.historyLoading = false }
  }

  async function restore() {
    try {
      const token = getAuthSession()?.loginCode
      if (!token) return
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
      if (disposed) return
      storageKey = `contract-communication-v1:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`
      const saved = JSON.parse(window.sessionStorage.getItem(storageKey) || 'null')
      const records = saved?.conversations
      if (Array.isArray(records) && records.length) {
        const loaded = records.map((c) => {
          if (typeof c.id !== 'string' || typeof c.name !== 'string' || !Array.isArray(c.messages) || !Array.isArray(c.turns)) throw new Error('缓存无效')
          return { ...c, registered: c.registered ?? c.turns.length > 0, turns: c.turns.map(createTurnState), queue: [], queuePaused: false, replying: false, submitting: false, cancelling: false }
        })
        conversations.value = loaded
        selectedConversationId.value = loaded.some((c) => c.id === saved.selectedConversationId) ? saved.selectedConversationId : loaded[0].id
        for (const conversation of conversations.value) {
          sync(conversation)
          for (const turn of conversation.turns) void connect(conversation, turn, true)
        }
      }
    } catch { /* 不可信或不可用的本地缓存不阻断新会话。 */ }
    finally {
      if (getAuthSession()?.loginCode) await refreshConversations()
      await loadHistory(conversations.value.find((conversation) => conversation.id === selectedConversationId.value))
      restoring.value = false
    }
  }

  function dispose() {
    persist()
    disposed = true
    lifetime.abort()
    streams.forEach((controller) => controller.abort())
    streams.clear()
  }

  return { conversations, selectedConversationId, restoring, listLoading, listError, refreshConversations, loadHistory, renameConversation, deleteConversation, submit, cancel, connect, persist, restore, dispose, enqueue, removeQueued, sendQueued }
}
