export function parseIntegerJson(text, integerKeys) {
  // 等级没有整数范围限制，读取原始数值文本，避免经过 Number 舍入。
  return JSON.parse(text, (key, value, context) => {
    if (!integerKeys.includes(key) || typeof value !== 'number') return value
    if (context?.source) {
      if (!/^-?\d+$/.test(context.source)) throw new TypeError('文件等级必须为整数')
      return BigInt(context.source)
    }
    if (!Number.isSafeInteger(value)) throw new TypeError('浏览器无法精确读取文件等级')
    return BigInt(value)
  })
}

export function parseFileLevelJson(text) {
  return parseIntegerJson(text, ['file_level'])
}

export function isFileLevel(value) {
  return value === null || typeof value === 'bigint' || Number.isSafeInteger(value)
}

