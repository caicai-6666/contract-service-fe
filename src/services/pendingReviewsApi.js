import { CONTRACT_API_BASE_PATH, contractApiFetch, ContractApiError } from './contractApi.js'
import { isSubmissionId, modelReviewIds, modelReviewDetail, modelCleanupPolicy } from '../models/pendingReviews.js'
const base = `${CONTRACT_API_BASE_PATH}/pending-reviews`
async function read(path, signal) {
  const response = await contractApiFetch(path, { signal, cache: 'no-store' })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new ContractApiError(typeof payload?.detail === 'string' ? payload.detail : `审核日志读取失败（${response.status}）`, { status: response.status, payload })
  return payload
}
export async function getPendingReviewIds({ signal } = {}) {
  return modelReviewIds(await read(`${base}/list`, signal))
}
export async function getPendingReviewDetail(id, { signal } = {}) {
  if (!isSubmissionId(id)) throw new ContractApiError('审核申请标识无效', { status: 422 })
  return modelReviewDetail(await read(`${base}/detail/${encodeURIComponent(id)}`, signal), id)
}
export async function getPendingReviewCleanupPolicy({ signal } = {}) {
  return modelCleanupPolicy(await read(`${base}/cleanup-policy`, signal))
}
export async function getPendingReviewPdf(id, { signal } = {}) {
  if (!isSubmissionId(id)) throw new ContractApiError('审核申请标识无效', { status: 422 })
  // 固定认证资源接口，不把详情中任意 URL 当作可携带登录凭证的请求地址。
  const response = await contractApiFetch(`${CONTRACT_API_BASE_PATH}/resource/pending-review-pdf/${id}`, { signal, cache: 'no-store' })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new ContractApiError(payload?.detail || '待审 PDF 读取失败', { status: response.status })
  }
  const blob = await response.blob()
  if (!blob.size || blob.type.split(';')[0].trim().toLowerCase() !== 'application/pdf') throw new Error('待审 PDF 内容无效')
  return blob
}
