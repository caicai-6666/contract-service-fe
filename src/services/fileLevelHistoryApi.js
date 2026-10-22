import { CONTRACT_API_BASE_PATH, ContractApiError, contractApiFetch } from './contractApi.js'
import { modelFileLevelHistory, parseFileLevelHistoryJson } from '../models/fileLevelHistory.js'

export async function getFileLevelHistory({ signal } = {}) {
  let response
  try {
    response = await contractApiFetch(`${CONTRACT_API_BASE_PATH}/contract/file-level-history`, {
      method: 'GET', signal, cache: 'no-store',
    })
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof ContractApiError) throw error
    throw new ContractApiError('无法连接文件权限变更服务，请稍后重试')
  }
  const payload = await response.text().then(parseFileLevelHistoryJson).catch(() => null)
  if (response.status !== 200) {
    throw new ContractApiError(typeof payload?.detail === 'string' ? payload.detail : `文件权限变更记录读取失败（${response.status}）`, {
      status: response.status, payload,
    })
  }
  try {
    return modelFileLevelHistory(payload)
  } catch {
    throw new ContractApiError('文件权限变更记录响应格式无效，请刷新重试', { status: response.status })
  }
}
