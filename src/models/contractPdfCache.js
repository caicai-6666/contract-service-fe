// 按处理版 PDF 地址复用文件；限制数量和总字节数，避免长期占用过多内存。
export function createContractPdfCache({ maxEntries = 5, maxBytes = 100 * 1024 * 1024 } = {}) {
  const entries = new Map()
  let bytes = 0
  function remove(key) {
    const blob = entries.get(key)
    if (!blob) return
    bytes -= blob.size
    entries.delete(key)
  }
  return {
    get(key) {
      const blob = entries.get(key)
      if (blob) { entries.delete(key); entries.set(key, blob) }
      return blob
    },
    set(key, blob) {
      remove(key)
      if (!blob.size || blob.size > maxBytes || maxEntries < 1) return
      while (entries.size >= maxEntries || bytes + blob.size > maxBytes) remove(entries.keys().next().value)
      entries.set(key, blob)
      bytes += blob.size
    },
    remove,
    retain(keys) {
      const retained = new Set(keys)
      for (const key of entries.keys()) if (!retained.has(key)) remove(key)
    },
    clear() { entries.clear(); bytes = 0 },
  }
}
