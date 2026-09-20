const progressTypes = new Set(['online-search', 'local-search', 'external-expert', 'thinking'])

export function validateTaskProgress(progress) {
  if (!progress || !progressTypes.has(progress.type)
    || typeof progress.message !== 'string' || !progress.message.trim()
    || Array.from(progress.message).length > 2000) throw new Error('对话进度类型或说明无效，请恢复快照')
}

export function taskProgressPresentation(progress, active = true) {
  validateTaskProgress(progress)
  let text = active ? progress.message : progress.message.replace(/^(\s*)正在/, '$1已')
  const colonIndex = text.search(/[:：]/)
  if (colonIndex >= 0) {
    const detail = Array.from(text.slice(colonIndex + 1))
    if (detail.length > 15) text = `${text.slice(0, colonIndex + 1)}${detail.slice(0, 15).join('')}…`
  }
  return { type: progress.type, text, thinking: progress.type === 'thinking' }
}
