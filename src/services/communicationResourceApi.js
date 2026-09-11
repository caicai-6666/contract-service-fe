import { CONTRACT_API_BASE_PATH, ContractApiError, contractApiFetch } from './contractApi.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function canPreviewCommunicationFile(file, status) {
  return Boolean(file?.admission === 'accepted' && uuid.test(file.fileId)
    && file.filePath === `/${file.fileId}.pdf`
    && ['processing', 'completed', 'cancelled', 'superseded', 'failed'].includes(status))
}

export async function getCommunicationPdf(conversationId, fileId, { signal } = {}) {
  if (typeof conversationId !== 'string' || !conversationId.length || Array.from(conversationId).length > 128
    || typeof fileId !== 'string' || !uuid.test(fileId)) throw new ContractApiError('会话附件标识无效')
  const response = await contractApiFetch(`${CONTRACT_API_BASE_PATH}/resource/conversations/${encodeURIComponent(conversationId)}/files/${encodeURIComponent(fileId)}`, { signal, cache: 'no-store' })
  if (response.status !== 200) {
    const payload = await response.json().catch(() => null)
    throw new ContractApiError(typeof payload?.detail === 'string' ? payload.detail : `会话附件读取失败（${response.status}）`, { status: response.status, payload })
  }
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf') throw new ContractApiError('会话附件未返回 PDF')
  const blob = await response.blob()
  if (!blob.size) throw new ContractApiError('会话附件 PDF 内容为空')
  return blob
}
