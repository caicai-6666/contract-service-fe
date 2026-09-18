import { CONTRACT_API_BASE_PATH, ContractApiError, contractApiFetch } from './contractApi.js'
import { modelContractNote, modelContractNotes, normalizeContractNoteContent, validateContractNotesDocumentId } from '../models/contractNotes.js'

function notesUrl(documentId) {
  validateContractNotesDocumentId(documentId)
  return `${CONTRACT_API_BASE_PATH}/contract/documents/${documentId}/notes`
}

function responseError(response, payload, creating) {
  const messages = {
    401: '登录已失效，请重新登录',
    404: '该合同已不存在，请关闭预览并刷新目录',
    409: '合同尚未完成入库，暂时无法操作注意事项',
    422: '合同标识或注意事项内容不符合要求，请检查后重试',
  }
  const detail = typeof payload?.detail === 'string' ? payload.detail.trim() : ''
  const fallback = creating ? '新增结果未确认，请重新打开注意事项核对后再提交，避免重复添加' : '注意事项加载失败，请重试'
  return new ContractApiError(detail || messages[response.status] || `${fallback}（${response.status}）`, { status: response.status, payload })
}

export async function getContractNotes(documentId, { signal } = {}) {
  const url = notesUrl(documentId)
  let response
  try { response = await contractApiFetch(url, { method: 'GET', signal, cache: 'no-store' }) }
  catch (error) {
    if (error.name === 'AbortError' || error instanceof ContractApiError) throw error
    throw new ContractApiError('无法连接注意事项服务，请重试')
  }
  const payload = await response.json().catch(() => null)
  if (response.status !== 200) throw responseError(response, payload, false)
  try { return modelContractNotes(payload) }
  catch { throw new ContractApiError('注意事项响应格式无效，请重试', { status: response.status }) }
}

export async function createContractNote(documentId, { content }) {
  const url = notesUrl(documentId)
  const body = JSON.stringify({ content: normalizeContractNoteContent(content) })
  let response
  // POST 不幂等：不自动重试，也不在弹层关闭时主动中止已发出的提交。
  try { response = await contractApiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }) }
  catch (error) {
    if (error instanceof ContractApiError) throw error
    throw new ContractApiError('连接中断，新增结果未确认。请重新打开注意事项核对后再提交，避免重复添加')
  }
  const payload = await response.json().catch(() => null)
  if (response.status !== 201) throw responseError(response, payload, true)
  try { return modelContractNote(payload) }
  catch { throw new ContractApiError('服务已接受提交，但返回记录格式无效。请重新打开注意事项核对，勿直接重复提交', { status: response.status }) }
}

export async function deleteContractNote(documentId, noteId) {
  const url = notesUrl(documentId)
  if (typeof noteId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(noteId)) {
    throw new TypeError('注意事项 ID 格式无效')
  }
  let response
  // 不主动中断已提交的删除，也不将重复删除的 404 当作成功。
  try { response = await contractApiFetch(`${url}/${noteId}`, { method: 'DELETE' }) }
  catch (error) {
    if (error instanceof ContractApiError) throw error
    throw new ContractApiError('连接中断，删除结果未确认。请重新打开注意事项核对')
  }
  if (response.status === 204) return
  const payload = await response.json().catch(() => null)
  const messages = {
    401: '登录已失效，请重新登录',
    403: '服务端拒绝删除注意事项，请刷新登录后重试',
    404: '合同或该注意事项已不存在，请重新打开注意事项刷新列表',
    409: '合同尚未完成入库，暂时无法删除注意事项',
    422: '合同或注意事项标识格式错误，请刷新后重试',
    503: '注意事项服务暂时不可用，请稍后重试',
  }
  const detail = typeof payload?.detail === 'string' ? payload.detail.trim() : ''
  throw new ContractApiError(messages[response.status] || detail || `删除未确认，请刷新列表核对（${response.status}）`, { status: response.status, payload })
}
