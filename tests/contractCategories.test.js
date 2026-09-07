import test from 'node:test'
import assert from 'node:assert/strict'
import { modelContractCategories } from '../src/models/contractCategories.js'

test('按类别 ID 建模排序，保留编码与名称，不推断数量', () => {
  const payload = [{ category_id: 2, code: 'b', name: '同名类别' }, { category_id: 1, code: 'a', name: '同名类别' }]
  assert.deepEqual(modelContractCategories(payload), [
    { categoryId: 1, code: 'a', name: '同名类别' },
    { categoryId: 2, code: 'b', name: '同名类别' },
  ])
  assert.equal(payload[0].category_id, 2)
})

test('空表为合法空模型', () => assert.deepEqual(modelContractCategories([]), []))

test('拒绝无效结构、身份重复及空名称编码', () => {
  const valid = { category_id: 1, code: 'a', name: '采购合同' }
  for (const payload of [null, {}, [null], [{ ...valid, category_id: '1' }],
    [{ ...valid, name: ' ' }], [{ ...valid, code: '' }], [valid, valid],
    [valid, { ...valid, category_id: 2 }]]) {
    assert.throws(() => modelContractCategories(payload), TypeError)
  }
})
