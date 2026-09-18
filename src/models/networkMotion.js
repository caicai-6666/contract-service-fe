// 欠阻尼弹簧从当前位置和速度出发，先加速，再以轻微过冲收稳。
export function sampleNetworkSpring(from, target, velocity, elapsed, reducedMotion = false) {
  if (reducedMotion || elapsed >= 1.6) return { position: target, velocity: 0 }
  const damping = 7.5
  const frequency = 7.8
  const offset = from - target
  const coefficient = (velocity + damping * offset) / frequency
  const decay = Math.exp(-damping * elapsed)
  const cos = Math.cos(frequency * elapsed)
  const sin = Math.sin(frequency * elapsed)
  return {
    position: target + decay * (offset * cos + coefficient * sin),
    velocity: decay * ((coefficient * frequency - damping * offset) * cos - (offset * frequency + damping * coefficient) * sin),
  }
}

export function networkFade(progress) {
  const clamped = Math.max(0, Math.min(1, progress))
  return clamped * clamped * (3 - 2 * clamped)
}

export function planNetworkTransition(previous, next) {
  const oldNodes = new Map(previous.nodes.map(node => [node.id, node]))
  const nextIds = new Set(next.nodes.map(node => node.id))
  const focus = next.nodes.find(node => node.isCenter)
  const anchor = oldNodes.get(focus?.id) || { x: 0, y: 0, z: 0 }
  const nodes = next.nodes.map(node => {
    const previousNode = oldNodes.get(node.id)
    // 保留节点当前的世界坐标，尤其不能把点击节点预先减去自身坐标。
    const start = previousNode || Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, node[axis] * .72 + anchor[axis] * .28]))
    return { ...node, from: { x: start.x, y: start.y, z: start.z }, target: { x: node.x, y: node.y, z: node.z }, entering: !previousNode, exiting: false }
  })
  for (const node of previous.nodes) {
    if (!nextIds.has(node.id)) nodes.push({ ...node, from: { x: node.x, y: node.y, z: node.z }, target: { x: node.x, y: node.y, z: node.z }, entering: false, exiting: true })
  }
  return nodes
}
