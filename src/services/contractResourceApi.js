import { CONTRACT_API_BASE_PATH, ContractApiError, contractApiFetch } from './contractApi.js'

export async function getContractPdf(fileUri, { signal } = {}) {
  if (typeof fileUri !== 'string' || !/^\/[a-f0-9]{64}\.pdf$/.test(fileUri)) {
    throw new ContractApiError('合同 PDF 资源地址无效')
  }
  const query = new URLSearchParams({ file_uri: fileUri })
  const response = await contractApiFetch(`${CONTRACT_API_BASE_PATH}/resource/contract?${query}`, {
    signal, cache: 'no-store',
  })
  if (response.status !== 200) {
    const payload = await response.json().catch(() => null)
    throw new ContractApiError(
      typeof payload?.detail === 'string' ? payload.detail : `合同 PDF 获取失败（${response.status}）`,
      { status: response.status, payload },
    )
  }
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf') {
    throw new ContractApiError('合同资源未返回 PDF，请重试')
  }
  const blob = await response.blob()
  if (!blob.size) throw new ContractApiError('合同 PDF 内容为空')
  return blob
}
