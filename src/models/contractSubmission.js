export function modelSubmissionReceipt(value) {
  if (!value || value.status !== 'submitted'
    || typeof value.submission_id !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value.submission_id)
    || typeof value.document_id !== 'string' || !/^[a-f0-9]{64}$/.test(value.document_id)
    || typeof value.file_name !== 'string' || !value.file_name.trim()
    || !Number.isInteger(value.page_count) || value.page_count < 1
    || typeof value.submitted_by !== 'string' || !value.submitted_by.trim()
    || typeof value.submitted_at !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(value.submitted_at) || !Number.isFinite(Date.parse(value.submitted_at))
    || typeof value.review_status !== 'string' || !value.review_status
    || typeof value.ingestion_status !== 'string' || !value.ingestion_status) {
    throw new Error('送审回执格式无效，请使用相同内容重新获取回执')
  }
  return { ...value }
}
