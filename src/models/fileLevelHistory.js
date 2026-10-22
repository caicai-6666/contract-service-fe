import { isFileLevel, parseIntegerJson } from './fileLevel.js'

export const fileLevelHistoryLabels = { applied: '已更新', skipped_missing: '文件不存在，已跳过' }
const isTime = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value))

export function parseFileLevelHistoryJson(text) {
  return parseIntegerJson(text, ['history_id', 'previous_level', 'new_level'])
}

export function modelFileLevelHistory(payload) {
  if (!Array.isArray(payload)) throw new TypeError('文件权限变更记录必须为数组')
  const ids = new Set()
  return payload.map(item => {
    if (!item || !(typeof item.history_id === 'bigint' || Number.isSafeInteger(item.history_id)) || item.history_id <= 0
      || ids.has(String(item.history_id))
      || typeof item.message_id !== 'string' || !item.message_id.trim()
      || typeof item.document_id !== 'string' || !/^[a-f0-9]{64}$/.test(item.document_id)
      || !isFileLevel(item.previous_level) || item.new_level === null || !isFileLevel(item.new_level)
      || !['reviewer', 'note'].every(key => typeof item[key] === 'string')
      || !Object.hasOwn(fileLevelHistoryLabels, item.status)
      || !isTime(item.created_at) || !isTime(item.processed_at)) {
      throw new TypeError('文件权限变更记录格式无效')
    }
    const id = String(item.history_id)
    ids.add(id)
    return {
      id,
      documentId: item.document_id,
      previousLevel: item.previous_level === null ? null : String(item.previous_level),
      newLevel: String(item.new_level),
      reviewer: item.reviewer,
      note: item.note,
      status: item.status,
      createdAt: item.created_at,
      processedAt: item.processed_at,
    }
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    || (BigInt(a.id) < BigInt(b.id) ? 1 : BigInt(a.id) > BigInt(b.id) ? -1 : 0))
}
