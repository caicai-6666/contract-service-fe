function isContractDate(value) {
  if (value === null) return true
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** 将正式合同目录映射为前端模型；保留服务端目录顺序和原始类别说明。 */
export function modelContractDocuments(payload) {
  if (!Array.isArray(payload)) throw new TypeError('合同目录响应必须是数组')
  const ids = new Set()
  return payload.map((item) => {
    if (!item || typeof item.document_id !== 'string' || !/^[a-f0-9]{64}$/.test(item.document_id)
      || ids.has(item.document_id)
      || !['file_name', 'category', 'file_uri', 'reviewer', 'ingested_at'].every((key) => typeof item[key] === 'string')
      || !item.file_name.trim() || !item.reviewer.trim()
      || !item.file_uri.startsWith('/') || item.file_uri.startsWith('//')
      || !isContractDate(item.contract_time)
      || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(item.ingested_at)
      || !Number.isFinite(Date.parse(item.ingested_at))) {
      throw new TypeError('合同元数据格式无效或文档身份重复')
    }
    ids.add(item.document_id)
    return {
      id: item.document_id,
      name: item.file_name,
      categoryRaw: item.category,
      categoryTokens: [...new Set(item.category.split('/').map((code) => code.trim()).filter(Boolean))],
      date: item.contract_time,
      fileUri: item.file_uri,
      reviewer: item.reviewer,
      ingestedAt: item.ingested_at,
    }
  })
}

export function resolveDocumentCategories(document, categories) {
  const byCode = new Map(categories.map((category) => [category.code, category]))
  return {
    ...document,
    categoryCodes: document.categoryTokens.filter((code) => byCode.has(code)),
    type: document.categoryTokens.map((code) => byCode.get(code)?.name ?? code).join(' / ') || document.categoryRaw || '—',
  }
}

export function filterContractDocuments(documents, { categoryCode = null, year = '', month = '', day = '', reviewer = null } = {}) {
  return documents.filter((document) => {
    if (categoryCode !== null && !document.categoryCodes.includes(categoryCode)) return false
    if (reviewer !== null && document.reviewer !== reviewer) return false
    if (!document.date) return !year
    return (!year || document.date.slice(0, 4) === String(year))
      && (!month || Number(document.date.slice(5, 7)) === Number(month))
      && (!day || Number(document.date.slice(8, 10)) === Number(day))
  })
}

/** 日期展示使用浏览器本地时区，原始带时区时间仍保留用于 datetime。 */
export function formatIngestionDate(value) {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
