import test from 'node:test'
import assert from 'node:assert/strict'
import { modelContractDocuments, resolveDocumentCategories, filterContractDocuments, formatIngestionDate } from '../src/models/contractDocuments.js'

const record = (overrides = {}) => ({
  document_id: 'a'.repeat(64), file_name: '设备采购合同', category: 'sale / construction',
  contract_time: '2026-09-07', file_uri: `/${'a'.repeat(64)}.pdf`,
  reviewer: '审核人甲', ingested_at: '2026-09-07T06:00:00Z', ...overrides,
})
const categories = [
  { categoryId: 1, code: 'sale', name: '买卖合同' },
  { categoryId: 2, code: 'construction', name: '建设工程合同' },
]

test('合同目录映射七个字段，保留服务端顺序和空日期，不修改响应', () => {
  const payload = [record({ document_id: 'b'.repeat(64), contract_time: null }), record()]
  const original = structuredClone(payload)
  const result = modelContractDocuments(payload)
  assert.deepEqual(payload, original)
  assert.deepEqual(result.map((item) => item.id), payload.map((item) => item.document_id))
  assert.equal(result[0].date, null)
  assert.deepEqual(result[1], {
    id: 'a'.repeat(64), name: '设备采购合同', categoryRaw: 'sale / construction',
    categoryTokens: ['sale', 'construction'], date: '2026-09-07',
    fileUri: `/${'a'.repeat(64)}.pdf`, reviewer: '审核人甲', ingestedAt: '2026-09-07T06:00:00Z',
  })
  assert.deepEqual(modelContractDocuments([]), [])
})

test('无效结构、缺失字段、非法日期和重复身份不伪装成空目录', () => {
  for (const key of Object.keys(record())) {
    const item = record()
    delete item[key]
    assert.throws(() => modelContractDocuments([item]), TypeError)
  }
  for (const invalid of [null, {}, [null], [record(), record()],
    [record({ document_id: 'A'.repeat(64) })], [record({ category: ['sale'] })],
    [record({ contract_time: '2026-02-29' })], [record({ contract_time: '2026-9-7' })],
    [record({ ingested_at: '2026-09-07T06:00:00' })], [record({ file_uri: '//external.test/a.pdf' })]]) {
    assert.throws(() => modelContractDocuments(invalid), TypeError)
  }
  assert.equal(modelContractDocuments([record({ contract_time: '2024-02-29' })])[0].date, '2024-02-29')
})

test('类别按 code 精确解析、去重，多类别均可匹配，未映射说明保留', () => {
  const [document] = modelContractDocuments([record({ category: ' sale / construction / sale / 未映射类型 / wholesale ' })])
  const resolved = resolveDocumentCategories(document, categories)
  assert.deepEqual(resolved.categoryCodes, ['sale', 'construction'])
  assert.equal(resolved.type, '买卖合同 / 建设工程合同 / 未映射类型 / wholesale')
  for (const code of ['sale', 'construction']) {
    assert.equal(filterContractDocuments([resolved], { categoryCode: code }).length, 1)
  }
  assert.equal(filterContractDocuments([resolved], { categoryCode: 'sal' }).length, 0)
  const unresolved = resolveDocumentCategories(document, [])
  assert.deepEqual(unresolved.categoryCodes, [])
  assert.equal(unresolved.type, 'sale / construction / 未映射类型 / wholesale')
  assert.equal(filterContractDocuments([unresolved]).length, 1)
})

test('日期、类别及真实审核人组合筛选，未指定年份包含无日期合同', () => {
  const documents = modelContractDocuments([
    record(), record({ document_id: 'b'.repeat(64), reviewer: '审核人乙', contract_time: null }),
    record({ document_id: 'c'.repeat(64), contract_time: '2025-08-06', category: 'construction' }),
  ]).map((item) => resolveDocumentCategories(item, categories))
  assert.equal(filterContractDocuments(documents).length, 3)
  assert.equal(filterContractDocuments(documents, { reviewer: '审核人甲' }).length, 2)
  assert.equal(filterContractDocuments(documents, { year: 2026 }).length, 1)
  assert.equal(filterContractDocuments(documents, { year: 2026, month: 9, day: 7, categoryCode: 'sale', reviewer: '审核人甲' }).length, 1)
  assert.equal(filterContractDocuments(documents, { year: 2026, month: 8 }).length, 0)
  assert.equal(filterContractDocuments(documents, { reviewer: '审核人' }).length, 0)
})

test('入库日期使用本地时区，支持带偏移的 ISO 时间', () => {
  const value = '2026-09-07T23:30:00-05:00'
  assert.equal(modelContractDocuments([record({ ingested_at: value })])[0].ingestedAt, value)
  const date = new Date(value)
  assert.equal(formatIngestionDate(value), `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`)
})
