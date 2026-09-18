import { CONTRACT_API_BASE_PATH, ContractApiError, contractApiFetch } from './contractApi.js'
import { sequence, validateTurnInput } from '../models/communicationTurn.js'

function turnPath(conversationId, turnId = '', suffix = '') {
  const base = `${CONTRACT_API_BASE_PATH}/communication/conversations/${encodeURIComponent(conversationId)}/turns`
  return turnId ? `${base}/${encodeURIComponent(turnId)}${suffix}` : base
}

function conversationPath(id) {
  if (typeof id !== 'string' || !id.length || Array.from(id).length > 128) throw new Error('会话 ID 无效')
  return `${CONTRACT_API_BASE_PATH}/communication/conversations/${encodeURIComponent(id)}`
}

function conversationItem(item) {
  if (!item || typeof item.conversation_id !== 'string' || !item.conversation_id.trim()
    || typeof item.name !== 'string' || !Number.isSafeInteger(item.created_at) || !Number.isFinite(new Date(item.created_at).getTime())) throw new Error('会话列表格式无效')
  return { id: item.conversation_id, name: item.name, createdAt: item.created_at }
}

export function validateConversationName(name) {
  if (typeof name !== 'string' || !name.trim() || Array.from(name).length > 200) throw new Error('会话名称需为 1～200 个字符，且不能全为空白')
}

export async function renameCommunicationConversation(id, name, { signal } = {}) {
  validateConversationName(name)
  const item = conversationItem(await requireResponse(await contractApiFetch(conversationPath(id), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }), signal,
  }), 200))
  if (item.id !== id) throw new Error('修改会话响应不匹配')
  return item
}

export async function deleteCommunicationConversation(id, { signal } = {}) {
  const response = await contractApiFetch(conversationPath(id), { method: 'DELETE', signal })
  if (response.status !== 204) {
    await requireResponse(response, 204)
    throw new Error('删除会话响应无效')
  }
}

async function requireResponse(response, status) {
  const payload = await response.json().catch(() => null)
  if (response.status !== status) throw new ContractApiError(
    typeof payload?.detail === 'string' ? payload.detail : `对话请求失败（${response.status}）`,
    { status: response.status, payload },
  )
  if (!payload || typeof payload !== 'object') throw new Error('对话服务返回了无效响应')
  return payload
}

export async function createCommunicationTurn(conversationId, { text, files, contractIds = [], supersedesTurnId, signal }) {
  validateTurnInput(text, files, contractIds)
  const body = new FormData()
  body.append('text', text)
  contractIds.forEach((id) => body.append('contract_ids', id))
  files.forEach((file) => body.append('files', file, file.name))
  if (supersedesTurnId) body.append('supersedes_turn_id', supersedesTurnId)
  return requireResponse(await contractApiFetch(turnPath(conversationId), { method: 'POST', body, signal }), 201)
}

export async function createCommunicationConversation({ text, files, contractIds = [], name, signal }) {
  validateTurnInput(text, files, contractIds)
  const body = new FormData()
  body.append('text', text)
  contractIds.forEach((id) => body.append('contract_ids', id))
  files.forEach((file) => body.append('files', file, file.name))
  if (name) body.append('name', name)
  return requireResponse(await contractApiFetch(`${CONTRACT_API_BASE_PATH}/communication/conversations`, { method: 'POST', body, signal }), 201)
}

export async function getCommunicationSnapshot(conversationId, turnId, { signal } = {}) {
  return requireResponse(await contractApiFetch(turnPath(conversationId, turnId), { signal }), 200)
}

export async function getCommunicationHistory(conversationId, { earlier = false, signal } = {}) {
  return requireResponse(await contractApiFetch(`${conversationPath(conversationId)}/${earlier ? 'refresh' : 'open'}`, { method: 'POST', signal }), 200)
}

export async function listCommunicationConversations({ signal } = {}) {
  const items = await requireResponse(await contractApiFetch(`${CONTRACT_API_BASE_PATH}/communication/conversations`, { signal }), 200)
  if (!Array.isArray(items)) throw new Error('会话列表格式无效')
  const ids = new Set()
  return items.map((item) => {
    const model = conversationItem(item)
    if (ids.has(model.id)) throw new Error('会话列表格式无效')
    ids.add(model.id)
    return model
  })
}

export async function cancelCommunicationTurn(conversationId, turnId, { signal } = {}) {
  return requireResponse(await contractApiFetch(turnPath(conversationId, turnId, '/cancel'), { method: 'POST', signal }), 200)
}

export function parseCommunicationFrame(frame) {
  let id = ''
  let event = ''
  const data = []
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const key = colon < 0 ? line : line.slice(0, colon)
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (key === 'id') id = value
    if (key === 'event') event = value
    if (key === 'data') data.push(value)
  }
  return data.length ? { id, event, data: JSON.parse(data.join('\n')) } : null
}

export async function streamCommunicationEvents(conversationId, turnId, { signal, lastEventId = '0', onEvent, onOpen }) {
  const headers = { Accept: 'text/event-stream', 'Last-Event-ID': sequence(lastEventId).toString() }
  const response = await contractApiFetch(turnPath(conversationId, turnId, '/events'), { headers, signal })
  if (response.status !== 200) await requireResponse(response, 200)
  if (!response.headers.get('Content-Type')?.includes('text/event-stream') || !response.body) throw new Error('无法读取对话事件流')
  onOpen?.()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let pendingCR = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      let chunk = decoder.decode(value, { stream: !done })
      // CRLF 可能跨网络分块；统一换行后再解析完整帧，不提交半截事件。
      if (pendingCR && chunk.startsWith('\n')) chunk = chunk.slice(1)
      pendingCR = chunk.endsWith('\r')
      buffer += chunk.replace(/\r\n|\r/g, '\n')
      let end
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = parseCommunicationFrame(buffer.slice(0, end))
        buffer = buffer.slice(end + 2)
        if (frame && await onEvent(frame) === false) return
      }
      if (done) return
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
