import { isContractPassports } from './contractPassports.js'

export const deliveryLabels = { pending: '待发送', publishing: '发送中', published: '已发送', uncertain: '发送结果待确认', blocked: '发送受阻' }
export const reviewLabels = { pending_send: '尚未送审', pending_review: '等待审核', approved: '审核通过', rejected: '审核拒绝' }
export const ingestionLabels = { pending: '待处理', ingesting: '入库中', succeeded: '入库成功', failed: '入库失败' }
export const isSubmissionId = value => typeof value === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)
const isTime = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value))
const nullableText = value => value === null || typeof value === 'string'
const nullableTime = value => value === null || isTime(value)
const invalid = () => { throw new Error('审核日志响应格式无效，请刷新重试') }

export function modelReviewIds(value) {
  if (!Array.isArray(value?.submission_ids) || !value.submission_ids.every(isSubmissionId)
    || new Set(value.submission_ids).size !== value.submission_ids.length) return invalid()
  return [...value.submission_ids]
}
export function modelCleanupPolicy(value) {
  if (!value || !Number.isFinite(value.retention_seconds) || value.retention_seconds <= 0
    || !Number.isFinite(value.cleanup_interval_seconds) || value.cleanup_interval_seconds <= 0
    || value.countdown_from !== 'review_processed_at' || !isTime(value.server_time)) return invalid()
  return { ...value }
}
export function modelReviewDetail(value, id) {
  if (!value || value.submission_id !== id || !isSubmissionId(id)
    || !['run_id', 'document_id', 'file_name', 'summary', 'submitted_by', 'note'].every(key => typeof value[key] === 'string')
    || !Number.isInteger(value.page_count) || value.page_count < 1
    || !['created_at', 'updated_at', 'server_time'].every(key => isTime(value[key]))
    || !Object.hasOwn(deliveryLabels, value.delivery?.status) || !nullableText(value.delivery?.message_id)
    || !Object.hasOwn(reviewLabels, value.review?.status)
    || !['note', 'reviewer'].every(key => nullableText(value.review[key])) || !nullableTime(value.review.reviewed_at)
    || !isContractPassports(value.review.passport)
    || !Object.hasOwn(ingestionLabels, value.ingestion?.status) || !nullableTime(value.ingestion.ingested_at)
    || !value.cleanup || !nullableTime(value.cleanup.review_processed_at) || !nullableTime(value.cleanup.eligible_at)
    || typeof value.pdf?.relative_path !== 'string' || typeof value.pdf?.url !== 'string') return invalid()
  return value
}

// 只从允许清理时刻倒计时；服务器时间加单调时钟增量，不受本机时区/时钟偏差影响。
export function cleanupRemainingSeconds(detail, receivedAt, now) {
  if (!detail?.cleanup?.eligible_at) return null
  const serverNow = Date.parse(detail.server_time) + Math.max(0, now - receivedAt)
  return Math.max(0, Math.ceil((Date.parse(detail.cleanup.eligible_at) - serverNow) / 1000))
}
export function formatRetention(seconds) {
  const whole = Math.ceil(seconds)
  const days = Math.floor(whole / 86400), hours = Math.floor(whole % 86400 / 3600)
  const minutes = Math.floor(whole % 3600 / 60), rest = whole % 60
  if (days) return `${days}天 ${hours}小时`
  if (hours) return `${hours}小时 ${minutes}分`
  if (minutes) return `${minutes}分 ${rest}秒`
  return `${rest}秒`
}
export function formatReviewTime(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—'
}
