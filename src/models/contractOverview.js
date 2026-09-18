export const CONTRACT_OVERVIEW_STAGE_CODE = 'contract_overview_generation'

export function modelContractOverview(value) {
  if (value == null) return null
  if (typeof value.file_name !== 'string' || !value.file_name.trim()
    || typeof value.summary !== 'string' || !value.summary.trim() || [...value.summary].length > 3000
    || typeof value.reasoning !== 'string' || !Array.isArray(value.evidence)
    || value.evidence.some((item) => !item || !Number.isSafeInteger(item.page_number) || item.page_number < 1 || typeof item.content !== 'string')) {
    throw new TypeError('合同概述响应格式无效，请重新同步任务')
  }
  return {
    file_name: value.file_name,
    summary: value.summary,
    reasoning: value.reasoning,
    evidence: value.evidence.map((item) => ({ page_number: item.page_number, content: item.content })),
  }
}
