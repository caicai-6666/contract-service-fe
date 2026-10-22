export function normalizeAuthSession(value) {
  if (!value || typeof value !== 'object') return null
  if (typeof value.userid !== 'string' || !value.userid.trim()) return null
  if (typeof value.username !== 'string' || !value.username.trim()) return null
  if (!Number.isInteger(value.ttl) || value.ttl <= 0) return null
  return { userId: value.userid, userName: value.username, ttl: value.ttl }
}
