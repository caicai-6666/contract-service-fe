import test from 'node:test'
import assert from 'node:assert/strict'
import { getContractPermissions, normalizeAuthSession } from '../src/models/contractPermissions.js'

test('三个权限等级精确对应查看、新增及删除', () => {
  assert.deepEqual(getContractPermissions(1), { canView: true, canCreate: true, canDelete: true })
  assert.deepEqual(getContractPermissions(2), { canView: true, canCreate: true, canDelete: false })
  assert.deepEqual(getContractPermissions(3), { canView: true, canCreate: false, canDelete: false })
})

test('缺失、未知及类型错误的权限一律不授权', () => {
  for (const level of [undefined, null, 0, 4, -1, 1.5, '1', true, {}, NaN]) {
    assert.deepEqual(getContractPermissions(level), { canView: false, canCreate: false, canDelete: false })
    assert.equal(normalizeAuthSession({ loginCode: 'test', userName: '测试用户', permissionLevel: level }), null)
  }
})

test('会话保留权限字段，拒绝旧会话及无效身份', () => {
  for (const permissionLevel of [1, 2, 3]) {
    assert.deepEqual(normalizeAuthSession({ loginCode: ' test ', userName: ' 测试用户 ', permissionLevel }), {
      loginCode: 'test', userName: '测试用户', permissionLevel,
    })
  }
  assert.equal(normalizeAuthSession({ loginCode: 'test', userName: '测试用户' }), null)
  assert.equal(normalizeAuthSession({ loginCode: '', userName: '测试用户', permissionLevel: 1 }), null)
  assert.equal(normalizeAuthSession(null), null)
})
