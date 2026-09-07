export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

export function updateContractDateFilter(current, field, value) {
  const next = { ...current, [field]: value }
  if (next.year === null) return { year: null, month: null, day: null }
  if (!Number.isInteger(next.year) || next.year < 1) return current
  if (!next.month) next.day = null
  else if (next.day) next.day = Math.min(next.day, daysInMonth(next.year, next.month))
  return next
}
