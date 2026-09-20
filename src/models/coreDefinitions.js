const types = new Set(['string', 'integer', 'number', 'boolean'])
const text = value => typeof value === 'string' && value.trim().length > 0
const numeric = type => type === 'integer' || type === 'number'

export function modelCoreDefinitions(payload) {
  const codes = new Set()
  const valid = Array.isArray(payload) && payload.every(definition => {
    if (!definition || !text(definition.code) || codes.has(definition.code) || !text(definition.name)
      || !['single', 'multiple'].includes(definition.cardinality) || !Array.isArray(definition.properties) || !definition.properties.length) return false
    codes.add(definition.code)
    const properties = new Set()
    return definition.properties.every(property => {
      if (!property || !text(property.code) || properties.has(property.code) || !text(property.name)
        || !types.has(property.type) || typeof property.required !== 'boolean' || !text(property.extraction_rule)) return false
      properties.add(property.code)
      const rules = property.constraints
      if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return false
      for (const key of ['minimum', 'maximum', 'multiple_of']) {
        if (rules[key] !== null && (typeof rules[key] !== 'number' || !Number.isFinite(rules[key]) || !numeric(property.type))) return false
      }
      if (rules.minimum !== null && rules.maximum !== null && rules.minimum > rules.maximum) return false
      if (rules.multiple_of !== null && rules.multiple_of <= 0) return false
      if (rules.enum !== null) {
        if (property.type !== 'string' || !Array.isArray(rules.enum) || !rules.enum.length) return false
        const values = new Set()
        for (const option of rules.enum) {
          if (!option || !text(option.value) || !text(option.label) || values.has(option.value)) return false
          values.add(option.value)
        }
      }
      return true
    })
  })
  if (!valid) throw new TypeError('Core 审核表单定义格式无效')
  return payload
}

export function serializeCoreProperty(value, type) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null
  if (numeric(type) && typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return Number(value)
  if (type === 'boolean' && value === 'true') return true
  if (type === 'boolean' && value === 'false') return false
  // 不截断小数、不将非法类型转换成看似合法的值，交给提交校验提示。
  return value
}

function decimalParts(value) {
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e')
  return { coefficient: BigInt(mantissa.replace('.', '')), scale: (mantissa.split('.')[1]?.length || 0) - Number(exponent) }
}
export function isCoreMultiple(value, multiple) {
  if (!Number.isFinite(value) || !Number.isFinite(multiple) || multiple <= 0) return false
  const a = decimalParts(value), b = decimalParts(multiple)
  const scale = Math.max(a.scale, b.scale)
  // 使用十进制整数计算，对齐服务端 Decimal，避免 0.3 / 0.1 的浮点误差。
  return (a.coefficient * 10n ** BigInt(scale - a.scale)) % (b.coefficient * 10n ** BigInt(scale - b.scale)) === 0n
}

export function validateCoreProperty(property, value) {
  if (value === null || value === undefined) return []
  const rules = property.constraints || {}
  const errors = []
  const fail = (code, message) => errors.push({ code, message })
  if (numeric(property.type)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return [{ code: 'type', message: '必须填写有效数字' }]
    if (property.type === 'integer' && !Number.isInteger(value)) fail('integer', '必须填写整数')
    if (rules.minimum != null && value < rules.minimum) fail('minimum', `不能小于 ${rules.minimum}`)
    if (rules.maximum != null && value > rules.maximum) fail('maximum', `不能大于 ${rules.maximum}`)
    if (rules.multiple_of != null && !isCoreMultiple(value, rules.multiple_of)) fail('multiple', `必须为 ${rules.multiple_of} 的整数倍`)
  } else if (typeof value !== property.type) {
    fail('type', property.type === 'boolean' ? '必须选择“是”或“否”' : '必须填写文字')
  }
  if (rules.enum && !rules.enum.some(option => option.value === value)) fail('enum', '请选择列表中的有效选项')
  return errors
}
