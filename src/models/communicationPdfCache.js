import { createContractPdfCache } from './contractPdfCache.js'

// 文件按会话隔离；关闭预览不取消共享下载，卸载或删除会话时才释放。
export function createCommunicationPdfCache(options = {}) {
  const files = createContractPdfCache({ maxEntries: 20, maxBytes: 100 * 1024 * 1024, ...options })
  const pending = new Map()
  const keyFor = (conversationId, fileId) => JSON.stringify([conversationId, fileId])

  function discard(predicate) {
    for (const [key, entry] of pending) {
      if (!predicate(key)) continue
      entry.controller.abort()
      pending.delete(key)
    }
  }

  return {
    load(conversationId, fileId, loader) {
      const key = keyFor(conversationId, fileId)
      const cached = files.get(key)
      if (cached) return Promise.resolve(cached)
      if (pending.has(key)) return pending.get(key).promise
      const controller = new AbortController()
      const entry = { controller }
      entry.promise = Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return loader(controller.signal)
      }).then(blob => {
        controller.signal.throwIfAborted()
        files.set(key, blob)
        return blob
      }).finally(() => {
        if (pending.get(key) === entry) pending.delete(key)
      })
      pending.set(key, entry)
      return entry.promise
    },
    removeConversation(conversationId) {
      discard(key => JSON.parse(key)[0] === conversationId)
      files.removeWhere(key => JSON.parse(key)[0] === conversationId)
    },
    clear() {
      discard(() => true)
      files.clear()
    },
  }
}
