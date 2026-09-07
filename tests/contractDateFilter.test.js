import test from 'node:test'
import assert from 'node:assert/strict'
import { daysInMonth, updateContractDateFilter } from '../src/models/contractDateFilter.js'

test('年份或月份留空时清空下级日期条件', () => {
  const value = { year: 2026, month: 9, day: 6 }
  assert.deepEqual(updateContractDateFilter(value, 'year', null), { year: null, month: null, day: null })
  assert.deepEqual(updateContractDateFilter(value, 'year', 0), value)
  assert.deepEqual(updateContractDateFilter(value, 'month', null), { year: 2026, month: null, day: null })
  assert.deepEqual(updateContractDateFilter(value, 'day', null), { year: 2026, month: 9, day: null })
})
test('切换年月修正月底与闰年日期', () => {
  assert.equal(daysInMonth(2024, 2), 29)
  assert.equal(daysInMonth(2025, 2), 28)
  assert.equal(updateContractDateFilter({ year: 2026, month: 1, day: 31 }, 'month', 4).day, 30)
  assert.equal(updateContractDateFilter({ year: 2024, month: 2, day: 29 }, 'year', 2025).day, 28)
})
