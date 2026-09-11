import { createTurnState, applyTurnEvent, sequence, settleTurnProgress, TERMINAL_TURN_STATUSES } from './communicationTurn.js'

const invalid = () => { throw new Error('历史展示事件格式无效，无法恢复对话') }
export function historyEventReferences(values, legacy = false) {
  if (!Array.isArray(values)) return invalid()
  return values.map(value => {
    if (legacy) {
      if (!value || !['web', 'contract'].includes(value.type) || typeof value.location !== 'string' || !value.location) return invalid()
      if (value.type === 'web') {
        try { if (!['http:', 'https:'].includes(new URL(value.location).protocol)) return invalid() } catch { return invalid() }
      }
      return { type: value.type, location: value.location }
    }
    if (!value || typeof value.document_id !== 'string' || !value.document_id
      || !(value.page_number === null || (Number.isSafeInteger(value.page_number) && value.page_number >= 1))) return invalid()
    return { document_id: value.document_id, page_number: value.page_number }
  })
}

export function modelHistoryEvents(record, conversationId) {
  const payload = record.payload
  const legacy = payload.event_source === 'legacy'
  if (!['recorded', 'legacy'].includes(payload.event_source) || !Array.isArray(payload.events)
    || !Array.isArray(payload.streaming_messages)) return invalid()
  const cursor = legacy ? null : sequence(payload.last_sequence)
  if (!legacy && !record.turn_id) return invalid()
  if (legacy && payload.last_sequence !== null) return invalid()
  const turn = createTurnState({ conversation_id: conversationId, turn_id: record.turn_id ?? `history-record:${record.record_id}`, status: 'pending_activation' })
  let previous = 0n
  for (const [index, entry] of payload.events.entries()) {
    if (!entry || !['turn.status', 'task.progress', 'message.completed', 'error'].includes(entry.event)
      || !entry.data || (entry.data.turn_id !== record.turn_id)) return invalid()
    if (legacy && (entry.sequence !== null || entry.event !== 'message.completed')) return invalid()
    const number = legacy ? BigInt(index + 1) : sequence(entry.sequence)
    if (number <= previous || (!legacy && number > cursor) || TERMINAL_TURN_STATUSES.has(turn.status)) return invalid()
    previous = number
    const data = { ...entry.data, turn_id: turn.turn_id }
    if (entry.event === 'message.completed') {
      if (!['completed', 'interrupted'].includes(data.status ?? 'completed')) return invalid()
      data.references = historyEventReferences(data.references, legacy)
    }
    if (entry.event === 'error' && (typeof data.code !== 'string' || typeof data.message !== 'string' || typeof data.retryable !== 'boolean')) return invalid()
    applyTurnEvent(turn, { id: number.toString(), event: entry.event, data }, { history: true })
  }
  if (payload.streaming_messages.length > 1 || (TERMINAL_TURN_STATUSES.has(record.status) && payload.streaming_messages.length)) return invalid()
  for (const message of payload.streaming_messages) {
    if (!message || typeof message.message_id !== 'string' || !message.message_id
      || !['intermediate', 'final'].includes(message.message_kind) || message.status !== 'streaming' || typeof message.text !== 'string') return invalid()
    const existing = turn.messages.find(item => item.message_id === message.message_id)
    if (existing && existing.message_kind !== message.message_kind) return invalid()
    settleTurnProgress(turn)
    const normalized = { ...message, references: historyEventReferences(message.references, legacy) }
    if (existing) Object.assign(existing, normalized)
    else turn.messages.push(normalized)
  }
  if (TERMINAL_TURN_STATUSES.has(turn.status) && turn.status !== record.status) return invalid()
  turn.status = record.status
  turn.history = true
  turn.event_source = payload.event_source
  turn.last_sequence = cursor?.toString() ?? null
  turn.activated_at = record.activated_at == null ? null : new Date(record.activated_at).toISOString()
  turn.processing_duration_ms = record.processing_duration_ms
  if (TERMINAL_TURN_STATUSES.has(turn.status)) {
    settleTurnProgress(turn)
    turn.messages.forEach(message => { if (message.status === 'streaming') message.status = 'interrupted' })
  }
  return turn
}
