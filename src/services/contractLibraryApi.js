import { invalidateContractData, invalidateReviewData } from './contractDataRevision.js'
import { CONTRACT_API_BASE_PATH, ContractApiError, contractApiFetch } from './contractApi.js'
import { modelContractCategories } from '../models/contractCategories.js'
import { modelContractDocuments, parseContractDocumentsJson } from '../models/contractDocuments.js'
import { isSubmissionId } from '../models/pendingReviews.js'

export async function deleteContractDocument(documentId, { note } = {}) {
  if (typeof documentId !== 'string' || !/^[a-f0-9]{64}$/.test(documentId)) throw new ContractApiError('合同文档 ID 格式无效', { status: 422 })
  if (typeof note !== 'string' || [...note].length > 10000) throw new ContractApiError('申请备注必须为文字且不能超过 10000 个字符', { status: 422 })
  const response = await contractApiFetch(`${CONTRACT_API_BASE_PATH}/contract/documents/${documentId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  }).finally(() => { invalidateContractData(); invalidateReviewData('deletion') })
  const payload = await response.json().catch(() => null)
  if (response.status === 202) {
    if (!isSubmissionId(payload?.submission_id) || payload.document_id !== documentId
      || payload.review_status !== 'pending_send' || payload.can_delete !== false) {
      throw new ContractApiError('删除申请回执格式无效，请刷新合同目录或在信箱中核对申请结果', { status: response.status })
    }
    return payload
  }
  const messages = {
    401: '登录已失效，请重新登录',
    403: '服务端拒绝删除申请，请刷新登录后重试',
    404: '该合同已不存在，请关闭预览并刷新目录',
    409: '合同当前不可申请删除，可能尚未就绪或已有删除申请，请刷新目录核对',
    422: '合同文档 ID 或申请备注不符合要求，请检查后重试',
    503: '删除申请保存结果未确认，请先在信箱中核对申请，再刷新合同目录',
  }
  throw new ContractApiError(typeof payload?.detail === 'string' && payload.detail.trim() ? payload.detail : messages[response.status] || `删除申请结果未确认（${response.status}），请刷新目录或在信箱中核对`, { status: response.status, payload })
}

export async function getContractDocuments({ signal } = {}) {
  const response = await contractApiFetch(`${CONTRACT_API_BASE_PATH}/contract/documents`, { signal, cache: 'no-store' })
  const payload = await response.text().then(parseContractDocumentsJson).catch(() => null)
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
