/**
 * @typedef {Object} ContractCategory
 * @property {number} categoryId 数据库类别身份
 * @property {string} code 稳定业务编码，不按显示名称推断关联
 * @property {string} name 类别显示名称
 */

/** @returns {ContractCategory[]} */
export function modelContractCategories(payload) {
  if (!Array.isArray(payload)) throw new TypeError('合同类别响应必须是数组')
  const ids = new Set()
  const codes = new Set()
  return payload.map((item) => {
    if (!item || !Number.isSafeInteger(item.category_id)
      || typeof item.code !== 'string' || !item.code.trim()
      || typeof item.name !== 'string' || !item.name.trim()
      || ids.has(item.category_id) || codes.has(item.code)) {
      throw new TypeError('合同类别数据格式无效或身份重复')
    }
    ids.add(item.category_id)
    codes.add(item.code)
    return { categoryId: item.category_id, code: item.code, name: item.name }
  }).sort((left, right) => left.categoryId - right.categoryId)
}
