// 触控板捏合以 Ctrl + wheel 派发；Safari 使用 gesture 事件。
export function bindPdfZoomGestures(element, applyZoom) {
  let gestureScale = null
  let touchDistance = null
  const options = { passive: false }
  function wheel(event) {
    if (!event.ctrlKey) return
    event.preventDefault()
    if (gestureScale !== null || touchDistance !== null) return
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1)
    applyZoom(Math.exp(-Math.max(-100, Math.min(100, delta)) * .01), [event.clientX, event.clientY])
  }
  function gestureStart(event) {
    event.preventDefault()
    gestureScale = event.scale || 1
  }
  function gestureChange(event) {
    event.preventDefault()
    if (gestureScale === null || !Number.isFinite(event.scale) || event.scale <= 0) return
    applyZoom(event.scale / gestureScale, [event.clientX, event.clientY])
    gestureScale = event.scale
  }
  function gestureEnd(event) {
    event.preventDefault()
    gestureScale = null
  }
  function distance(touches) {
    return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
  }
  function touchStart(event) {
    if (event.touches.length !== 2) { touchDistance = null; return }
    event.preventDefault()
    touchDistance = distance(event.touches)
  }
  function touchMove(event) {
    if (event.touches.length !== 2 || gestureScale !== null) return
    event.preventDefault()
    const nextDistance = distance(event.touches)
    if (touchDistance > 0 && nextDistance > 0) {
      applyZoom(nextDistance / touchDistance, [
        (event.touches[0].clientX + event.touches[1].clientX) / 2,
        (event.touches[0].clientY + event.touches[1].clientY) / 2,
      ])
    }
    touchDistance = nextDistance
  }
  function touchEnd() { touchDistance = null }
  const handlers = { wheel, gesturestart: gestureStart, gesturechange: gestureChange, gestureend: gestureEnd, touchstart: touchStart, touchmove: touchMove, touchend: touchEnd, touchcancel: touchEnd }
  for (const [type, handler] of Object.entries(handlers)) element.addEventListener(type, handler, options)
  return () => {
    for (const [type, handler] of Object.entries(handlers)) element.removeEventListener(type, handler, options)
  }
}
