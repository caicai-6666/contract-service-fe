const progressLabels = Object.freeze({
  'online-search': '正在联网检索',
  'local-search': '正在查阅资料',
  thinking: '正在思考',
})

export function validateTaskProgress(progress) {
  if (!progress || !Object.hasOwn(progressLabels, progress.type)
    || typeof progress.message !== 'string' || !progress.message.trim()
    || Array.from(progress.message).length > 2000) throw new Error('对话进度类型或说明无效，请恢复快照')
}

export function taskProgressPresentation(progress) {
  validateTaskProgress(progress)
  return { type: progress.type, text: progressLabels[progress.type], thinking: progress.type === 'thinking' }
}
