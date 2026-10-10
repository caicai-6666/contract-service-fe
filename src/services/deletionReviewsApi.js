import { CONTRACT_API_BASE_PATH, contractApiFetch, ContractApiError } from './contractApi.js'
import { isSubmissionId } from '../models/pendingReviews.js'
import { modelDeletionReviewIds, modelDeletionReviewDetail } from '../models/deletionReviews.js'
import { getContractPdf } from './contractResourceApi.js'

const base = `${CONTRACT_API_BASE_PATH}/deletion-reviews`
async function read(path, signal) {
  const response = await contractApiFetch(path, { signal, cache: 'no-store' })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new ContractApiError(typeof payload?.detail === 'string' ? payload.detail : `删除审核读取失败（${response.status}）`, { status: response.status, payload })
  return payload
}
export async function getDeletionReviewIds({ signal } = {}) {
  return modelDeletionReviewIds(await read(`${base}/list`, signal))
}
export async function getDeletionReviewDetail(id, { signal } = {}) {
  if (!isSubmissionId(id)) throw new ContractApiError('删除申请标识无效', { status: 422 })
  return modelDeletionReviewDetail(await read(`${base}/detail/${encodeURIComponent(id)}`, signal), id)
}
export async function getDeletionReviewPdf(detail, { signal } = {}) {
  modelDeletionReviewDetail(detail, detail?.submission_id)
  if (detail.pdf.url === null) throw new ContractApiError('原合同 PDF 已不可用，请刷新审核日志', { status: 404 })
  return getContractPdf(detail.pdf.file_uri, { signal })
}
