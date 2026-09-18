import { CONTRACT_API_BASE_PATH, ContractApiError, contractApiFetch } from './contractApi.js'
import { getContractDocuments, getContractCategories } from './contractLibraryApi.js'
import { resolveDocumentCategories } from '../models/contractDocuments.js'
import { normalizeContractNetwork } from '../models/contractNetwork.js'

export async function getNetworkDocuments({ signal } = {}) {
  const [documents, categories] = await Promise.all([getContractDocuments({ signal }), getContractCategories({ signal })])
  signal?.throwIfAborted()
  return documents.map(document => ({
    ...document,
    document_id: document.id,
    file_name: document.name,
    category: resolveDocumentCategories(document, categories).type,
  }))
}

export async function getContractRelations(documentId, { signal } = {}) {
  if (typeof documentId !== 'string' || !/^[a-f0-9]{64}$/.test(documentId)) {
    throw new ContractApiError('合同文档 ID 格式无效', { status: 422 })
  }
  let response
  try {
    response = await contractApiFetch(`${CONTRACT_API_BASE_PATH}/contract/documents/${documentId}/relations`, { method: 'GET', signal, cache: 'no-store' })
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof ContractApiError) throw error
    throw new ContractApiError('无法连接合同关联服务，请重试')
  }
  const payload = await response.json().catch(error => {
    if (error.name === 'AbortError') throw error
    return null
  })
  signal?.throwIfAborted()
  if (response.status !== 200) {
    const messages = {
      401: '登录已失效，请重新登录',
      404: '该合同不存在或已删除，请刷新合同列表',
      409: '该合同正在入库、删除或关系图待同步，请稍后重试',
      422: '合同文档 ID 格式无效',
      502: '合同关联服务暂时不可用，请稍后重试',
    }
    throw new ContractApiError(messages[response.status] || `关系网加载失败（${response.status}），请重试`, { status: response.status, payload })
  }
  if (!Array.isArray(payload) || payload.some(item => !item
    || typeof item.relation_id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(item.relation_id)
    || typeof item.document_id !== 'string' || !/^[a-f0-9]{64}$/.test(item.document_id)
    || typeof item.description !== 'string' || typeof item.created_by !== 'string'
    || typeof item.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(item.created_at)
    || !Number.isFinite(Date.parse(item.created_at)))) {
    throw new ContractApiError('合同关联响应格式无效，请重试', { status: response.status })
  }
  return payload
}

export async function getContractNetwork(documentId, documents, { signal } = {}) {
  const relations = await getContractRelations(documentId, { signal })
  const ids = new Set([documentId, ...relations.map(item => item.document_id)])
  let byId = new Map(documents.map(document => [document.document_id, document]))
  if ([...ids].some(id => !byId.has(id))) {
    // 一次查询最多补拉一次目录，避免并发删除造成无限刷新或缺名节点。
    documents = await getNetworkDocuments({ signal })
    byId = new Map(documents.map(document => [document.document_id, document]))
  }
  signal?.throwIfAborted()
  if ([...ids].some(id => !byId.has(id))) {
    throw new ContractApiError('合同列表刷新后仍缺少部分合同，可能已被删除或状态变化，请重试', { status: 404 })
  }
  return {
    documents,
    network: normalizeContractNetwork({
      center_document_id: documentId,
      nodes: [...ids].map(id => byId.get(id)),
      // 两端排序保证反向探索时边的空间方向稳定，不改变用户填写的描述。
      edges: relations.map(item => {
        const [source_document_id, target_document_id] = [documentId, item.document_id].sort()
        return { relation_id: item.relation_id, source_document_id, target_document_id, description: item.description, created_at: item.created_at, created_by: item.created_by }
      }),
    }),
  }
}
