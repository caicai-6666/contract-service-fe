import ForceGraph3D from '3d-force-graph'
import * as THREE from 'three'
import { layoutContractNetwork } from '../models/contractNetwork.js'
import { networkFade, planNetworkTransition, sampleNetworkSpring } from '../models/networkMotion.js'

const palettes = [
  { color: '#6c8a2d', highlight: '#548508' },
  { color: '#278296', highlight: '#007f98' },
  { color: '#4c76a3', highlight: '#2869ad' },
  { color: '#85669f', highlight: '#8049ac' },
  { color: '#39836d', highlight: '#128261' },
]
const configurations = [
  [[25, 7, 4], [-15, 23, -6], [-12, -19, 8]],
  [[21, 17, -4], [-23, 10, 5], [0, -25, 0], [3, 3, 22]],
  [[-26, 8, 0], [23, -7, 2]],
  [[21, 19, 5], [-20, 14, -4], [-17, -18, 6], [20, -19, -5], [0, 6, 25]],
]

export function createContractNetworkScene(container, { reducedMotion, onSelect, onInspectRelation, onDetail }) {
  const resources = new Set()
  const own = resource => { resources.add(resource); return resource }
  const objects = new Map()
  const edgeMaterials = new Map()
  const edgeObjects = new Map()
  const sphereGeometry = own(new THREE.SphereGeometry(1, 28, 20))
  const bondGeometry = own(new THREE.CylinderGeometry(1, 1, 1, 8))
  const glowCanvas = document.createElement('canvas')
  glowCanvas.width = glowCanvas.height = 64
  const glowContext = glowCanvas.getContext('2d')
  const glowGradient = glowContext.createRadialGradient(32, 32, 0, 32, 32, 32)
  glowGradient.addColorStop(0, 'rgba(255,255,255,.8)')
  glowGradient.addColorStop(.3, 'rgba(255,255,255,.3)')
  glowGradient.addColorStop(1, 'rgba(255,255,255,0)')
  glowContext.fillStyle = glowGradient; glowContext.fillRect(0, 0, 64, 64)
  const glowTexture = own(new THREE.CanvasTexture(glowCanvas))
  glowTexture.colorSpace = THREE.SRGBColorSpace
  const up = new THREE.Vector3(0, 1, 0)
  let hasNetwork = false, active = true, disposed = false
  let hoveredNodeId = null, hoveredRelationId = null
  let selectedRelationId = null
  let motion = null, currentNodes = [], currentLinks = []
  let pausedAt = 0

  function identity(id) {
    const hash = [...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7)
    return (hash ^ (hash >>> 16)) >>> 0
  }
  function makeLabel(text) {
    const canvas = document.createElement('canvas')
    canvas.width = 768; canvas.height = 88
    const ctx = canvas.getContext('2d')
    const chars = [...text]
    ctx.font = '500 34px system-ui, sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.lineWidth = 7; ctx.strokeStyle = '#f7faf8'
    const value = chars.length > 16 ? `${chars.slice(0, 15).join('')}…` : text
    ctx.strokeText(value, 384, 44); ctx.fillStyle = '#45566a'; ctx.fillText(value, 384, 44)
    const texture = own(new THREE.CanvasTexture(canvas)); texture.colorSpace = THREE.SRGBColorSpace
    const material = own(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }))
    const label = new THREE.Sprite(material)
    label.scale.set(112, 12.8, 1); label.position.y = -29; label.renderOrder = 20
    return label
  }
  function nodeObject(node) {
    if (objects.has(node.id)) return objects.get(node.id).group
    const seed = identity(node.id)
    const { color, highlight } = palettes[seed % palettes.length]
    const sites = configurations[(seed >>> 4) % configurations.length]
    const group = new THREE.Group(), molecule = new THREE.Group()
    const materials = []
    function material(color) {
      const value = own(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }))
      materials.push(value); return value
    }
    const coreMaterial = material(color)
    const secondary = material(color)
    secondary.userData.opacity = .9
    const bondMaterial = material(color)
    bondMaterial.userData.opacity = .65
    const glow = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: glowTexture, color: highlight, transparent: true, opacity: 0, depthWrite: false })))
    glow.scale.set(28, 28, 1); glow.renderOrder = -1; molecule.add(glow)
    const core = new THREE.Mesh(sphereGeometry, coreMaterial)
    core.scale.setScalar(2.4 + seed % 3 * .35); molecule.add(core)
    sites.forEach((coords, index) => {
      const position = new THREE.Vector3(...coords)
      const atom = new THREE.Mesh(sphereGeometry, secondary)
      atom.position.copy(position); atom.scale.setScalar(.85 + index % 3 * .25)
      molecule.add(atom)
      const from = new THREE.Vector3()
      const direction = position.clone().sub(from)
      const bond = new THREE.Mesh(bondGeometry, bondMaterial)
      bond.scale.set(.13, direction.length(), .13)
      bond.position.copy(from.add(position).multiplyScalar(.5))
      bond.quaternion.setFromUnitVectors(up, direction.normalize()); molecule.add(bond)
    })
    molecule.rotation.set(.15, (seed % 7 - 3) * .13, (seed % 5 - 2) * .09)
    group.add(molecule)
    const hitArea = new THREE.Mesh(sphereGeometry, own(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })))
    hitArea.scale.setScalar(19); group.add(hitArea)
    const label = node.file_name ? makeLabel(node.file_name) : null
    if (label) group.add(label)
    objects.set(node.id, { group, molecule, label, labelText: node.file_name, glow, materials, seed, color: new THREE.Color(color), highlight: new THREE.Color(highlight) })
    return group
  }
  function edgeObject(link) {
    if (edgeObjects.has(link.relation_id)) return edgeObjects.get(link.relation_id)
    const material = own(new THREE.LineDashedMaterial({ color: '#68879c', transparent: true, opacity: 0, depthWrite: false, dashSize: 4.5, gapSize: 3.5 }))
    const geometry = own(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 41 }, () => new THREE.Vector3())))
    const line = new THREE.Line(geometry, material)
    const group = new THREE.Group(); group.add(line)
    // 按关联 ID 固定随机外观，切换中心时不会重新抽取弧度。
    let seed = Math.imul(identity(link.relation_id) ^ 0x9e3779b9, 0x85ebca6b) >>> 0
    seed = (seed ^ (seed >>> 13)) >>> 0
    group.userData = {
      line,
      curvature: seed % 4 === 0 ? 0 : (.12 + ((seed >>> 8) & 255) / 255 * .38) * (seed & 1 ? 1 : -1),
      twist: ((seed >>> 16) & 255) / 255 * 1.4 - .7,
      phase: (seed >>> 24) / 255,
    }
    edgeMaterials.set(link.relation_id, material); edgeObjects.set(link.relation_id, group)
    return group
  }
  function positionEdge(group, { start, end }) {
    const from = new THREE.Vector3(start.x, start.y, start.z)
    const to = new THREE.Vector3(end.x, end.y, end.z)
    const direction = to.clone().sub(from)
    const { line, curvature, twist, phase } = group.userData
    const normal = Math.abs(direction.x) + Math.abs(direction.y) > .001 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
    const bend = direction.clone().cross(normal).normalize().multiplyScalar(direction.length() * curvature)
    if (direction.lengthSq() > 0) bend.applyAxisAngle(direction.clone().normalize(), twist)
    const control = from.clone().add(to).multiplyScalar(.5).add(bend)
    const curve = new THREE.QuadraticBezierCurve3(from, control, to)
    line.geometry.setFromPoints(curve.getPoints(40))
    line.geometry.computeBoundingSphere(); line.computeLineDistances()
    const period = line.material.dashSize + line.material.gapSize
    // 仅移动虚线的相位，不叠加光点；流动不表示业务方向。
    const offset = ((reducedMotion ? 0 : performance.now() / 1000 * 4.8) + phase * period) % period
    const distances = line.geometry.getAttribute('lineDistance')
    for (let index = 0; index < distances.count; index++) distances.array[index] -= offset
    distances.needsUpdate = true
    return true
  }
  function applyAppearance(node, elapsed) {
    const object = objects.get(node.id)
    if (!object) return
    if (object.labelText !== node.file_name) {
      if (object.label) {
        object.group.remove(object.label)
        for (const resource of [object.label.material.map, object.label.material]) { resource.dispose(); resources.delete(resource) }
      }
      object.label = node.file_name ? makeLabel(node.file_name) : null
      object.labelText = node.file_name
      if (object.label) object.group.add(object.label)
    }
    const hover = hoveredNodeId === node.id && !node.exiting
    const focus = hasNetwork && node.file_name ? THREE.MathUtils.clamp((node.visualScale - 1) / .42, 0, 1) : 0
    const scale = node.visualScale + (hover ? .08 : 0)
    object.molecule.scale.setScalar(scale)
    object.molecule.position.y = reducedMotion ? 0 : Math.sin(elapsed * .7 + object.seed) * .35
    for (const material of object.materials) {
      material.color.copy(object.color).lerp(object.highlight, Math.max(focus, hover ? .25 : 0))
      material.opacity = node.alpha * Math.min(1, (material.userData.opacity || 1) + focus * .18) * (hover || node.isCenter ? 1 : .96)
    }
    object.glow.material.opacity = node.alpha * focus * .36
    if (object.label) {
      object.label.material.opacity = node.alpha * (node.isCenter ? 1 : .88)
      object.label.position.y = -34 * node.visualScale
      object.label.scale.set(112 * (1 + focus * .08), 12.8 * (1 + focus * .08), 1)
    }
  }
  function tick() {
    const now = performance.now()
    const elapsed = motion ? Math.max(0, (now - motion.startTime) / 1000) : 2
    for (const node of currentNodes) {
      if (motion) {
        for (const axis of ['x', 'y', 'z']) {
          const sample = sampleNetworkSpring(node.from[axis], node.target[axis], node.startVelocity[axis], elapsed, reducedMotion)
          node[axis] = node[`f${axis}`] = sample.position
          node.velocity[axis] = sample.velocity
        }
        node.alpha = reducedMotion ? (node.exiting ? 0 : 1) : node.exiting
          ? node.startAlpha * (1 - networkFade(elapsed / .3))
          : node.startAlpha + (1 - node.startAlpha) * networkFade((elapsed - (node.entering ? .18 : 0)) / .65)
        const targetScale = node.isCenter ? 1.42 : 1
        node.visualScale = sampleNetworkSpring(node.startScale, targetScale, 0, elapsed, reducedMotion).position
      }
      applyAppearance(node, now / 1000)
    }
    for (const link of currentLinks) {
      const material = edgeMaterials.get(link.relation_id)
      if (!material) continue
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source
      const targetId = typeof link.target === 'object' ? link.target.id : link.target
      const source = currentNodes.find(node => node.id === sourceId)
      const target = currentNodes.find(node => node.id === targetId)
      const highlighted = link.relation_id === selectedRelationId || link.relation_id === hoveredRelationId || [sourceId, targetId].includes(hoveredNodeId)
      material.color.set(highlighted ? '#3f687f' : '#68879c')
      material.opacity = Math.min(source?.alpha || 0, target?.alpha || 0) * (highlighted ? .95 : .76) * (link.exiting ? 1 - networkFade(elapsed / .3) : networkFade(elapsed / .55))
    }
    if (motion && (reducedMotion || elapsed >= 1.6)) {
      motion = null
      currentNodes = currentNodes.filter(node => !node.exiting)
      const ids = new Set(currentNodes.map(node => node.id))
      currentLinks = currentLinks.filter(link => !link.exiting && ids.has(typeof link.source === 'object' ? link.source.id : link.source) && ids.has(typeof link.target === 'object' ? link.target.id : link.target))
      graph.graphData({ nodes: currentNodes, links: currentLinks })
    }
  }
  const graph = new ForceGraph3D(container, { controlType: 'orbit', rendererConfig: { antialias: true, alpha: true } })
    .width(container.clientWidth).height(container.clientHeight)
    .backgroundColor('#00000000').showNavInfo(false)
    .nodeThreeObject(nodeObject).nodeLabel(() => '')
    .linkThreeObject(edgeObject).linkPositionUpdate(positionEdge)
    .linkLabel(() => '').linkHoverPrecision(5)
    .enableNodeDrag(false).cooldownTicks(Infinity).cooldownTime(Infinity).d3AlphaMin(0)
    .onEngineTick(tick)
    .onNodeClick(node => {
      if (hasNetwork && !node.exiting && node.alpha > .4) { selectedRelationId = null; onSelect(node.id) }
    })
    .onLinkClick(link => {
      if (!hasNetwork || link.exiting) return
      selectedRelationId = link.relation_id
      onInspectRelation(link.relation_id)
    })
    .onNodeHover(node => {
      hoveredNodeId = node && !node.exiting ? node.id : null
      container.style.cursor = hasNetwork ? (node && !node.exiting ? 'pointer' : 'grab') : 'default'
      onDetail(hasNetwork && node?.file_name && [...node.file_name].length > 16 ? { title: node.file_name, text: '' } : null)
    })
    .onLinkHover(link => {
      hoveredRelationId = link && !link.exiting ? link.relation_id : null
      container.style.cursor = hasNetwork ? (link && !link.exiting ? 'pointer' : 'grab') : 'default'
      onDetail(null)
    })
  graph.d3Force('charge', null).d3Force('center', null)
  graph.d3Force('link').strength(0)
  graph.renderer().setPixelRatio(Math.min(window.devicePixelRatio, 2))
  const controls = graph.controls()
  controls.enableDamping = true; controls.dampingFactor = .065
  controls.minDistance = 170; controls.maxDistance = 1300; controls.autoRotateSpeed = .3
  controls.addEventListener('start', stopRotation)
  function stopRotation() { if (hasNetwork) controls.autoRotate = false }
  function homeDistance(width, height) { return Math.max(460, 430 / Math.max(.55, width / height)) }
  function home(animated = true) {
    const distance = homeDistance(container.clientWidth, container.clientHeight)
    graph.cameraPosition({ x: distance * .12, y: distance * .1, z: distance }, { x: 0, y: 0, z: 0 }, reducedMotion || !animated ? 0 : 900)
  }
  function setData(network) {
    const previouslyShowingContract = hasNetwork
    hasNetwork = Boolean(network); hoveredNodeId = null; hoveredRelationId = null; selectedRelationId = null
    // 保留控制器的逐帧更新以维持自动旋转，只关闭用户的视角操作。
    controls.enableRotate = controls.enablePan = controls.enableZoom = hasNetwork
    container.style.cursor = hasNetwork ? 'grab' : 'default'
    stopRotation(); onDetail(null)
    const next = network ? layoutContractNetwork(network) : layoutContractNetwork({ center_document_id: 'idle-0', nodes: Array.from({ length: 7 }, (_, i) => ({ document_id: `idle-${i}` })), edges: Array.from({ length: 6 }, (_, i) => ({ relation_id: `idle-edge-${i}`, source_document_id: 'idle-0', target_document_id: `idle-${i + 1}` })) })
    const old = new Map(currentNodes.map(node => [node.id, node]))
    currentNodes = planNetworkTransition({ nodes: currentNodes }, next).map(node => {
      const previous = old.get(node.id)
      return Object.assign(previous || {}, { ...node, x: node.from.x, y: node.from.y, z: node.from.z, fx: node.from.x, fy: node.from.y, fz: node.from.z,
        alpha: previous?.alpha || 0, startAlpha: previous?.alpha || 0,
        visualScale: previous?.visualScale || (node.isCenter ? 1.42 : 1), startScale: previous?.visualScale || (node.isCenter ? 1.42 : 1),
        startVelocity: { ...(previous?.velocity || { x: 0, y: 0, z: 0 }) }, velocity: { ...(previous?.velocity || { x: 0, y: 0, z: 0 }) },
      })
    })
    const nextEdges = new Set(next.links.map(link => link.relation_id))
    const previousLinks = new Map(currentLinks.map(link => [link.relation_id, link]))
    currentLinks = [...next.links.map(link => Object.assign(previousLinks.get(link.relation_id) || {}, link, { exiting: false })), ...currentLinks.filter(link => !nextEdges.has(link.relation_id)).map(link => Object.assign(link, { exiting: true }))]
    motion = { startTime: performance.now() }
    graph.graphData({ nodes: currentNodes, links: currentLinks })
    if (previouslyShowingContract && network) {
      // 镜头保留用户旋转后的方向，节点自身从原位置移向空间原点。
      const position = graph.cameraPosition(), target = controls.target
      graph.cameraPosition({ x: position.x - target.x, y: position.y - target.y, z: position.z - target.z }, { x: 0, y: 0, z: 0 }, reducedMotion ? 0 : 1000)
    } else home()
    controls.autoRotate = !network && !reducedMotion
    if (!active) { pausedAt = performance.now(); graph.pauseAnimation() }
  }
  return {
    setData,
    clearRelationSelection() { selectedRelationId = null },
    resize() {
      const width = container.clientWidth, height = container.clientHeight
      if (!width || !height) return
      const factor = homeDistance(width, height) / homeDistance(graph.width(), graph.height())
      graph.width(width).height(height)
      if (Math.abs(factor - 1) < .0001) return
      // 分栏变窄时按可视空间调整距离，同时保留用户的旋转方向与相对缩放。
      const position = graph.cameraPosition(), target = controls.target.clone()
      const offset = new THREE.Vector3(position.x, position.y, position.z).sub(target)
      offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, 170, 1300)).add(target)
      graph.cameraPosition(offset, target, 0)
    },
    setActive(value) {
      if (value === active || disposed) return
      active = value
      if (value) {
        if (motion && pausedAt) motion.startTime += performance.now() - pausedAt
        pausedAt = 0; graph.resumeAnimation()
      } else { pausedAt = performance.now(); graph.pauseAnimation() }
    },
    viewport(action) {
      if (!hasNetwork) return
      if (action === 'fit') return home()
      const position = graph.cameraPosition(), target = controls.target
      const offset = new THREE.Vector3(position.x, position.y, position.z).sub(target)
      offset.setLength(THREE.MathUtils.clamp(offset.length() / action, 170, 1300)).add(target)
      graph.cameraPosition(offset, target, reducedMotion ? 0 : 280)
    },
    destroy() {
      disposed = true; motion = null
      controls.removeEventListener('start', stopRotation); graph._destructor()
      for (const resource of resources) resource.dispose()
      resources.clear(); objects.clear(); edgeMaterials.clear(); edgeObjects.clear()
    },
  }
}
