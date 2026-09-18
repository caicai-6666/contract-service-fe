import { CONTRACT_API_BASE_PATH, ContractApiError, contractApiFetch } from './contractApi.js'

const documentPattern = /^[a-f0-9]{64}$/
const relationPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i

function failure(response, payload, creating) {
  const messages = {
    401: '登录已失效，请重新登录',
    404: creating ? '其中一份合同不存在或已删除，请刷新合同列表' : '该关联已不存在，请刷新关联列表核对',
    409: '两份合同已有关系，或合同正在处理、关系图待同步，请刷新核对后重试',
    422: creating ? '合同标识或描述不符合要求，请检查后重试' : '关联标识格式无效，请刷新列表',
    502: '合同关联服务暂时不可用，请稍后重试',
  }
  return new ContractApiError(messages[response.status] || '操作结果未确认，请刷新关联列表核对', { status: response.status, payload })
}

export async function createContractRelation({ document_id_a, document_id_b, description }) {
  if (![document_id_a, document_id_b].every(id => typeof id === 'string' && documentPattern.test(id)) || document_id_a === document_id_b) {
    throw new ContractApiError('请选择两份不同的正式合同', { status: 422 })
  }
  if (typeof description !== 'string' || !description.trim() || Array.from(description.trim()).length > 10000) {
    throw new ContractApiError('关联描述去除首尾空白后须为 1–10000 字', { status: 422 })
  }
  let response
  // 写操作不自动重试或主动取消；响应丢失时先查询确认实际结果。
  try {
    response = await contractApiFetch(`${CONTRACT_API_BASE_PATH}/contract/relations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_id_a, document_id_b, description: description.trim() }),
    })
  } catch (error) {
    if (error instanceof ContractApiError) throw error
    throw new ContractApiError('连接中断，新增结果未确认，请刷新关联列表核对后再提交')
  }
  const payload = await response.json().catch(() => null)
  if (response.status !== 201) throw failure(response, payload, true)
  const endpoints = [document_id_a, document_id_b].sort()
  if (!payload || !relationPattern.test(payload.relation_id) || payload.document_id_a !== endpoints[0] || payload.document_id_b !== endpoints[1]
    || typeof payload.description !== 'string' || !payload.description.trim() || Array.from(payload.description).length > 10000
    || typeof payload.created_by !== 'string' || typeof payload.created_at !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(payload.created_at) || !Number.isFinite(Date.parse(payload.created_at))) {
    throw new ContractApiError('服务已接受提交，但返回记录格式无效，请刷新关联列表核对后再提交', { status: response.status })
  }
  return payload
}

export async function deleteContractRelation(relationId) {
  if (typeof relationId !== 'string' || !relationPattern.test(relationId)) throw new ContractApiError('关联标识格式无效', { status: 422 })
  let response
  try {
    response = await contractApiFetch(`${CONTRACT_API_BASE_PATH}/contract/relations/${relationId.toLowerCase()}`, { method: 'DELETE' })
  } catch (error) {
    if (error instanceof ContractApiError) throw error
    throw new ContractApiError('连接中断，删除结果未确认，请刷新关联列表核对')
  }
  if (response.status === 204) return
  throw failure(response, await response.json().catch(() => null), false)
}
