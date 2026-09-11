import { TERMINAL_TURN_STATUSES, turnDisplayMessages, interruptionPermission } from './communicationTurn.js'
import { modelHistoryEvents } from './communicationHistoryEvents.js'

const invalid = () => { throw new Error('历史轨迹格式无效，无法完整展示，请重试或联系管理员') }
const text = (value) => typeof value === 'string'
const id = (value) => text(value) && value.length > 0
const time = (value) => Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime())
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function attachment(file) {
  if (!file || !id(file.file_name) || !id(file.file_id)) return invalid()
  const result = { name: file.file_name, fileId: file.file_id, filePath: file.file_path }
  // 旧记录不补造准入结论；新记录的空路径是正常业务状态，而非历史结构错误。
  if (!Object.hasOwn(file, 'admission')) {
    if (!id(file.file_path)) return invalid()
    return result
  }
  if (!uuid.test(file.file_id) || !['pending', 'accepted', 'unavailable'].includes(file.admission)) return invalid()
  if (file.admission === 'accepted' ? file.file_path !== `/${file.file_id}.pdf` : file.file_path !== null) return invalid()
  return { ...result, admission: file.admission }
}

function references(items) {
  if (!Array.isArray(items)) return invalid()
  return items.map((item) => {
    if (!item || !['web', 'contract'].includes(item.type) || !id(item.location)) return invalid()
    if (item.type === 'web') {
      try { if (!['http:', 'https:'].includes(new URL(item.location).protocol)) return invalid() } catch { return invalid() }
    }
    return { type: item.type, location: item.location }
  })
}

export function modelCommunicationHistory(data, conversationId) {
  if (!data || data.conversation_id !== conversationId || !text(data.name) || !time(data.created_at)
    || !Array.isArray(data.records) || typeof data.has_more !== 'boolean'
    || !(data.model_context_start_sequence === null || (Number.isSafeInteger(data.model_context_start_sequence) && data.model_context_start_sequence > 0))) return invalid()
  const turns = [], messages = [], ids = new Set(), turnIds = new Set()
  let previous = 0
  for (const record of data.records) {
    if (!record || !id(record.record_id) || ids.has(record.record_id) || record.kind !== 'task'
      || !Number.isSafeInteger(record.sequence) || record.sequence <= previous || !time(record.created_at)
      || !(record.activated_at == null || time(record.activated_at))
      || !(record.turn_id === null || id(record.turn_id))
      || !(record.status === null || TERMINAL_TURN_STATUSES.has(record.status) || ['pending_activation', 'processing'].includes(record.status))
      || !(record.processing_duration_ms === null || (Number.isSafeInteger(record.processing_duration_ms) && record.processing_duration_ms >= 0))) return invalid()
    previous = record.sequence
    ids.add(record.record_id)
    const turnId = record.turn_id ?? `history-record:${record.record_id}`
    if (turnIds.has(turnId)) return invalid()
    turnIds.add(turnId)
    const { input, trace } = record.payload ?? {}
    const usesEvents = Object.hasOwn(record.payload ?? {}, 'events')
    if (!input || !(input.text === null || text(input.text)) || !Array.isArray(input.files) || (!usesEvents && !Array.isArray(trace))) return invalid()
    const attachments = input.files.map(attachment)
    const canInterrupt = interruptionPermission(record)
    const turn = { turn_id: turnId, status: record.status, history: true, messages: [], processing_duration_ms: record.processing_duration_ms,
      can_interrupt: canInterrupt,
      activated_at: record.activated_at == null ? null : new Date(record.activated_at).toISOString() }
    const common = { turnId, fromHistory: true }
    messages.push({ ...common, id: `history:${record.record_id}:input`, role: 'user', content: input.text ?? '', attachments, turnStatus: record.status })
    if (usesEvents) {
      const restored = modelHistoryEvents(record, conversationId)
      restored.can_interrupt = canInterrupt
      messages.push(...turnDisplayMessages(restored).map(message => ({
        ...common, id: `${turnId}:${message.message_id}`, role: 'assistant', content: message.text,
        messageKind: message.message_kind, status: message.status, references: message.references,
        settledProgress: message.progress, progressActive: message.progressActive,
      })))
      if (restored.error) messages.push({ ...common, id: `${turnId}:error`, role: 'assistant', content: restored.error.message, historyError: true, messageKind: 'intermediate' })
      turns.push(restored)
      continue
    }
    const calls = new Map()
    trace.forEach((entry, index) => {
      if (!entry || entry.sequence !== index + 1) return invalid()
      const messageId = `trace-${entry.sequence}`
      const base = { ...common, id: `${turnId}:${messageId}`, role: 'assistant' }
      if (entry.type === 'message') {
        if (!id(entry.message_id) || !['intermediate', 'final'].includes(entry.message_kind) || !['completed', 'interrupted'].includes(entry.status) || !text(entry.text)) return invalid()
        const refs = references(entry.references)
        // 保留同一 message_id 被工具调用分隔后的片段位置，不跨轨迹拼接全文。
        turn.messages.push({ message_id: messageId, message_kind: entry.message_kind, text: entry.text, status: entry.status, references: refs })
        messages.push({ ...base, content: entry.text, messageKind: entry.message_kind, status: entry.status, references: refs })
      } else if (entry.type === 'tool_call') {
        if (!id(entry.call_id) || calls.has(entry.call_id) || !id(entry.name) || !id(entry.title) || !text(entry.input_summary)) return invalid()
        calls.set(entry.call_id, entry.title)
        messages.push({ ...base, content: entry.input_summary, messageKind: 'intermediate', operationLabel: entry.title, isTool: true })
      } else if (entry.type === 'tool_result') {
        if (!calls.has(entry.call_id) || !['succeeded', 'failed', 'interrupted'].includes(entry.status) || !(entry.output_summary === null || text(entry.output_summary))) return invalid()
        messages.push({ ...base, content: entry.output_summary ?? '', messageKind: 'intermediate', isTool: true, references: references(entry.references),
          operationLabel: `${calls.get(entry.call_id)} · ${{ succeeded: '已完成', failed: '失败', interrupted: '已中断' }[entry.status]}` })
      } else return invalid()
    })
    turns.push(turn)
  }
  return { turns, messages, hasMore: data.has_more, name: data.name, createdAt: data.created_at, contextStartSequence: data.model_context_start_sequence }
}

export function mergeCommunicationHistory(history, localMessages, localTurns) {
  // 本页实际执行的轮次在停止后仍保留实时结果，不能因状态变为终态便被较早的归档投影替换。
  const live = new Set(localTurns.filter((turn) => turn.localSession || (!TERMINAL_TURN_STATUSES.has(turn.status) && !turn.unavailable)).map((turn) => turn.turn_id))
  const archived = new Set((history?.turns ?? []).filter((turn) => !live.has(turn.turn_id)).map((turn) => turn.turn_id))
  const historyUsers = new Map((history?.messages ?? []).filter(message => message.role === 'user').map(message => [message.turnId, message]))
  const currentMessages = localMessages.filter(message => !archived.has(message.turnId)).map(message => {
    const historical = message.role === 'user' && historyUsers.get(message.turnId)
    // 本地消息正文与 SSE 优先，但附件准入必须跟随最新 open/refresh，不能停留在初次上传状态。
    return historical ? { ...message, attachments: historical.attachments } : message
  })
  return [...(history?.messages ?? []).filter((message) => archived.has(message.turnId)), ...currentMessages]
}
