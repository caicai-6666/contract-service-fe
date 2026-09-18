export function normalizeAuthSession(value) {
  if (!value || typeof value !== 'object') return null
  const loginCode = typeof value.loginCode === 'string' ? value.loginCode.trim() : ''
  const userName = typeof value.userName === 'string' ? value.userName.trim() : ''
  if (!loginCode || !userName) return null
  return { loginCode, userName }
}
