import {
  CONTRACT_API_BASE_PATH,
  ContractApiError,
  contractApiFetch,
} from './contractApi.js'

const EXTRACTION_RUNS_PATH = `${CONTRACT_API_BASE_PATH}/contract/extraction-runs`
const CORE_DEFINITIONS_PATH = `${CONTRACT_API_BASE_PATH}/contract/core-definitions`
const CONTRACT_RESOURCE_PATH = `${CONTRACT_API_BASE_PATH}/resource/contract`

async function responsePayload(response) {
  return response.json().catch(() => null)
}

function responseErrorMessage(payload, fallback) {
  if (typeof payload?.detail === 'string' && payload.detail.trim()) return payload.detail.trim()
  return fallback
}

async function requireJsonResponse(response, acceptedStatuses) {
  const payload = await responsePayload(response)
  if (!acceptedStatuses.includes(response.status)) {
    throw new ContractApiError(
      responseErrorMessage(payload, `合同处理服务请求失败（${response.status}）`),
      { status: response.status, payload },
    )
  }
  if (!payload || typeof payload !== 'object') {
    throw new ContractApiError('合同处理服务返回了无效响应', {
      status: response.status,
      payload,
    })
  }
  return payload
}

function runPath(runId, suffix = '') {
  return `${EXTRACTION_RUNS_PATH}/${encodeURIComponent(runId)}${suffix}`
}

export async function createExtractionRun(file, { signal, fileName = file.name } = {}) {
  const query = new URLSearchParams({ file_name: fileName })
  const response = await contractApiFetch(`${EXTRACTION_RUNS_PATH}?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: file,
    signal,
  })
  return requireJsonResponse(response, [202])
}

export async function listExtractionRuns({ signal } = {}) {
  const response = await contractApiFetch(EXTRACTION_RUNS_PATH, { signal })
  const payload = await requireJsonResponse(response, [200])
  const supportedStatuses = new Set(['processing', 'blocked'])
  const isValid = Array.isArray(payload) && payload.every((run) => (
    run
    && typeof run.run_id === 'string'
    && run.run_id
    && run.document
    && typeof run.document.file_name === 'string'
    && run.document.file_name
    && Number.isInteger(run.document.processed_file_size_bytes)
    && run.document.processed_file_size_bytes >= 1
    && Number.isInteger(run.document.page_count)
    && run.document.page_count >= 1
    && Number.isInteger(run.document.cover_width_pixels)
    && run.document.cover_width_pixels >= 1
    && Number.isInteger(run.document.cover_height_pixels)
    && run.document.cover_height_pixels >= 1
    && supportedStatuses.has(run.status)
    && typeof run.created_at === 'string'
    && typeof run.updated_at === 'string'
    && typeof run.expires_at === 'string'
  ))

  if (!isValid) {
    throw new ContractApiError('后台处理任务列表格式无效', {
      status: response.status,
      payload,
    })
  }
  return payload
}

export async function getCoreDefinitions({ signal } = {}) {
  const response = await contractApiFetch(CORE_DEFINITIONS_PATH, { signal })
  const payload = await requireJsonResponse(response, [200])
  const supportedTypes = new Set(['string', 'integer', 'number', 'boolean'])
  const definitionCodes = new Set()
  const isValid = Array.isArray(payload) && payload.every((definition) => {
    if (
      !definition
      || typeof definition.code !== 'string'
      || !definition.code
      || definitionCodes.has(definition.code)
      || typeof definition.name !== 'string'
      || !['single', 'multiple'].includes(definition.cardinality)
      || !Array.isArray(definition.properties)
      || !definition.properties.length
    ) return false

    definitionCodes.add(definition.code)
    const propertyCodes = new Set()
    return definition.properties.every((property) => {
      if (
        !property
        || typeof property.code !== 'string'
        || !property.code
        || propertyCodes.has(property.code)
        || typeof property.name !== 'string'
        || !supportedTypes.has(property.type)
        || typeof property.required !== 'boolean'
      ) return false
      propertyCodes.add(property.code)
      return true
    })
  })

  if (!isValid) {
    throw new ContractApiError('Core 审核表单定义格式无效', {
      status: response.status,
      payload,
    })
  }
  return payload
}

export async function getExtractionSnapshot(runId, { signal } = {}) {
  const response = await contractApiFetch(runPath(runId), { signal })
  return requireJsonResponse(response, [200])
}

export async function cancelExtractionRun(runId, { signal } = {}) {
  const response = await contractApiFetch(runPath(runId), {
    method: 'DELETE',
    signal,
  })
  if (response.status === 204) return

  const payload = await responsePayload(response)
  throw new ContractApiError(
    responseErrorMessage(payload, `取消合同处理任务失败（${response.status}）`),
    { status: response.status, payload },
  )
}

export async function continueExtractionRun(runId, { signal } = {}) {
  const response = await contractApiFetch(runPath(runId, '/continue'), {
    method: 'POST',
    signal,
  })
  return requireJsonResponse(response, [202])
}

export async function retryExtractionStage(runId, stageCode, { signal } = {}) {
  const response = await contractApiFetch(
    runPath(runId, `/stages/${encodeURIComponent(stageCode)}/retry`),
    { method: 'POST', signal },
  )
  return requireJsonResponse(response, [202])
}

export async function ingestExtractionRun(runId, draft, { signal } = {}) {
  const response = await contractApiFetch(runPath(runId, '/ingestion'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
    signal,
  })
  return requireJsonResponse(response, [201])
}

export async function getDeduplicationCandidatePdf(fileUri, { signal } = {}) {
  if (typeof fileUri !== 'string' || !fileUri.trim()) {
    throw new ContractApiError('候选 PDF 缺少有效的资源地址')
  }
  const query = new URLSearchParams({ file_uri: fileUri })
  const response = await contractApiFetch(
    `${CONTRACT_RESOURCE_PATH}?${query}`,
    { signal },
  )
  if (!response.ok) {
    const payload = await responsePayload(response)
    throw new ContractApiError(
      responseErrorMessage(payload, `候选 PDF 获取失败（${response.status}）`),
      { status: response.status, payload },
    )
  }
  return response.blob()
}

function parseSseFrame(frame) {
  let id = ''
  let event = 'message'
  const dataLines = []

  frame.split(/\r?\n/).forEach((line) => {
    if (!line || line.startsWith(':')) return
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    let value = separator === -1 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'id') id = value
    else if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
  })

  const serializedData = dataLines.join('\n')
  if (!serializedData) return { id, event, data: null }

  try {
    return { id, event, data: JSON.parse(serializedData) }
  } catch {
    throw new ContractApiError('处理事件包含无法解析的数据')
  }
}

export async function streamExtractionEvents(
  runId,
  { signal, lastEventId = null, onEvent } = {},
) {
  const headers = new Headers({ Accept: 'text/event-stream' })
  if (Number.isInteger(lastEventId) && lastEventId >= 0) {
    headers.set('Last-Event-ID', String(lastEventId))
  }

  const response = await contractApiFetch(runPath(runId, '/events'), {
    headers,
    signal,
  })
  if (!response.ok) {
    const payload = await responsePayload(response)
    throw new ContractApiError(
      responseErrorMessage(payload, `处理事件订阅失败（${response.status}）`),
      { status: response.status, payload },
    )
  }
  if (!response.body) throw new ContractApiError('当前浏览器无法读取处理事件流')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

    let separatorMatch = buffer.match(/\r?\n\r?\n/)
    while (separatorMatch?.index !== undefined) {
      const frame = buffer.slice(0, separatorMatch.index)
      buffer = buffer.slice(separatorMatch.index + separatorMatch[0].length)
      if (frame.trim()) await onEvent?.(parseSseFrame(frame))
      separatorMatch = buffer.match(/\r?\n\r?\n/)
    }

    if (done) break
  }

  if (buffer.trim()) await onEvent?.(parseSseFrame(buffer))
}
