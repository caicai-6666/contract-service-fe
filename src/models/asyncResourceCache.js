// 组件生命周期内复用成功结果及在途请求；失败不缓存，清空后旧请求不得回填。
export function createAsyncResourceCache(limit = 100) {
  const entries = new Map()
  return {
    has: key => entries.has(key),
    load(key, loader) {
      if (entries.has(key)) {
        const entry = entries.get(key)
        entries.delete(key); entries.set(key, entry)
        return entry.promise
      }
      const controller = new AbortController()
      const entry = { controller }
      entry.promise = Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return loader(controller.signal)
      }).then(value => {
        controller.signal.throwIfAborted()
        return value
      }).catch(error => {
        if (entries.get(key) === entry) entries.delete(key)
        throw error
      })
      entries.set(key, entry)
      while (entries.size > limit) {
        const oldest = entries.keys().next().value
        entries.get(oldest).controller.abort()
        entries.delete(oldest)
      }
      return entry.promise
    },
    clear() {
      for (const entry of entries.values()) entry.controller.abort()
      entries.clear()
    },
  }
}
