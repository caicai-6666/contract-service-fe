import { CONTRACT_API_BASE_PATH, ContractApiError, contractApiFetch } from './contractApi.js'
import { modelContractCategories } from '../models/contractCategories.js'
import { modelContractDocuments } from '../models/contractDocuments.js'

export async function deleteContractDocument(documentId) {
  if (typeof documentId !== 'string' || !/^[a-f0-9]{64}$/.test(documentId)) throw new ContractApiError('合同文档 ID 格式无效', { status: 422 })
  const response = await contractApiFetch(`${CONTRACT_API_BASE_PATH}/contract/documents/${documentId}`, { method: 'DELETE' })
  if (response.status === 204) return
  const messages = {
    401: '登录已失效，请重新登录',
    403: '服务端拒绝删除合同，请刷新登录后重试',
    404: '该合同已不存在，请关闭预览并刷新目录',
    409: '合同尚未完成入库，暂时不能删除',
    422: '合同文档 ID 格式无效',
    502: '存储清理失败，可能已部分删除。请重试删除以继续清理同一份合同。',
  }
  throw new ContractApiError(messages[response.status] || `删除结果未确认（${response.status}），请刷新目录核对或重试`, { status: response.status })
}

export async function getContractDocuments({ signal } = {}) {
  const response = await contractApiFetch(`${CONTRACT_API_BASE_PATH}/contract/documents`, { signal, cache: 'no-store' })
  const payload = await response.json().catch(() => null)
  if (response.status !== 200) {
    throw new ContractApiError(
      typeof payload?.detail === 'string' && payload.detail.trim()
        ? payload.detail : `合同目录加载失败（${response.status}）`,
      { status: response.status, payload },
    )
  }
  try {
    return modelContractDocuments(payload)
  } catch {
    throw new ContractApiError('合同目录响应格式无效，请重试', { status: response.status, payload })
  }
}

export async function getContractCategories({ signal } = {}) {
  const response = await contractApiFetch(`${CONTRACT_API_BASE_PATH}/contract/categories`, { signal })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ContractApiError(
      typeof payload?.detail === 'string' && payload.detail.trim()
        ? payload.detail
        : `合同类别加载失败（${response.status}）`,
      { status: response.status, payload },
    )
  }
  try {
    return modelContractCategories(payload)
  } catch {
    throw new ContractApiError('合同类别响应格式无效，请重试', { status: response.status, payload })
  }
}
