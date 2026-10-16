/** 查询响应只接受完整数组或 null，不改写通行证的原值、顺序和重复项。 */
export function isContractPassports(value) {
  return value === null || Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim().length > 0)
}
