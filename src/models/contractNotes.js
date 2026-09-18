export const CONTRACT_NOTE_MAX_LENGTH = 10000

export function normalizeContractNoteContent(value) {
  if (typeof value !== 'string') throw new TypeError('请输入注意事项正文')
  const content = value.trim()
  // 按 Unicode 码点计数，与后端字符串长度一致，避免将表情计为两个字符。
  if (!content || [...content].length > CONTRACT_NOTE_MAX_LENGTH) {
    throw new TypeError(`注意事项须为 1–${CONTRACT_NOTE_MAX_LENGTH} 个字符`)
  }
  return content
}

export function validateContractNotesDocumentId(documentId) {
  if (typeof documentId !== 'string' || !/^[a-f0-9]{64}$/.test(documentId)) {
    throw new TypeError('合同文档 ID 格式无效')
  }
}

export function modelContractNote(value) {
  if (!value || typeof value.note_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.note_id)
    || typeof value.content !== 'string' || !value.content.trim() || [...value.content.trim()].length > CONTRACT_NOTE_MAX_LENGTH
    || typeof value.author_name !== 'string' || !value.author_name.trim()
    || typeof value.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|\+00:00)$/.test(value.created_at)
    || !Number.isFinite(Date.parse(value.created_at))) throw new TypeError('注意事项响应格式无效')
  return { note_id: value.note_id, content: value.content, author_name: value.author_name, created_at: value.created_at }
}

export function modelContractNotes(payload) {
  if (!Array.isArray(payload)) throw new TypeError('注意事项列表必须是数组')
  const notes = payload.map(modelContractNote)
  if (new Set(notes.map((note) => note.note_id)).size !== notes.length) throw new TypeError('注意事项标识重复')
  return notes.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.note_id.localeCompare(b.note_id))
}
