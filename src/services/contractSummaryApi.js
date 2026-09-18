import { CONTRACT_API_BASE_PATH, ContractApiError, contractApiFetch } from './contractApi.js'

export async function getContractSummary(documentId, { signal } = {}) {
  if (typeof documentId !== 'string' || !/^[a-f0-9]{64}$/.test(documentId)) {
    throw new ContractApiError('合同文档 ID 格式无效', { status: 422 })
  }
  let response
  try {
    response = await contractApiFetch(`${CONTRACT_API_BASE_PATH}/contract/documents/${documentId}/summary`, { method: 'GET', signal, cache: 'no-store' })
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof ContractApiError) throw error
    throw new ContractApiError('无法连接摘要服务，请重试')
  }
  const payload = await response.json().catch((error) => {
    if (error.name === 'AbortError') throw error
    return null
  })
  if (response.status !== 200) {
    const messages = {
      401: '登录已失效，请重新登录',
      404: '该合同已不存在，请关闭预览并刷新目录',
      409: '合同尚未完成入库，暂时无法读取摘要',
      422: '合同文档 ID 格式无效',
    }
    throw new ContractApiError(
      typeof payload?.detail === 'string' && payload.detail.trim()
        ? payload.detail : messages[response.status] || `摘要加载失败（${response.status}），请重试`,
      { status: response.status, payload },
    )
  }
  if (payload?.document_id !== documentId || !(payload.summary === null || typeof payload.summary === 'string')) {
    throw new ContractApiError('合同摘要响应格式无效，请重试', { status: response.status })
  }
  // null 是尚未生成，与合同不存在或响应异常区分；已有文字保持原样。
  return payload.summary
}
