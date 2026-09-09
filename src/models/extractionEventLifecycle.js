const followupStageCodes = new Set([
  'contract_document_detection',
  'pdf_deduplication',
  'core_extraction',
  'clause_extraction',
])

export function awaitsExtractionFollowup(event) {
  // 阶段完成可能已携带终态，但识别/查重详情或草稿由后续事件发布。
  return event?.event_type === 'stage.completed' && followupStageCodes.has(event.stage?.code)
}
