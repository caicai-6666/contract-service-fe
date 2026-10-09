import { validateTaskProgress } from './communicationProgress.js'

export const TERMINAL_TURN_STATUSES = new Set(['completed', 'cancelled', 'superseded', 'rejected', 'failed', 'expired'])
const statuses = new Set(['pending_activation', 'processing', ...TERMINAL_TURN_STATUSES])
const kinds = new Set(['intermediate', 'final'])

export function interruptionPermission(state) {
  if (state.can_interrupt !== undefined && typeof state.can_interrupt !== 'boolean') throw new Error('轮次中断权限无效')
  return state.can_interrupt === true && ['pending_activation', 'processing'].includes(state.status)
}

export function canInterruptTurn(turn) {
  return Boolean(turn && !turn.unavailable && turn.can_interrupt === true && ['pending_activation', 'processing'].includes(turn.status))
}

export function hasStartedFinal(turn) {
  return Boolean(turn?.messages?.some((message) => message.message_kind === 'final' && (message.status !== 'interrupted' || TERMINAL_TURN_STATUSES.has(turn.status)) && typeof message.text === 'string' && message.text.trim()))
}

export function shouldCollapseTurnProcess(turn, displayStates) {
  if (turn?.status === 'cancelled') return true
  if (!hasStartedFinal(turn)) return false
  if (!displayStates) return true
  const stateFor = message => displayStates.get(`${turn.turn_id}:${message.message_id}`)
  const finalVisible = turn.messages.some(message => message.message_kind === 'final'
    && (message.status !== 'interrupted' || TERMINAL_TURN_STATUSES.has(turn.status)) && stateFor(message)?.visible)
  const processCaughtUp = turn.messages.filter(message => message.message_kind === 'intermediate' && message.text?.trim())
    .every(message => stateFor(message)?.text === message.text)
  return finalVisible && processCaughtUp
}

export function copyableTurnMessage(turn, renderedText) {
  const message = turn?.messages?.at(-1)
  if (!message || !message.text || renderedText !== message.text) return null
  const finalComplete = message.message_kind === 'final' && message.status === 'completed'
  return finalComplete || turn.status === 'cancelled' ? message : null
}

export function turnDurationMs(turn, now = Date.now()) {
  if (!turn) return null
  if (TERMINAL_TURN_STATUSES.has(turn.status)) {
    return Number.isSafeInteger(turn.processing_duration_ms) && turn.processing_duration_ms >= 0
      ? turn.processing_duration_ms : null
  }
  if (turn.status !== 'processing' || !turn.activated_at) return null
  const started = Date.parse(turn.activated_at)
  return Number.isFinite(started) ? Math.max(0, now - started) : null
}

export function turnTimingLabel(turn, now = Date.now()) {
  const milliseconds = turnDurationMs(turn, now)
  if (milliseconds === null) return turn?.status === 'superseded' ? '已调整任务方向' : ''
  const seconds = Math.floor(milliseconds / 1000)
  const duration = seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
  return TERMINAL_TURN_STATUSES.has(turn.status) ? `用时 ${duration}` : `已经处理 ${duration}`
}

export function turnStartTime(turn, now = Date.now()) {
  if (typeof turn?.activated_at !== 'string' || !turn.activated_at) return null
  const date = new Date(turn.activated_at)
  if (!Number.isFinite(date.getTime())) return null
  const today = new Date(now)
  const dayStart = value => new Date(value.getFullYear(), value.getMonth(), value.getDate())
  const start = dayStart(today)
  const weekStart = dayStart(today)
  weekStart.setDate(weekStart.getDate() - (weekStart.getDay() + 6) % 7)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  let prefix = ''
  if (dayStart(date).getTime() !== start.getTime()) {
    if (date >= weekStart && date < weekEnd) prefix = `周${'日一二三四五六'[date.getDay()]}`
    else prefix = date.toLocaleDateString('zh-CN', {
      ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
      month: '2-digit', day: '2-digit',
    })
  }
  return {
    datetime: date.toISOString(),
    label: prefix ? `${prefix} ${time}` : time,
    fullLabel: date.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }),
  }
}

export function validateTurnInput(text, files, contractIds = []) {
  if (!Array.isArray(contractIds) || contractIds.some((id) => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) throw new Error('引用合同 ID 格式无效')
  if (files.length + contractIds.length > 10) throw new Error('每轮附件与引用合同合计最多 10 份')
  if (!text.trim() && !files.length && !contractIds.length) throw new Error('请输入消息、添加 PDF 附件或引用合同')
  if (Array.from(text).length > 20000) throw new Error('消息不能超过 20000 个字符')
  if (files.length > 10) throw new Error('每轮最多添加 10 份 PDF')
  let total = 0
  for (const file of files) {
    if (!/\.pdf$/i.test(file.name) || !file.size) throw new Error(`${file.name}：需要非空 PDF 文件`)
    if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name}：文件不能超过 10 MiB`)
    total += file.size
  }
  if (total > 20 * 1024 * 1024) throw new Error('本轮附件总大小不能超过 20 MiB')
}

export function sequence(value) {
  const text = String(value)
  if (!/^\d{1,20}$/.test(text) || (typeof value === 'number' && !Number.isSafeInteger(value))) {
    throw new Error('事件序号无效，请恢复快照')
  }
  return BigInt(text)
}

export function createTurnState(created) {
  if (!created?.turn_id || !created.conversation_id || !statuses.has(created.status)) throw new Error('对话轮次响应无效')
  return {
    activated_at: null, finished_at: null, processing_duration_ms: null,
    ...created, can_interrupt: interruptionPermission(created), last_sequence: '0', messages: [], progress: null, active_progress: null, progress_entries: [], error: null,
    context_status: null, connection: '', connectionError: '',
  }
}

export function settleTurnProgress(turn) {
  for (const entry of turn.progress_entries ?? []) entry.active = false
  turn.active_progress = null
}

function sameProgress(left, right) {
  return Boolean(left && right && left.type === right.type && left.message === right.message)
}

function setTurnProgress(turn, progress, id) {
  // final 开始后只继续消费事件和游标，不让迟到的过程通知重新激活界面。
  if (hasStartedFinal(turn) || TERMINAL_TURN_STATUSES.has(turn.status)) {
    settleTurnProgress(turn)
    return
  }
  if (!sameProgress(turn.active_progress, progress)) settleTurnProgress(turn)
  turn.active_progress = progress
  // 消息增量会结束高光；只有类型与完整说明都相同，穿插上报才复用原阶段。
  const samePhase = sameProgress(turn.last_progress, progress)
  if (progress) turn.last_progress = { type: progress.type, message: progress.message }
  if (!progress || progress.type === 'thinking') return
  turn.progress_entries ??= []
  const current = turn.progress_entries.find(entry => entry.active)
    ?? (samePhase ? turn.progress_entries.findLast(entry => sameProgress(entry.progress, progress)) : null)
  if (current) {
    current.progress = { ...progress }
    current.active = true
  }
  else turn.progress_entries.push({
    id: `progress-${id}`, progress: { ...progress }, active: true,
    after_message_id: turn.messages.at(-1)?.message_id ?? null,
  })
}

export function turnDisplayMessages(turn) {
  const result = []
  const appendProgress = after => {
    for (const entry of turn.progress_entries ?? []) {
      if (entry.after_message_id !== after) continue
      const previous = result.at(-1)
      // 思考阶段不留存；去掉它后相邻的完全相同状态合并展示，原事件和阶段仍保留。
      if (sameProgress(previous?.progress, entry.progress)) {
        previous.progress = entry.progress
        previous.progressActive = entry.active
      } else result.push({
        message_id: entry.id, message_kind: 'intermediate', text: '',
        status: 'completed', references: [], progress: entry.progress, progressActive: entry.active,
      })
    }
  }
  appendProgress(null)
  for (const message of turn.messages) {
    result.push(message)
    appendProgress(message.message_id)
  }
  return result
}

export function applyTurnSnapshot(turn, snapshot) {
  if (snapshot?.turn_id !== turn.turn_id || snapshot.conversation_id !== turn.conversation_id
    || !statuses.has(snapshot.status) || !Array.isArray(snapshot.messages)) throw new Error('对话快照不匹配')
  const last = sequence(snapshot.last_sequence)
  if (last < sequence(turn.last_sequence)) return
  // 同一轮次的终态不可逆；迟到的恢复响应不能重新打开已结束的任务。
  if (TERMINAL_TURN_STATUSES.has(turn.status) && snapshot.status !== turn.status) return
  const canInterrupt = interruptionPermission(snapshot)
  if (snapshot.progress != null) validateTaskProgress(snapshot.progress)
  const ids = new Set()
  for (const message of snapshot.messages) {
    if (!message.message_id || ids.has(message.message_id) || !kinds.has(message.message_kind)
      || typeof message.text !== 'string' || !['streaming', 'completed', 'interrupted'].includes(message.status)
      || !Array.isArray(message.references)) throw new Error('对话消息快照无效')
    ids.add(message.message_id)
  }
  // completed final 已正式交付，后端契约不允许撤回、改写或降为半成品。
  // 不接纳矛盾快照，也不推进游标，由连接层继续恢复，界面保留已交付结果。
  const completedFinal = turn.messages.find(message => message.message_kind === 'final' && message.status === 'completed')
  if (completedFinal) {
    const restored = snapshot.messages.find(message => message.message_id === completedFinal.message_id)
    if (!restored || restored.message_kind !== 'final' || restored.status !== 'completed' || restored.text !== completedFinal.text) {
      throw new Error('恢复快照与已完成的最终答复不一致，正在重新恢复')
    }
  }
  if (snapshot.messages.length || TERMINAL_TURN_STATUSES.has(snapshot.status)) settleTurnProgress(turn)
  Object.assign(turn, snapshot, { can_interrupt: canInterrupt, last_sequence: last.toString(), messages: snapshot.messages.map((m) => ({ ...m })) })
  // 快照仅保存最近进度，未提供它与消息的先后顺序；已有消息时不恢复可能过时的尾部文案。
  setTurnProgress(turn, snapshot.status === 'processing' && !snapshot.messages.length ? snapshot.progress : null, last.toString())
}

export function applyTurnEvent(turn, frame, { history = false } = {}) {
  const data = frame.data
  if (!data) return
  if (!frame.id) {
    if (frame.event !== 'error') throw new Error('对话事件缺少序号')
    return data.code === 'replay_required' ? 'recover' : 'unavailable'
  }
  const next = sequence(frame.id)
  if (next <= sequence(turn.last_sequence)) return
  if (!history && next !== sequence(turn.last_sequence) + 1n) return 'recover'
  if (data.turn_id !== turn.turn_id) throw new Error('收到其他轮次的事件')
  if (TERMINAL_TURN_STATUSES.has(turn.status)) return
  switch (frame.event) {
    case 'turn.status':
      if (!statuses.has(data.status)) throw new Error('未知的轮次状态')
      turn.can_interrupt = interruptionPermission(data)
      turn.status = data.status
      turn.context_status = data.context_status
      turn.superseded_by_turn_id = data.superseded_by_turn_id
      turn.activated_at = data.activated_at ?? null
      turn.finished_at = data.finished_at ?? null
      turn.processing_duration_ms = data.processing_duration_ms ?? null
      if (TERMINAL_TURN_STATUSES.has(data.status)) {
        settleTurnProgress(turn)
        turn.messages.forEach((m) => { if (m.status === 'streaming') m.status = 'interrupted' })
      }
      break
    case 'message.delta':
    case 'message.completed': {
      if (!kinds.has(data.message_kind) || !data.message_id) throw new Error('消息类型或标识无效')
      let message = turn.messages.find((m) => m.message_id === data.message_id)
      if (message && (message.message_kind !== data.message_kind || (!history && message.status !== 'streaming'))) throw new Error('消息生命周期不一致')
      const text = frame.event === 'message.delta' ? data.delta : data.text
      if (typeof text !== 'string') throw new Error('消息文本无效')
      if (frame.event === 'message.completed' && !['completed', 'interrupted'].includes(data.status ?? 'completed')) throw new Error('消息完成状态无效')
      if (!history && message && frame.event === 'message.completed' && message.text !== text) return 'recover'
      settleTurnProgress(turn)
      if (!message) {
        message = { message_id: data.message_id, message_kind: data.message_kind, text: '', status: 'streaming', references: [] }
        turn.messages.push(message)
      }
      if (frame.event === 'message.delta') message.text += text
      else Object.assign(message, { text, status: data.status ?? 'completed', references: data.references || [] })
      turn.active_progress = null
      break
    }
    case 'task.progress':
      validateTaskProgress(data)
      turn.progress = data
      setTurnProgress(turn, data, next.toString())
      break
    case 'error': turn.error = data; break
    default: throw new Error(`不支持的对话事件：${frame.event}`)
  }
  turn.last_sequence = next.toString()
}
