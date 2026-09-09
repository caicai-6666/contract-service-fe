export function createMessageScrollFollower(list, content) {
  let following = true
  let frame = 0
  let lastTop = list.scrollTop
  let touchY = null
  let pinnedMessage = null
  let layoutHold = false
  let layoutHoldTimer = null
  const listeners = []
  const atBottom = () => list.scrollHeight - list.clientHeight - list.scrollTop <= 2
  function pause() {
    following = false
    cancelAnimationFrame(frame)
    frame = 0
  }
  function schedule() {
    if (layoutHold) return
    updatePinnedHeight()
    if (!following || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!following || layoutHold) return
      // 跟随实际渲染高度，不反复启动 smooth 滚动与流式逐字动画竞争。
      list.scrollTop = list.scrollHeight
      lastTop = list.scrollTop
    })
  }
  function resume() { following = true; schedule() }
  function holdLayout() {
    layoutHold = true
    clearTimeout(layoutHoldTimer)
    cancelAnimationFrame(frame)
    frame = 0
    // 过程区动画为 420ms；手动展开不作为新的流式输出，也不改变原跟随状态。
    layoutHoldTimer = setTimeout(() => {
      layoutHold = false
      lastTop = list.scrollTop
      // 不补滚到末尾，等待之后真正的内容更新或用户滚动。
    }, 500)
  }
  function updatePinnedHeight() {
    if (!pinnedMessage?.isConnected) return
    // 只预留新问题以下的一屏；回复逐渐填满该区域，而不是在回复后再追加一屏空白。
    const height = Math.max(list.clientHeight, pinnedMessage.offsetTop + list.clientHeight - 24)
    content.style.setProperty('--message-pinned-height', `${height}px`)
  }
  function clearPin() {
    if (!pinnedMessage) return
    pinnedMessage = null
    content.classList.remove('is-question-pinned')
    content.style.removeProperty('--message-pinned-height')
  }
  function pin(message, { follow = true } = {}) {
    if (!message) return
    pause()
    pinnedMessage = message
    content.classList.add('is-question-pinned')
    updatePinnedHeight()
    list.scrollTop = Math.max(0, message.offsetTop - 24)
    lastTop = list.scrollTop
    if (follow) resume()
  }
  function listen(type, handler) {
    list.addEventListener(type, handler, { passive: true })
    listeners.push([type, handler])
  }
  listen('scroll', () => {
    const top = list.scrollTop
    if (layoutHold) { lastTop = top; return }
    if (top < lastTop && !atBottom()) pause()
    else if (top >= lastTop && atBottom()) following = true
    lastTop = top
  })
  listen('wheel', (event) => { if (event.deltaY < 0) pause() })
  listen('touchstart', (event) => { touchY = event.touches[0]?.clientY ?? null })
  listen('touchmove', (event) => {
    const nextY = event.touches[0]?.clientY
    if (touchY !== null && nextY > touchY) pause()
    touchY = nextY ?? null
  })
  listen('keydown', (event) => {
    if (event.target !== list) return
    if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) pause()
  })
  const observer = new ResizeObserver(schedule)
  observer.observe(content)
  observer.observe(list)
  // 最小高度可能掩盖内部布局变化，例如顶部历史加载提示移除后，
  // 用户消息已经上移，但 ResizeObserver 不会收到容器尺寸变化。
  const contentObserver = new MutationObserver(schedule)
  contentObserver.observe(content, { childList: true, subtree: true })
  schedule()
  return {
    pause, resume, pin, clearPin, holdLayout,
    isFollowing: () => following,
    dispose() {
      pause()
      clearTimeout(layoutHoldTimer)
      observer.disconnect()
      contentObserver.disconnect()
      clearPin()
      listeners.forEach(([type, handler]) => list.removeEventListener(type, handler))
    },
  }
}
