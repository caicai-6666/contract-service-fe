import { normalizeAuthSession } from '../models/contractPermissions.js'

const AUTH_STORAGE_KEY = 'contract-reviewer-session'
const AUTH_EXPIRED_EVENT = 'contract-auth-expired'
const CONTRACT_API_BASE_PATH = `${import.meta.env.DEV ? '/dev' : ''}/contract/api`

let memorySession = null

export class ContractApiError extends Error {
  constructor(message, { status = 0, payload = null } = {}) {
    super(message)
    this.name = 'ContractApiError'
    this.status = status
    this.payload = payload
  }
}

function readResponsePayload(response) {
  return response.json().catch(() => null)
}

function errorMessage(payload, fallback) {
  if (typeof payload?.detail === 'string' && payload.detail.trim()) return payload.detail.trim()
  return fallback
}

export function getAuthSession() {
  if (memorySession) return memorySession

  try {
    const storedSession = normalizeAuthSession(JSON.parse(window.sessionStorage.getItem(AUTH_STORAGE_KEY)))
    if (storedSession) memorySession = storedSession
    else window.sessionStorage.removeItem(AUTH_STORAGE_KEY)
  } catch {
    try {
      window.sessionStorage.removeItem(AUTH_STORAGE_KEY)
    } catch {
      // 浏览器禁用会话存储时回退到内存会话。
    }
  }

  return memorySession
}

export function saveAuthSession(session) {
  const normalizedSession = normalizeAuthSession(session)
  if (!normalizedSession) throw new TypeError('登录响应缺少有效的免登码、审核人名称或权限等级')

  memorySession = normalizedSession
  try {
    window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalizedSession))
  } catch {
    // 浏览器禁用会话存储时，当前页面生命周期内仍可使用内存会话。
  }

  return normalizedSession
}

export function clearAuthSession() {
  memorySession = null
  try {
    window.sessionStorage.removeItem(AUTH_STORAGE_KEY)
  } catch {
    // 清理内存会话已经足以使当前页面退出登录。
  }
}

export async function loginWithSecretKey(secretKey, { signal } = {}) {
  const response = await fetch(`${CONTRACT_API_BASE_PATH}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret_key: secretKey }),
    signal,
  })
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    const fallback = response.status === 401
      ? '审核用户密钥无效'
      : response.status === 422
        ? '密钥格式不正确，请检查后重试'
        : `登录服务暂时不可用（${response.status}）`
    throw new ContractApiError(errorMessage(payload, fallback), {
      status: response.status,
      payload,
    })
  }

  const session = normalizeAuthSession({
    loginCode: payload?.login_code,
    userName: payload?.user_name,
    permissionLevel: payload?.permission_level,
  })
  if (!session) {
    throw new ContractApiError('登录服务返回了无效的会话信息', {
      status: response.status,
      payload,
    })
  }

  return saveAuthSession(session)
}

export async function contractApiFetch(input, init = {}) {
  const session = getAuthSession()
  if (!session) throw new ContractApiError('登录状态已失效，请重新登录', { status: 401 })

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${session.loginCode}`)
  const response = await fetch(input, { ...init, headers })

  if (response.status === 401) {
    clearAuthSession()
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
  }

  return response
}

export { AUTH_EXPIRED_EVENT, CONTRACT_API_BASE_PATH }
