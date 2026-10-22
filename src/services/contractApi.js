import { normalizeAuthSession } from '../models/authSession.js'

const ACCESS_TOKEN_STORAGE_KEY = 'access_token'
const AUTH_EXPIRED_EVENT = 'contract-auth-expired'
const ACCESS_DENIED_EVENT = 'contract-access-denied'
const CONTRACT_API_BASE_PATH = `${import.meta.env.BASE_URL}api`
const KNOWLEDGE_ENTRY_PATH = import.meta.env.BASE_URL.slice(0, -'contract/'.length)

let memorySession = null
let validatedToken = null

export class ContractApiError extends Error {
  constructor(message, { status = 0, payload = null } = {}) {
    super(message)
    this.name = 'ContractApiError'
    this.status = status
    this.payload = payload
  }
}

export function getAccessToken() {
  try {
    const token = window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)
    return typeof token === 'string' && /^[\x21-\x7e]+$/.test(token) ? token : null
  } catch {
    return null
  }
}

export function getAuthSession() {
  return validatedToken && validatedToken === getAccessToken() ? memorySession : null
}

export function clearAuthSession() {
  memorySession = null
  validatedToken = null
}

function notifyAuthFailure(status, requestToken) {
  // 旧凭据请求的迟到响应不能覆盖统一入口刚更新的身份。
  if (requestToken !== getAccessToken()) return
  clearAuthSession()
  window.dispatchEvent(new CustomEvent(status === 403 ? ACCESS_DENIED_EVENT : AUTH_EXPIRED_EVENT))
}

export async function contractApiFetch(input, init = {}) {
  const target = typeof input === 'string' ? new URL(input, 'https://contract.invalid') : null
  if (!target || !input.startsWith('/') || input.startsWith('//')
    || target.origin !== 'https://contract.invalid' || target.hash
    || !target.pathname.startsWith(`${CONTRACT_API_BASE_PATH}/`)) {
    throw new TypeError('受保护请求只能访问合同平台 API')
  }

  const token = getAccessToken()
  if (!token) {
    notifyAuthFailure(401, token)
    throw new ContractApiError('请从知识沉淀入口进入', { status: 401 })
  }

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(input, { ...init, headers, redirect: 'error' })
  if (response.status === 401 || response.status === 403) notifyAuthFailure(response.status, token)
  return response
}

export async function fetchCurrentUser({ signal } = {}) {
  const token = getAccessToken()
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => controller.abort(new DOMException('身份确认超时，请稍后重试', 'TimeoutError')), 15000)

  try {
    const response = await contractApiFetch(`${CONTRACT_API_BASE_PATH}/auth/me`, {
      method: 'GET', cache: 'no-store', signal: controller.signal,
    })
    const payload = await response.json().catch(() => {
      if (controller.signal.aborted) throw controller.signal.reason
      return null
    })
    controller.signal.throwIfAborted()
    if (token !== getAccessToken()) throw new DOMException('登录身份已变化', 'AbortError')
    if (!response.ok) {
      throw new ContractApiError(typeof payload?.detail === 'string' ? payload.detail : '暂时无法确认登录状态，请稍后重试', {
        status: response.status, payload,
      })
    }
    const session = normalizeAuthSession(payload)
    if (!session) throw new ContractApiError('用户服务返回了无效的身份信息，请稍后重试')
    memorySession = session
    validatedToken = token
    return session
  } catch (error) {
    if (!signal?.aborted && token !== getAccessToken()) throw new DOMException('登录身份已变化', 'AbortError')
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

export { ACCESS_TOKEN_STORAGE_KEY, AUTH_EXPIRED_EVENT, ACCESS_DENIED_EVENT, CONTRACT_API_BASE_PATH, KNOWLEDGE_ENTRY_PATH }
