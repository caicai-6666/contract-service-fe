import { deliveryLabels, isSubmissionId, modelReviewIds, reviewLabels } from './pendingReviews.js'
import { isContractPassports } from './contractPassports.js'
import { isFileLevel } from './fileLevel.js'

export { modelReviewIds as modelDeletionReviewIds }
export const deletionLabels = { pending: '待删除', deleting: '删除中', succeeded: '删除成功', failed: '删除失败' }
const isTime = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value))
const nullableText = value => value === null || typeof value === 'string'
const nullableTime = value => value === null || isTime(value)
const invalid = () => { throw new Error('删除审核响应格式无效，请刷新重试') }

export function modelDeletionReviewDetail(value, id) {
  if (!value || value.submission_id !== id || !isSubmissionId(id)
    || !/^[a-f0-9]{64}$/.test(value.document_id ?? '')
    || !['file_name', 'uploader', 'requested_by', 'note'].every(key => typeof value[key] === 'string')
    || !['file_name', 'uploader', 'requested_by'].every(key => value[key].trim())
    || !isFileLevel(value.file_level)
    || !nullableText(value.summary) || !isContractPassports(value.passport)
    || !isTime(value.contract_ingested_at)
    || !['created_at', 'updated_at', 'server_time'].every(key => isTime(value[key]))
    || !Object.hasOwn(deliveryLabels, value.delivery?.status) || !nullableText(value.delivery?.message_id)
    || !Object.hasOwn(reviewLabels, value.review?.status)
    || !['note', 'reviewer'].every(key => nullableText(value.review[key])) || !nullableTime(value.review.reviewed_at)
    || !Object.hasOwn(deletionLabels, value.deletion?.status) || !nullableTime(value.deletion.completed_at)
    || (value.deletion.status === 'succeeded' && !isTime(value.deletion.completed_at))
    || !value.cleanup || !nullableTime(value.cleanup.review_processed_at) || !nullableTime(value.cleanup.eligible_at)
    || value.pdf?.file_uri !== `/${value.document_id}.pdf` || !nullableText(value.pdf?.url)
    || (value.deletion.status === 'succeeded' && value.pdf.url !== null)) return invalid()
  if (value.pdf.url !== null) {
    // 只接受约定的本地资源路径；预览请求由资源服务构造，不向任意地址发送凭据。
    if (!value.pdf.url.startsWith('/knowledge-accumulation/contract/api/resource/contract?')) return invalid()
    const url = new URL(value.pdf.url, 'https://local.invalid')
    if (url.hash || [...url.searchParams].length !== 1 || url.searchParams.get('file_uri') !== value.pdf.file_uri) return invalid()
  }
  return value
}
