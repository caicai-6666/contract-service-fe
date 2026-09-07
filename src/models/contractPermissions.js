export function getContractPermissions(level) {
  return {
    canView: [1, 2, 3].includes(level),
    canCreate: level === 1 || level === 2,
    canDelete: level === 1,
  }
}

export function normalizeAuthSession(value) {
  if (!value || typeof value !== 'object') return null
  const loginCode = typeof value.loginCode === 'string' ? value.loginCode.trim() : ''
  const userName = typeof value.userName === 'string' ? value.userName.trim() : ''
  if (!loginCode || !userName || !getContractPermissions(value.permissionLevel).canView) return null
  return { loginCode, userName, permissionLevel: value.permissionLevel }
}
