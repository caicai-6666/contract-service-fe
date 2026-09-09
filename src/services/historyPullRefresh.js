export function createHistoryPullRefresh(element, { canLoad, load, onDistance }) {
  let distance = 0, lastWheel = 0, locked = false, touchStart = null
  const reset = () => { distance = 0; onDistance(0) }
  const trigger = () => { if (!locked && canLoad()) { locked = true; reset(); void load() } }
  function wheel(event) {
    const now = Date.now()
    if (now - lastWheel > 350) { locked = false; reset() }
    lastWheel = now
    if (element.scrollTop > 2 || event.deltaY >= 0 || !canLoad() || locked) { reset(); return }
    distance += Math.min(40, Math.abs(event.deltaY) * (event.deltaMode === 1 ? 16 : 1))
    onDistance(Math.min(64, distance))
    if (distance >= 64) trigger()
  }
  function start(event) { touchStart = element.scrollTop <= 2 ? event.touches[0]?.clientY : null; locked = false; reset() }
  function move(event) {
    if (touchStart === null || element.scrollTop > 2 || !canLoad() || locked) return
    distance = Math.max(0, (event.touches[0]?.clientY - touchStart) * .5)
    if (distance && event.cancelable) event.preventDefault()
    onDistance(Math.min(64, distance))
  }
  function end() { if (distance >= 64) trigger(); touchStart = null; reset() }
  element.addEventListener('wheel', wheel, { passive: true })
  element.addEventListener('touchstart', start, { passive: true })
  element.addEventListener('touchmove', move, { passive: false })
  element.addEventListener('touchend', end)
  element.addEventListener('touchcancel', reset)
  return () => {
    element.removeEventListener('wheel', wheel)
    element.removeEventListener('touchstart', start)
    element.removeEventListener('touchmove', move)
    element.removeEventListener('touchend', end)
    element.removeEventListener('touchcancel', reset)
    reset()
  }
}
