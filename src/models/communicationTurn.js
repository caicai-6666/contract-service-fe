export const TERMINAL_TURN_STATUSES = new Set(['completed', 'cancelled', 'superseded', 'rejected', 'failed', 'expired'])
const statuses = new Set(['pending_activation', 'processing', ...TERMINAL_TURN_STATUSES])
const kinds = new Set(['intermediate', 'final'])

export function hasStartedFinal(turn) {
  return Boolean(turn?.messages?.some((message) => message.message_kind === 'final'))
}

export function shouldCollapseTurnProcess(turn) {
  return turn?.status === 'cancelled' || hasStartedFinal(turn)
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
  if (turn.status === 'superseded') return `你在 ${seconds} 秒后调整了方向`
  return turn.status === 'cancelled' ? `你在 ${seconds} 秒后手动停止` : `已经处理 ${seconds} 秒`
}

export function validateTurnInput(text, files) {
  if (!text.trim() && !files.length) throw new Error('请输入消息或添加 PDF 附件')
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
    ...created, last_sequence: '0', messages: [], gate_result: null, progress: null, active_progress: null, error: null,
    context_status: null, connection: '', connectionError: '',
  }
}

export function applyTurnSnapshot(turn, snapshot) {
  if (snapshot?.turn_id !== turn.turn_id || snapshot.conversation_id !== turn.conversation_id
    || !statuses.has(snapshot.status) || !Array.isArray(snapshot.messages)) throw new Error('对话快照不匹配')
  const last = sequence(snapshot.last_sequence)
  if (last < sequence(turn.last_sequence)) return
  const ids = new Set()
  for (const message of snapshot.messages) {
    if (!message.message_id || ids.has(message.message_id) || !kinds.has(message.message_kind)
      || typeof message.text !== 'string' || !['streaming', 'completed', 'interrupted'].includes(message.status)
      || !Array.isArray(message.references)) throw new Error('对话消息快照无效')
    ids.add(message.message_id)
  }
  Object.assign(turn, snapshot, { last_sequence: last.toString(), messages: snapshot.messages.map((m) => ({ ...m })) })
  // 快照仅保存最近进度，未提供它与消息的先后顺序；已有消息时不恢复可能过时的尾部文案。
  turn.active_progress = snapshot.status === 'processing' && !snapshot.messages.length ? snapshot.progress : null
}

export function applyTurnEvent(turn, frame) {
  const data = frame.data
  if (!data) return
  if (!frame.id) {
    if (frame.event !== 'error') throw new Error('对话事件缺少序号')
    return data.code === 'replay_required' ? 'recover' : 'unavailable'
  }
  const next = sequence(frame.id)
  if (next <= sequence(turn.last_sequence)) return
  if (next !== sequence(turn.last_sequence) + 1n) return 'recover'
  if (data.turn_id !== turn.turn_id) throw new Error('收到其他轮次的事件')
  if (TERMINAL_TURN_STATUSES.has(turn.status)) return
  switch (frame.event) {
    case 'turn.status':
      if (!statuses.has(data.status)) throw new Error('未知的轮次状态')
      turn.status = data.status
      turn.context_status = data.context_status
      turn.superseded_by_turn_id = data.superseded_by_turn_id
      turn.activated_at = data.activated_at ?? null
      turn.finished_at = data.finished_at ?? null
      turn.processing_duration_ms = data.processing_duration_ms ?? null
      if (TERMINAL_TURN_STATUSES.has(data.status)) {
        turn.active_progress = null
        turn.messages.forEach((m) => { if (m.status === 'streaming') m.status = 'interrupted' })
      }
      break
    case 'message.delta':
    case 'message.completed': {
      if (!kinds.has(data.message_kind) || !data.message_id) throw new Error('消息类型或标识无效')
      let message = turn.messages.find((m) => m.message_id === data.message_id)
      if (message && (message.message_kind !== data.message_kind || message.status !== 'streaming')) throw new Error('消息生命周期不一致')
      const text = frame.event === 'message.delta' ? data.delta : data.text
      if (typeof text !== 'string') throw new Error('消息文本无效')
      if (message && frame.event === 'message.completed' && message.text !== text) return 'recover'
      if (!message) {
        message = { message_id: data.message_id, message_kind: data.message_kind, text: '', status: 'streaming', references: [], operation: turn.active_progress?.message || '' }
        turn.messages.push(message)
      }
      if (frame.event === 'message.delta') message.text += text
      else Object.assign(message, { text, status: 'completed', references: data.references || [] })
      turn.active_progress = null
      break
    }
    case 'gate.result': turn.gate_result = data; break
    case 'task.progress':
      turn.progress = data
      turn.active_progress = data
      break
    case 'error': turn.error = data; break
    default: throw new Error(`不支持的对话事件：${frame.event}`)
  }
  turn.last_sequence = next.toString()
}
