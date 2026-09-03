<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import moePdfUrl from '../assets/moe.pdf?url'
import PdfPreviewOverlay from './PdfPreviewOverlay.vue'

const emit = defineEmits(['preview-visibility-change'])
const sceneRootRef = ref(null)
const canvasRef = ref(null)
const sceneError = ref('')
const hoveredDrawerLabel = ref('')
const hoverPosition = ref({ x: 0, y: 0 })
const focusedDrawerLabel = ref('')
const hoveredDocumentLabel = ref('')
const activeDocumentLabel = ref('')
const pdfPreviewOpen = ref(false)
const dragging = ref(false)
const atLeftBoundary = ref(true)

const hoverPositionStyle = computed(() => ({
  left: `${hoverPosition.value.x}px`,
  top: `${hoverPosition.value.y}px`,
}))

const COLUMN_COUNT = 15
const ROW_COUNT = 5
const COLUMN_SPACING = 1.62
const ROW_SPACING = 1.12
const COLUMN_SPAN = COLUMN_COUNT * COLUMN_SPACING
const DRAWER_OPEN_DISTANCE = 2.35
const CABINET_LEFT_INSET_PX = 130
const BROWSE_CAMERA_Y = 3.55
const BROWSE_CAMERA_Z = 28
const BROWSE_LOOK_Y = 0.15
const BROWSE_LOOK_Z = -0.5
const INSPECTION_CAMERA_Y_OFFSET = 3.4
const INSPECTION_CAMERA_Z_OFFSET = 2.75
const INSPECTION_LOOK_Y_OFFSET = -0.05
const INSPECTION_LOOK_Z_OFFSET = -0.72
const ENVIRONMENT_BAY_COUNT = 12
const ENVIRONMENT_BAY_SPACING = 4.8
const ENVIRONMENT_BAY_SPAN = ENVIRONMENT_BAY_COUNT * ENVIRONMENT_BAY_SPACING
const COLUMN_RECYCLE_MARGIN = COLUMN_SPACING * 1.15
const ENVIRONMENT_RECYCLE_MARGIN = ENVIRONMENT_BAY_SPACING * 1.25
const CABINET_VISIBILITY_MARGIN = COLUMN_SPACING * 2
const ENVIRONMENT_VISIBILITY_MARGIN = ENVIRONMENT_BAY_SPACING * 1.35

let renderer
let scene
let camera
let animationFrame = 0
let resizeObserver
let clock
let raycaster
let cabinetRoot
let leftEndCap
let environmentShell
let environmentDust
let leftArchiveFeature
let scrollPosition = 0
let targetScrollPosition = 0
let cabinetLeftEdge = -4
let viewportLeftEdge = -4
let viewportHalfWidth = 4
let hoveredDrawer = null
let hoveredDocument = null
let focusedDrawer = null
let activeFileRack = null
let activeFileOwner = null
let drawerHighlight = null
let drawerHighlightMaterial = null
let highlightedDrawer = null
let highlightedDrawerProgress = 0
let pointerState = null
let lastLayoutCameraX = Number.NaN
let lastCabinetLeftEdge = Number.NaN
let lastEnvironmentShellX = Number.NaN
let activeShadowBay = null
let shadowDirty = true
let diagnosticsRenderFrame = 0

const cameraLookTarget = new THREE.Vector3(0, BROWSE_LOOK_Y, BROWSE_LOOK_Z)
const drawerWorldPosition = new THREE.Vector3()

const cabinetColumns = []
const environmentBays = []
const drawers = []
const interactiveFronts = []
const activeFiles = []

function markDynamicTransform(object) {
  object.userData.dynamicTransform = true
  return object
}

function freezeStaticTransforms(root) {
  root.traverse((object) => {
    if (object.userData.dynamicTransform) return
    object.updateMatrix()
    object.matrixAutoUpdate = false
  })
}

function mergePlacedGeometries(placements) {
  const geometries = placements.map(({ geometry, position, rotation, scale }) => {
    const transformed = geometry.clone()
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...(rotation ?? [0, 0, 0])),
    )
    matrix.compose(
      new THREE.Vector3(...(position ?? [0, 0, 0])),
      quaternion,
      new THREE.Vector3(...(scale ?? [1, 1, 1])),
    )
    transformed.applyMatrix4(matrix)
    return transformed
  })

  const merged = mergeGeometries(geometries, false)
  geometries.forEach((geometry) => geometry.dispose())
  return merged
}

function createFlexibleSheetGeometry(width, height, options = {}) {
  const {
    bow = 0.012,
    taper = 0.035,
    wave = 0.003,
    segmentsX = 8,
    segmentsY = 4,
  } = options
  const geometry = new THREE.PlaneGeometry(width, height, segmentsX, segmentsY)
  const positions = geometry.attributes.position

  for (let index = 0; index < positions.count; index += 1) {
    const originalX = positions.getX(index)
    const y = positions.getY(index)
    const normalizedX = originalX / (width * 0.5)
    const normalizedY = y / height + 0.5
    const taperedX = originalX * (1 - taper * (1 - normalizedY))
    const curvedZ =
      bow * (1 - normalizedX * normalizedX) * (0.35 + (1 - normalizedY) * 0.65) +
      Math.sin((normalizedX + 1) * Math.PI) * wave * (0.4 + normalizedY * 0.6)

    positions.setXYZ(index, taperedX, y, curvedZ)
  }

  positions.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function createFolderGussetGeometry() {
  const positions = []
  const indices = []

  for (const side of [-1, 1]) {
    const start = positions.length / 3
    const outerX = side * 0.495
    const innerX = side * 0.468
    positions.push(
      outerX, -0.25, 0.012,
      outerX, 0.13, 0.012,
      innerX, 0.045, 0.078,
      innerX, -0.242, 0.078,
    )
    if (side < 0) {
      indices.push(start, start + 2, start + 1, start, start + 3, start + 2)
    } else {
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function createMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.48,
    metalness: 0.18,
    ...options,
  })
}

function addBookRows(bay, shared, bayIndex) {
  const placementsByMaterial = shared.bookMaterials.map(() => [])

  for (const [rowIndex, shelfY] of [3.08, 3.78].entries()) {
    let cursor = -1.72

    for (let bookIndex = 0; bookIndex < 12; bookIndex += 1) {
      const width = 0.16 + ((bookIndex * 7 + bayIndex * 3 + rowIndex) % 5) * 0.035
      const height = 0.4 + ((bookIndex * 5 + bayIndex + rowIndex * 2) % 6) * 0.045
      if (cursor + width > 1.72) break

      const materialIndex = (bookIndex + bayIndex * 2 + rowIndex) % shared.bookMaterials.length
      placementsByMaterial[materialIndex].push({
        position: [cursor + width / 2, shelfY + height / 2, -2.06],
        rotation: [0, 0, ((bookIndex + bayIndex) % 5 - 2) * 0.012],
        scale: [width, height, 1],
      })
      cursor += width + 0.055
    }
  }

  placementsByMaterial.forEach((placements, materialIndex) => {
    if (!placements.length) return

    const books = new THREE.InstancedMesh(
      shared.bookGeometry,
      shared.bookMaterials[materialIndex],
      placements.length,
    )
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    placements.forEach((placement, instanceIndex) => {
      quaternion.setFromEuler(new THREE.Euler(...placement.rotation))
      matrix.compose(
        new THREE.Vector3(...placement.position),
        quaternion,
        new THREE.Vector3(...placement.scale),
      )
      books.setMatrixAt(instanceIndex, matrix)
    })
    books.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    books.instanceMatrix.needsUpdate = true
    books.castShadow = true
    bay.add(books)
  })
}

function createFileCart(bayIndex, shared, withLamp) {
  const cart = new THREE.Group()
  cart.name = withLamp ? 'file-cart-with-lamp' : 'file-cart'

  const shelves = new THREE.Mesh(shared.cartShelvesGeometry, shared.cartShelfMaterial)
  shelves.castShadow = true
  const frame = new THREE.Mesh(shared.cartFrameGeometry, shared.cartFrameMaterial)
  frame.castShadow = true
  const handleGrip = new THREE.Mesh(shared.cartHandleGripGeometry, shared.brassMaterial)
  handleGrip.position.set(0.58, 1.63, 0)
  cart.add(shelves, frame, handleGrip)

  const fileCount = withLamp ? 4 : 6
  for (let index = 0; index < fileCount; index += 1) {
    const height = 0.4 + ((index + bayIndex) % 4) * 0.07
    const file = new THREE.Mesh(
      shared.cartFileGeometry,
      shared.bookMaterials[(index * 2 + bayIndex) % shared.bookMaterials.length],
    )
    file.scale.set(0.18 + (index % 2) * 0.035, height, 1)
    file.position.set(-0.42 + index * 0.17, 0.99 + height / 2, -0.03 + (index % 2) * 0.04)
    file.rotation.z = ((index + bayIndex) % 3 - 1) * 0.045
    file.castShadow = true
    cart.add(file)
  }

  if (withLamp) {
    const lampBase = new THREE.Mesh(shared.cartLampBaseGeometry, shared.brassMaterial)
    lampBase.position.set(-0.31, 1.03, 0.12)
    const lampStem = new THREE.Mesh(shared.cartLampStemGeometry, shared.brassMaterial)
    lampStem.position.set(-0.31, 1.35, 0.12)
    const lampShade = new THREE.Mesh(shared.cartLampShadeGeometry, shared.pendantMaterial)
    lampShade.position.set(-0.31, 1.66, 0.12)
    const lampGlow = new THREE.Mesh(shared.cartLampGlowGeometry, shared.pendantGlowMaterial)
    lampGlow.position.set(-0.31, 1.565, 0.12)

    const lampLight = new THREE.PointLight(0xffc982, 9.5, 5.5, 2)
    lampLight.position.set(-0.31, 1.56, 0.12)
    cart.userData.lampLight = lampLight
    cart.add(lampBase, lampStem, lampShade, lampGlow, lampLight)
  }

  return cart
}

function createArchiveBay(bayIndex, shared) {
  const bay = markDynamicTransform(new THREE.Group())
  bay.userData.bayIndex = bayIndex

  const wallInset = new THREE.Mesh(shared.wallInsetGeometry, shared.wallInsetMaterial)
  wallInset.position.set(0, 0.72, -2.525)
  wallInset.receiveShadow = true

  const panelSeam = new THREE.Mesh(shared.panelSeamGeometry, shared.structureMaterial)
  panelSeam.position.set(-ENVIRONMENT_BAY_SPACING / 2, 0.72, -2.54)

  const pier = new THREE.Mesh(shared.pierGeometry, shared.stoneMaterial)
  pier.position.set(-ENVIRONMENT_BAY_SPACING / 2, 0.78, -2.28)
  pier.castShadow = true
  pier.receiveShadow = true

  const pierInlay = new THREE.Mesh(shared.pierInlayGeometry, shared.brassMaterial)
  pierInlay.position.set(-ENVIRONMENT_BAY_SPACING / 2 + 0.09, 0.78, -2.08)

  const arch = new THREE.Mesh(shared.archGeometry, shared.stoneMaterial)
  arch.position.set(0, 2.72, -2.25)
  arch.castShadow = true

  const shelfBack = new THREE.Mesh(shared.shelfBackGeometry, shared.shelfBackMaterial)
  shelfBack.position.set(0, 3.7, -2.33)
  shelfBack.receiveShadow = true

  const shelfUnit = new THREE.Mesh(shared.shelfUnitGeometry, shared.woodMaterial)
  shelfUnit.castShadow = true

  const lowerShelfLight = new THREE.Mesh(shared.shelfLightGeometry, shared.lightMaterial)
  lowerShelfLight.position.set(0, 3.73, -1.86)
  const upperShelfLight = lowerShelfLight.clone()
  upperShelfLight.position.y = 4.43

  bay.add(
    wallInset,
    panelSeam,
    pier,
    pierInlay,
    arch,
    shelfBack,
    shelfUnit,
    lowerShelfLight,
    upperShelfLight,
  )
  addBookRows(bay, shared, bayIndex)

  const balcony = new THREE.Mesh(shared.balconyGeometry, shared.woodMaterial)
  balcony.position.set(0, 2.97, -1.55)
  balcony.castShadow = true
  const balconyRailing = new THREE.Mesh(shared.balconyRailingGeometry, shared.brassMaterial)
  bay.add(balcony, balconyRailing)

  if (bayIndex % 3 === 1) {
    const ladder = new THREE.Mesh(shared.ladderUnitGeometry, shared.brassMaterial)
    bay.add(ladder)
  }

  const wallMarker = new THREE.Mesh(
    shared.wallMarkerGeometry,
    bayIndex % 2 === 0 ? shared.violetGuideMaterial : shared.greenGuideMaterial,
  )
  wallMarker.position.set(0, 4.62, -2.02)

  const ceilingRib = new THREE.Mesh(shared.ceilingRibGeometry, shared.structureMaterial)
  ceilingRib.position.set(-ENVIRONMENT_BAY_SPACING / 2, 5.16, 3.2)

  const ceilingLight = new THREE.Mesh(shared.ceilingLightGeometry, shared.lightMaterial)
  ceilingLight.position.set(0, 5.145, 2.2)

  const pendantCable = new THREE.Mesh(shared.pendantCableGeometry, shared.brassMaterial)
  pendantCable.position.set(0, 4.8, 0.9)
  const pendantShade = new THREE.Mesh(shared.pendantShadeGeometry, shared.pendantMaterial)
  pendantShade.position.set(0, 4.43, 0.9)
  const pendantGlow = new THREE.Mesh(shared.pendantGlowGeometry, shared.pendantGlowMaterial)
  pendantGlow.position.set(0, 4.335, 0.9)

  const pendantTarget = new THREE.Object3D()
  pendantTarget.position.set(0, -1.7, -0.3)
  const pendantLight = new THREE.SpotLight(0xffdfad, 48, 14, Math.PI * 0.34, 0.66, 1.65)
  pendantLight.position.set(0, 4.32, 0.9)
  pendantLight.target = pendantTarget
  pendantLight.castShadow = false
  pendantLight.shadow.mapSize.set(768, 768)
  pendantLight.shadow.camera.near = 0.4
  pendantLight.shadow.camera.far = 13
  pendantLight.shadow.bias = -0.00015
  bay.userData.pendantLight = pendantLight

  const pendantFillLight = new THREE.PointLight(0xffd6a0, 7.5, 7.5, 2)
  pendantFillLight.position.set(0, 4.25, 0.82)
  bay.userData.pendantFillLight = pendantFillLight

  const floorSeam = new THREE.Mesh(shared.floorSeamGeometry, shared.floorSeamMaterial)
  floorSeam.position.set(-ENVIRONMENT_BAY_SPACING / 2, -3.005, 5.4)

  const floorTile = new THREE.Mesh(
    shared.floorTileGeometry,
    bayIndex % 2 === 0 ? shared.floorTileMaterials[0] : shared.floorTileMaterials[1],
  )
  floorTile.position.set(0, -2.998, 2.08)
  floorTile.receiveShadow = true

  const runnerDivider = new THREE.Mesh(shared.runnerDividerGeometry, shared.brassMaterial)
  runnerDivider.position.set(-ENVIRONMENT_BAY_SPACING / 2, -2.968, 7.2)

  const runnerMedallion = new THREE.Mesh(shared.runnerMedallionGeometry, shared.brassMaterial)
  runnerMedallion.rotation.x = -Math.PI / 2
  runnerMedallion.position.set(0, -2.963, 7.2)

  const runnerDiamond = new THREE.Mesh(shared.runnerDiamondGeometry, shared.runnerPatternMaterial)
  runnerDiamond.position.set(0, -2.958, 7.2)
  runnerDiamond.rotation.y = Math.PI / 4

  const platformLight = new THREE.Mesh(shared.platformLightGeometry, shared.lightMaterial)
  platformLight.position.set(0, -2.91, 0.555)

  if (bayIndex % 3 !== 2) {
    const withLamp = bayIndex % 3 === 1
    const cart = createFileCart(bayIndex, shared, withLamp)
    cart.position.set(bayIndex % 2 === 0 ? 1.34 : -1.34, -3.01, 4.65 + (bayIndex % 2) * 0.5)
    cart.rotation.y = bayIndex % 2 === 0 ? -0.08 : 0.08
    bay.userData.foregroundLights = cart.userData.lampLight ? [cart.userData.lampLight] : []
    bay.add(cart)
  } else {
    bay.userData.foregroundLights = []
  }

  const leftTrackTie = new THREE.Mesh(shared.trackTieGeometry, shared.structureMaterial)
  leftTrackTie.position.set(-ENVIRONMENT_BAY_SPACING / 2, -2.865, -0.62)
  const centerTrackTie = leftTrackTie.clone()
  centerTrackTie.position.x = 0

  bay.add(
    wallMarker,
    ceilingRib,
    ceilingLight,
    pendantCable,
    pendantShade,
    pendantGlow,
    pendantTarget,
    pendantLight,
    pendantFillLight,
    floorSeam,
    floorTile,
    runnerDivider,
    runnerMedallion,
    runnerDiamond,
    platformLight,
    leftTrackTie,
    centerTrackTie,
  )

  return bay
}

function createArchiveIndexFeature(shared) {
  const feature = markDynamicTransform(new THREE.Group())
  feature.name = 'archive-index-feature'

  const backdrop = new THREE.Mesh(new THREE.BoxGeometry(1.28, 5.45, 0.22), shared.stoneMaterial)
  backdrop.position.set(0, -0.08, -2.26)
  backdrop.castShadow = true
  backdrop.receiveShadow = true

  const screenMaterial = createMaterial(0x263a31, {
    emissive: 0x17271f,
    emissiveIntensity: 0.34,
    roughness: 0.44,
    metalness: 0.16,
  })
  const screen = new THREE.Mesh(new THREE.BoxGeometry(1.04, 2.3, 0.08), screenMaterial)
  screen.position.set(0, 0.76, -2.105)

  const leftFrame = new THREE.Mesh(new THREE.BoxGeometry(0.045, 2.38, 0.055), shared.brassMaterial)
  leftFrame.position.set(-0.55, 0.76, -2.03)
  const rightFrame = leftFrame.clone()
  rightFrame.position.x = 0.55
  const topFrame = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.045, 0.055), shared.brassMaterial)
  topFrame.position.set(0, 1.95, -2.03)
  const bottomFrame = topFrame.clone()
  bottomFrame.position.y = -0.43

  const indexRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.19, 0.035, 8, 28, Math.PI * 1.72),
    shared.violetGuideMaterial,
  )
  indexRing.position.set(-0.27, 1.56, -2.01)
  indexRing.rotation.z = -0.42
  const indexDot = new THREE.Mesh(new THREE.SphereGeometry(0.065, 14, 10), shared.greenGuideMaterial)
  indexDot.position.set(-0.11, 1.43, -1.99)

  const indexBars = []
  const barWidths = [0.68, 0.52, 0.74, 0.46, 0.61]
  for (let index = 0; index < barWidths.length; index += 1) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(barWidths[index], 0.045, 0.025),
      index === 2 ? shared.violetGuideMaterial : shared.lightMaterial,
    )
    bar.position.set(-0.38 + barWidths[index] / 2, 1.02 - index * 0.28, -2.01)
    indexBars.push(bar)
  }

  const nicheBack = new THREE.Mesh(new THREE.BoxGeometry(1.04, 1.28, 0.12), shared.shelfBackMaterial)
  nicheBack.position.set(0, -1.54, -2.1)
  const nicheTop = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.09, 0.48), shared.woodMaterial)
  nicheTop.position.set(0, -0.85, -1.94)
  const nicheBottom = nicheTop.clone()
  nicheBottom.position.y = -2.23

  const displayFiles = []
  const displayFileColors = [shared.bookMaterials[0], shared.bookMaterials[1], shared.bookMaterials[2]]
  for (let index = 0; index < 3; index += 1) {
    const displayFile = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.74 + index * 0.09, 0.12), displayFileColors[index])
    displayFile.position.set((index - 1) * 0.27, -1.77 + index * 0.045, -1.94)
    displayFile.rotation.z = (index - 1) * 0.04
    displayFile.castShadow = true
    displayFiles.push(displayFile)
  }

  const verticalLight = new THREE.Mesh(new THREE.BoxGeometry(0.045, 4.92, 0.035), shared.lightMaterial)
  verticalLight.position.set(0.54, -0.08, -2.03)

  feature.add(
    backdrop,
    screen,
    leftFrame,
    rightFrame,
    topFrame,
    bottomFrame,
    indexRing,
    indexDot,
    ...indexBars,
    nicheBack,
    nicheTop,
    nicheBottom,
    ...displayFiles,
    verticalLight,
  )
  return feature
}

function createEnvironment() {
  const environmentRoot = new THREE.Group()
  environmentRoot.name = 'archive-corridor-environment'
  scene.add(environmentRoot)

  environmentShell = markDynamicTransform(new THREE.Group())
  environmentShell.name = 'archive-corridor-shell'
  environmentRoot.add(environmentShell)

  const wallMaterial = createMaterial(0xe4ece8, { roughness: 0.92, metalness: 0.02 })
  const floorMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xd9e3df,
    roughness: 0.3,
    metalness: 0.1,
    clearcoat: 0.72,
    clearcoatRoughness: 0.26,
  })
  const ceilingMaterial = createMaterial(0xf0f5f3, {
    emissive: 0xdfece6,
    emissiveIntensity: 0.32,
    roughness: 0.88,
    metalness: 0.02,
  })
  const structureMaterial = createMaterial(0xb8c8c0, { roughness: 0.62, metalness: 0.18 })
  const stoneMaterial = createMaterial(0xc4d0ca, { roughness: 0.72, metalness: 0.09 })
  const woodMaterial = createMaterial(0x756454, { roughness: 0.52, metalness: 0.08 })
  const brassMaterial = createMaterial(0xa99562, { roughness: 0.3, metalness: 0.68 })
  const runnerMaterial = createMaterial(0x314a3f, { roughness: 0.92, metalness: 0.01 })
  const cartFrameMaterial = createMaterial(0x40564b, { roughness: 0.3, metalness: 0.68 })
  const cartShelfMaterial = createMaterial(0x6c5b4c, { roughness: 0.5, metalness: 0.12 })
  const runnerPatternMaterial = createMaterial(0x7469ad, {
    emissive: 0x4f477f,
    emissiveIntensity: 0.18,
    roughness: 0.72,
    metalness: 0.08,
  })
  const shelfBackMaterial = createMaterial(0x3e4d46, {
    emissive: 0x1d2923,
    emissiveIntensity: 0.16,
    roughness: 0.74,
    metalness: 0.08,
  })
  const pendantMaterial = createMaterial(0x596a62, { roughness: 0.34, metalness: 0.56 })
  const wallInsetMaterial = createMaterial(0xd8e4df, {
    emissive: 0xc8ddd4,
    emissiveIntensity: 0.12,
    roughness: 0.78,
    metalness: 0.05,
  })
  const trackMaterial = createMaterial(0x82968c, { roughness: 0.34, metalness: 0.56 })
  const platformMaterial = createMaterial(0xbac9c2, { roughness: 0.46, metalness: 0.24 })
  const floorSeamMaterial = createMaterial(0xaebfb7, {
    transparent: true,
    opacity: 0.34,
    roughness: 0.72,
    metalness: 0.08,
  })
  const lightMaterial = createMaterial(0xf8fffc, {
    emissive: 0xa9c5b8,
    emissiveIntensity: 0.38,
    roughness: 0.42,
    metalness: 0.02,
  })
  const pendantGlowMaterial = createMaterial(0xffe9c4, {
    emissive: 0xffd89d,
    emissiveIntensity: 4.2,
    roughness: 0.2,
    metalness: 0.02,
  })
  const violetGuideMaterial = createMaterial(0x8175ca, {
    emissive: 0x6558b4,
    emissiveIntensity: 1.35,
    roughness: 0.42,
    metalness: 0.08,
  })
  const greenGuideMaterial = createMaterial(0x78a994, {
    emissive: 0x57907a,
    emissiveIntensity: 1.15,
    roughness: 0.42,
    metalness: 0.08,
  })
  const bookMaterials = [
    createMaterial(0x786db1, { roughness: 0.78, metalness: 0.02 }),
    createMaterial(0x719b87, { roughness: 0.78, metalness: 0.02 }),
    createMaterial(0xc39a5d, { roughness: 0.78, metalness: 0.02 }),
    createMaterial(0x9f6f62, { roughness: 0.78, metalness: 0.02 }),
    createMaterial(0x607d8b, { roughness: 0.78, metalness: 0.02 }),
    createMaterial(0xb8aa91, { roughness: 0.78, metalness: 0.02 }),
  ]
  const floorTileMaterials = [
    new THREE.MeshPhysicalMaterial({
      color: 0xe2e7e3,
      roughness: 0.34,
      metalness: 0.08,
      clearcoat: 0.58,
      clearcoatRoughness: 0.3,
    }),
    new THREE.MeshPhysicalMaterial({
      color: 0xd2ddd7,
      roughness: 0.36,
      metalness: 0.07,
      clearcoat: 0.54,
      clearcoatRoughness: 0.32,
    }),
  ]

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(80, 16), wallMaterial)
  backWall.position.set(0, 1.1, -2.58)
  backWall.receiveShadow = true

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 34), floorMaterial)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, -3.02, 5.4)
  floor.receiveShadow = true

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(80, 24), ceilingMaterial)
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.set(0, 5.2, 4.2)
  ceiling.receiveShadow = true
  environmentShell.add(backWall, floor, ceiling)

  const upperCove = new THREE.Mesh(new THREE.BoxGeometry(80, 0.075, 0.16), lightMaterial)
  upperCove.position.set(0, 4.82, -2.42)
  const lowerTrack = new THREE.Mesh(new THREE.BoxGeometry(80, 0.1, 0.2), structureMaterial)
  lowerTrack.position.set(0, -2.83, -2.37)
  environmentShell.add(upperCove, lowerTrack)

  const shared = {
    panelSeamGeometry: new THREE.BoxGeometry(0.022, 8.1, 0.025),
    wallInsetGeometry: new THREE.BoxGeometry(4.34, 7.6, 0.07),
    wallMarkerGeometry: new THREE.BoxGeometry(1.18, 0.045, 0.035),
    pierGeometry: new THREE.BoxGeometry(0.28, 8.25, 0.38),
    pierInlayGeometry: new THREE.BoxGeometry(0.035, 7.7, 0.035),
    archGeometry: new THREE.TorusGeometry(2.08, 0.09, 10, 48, Math.PI),
    shelfBackGeometry: new THREE.BoxGeometry(4.05, 1.55, 0.12),
    shelfGeometry: new THREE.BoxGeometry(4.1, 0.09, 0.42),
    shelfSideGeometry: new THREE.BoxGeometry(0.1, 1.48, 0.42),
    shelfLightGeometry: new THREE.BoxGeometry(3.72, 0.035, 0.035),
    bookGeometry: new THREE.BoxGeometry(1, 1, 0.16),
    balconyGeometry: new THREE.BoxGeometry(4.72, 0.12, 1.26),
    balconyRailGeometry: new THREE.BoxGeometry(4.62, 0.055, 0.055),
    balconyPostGeometry: new THREE.BoxGeometry(0.045, 0.56, 0.045),
    ladderSideGeometry: new THREE.BoxGeometry(0.055, 1.72, 0.055),
    ladderRungGeometry: new THREE.BoxGeometry(0.4, 0.045, 0.05),
    ceilingRibGeometry: new THREE.BoxGeometry(0.035, 0.05, 12),
    ceilingLightGeometry: new THREE.BoxGeometry(0.1, 0.028, 8.4),
    pendantCableGeometry: new THREE.CylinderGeometry(0.012, 0.012, 0.74, 8),
    pendantShadeGeometry: new THREE.CylinderGeometry(0.26, 0.48, 0.18, 24, 1, true),
    pendantGlowGeometry: new THREE.CylinderGeometry(0.29, 0.29, 0.025, 24),
    floorSeamGeometry: new THREE.BoxGeometry(0.018, 0.014, 24),
    floorTileGeometry: new THREE.BoxGeometry(4.52, 0.025, 2.75),
    runnerDividerGeometry: new THREE.BoxGeometry(0.045, 0.025, 6.55),
    runnerMedallionGeometry: new THREE.RingGeometry(0.42, 0.5, 40),
    runnerDiamondGeometry: new THREE.BoxGeometry(0.42, 0.018, 0.42),
    platformLightGeometry: new THREE.BoxGeometry(0.42, 0.05, 0.025),
    cartShelfGeometry: new THREE.BoxGeometry(1.18, 0.07, 0.68),
    cartPostGeometry: new THREE.BoxGeometry(0.045, 1.12, 0.045),
    cartHandleSideGeometry: new THREE.BoxGeometry(0.045, 0.72, 0.045),
    cartHandleGripGeometry: new THREE.BoxGeometry(0.045, 0.045, 0.56),
    cartWheelGeometry: new THREE.TorusGeometry(0.11, 0.035, 8, 18),
    cartFileGeometry: new THREE.BoxGeometry(1, 1, 0.14),
    cartLampBaseGeometry: new THREE.CylinderGeometry(0.15, 0.19, 0.06, 20),
    cartLampStemGeometry: new THREE.CylinderGeometry(0.018, 0.025, 0.6, 12),
    cartLampShadeGeometry: new THREE.CylinderGeometry(0.15, 0.28, 0.2, 20, 1, true),
    cartLampGlowGeometry: new THREE.SphereGeometry(0.09, 16, 12),
    trackTieGeometry: new THREE.BoxGeometry(0.09, 0.035, 1.5),
    structureMaterial,
    stoneMaterial,
    woodMaterial,
    brassMaterial,
    runnerPatternMaterial,
    cartFrameMaterial,
    cartShelfMaterial,
    shelfBackMaterial,
    pendantMaterial,
    wallInsetMaterial,
    floorSeamMaterial,
    lightMaterial,
    pendantGlowMaterial,
    violetGuideMaterial,
    greenGuideMaterial,
    bookMaterials,
    floorTileMaterials,
  }

  shared.shelfUnitGeometry = mergePlacedGeometries([
    ...[3.0, 3.7, 4.4].map((shelfY) => ({
      geometry: shared.shelfGeometry,
      position: [0, shelfY, -2.08],
    })),
    ...[-1.92, 1.92].map((shelfX) => ({
      geometry: shared.shelfSideGeometry,
      position: [shelfX, 3.7, -2.08],
    })),
  ])
  shared.balconyRailingGeometry = mergePlacedGeometries([
    {
      geometry: shared.balconyRailGeometry,
      position: [0, 3.53, -1.08],
    },
    ...[-2.2, -1.1, 0, 1.1, 2.2].map((railX) => ({
      geometry: shared.balconyPostGeometry,
      position: [railX, 3.28, -1.08],
    })),
  ])
  shared.ladderUnitGeometry = mergePlacedGeometries([
    ...[1.28, 1.66].map((sideX) => ({
      geometry: shared.ladderSideGeometry,
      position: [sideX, 3.67, -1.47],
      rotation: [0, 0, -0.09],
    })),
    ...Array.from({ length: 6 }, (_, rungIndex) => ({
      geometry: shared.ladderRungGeometry,
      position: [1.47 + (rungIndex - 2.5) * 0.018, 3.02 + rungIndex * 0.26, -1.46],
      rotation: [0, 0, -0.09],
    })),
  ])
  shared.cartShelvesGeometry = mergePlacedGeometries([
    { geometry: shared.cartShelfGeometry, position: [0, 0.28, 0] },
    { geometry: shared.cartShelfGeometry, position: [0, 0.94, 0] },
  ])
  shared.cartFrameGeometry = mergePlacedGeometries([
    ...[-0.54, 0.54].flatMap((x) =>
      [-0.29, 0.29].map((z) => ({
        geometry: shared.cartPostGeometry,
        position: [x, 0.62, z],
      })),
    ),
    { geometry: shared.cartHandleSideGeometry, position: [0.58, 1.28, -0.23] },
    { geometry: shared.cartHandleSideGeometry, position: [0.58, 1.28, 0.23] },
    ...[-0.42, 0.42].map((x) => ({
      geometry: shared.cartWheelGeometry,
      position: [x, 0.08, 0.38],
    })),
  ])

  for (let bayIndex = 0; bayIndex < ENVIRONMENT_BAY_COUNT; bayIndex += 1) {
    const bay = createArchiveBay(bayIndex, shared)
    environmentBays.push(bay)
    environmentRoot.add(bay)
  }

  leftArchiveFeature = createArchiveIndexFeature(shared)
  environmentRoot.add(leftArchiveFeature)

  const platform = new THREE.Mesh(new THREE.BoxGeometry(80, 0.12, 2.3), platformMaterial)
  platform.position.set(0, -2.96, -0.62)
  platform.receiveShadow = true

  const platformEdge = new THREE.Mesh(new THREE.BoxGeometry(80, 0.2, 0.1), trackMaterial)
  platformEdge.position.set(0, -2.93, 0.5)
  platformEdge.castShadow = true

  const rearRail = new THREE.Mesh(new THREE.BoxGeometry(80, 0.045, 0.09), trackMaterial)
  rearRail.position.set(0, -2.875, -1.25)
  const frontRail = rearRail.clone()
  frontRail.position.z = 0.02
  environmentShell.add(platform, platformEdge, rearRail, frontRail)

  const violetGuide = new THREE.Mesh(new THREE.BoxGeometry(80, 0.018, 0.035), violetGuideMaterial)
  violetGuide.position.set(0, -2.958, 1.85)
  const greenGuide = new THREE.Mesh(new THREE.BoxGeometry(80, 0.018, 0.035), greenGuideMaterial)
  greenGuide.position.set(0, -2.948, 5.75)
  environmentShell.add(violetGuide, greenGuide)

  const runner = new THREE.Mesh(new THREE.BoxGeometry(80, 0.03, 6.55), runnerMaterial)
  runner.position.set(0, -2.982, 7.2)
  runner.receiveShadow = true
  const farRunnerBorder = new THREE.Mesh(new THREE.BoxGeometry(80, 0.045, 0.075), brassMaterial)
  farRunnerBorder.position.set(0, -2.958, 3.92)
  const nearRunnerBorder = farRunnerBorder.clone()
  nearRunnerBorder.position.z = 10.48
  environmentShell.add(runner, farRunnerBorder, nearRunnerBorder)

  const crossSeamGeometry = new THREE.BoxGeometry(80, 0.018, 0.025)
  for (const z of [0.7, 1.62, 2.54, 3.46]) {
    const crossSeam = new THREE.Mesh(crossSeamGeometry, brassMaterial)
    crossSeam.position.set(0, -2.978, z)
    environmentShell.add(crossSeam)
  }

  const dustPositions = new Float32Array(96 * 3)
  let seed = 5187
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  for (let index = 0; index < dustPositions.length; index += 3) {
    dustPositions[index] = -18 + random() * 40
    dustPositions[index + 1] = -2.6 + random() * 5.7
    dustPositions[index + 2] = -1.3 + random() * 12.5
  }

  const dustGeometry = new THREE.BufferGeometry()
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
  environmentDust = new THREE.Points(
    dustGeometry,
    new THREE.PointsMaterial({
      color: 0xd9e8e1,
      size: 0.025,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      fog: true,
    }),
  )
  markDynamicTransform(environmentDust)
  environmentDust.name = 'ambient-dust'
  environmentShell.add(environmentDust)
}

function createFileRack(shared) {
  const fileRack = markDynamicTransform(new THREE.Group())
  fileRack.name = 'active-file-rack'

  const files = Array.from({ length: 8 }, (_, fileIndex) => {
    const fileGroup = markDynamicTransform(new THREE.Group())
    const folderMaterial = shared.fileMaterials[fileIndex % shared.fileMaterials.length]
    const folderBack = new THREE.Mesh(shared.fileBackGeometry, folderMaterial)
    folderBack.rotation.x = -0.025
    folderBack.castShadow = true

    const folderFront = new THREE.Mesh(shared.fileFrontGeometry, folderMaterial)
    folderFront.position.set(0, -0.1, 0.078)
    folderFront.rotation.x = 0.035
    folderFront.castShadow = true

    const folderGusset = new THREE.Mesh(shared.fileGussetGeometry, folderMaterial)
    folderGusset.castShadow = true

    const paperSheets = shared.filePaperGeometries.map((geometry, paperIndex) => {
      const paper = new THREE.Mesh(
        geometry,
        shared.filePaperMaterials[paperIndex % shared.filePaperMaterials.length],
      )
      paper.position.set(
        [-0.02, 0.015, -0.01][paperIndex],
        0.004 + paperIndex * 0.02,
        0.022 + paperIndex * 0.022,
      )
      paper.rotation.x = 0.07 + paperIndex * 0.035
      paper.rotation.z = ((fileIndex + paperIndex) % 3 - 1) * 0.007
      paper.castShadow = paperIndex === shared.filePaperGeometries.length - 1
      return paper
    })

    const foldLine = new THREE.Mesh(shared.fileCreaseGeometry, shared.fileCreaseMaterial)
    foldLine.position.set(0, -0.245, 0.052)

    const pocketLine = new THREE.Mesh(shared.filePocketLineGeometry, shared.fileCreaseMaterial)
    pocketLine.position.set(0, 0.047, 0.098)

    const hangingRail = new THREE.Mesh(shared.fileRailGeometry, shared.fileRailMaterial)
    hangingRail.position.set(0, 0.264, 0.004)
    hangingRail.rotation.z = Math.PI / 2
    hangingRail.castShadow = true

    for (const [lineIndex, lineY] of [0.175, 0.135, 0.095, 0.058].entries()) {
      const geometry = lineIndex === 1 || lineIndex === 3
        ? shared.filePaperShortLineGeometry
        : shared.filePaperLineGeometry
      const paperLine = new THREE.Mesh(geometry, shared.filePaperLineMaterial)
      paperLine.position.set(-0.07 + lineIndex * 0.02, lineY, 0.108)
      fileGroup.add(paperLine)
    }

    if (fileIndex % 2 === 0) {
      const contractStamp = new THREE.Mesh(
        shared.fileContractStampGeometry,
        shared.fileContractStampMaterial,
      )
      contractStamp.position.set(0.285, 0.13, 0.105)
      contractStamp.rotation.z = (fileIndex % 3 - 1) * 0.08
      fileGroup.add(contractStamp)
    }

    const tabX = ((fileIndex % 4) - 1.5) * 0.205
    const tab = new THREE.Mesh(shared.fileTabGeometry, folderMaterial)
    tab.position.set(tabX, 0.298, 0.012)
    tab.castShadow = true
    const tabPlate = new THREE.Mesh(shared.fileTabPlateGeometry, shared.filePaperMaterial)
    tabPlate.position.set(tabX, 0.299, 0.022)
    const tabMark = new THREE.Mesh(shared.fileTabMarkGeometry, shared.fileTabMarkMaterial)
    tabMark.position.set(tabX - 0.018, 0.3, 0.029)
    const tabMarkShort = new THREE.Mesh(shared.fileTabMarkShortGeometry, shared.fileTabMarkMaterial)
    tabMarkShort.position.set(tabX + 0.042, 0.3, 0.029)

    for (const hookX of [-0.515, 0.515]) {
      const hangingHook = new THREE.Mesh(shared.fileHookGeometry, shared.fileHookMaterial)
      hangingHook.position.set(hookX, 0.264, 0.004)
      fileGroup.add(hangingHook)
    }

    const hoverFrame = markDynamicTransform(new THREE.Group())
    const hoverRail = new THREE.Mesh(shared.fileHoverRailGeometry, shared.fileHoverMaterial)
    hoverRail.position.y = 0.264
    hoverRail.rotation.z = Math.PI / 2
    const hoverLeft = new THREE.Mesh(shared.fileHoverClipGeometry, shared.fileHoverMaterial)
    hoverLeft.position.set(-0.525, 0.264, 0)
    const hoverRight = hoverLeft.clone()
    hoverRight.position.x = 0.525
    hoverFrame.position.z = 0.022
    hoverFrame.visible = false
    hoverFrame.add(hoverRail, hoverLeft, hoverRight)

    const selectionMark = new THREE.Mesh(shared.fileSelectionGeometry, shared.fileHoverMaterial)
    markDynamicTransform(selectionMark)
    selectionMark.position.set(0.445, 0.302, 0.048)
    selectionMark.rotation.z = Math.PI / 4
    selectionMark.visible = false

    fileGroup.add(
      folderBack,
      folderFront,
      folderGusset,
      ...paperSheets,
      foldLine,
      pocketLine,
      hangingRail,
      tab,
      tabPlate,
      tabMark,
      tabMarkShort,
      hoverFrame,
      selectionMark,
    )

    fileGroup.position.set(0, -0.105 + fileIndex * 0.01, -0.205 - fileIndex * 0.165)
    fileGroup.userData.fileIndex = fileIndex
    fileGroup.userData.closedY = fileGroup.position.y
    fileGroup.userData.openY = 0.065 + fileIndex * 0.007
    fileGroup.userData.baseZ = fileGroup.position.z
    fileGroup.userData.baseRotationZ = ((fileIndex % 5) - 2) * 0.003
    fileGroup.rotation.z = fileGroup.userData.baseRotationZ
    fileGroup.userData.label = `合同文件 ${String(fileIndex + 1).padStart(2, '0')}.pdf`
    fileGroup.userData.hoverProgress = 0
    fileGroup.userData.hoverFrame = hoverFrame
    fileGroup.userData.selectionMark = selectionMark
    fileGroup.userData.folderMeshes = [folderBack, folderFront, folderGusset, tab]
    fileGroup.userData.pickTargets = [folderBack, folderFront, folderGusset, ...paperSheets, tab, tabPlate]
    fileGroup.userData.pickTargets.forEach((part) => {
      part.userData.document = fileGroup
    })
    fileRack.add(fileGroup)
    return fileGroup
  })

  fileRack.visible = false
  fileRack.userData.fileMaterials = shared.fileMaterials
  return { fileRack, files }
}

function createDrawer(columnIndex, rowIndex, shared) {
  const assembly = new THREE.Group()
  const mechanicsGroup = new THREE.Group()
  const drawer = markDynamicTransform(new THREE.Group())
  const interiorGroup = new THREE.Group()

  const cavityBack = new THREE.Mesh(shared.cavityBackGeometry, shared.cavityMaterial)
  cavityBack.position.set(0, 0, -1.52)
  cavityBack.receiveShadow = true
  const cavityTop = new THREE.Mesh(shared.cavityHorizontalGeometry, shared.cavityMaterial)
  cavityTop.position.set(0, 0.41, -0.76)
  const cavityBottom = cavityTop.clone()
  cavityBottom.position.y = -0.41
  const cavityLeft = new THREE.Mesh(shared.cavitySideGeometry, shared.cavityMaterial)
  cavityLeft.position.set(-0.725, 0, -0.76)
  const cavityRight = cavityLeft.clone()
  cavityRight.position.x = 0.725
  mechanicsGroup.add(cavityBack, cavityTop, cavityBottom, cavityLeft, cavityRight)

  const middleRailGroup = markDynamicTransform(new THREE.Group())
  const bearingInstances = new THREE.InstancedMesh(
    shared.railBearingGeometry,
    shared.railHighlightMaterial,
    10,
  )
  const bearingMatrix = new THREE.Matrix4()
  let bearingInstanceIndex = 0
  for (const side of [-1, 1]) {
    const outerRail = new THREE.Mesh(shared.outerRailGeometry, shared.outerRailMaterial)
    outerRail.position.set(side * 0.705, -0.21, -0.74)
    const outerRailAccent = new THREE.Mesh(shared.outerRailAccentGeometry, shared.railHighlightMaterial)
    outerRailAccent.position.set(side * 0.68, -0.21, -0.74)

    const middleRail = new THREE.Mesh(shared.middleRailGeometry, shared.middleRailMaterial)
    middleRail.position.set(side * 0.685, -0.21, -0.7)
    middleRail.castShadow = true
    middleRailGroup.add(middleRail)

    for (let bearingIndex = 0; bearingIndex < 5; bearingIndex += 1) {
      bearingMatrix.makeTranslation(side * 0.665, -0.21, -1.12 + bearingIndex * 0.22)
      bearingInstances.setMatrixAt(bearingInstanceIndex, bearingMatrix)
      bearingInstanceIndex += 1
    }

    const innerRail = new THREE.Mesh(shared.innerRailGeometry, shared.railHighlightMaterial)
    innerRail.position.set(side * 0.674, -0.21, -0.7)
    innerRail.castShadow = true
    interiorGroup.add(innerRail)
    mechanicsGroup.add(outerRail, outerRailAccent)
  }
  bearingInstances.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  bearingInstances.instanceMatrix.needsUpdate = true
  middleRailGroup.add(bearingInstances)
  mechanicsGroup.add(middleRailGroup)
  mechanicsGroup.visible = false
  interiorGroup.visible = false
  drawer.add(interiorGroup)
  assembly.add(mechanicsGroup, drawer)

  const frontMaterial = shared.frontMaterials[rowIndex % shared.frontMaterials.length]
  const front = new THREE.Mesh(shared.frontGeometry, frontMaterial)
  front.position.z = 0.04
  front.castShadow = true
  front.receiveShadow = true

  const inset = new THREE.Mesh(shared.insetGeometry, shared.insetMaterial)
  inset.position.set(0, 0.04, 0.105)

  const topTrim = new THREE.Mesh(shared.frontTrimHorizontalGeometry, shared.frontTrimMaterial)
  topTrim.position.set(0, 0.385, 0.142)
  const bottomTrim = topTrim.clone()
  bottomTrim.position.y = -0.345
  const leftTrim = new THREE.Mesh(shared.frontTrimVerticalGeometry, shared.frontTrimMaterial)
  leftTrim.position.set(-0.6, 0.02, 0.142)
  const rightTrim = leftTrim.clone()
  rightTrim.position.x = 0.6

  const handle = new THREE.Mesh(shared.handleGeometry, shared.handleMaterial)
  handle.position.set(0, 0.17, 0.17)
  handle.rotation.z = Math.PI / 2

  const leftHandleMount = new THREE.Mesh(shared.handleMountGeometry, shared.handleMaterial)
  leftHandleMount.position.set(-0.18, 0.17, 0.125)
  const rightHandleMount = leftHandleMount.clone()
  rightHandleMount.position.x = 0.18

  const labelPlate = new THREE.Mesh(shared.labelGeometry, shared.labelMaterial)
  labelPlate.position.set(0, -0.18, 0.155)

  const labelMark = new THREE.Mesh(shared.labelMarkGeometry, shared.labelMarkMaterial)
  labelMark.position.set((rowIndex - 2) * 0.045, -0.18, 0.19)

  const bottom = new THREE.Mesh(shared.bottomGeometry, shared.drawerBodyMaterial)
  bottom.position.set(0, -0.4, -0.72)
  const leftSide = new THREE.Mesh(shared.sideGeometry, shared.drawerBodyMaterial)
  leftSide.position.set(-0.64, -0.02, -0.72)
  const rightSide = leftSide.clone()
  rightSide.position.x = 0.64
  const back = new THREE.Mesh(shared.backGeometry, shared.drawerBodyMaterial)
  back.position.set(0, -0.02, -1.43)

  const leftLip = new THREE.Mesh(shared.sideLipGeometry, shared.drawerEdgeMaterial)
  leftLip.position.set(-0.64, 0.35, -0.72)
  const rightLip = leftLip.clone()
  rightLip.position.x = 0.64

  const interiorGlow = new THREE.Mesh(shared.interiorGlowGeometry, shared.interiorGlowMaterial)
  interiorGlow.position.set(0, -0.02, -1.455)

  interiorGroup.add(
    bottom,
    leftSide,
    rightSide,
    back,
    leftLip,
    rightLip,
    interiorGlow,
  )

  drawer.add(
    front,
    inset,
    topTrim,
    bottomTrim,
    leftTrim,
    rightTrim,
    leftHandleMount,
    rightHandleMount,
    handle,
    labelPlate,
    labelMark,
  )

  for (const part of [bottom, leftSide, rightSide, back, leftLip, rightLip, handle]) {
    part.castShadow = true
  }

  const fastenerInstances = new THREE.InstancedMesh(
    shared.fastenerGeometry,
    shared.railHighlightMaterial,
    4,
  )
  const fastenerMatrix = new THREE.Matrix4()
  const fastenerQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0))
  let fastenerInstanceIndex = 0
  for (const x of [-0.56, 0.56]) {
    for (const y of [-0.34, 0.36]) {
      fastenerMatrix.compose(
        new THREE.Vector3(x, y, 0.17),
        fastenerQuaternion,
        new THREE.Vector3(1, 1, 1),
      )
      fastenerInstances.setMatrixAt(fastenerInstanceIndex, fastenerMatrix)
      fastenerInstanceIndex += 1
    }
  }
  fastenerInstances.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  fastenerInstances.instanceMatrix.needsUpdate = true
  drawer.add(fastenerInstances)

  const drawerData = {
    columnIndex,
    rowIndex,
    label: `抽屉 ${String(rowIndex + 1).padStart(2, '0')} · 柜列 ${String(columnIndex + 1).padStart(2, '0')}`,
    group: drawer,
    front,
    middleRailGroup,
    mechanicsGroup,
    interiorGroup,
    open: false,
    progress: 0,
    hoverProgress: 0,
  }

  front.userData.drawer = drawerData
  interactiveFronts.push(front)
  drawers.push(drawerData)
  return assembly
}

function createCabinetColumn(columnIndex, shared) {
  const column = markDynamicTransform(new THREE.Group())

  column.userData.columnIndex = columnIndex

  const backPanel = new THREE.Mesh(shared.cabinetBackGeometry, shared.cabinetBackMaterial)
  backPanel.position.z = -1.48
  backPanel.receiveShadow = true
  column.add(backPanel)

  const leftPost = new THREE.Mesh(shared.verticalPostGeometry, shared.frameMaterial)
  leftPost.position.set(-0.77, 0, -0.73)
  leftPost.castShadow = true
  const rightPost = leftPost.clone()
  rightPost.position.x = 0.77
  column.add(leftPost, rightPost)

  for (let railIndex = 0; railIndex <= ROW_COUNT; railIndex += 1) {
    const rail = new THREE.Mesh(shared.horizontalRailGeometry, shared.frameMaterial)
    rail.position.set(0, (ROW_COUNT / 2 - railIndex) * ROW_SPACING, -0.72)
    rail.castShadow = true
    column.add(rail)
  }

  for (let rowIndex = 0; rowIndex < ROW_COUNT; rowIndex += 1) {
    const drawer = createDrawer(columnIndex, rowIndex, shared)
    drawers[drawers.length - 1].column = column
    drawer.position.set(0, ((ROW_COUNT - 1) / 2 - rowIndex) * ROW_SPACING, 0)
    column.add(drawer)
  }

  cabinetColumns.push(column)
  cabinetRoot.add(column)
}

function createCabinet() {
  cabinetRoot = new THREE.Group()
  scene.add(cabinetRoot)

  const shared = {
    frontGeometry: new RoundedBoxGeometry(1.38, 0.94, 0.12, 3, 0.035),
    insetGeometry: new RoundedBoxGeometry(1.22, 0.78, 0.025, 2, 0.025),
    frontTrimHorizontalGeometry: new RoundedBoxGeometry(1.18, 0.035, 0.025, 2, 0.012),
    frontTrimVerticalGeometry: new RoundedBoxGeometry(0.035, 0.7, 0.025, 2, 0.012),
    handleGeometry: new THREE.CapsuleGeometry(0.04, 0.38, 4, 10),
    handleMountGeometry: new THREE.BoxGeometry(0.055, 0.12, 0.075),
    labelGeometry: new THREE.BoxGeometry(0.4, 0.14, 0.04),
    labelMarkGeometry: new THREE.BoxGeometry(0.12, 0.035, 0.025),
    bottomGeometry: new THREE.BoxGeometry(1.27, 0.06, 1.42),
    sideGeometry: new THREE.BoxGeometry(0.06, 0.72, 1.42),
    backGeometry: new THREE.BoxGeometry(1.27, 0.72, 0.06),
    sideLipGeometry: new RoundedBoxGeometry(0.07, 0.07, 1.44, 2, 0.02),
    interiorGlowGeometry: new THREE.BoxGeometry(1.12, 0.58, 0.025),
    cavityBackGeometry: new THREE.BoxGeometry(1.34, 0.82, 0.06),
    cavityHorizontalGeometry: new THREE.BoxGeometry(1.36, 0.04, 1.55),
    cavitySideGeometry: new THREE.BoxGeometry(0.04, 0.78, 1.55),
    outerRailGeometry: new RoundedBoxGeometry(0.05, 0.11, 1.34, 2, 0.018),
    outerRailAccentGeometry: new THREE.BoxGeometry(0.012, 0.038, 1.18),
    middleRailGeometry: new RoundedBoxGeometry(0.038, 0.075, 1.18, 2, 0.014),
    innerRailGeometry: new RoundedBoxGeometry(0.026, 0.048, 1.27, 2, 0.012),
    railBearingGeometry: new THREE.SphereGeometry(0.024, 10, 8),
    fastenerGeometry: new THREE.CylinderGeometry(0.025, 0.025, 0.014, 12),
    fileBackGeometry: createFlexibleSheetGeometry(1.02, 0.54, {
      bow: 0.012,
      taper: 0.045,
      wave: 0.004,
    }),
    fileFrontGeometry: createFlexibleSheetGeometry(0.99, 0.3, {
      bow: 0.018,
      taper: 0.055,
      wave: 0.005,
    }),
    fileGussetGeometry: createFolderGussetGeometry(),
    filePaperGeometries: [
      createFlexibleSheetGeometry(0.88, 0.43, { bow: 0.009, taper: 0.018, wave: 0.004 }),
      createFlexibleSheetGeometry(0.9, 0.415, { bow: 0.012, taper: 0.015, wave: 0.005 }),
      createFlexibleSheetGeometry(0.865, 0.4, { bow: 0.008, taper: 0.02, wave: 0.003 }),
    ],
    fileCreaseGeometry: new RoundedBoxGeometry(0.86, 0.009, 0.009, 2, 0.004),
    filePocketLineGeometry: new RoundedBoxGeometry(0.82, 0.01, 0.008, 2, 0.004),
    filePaperLineGeometry: new THREE.BoxGeometry(0.42, 0.008, 0.005),
    filePaperShortLineGeometry: new THREE.BoxGeometry(0.27, 0.008, 0.005),
    fileContractStampGeometry: new THREE.RingGeometry(0.027, 0.037, 20),
    fileRailGeometry: new THREE.CapsuleGeometry(0.006, 1.045, 4, 10),
    fileHookGeometry: new RoundedBoxGeometry(0.064, 0.024, 0.024, 2, 0.007),
    fileTabGeometry: createFlexibleSheetGeometry(0.22, 0.086, {
      bow: 0.003,
      taper: 0.015,
      wave: 0.001,
      segmentsX: 4,
      segmentsY: 2,
    }),
    fileTabPlateGeometry: new THREE.PlaneGeometry(0.165, 0.045),
    fileTabMarkGeometry: new THREE.BoxGeometry(0.07, 0.007, 0.004),
    fileTabMarkShortGeometry: new THREE.BoxGeometry(0.032, 0.007, 0.004),
    fileHoverRailGeometry: new THREE.CapsuleGeometry(0.014, 1.04, 4, 10),
    fileHoverClipGeometry: new RoundedBoxGeometry(0.07, 0.031, 0.014, 2, 0.007),
    fileSelectionGeometry: new THREE.PlaneGeometry(0.045, 0.045),
    cabinetBackGeometry: new THREE.BoxGeometry(1.55, ROW_COUNT * ROW_SPACING, 0.12),
    verticalPostGeometry: new THREE.BoxGeometry(0.08, ROW_COUNT * ROW_SPACING + 0.08, 1.58),
    horizontalRailGeometry: new THREE.BoxGeometry(1.54, 0.08, 1.58),
    frontMaterials: [
      createMaterial(0xe7ece9, { emissive: 0x6f73c8, emissiveIntensity: 0 }),
      createMaterial(0xdfe7e3, { emissive: 0x6f73c8, emissiveIntensity: 0 }),
    ],
    insetMaterial: createMaterial(0xcfd9d4, { roughness: 0.72, metalness: 0.08 }),
    frontTrimMaterial: createMaterial(0xa9b8b1, { roughness: 0.42, metalness: 0.42 }),
    handleMaterial: createMaterial(0x71827a, { roughness: 0.34, metalness: 0.58 }),
    drawerEdgeMaterial: createMaterial(0x889a91, { roughness: 0.36, metalness: 0.48 }),
    cavityMaterial: createMaterial(0x33423b, { roughness: 0.74, metalness: 0.12, side: THREE.DoubleSide }),
    outerRailMaterial: createMaterial(0x53625b, { roughness: 0.3, metalness: 0.7 }),
    middleRailMaterial: createMaterial(0x7d8b84, { roughness: 0.24, metalness: 0.78 }),
    railHighlightMaterial: createMaterial(0xd2ddd7, { roughness: 0.12, metalness: 0.94 }),
    interiorGlowMaterial: createMaterial(0xe7dfc8, {
      emissive: 0xd6bc79,
      emissiveIntensity: 0.42,
      roughness: 0.76,
      metalness: 0.02,
    }),
    labelMaterial: createMaterial(0xf4f6f5, { roughness: 0.65, metalness: 0.06 }),
    labelMarkMaterial: createMaterial(0x7b70c3, { roughness: 0.46, metalness: 0.12 }),
    fileTabMarkMaterial: createMaterial(0x6e65ad, { roughness: 0.56, metalness: 0.08 }),
    filePaperMaterial: createMaterial(0xf6f0df, {
      emissive: 0xc7b98f,
      emissiveIntensity: 0.16,
      roughness: 0.96,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    filePaperMaterials: [
      createMaterial(0xeee7d6, {
        emissive: 0xbeb18e,
        emissiveIntensity: 0.12,
        roughness: 0.97,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
      createMaterial(0xf8f3e7, {
        emissive: 0xcfc3a0,
        emissiveIntensity: 0.16,
        roughness: 0.98,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
      createMaterial(0xe4ded1, {
        emissive: 0xb6aa8c,
        emissiveIntensity: 0.13,
        roughness: 0.96,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    ],
    filePaperLineMaterial: new THREE.MeshBasicMaterial({
      color: 0x6f7773,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
    fileContractStampMaterial: new THREE.MeshBasicMaterial({
      color: 0xa4544b,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
    fileCreaseMaterial: createMaterial(0x5f6963, { roughness: 0.82, metalness: 0.02 }),
    fileRailMaterial: createMaterial(0x555b52, { roughness: 0.52, metalness: 0.46 }),
    fileHookMaterial: createMaterial(0x998052, { roughness: 0.32, metalness: 0.72 }),
    fileHoverMaterial: createMaterial(0xc7bfff, {
      emissive: 0x776fca,
      emissiveIntensity: 0.85,
      roughness: 0.3,
      metalness: 0.22,
    }),
    fileMaterials: [
      createMaterial(0xa69cbd, { roughness: 0.92, metalness: 0, side: THREE.DoubleSide }),
      createMaterial(0x8eaa98, { roughness: 0.93, metalness: 0, side: THREE.DoubleSide }),
      createMaterial(0xc5a775, { roughness: 0.94, metalness: 0, side: THREE.DoubleSide }),
      createMaterial(0xb4867b, { roughness: 0.93, metalness: 0, side: THREE.DoubleSide }),
      createMaterial(0x86a1aa, { roughness: 0.92, metalness: 0, side: THREE.DoubleSide }),
      createMaterial(0xb8ae98, { roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
    ],
    drawerBodyMaterial: createMaterial(0xb8c5bf, { roughness: 0.7, metalness: 0.12, side: THREE.DoubleSide }),
    cabinetBackMaterial: createMaterial(0xc8d2cd, { roughness: 0.8, metalness: 0.08 }),
    frameMaterial: createMaterial(0x8fa098, { roughness: 0.45, metalness: 0.42 }),
  }

  leftEndCap = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, ROW_COUNT * ROW_SPACING + 0.22, 1.72),
    shared.frameMaterial,
  )
  markDynamicTransform(leftEndCap)
  leftEndCap.position.set(cabinetLeftEdge - 0.06, 0, -0.72)
  leftEndCap.castShadow = true
  cabinetRoot.add(leftEndCap)

  for (let columnIndex = 0; columnIndex < COLUMN_COUNT; columnIndex += 1) {
    createCabinetColumn(columnIndex, shared)
  }

  const reusableFileRack = createFileRack(shared)
  activeFileRack = reusableFileRack.fileRack
  activeFiles.push(...reusableFileRack.files)
  cabinetRoot.add(activeFileRack)

  drawerHighlightMaterial = new THREE.MeshBasicMaterial({
    color: 0x8175ca,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  drawerHighlight = markDynamicTransform(
    new THREE.Mesh(shared.insetGeometry, drawerHighlightMaterial),
  )
  drawerHighlight.name = 'active-drawer-highlight'
  drawerHighlight.position.set(0, 0.04, 0.137)
  drawerHighlight.renderOrder = 2
  drawerHighlight.visible = false
  cabinetRoot.add(drawerHighlight)
}

function activateFileRack(drawer) {
  if (!activeFileRack) return

  setHoveredDocument(null)
  activeFileOwner = drawer
  drawer.interiorGroup.add(activeFileRack)
  activeFileRack.position.set(0, 0, 0)
  activeFileRack.rotation.set(0, 0, 0)

  const fileMaterials = activeFileRack.userData.fileMaterials
  activeFiles.forEach((file) => {
    const materialIndex =
      (file.userData.fileIndex + drawer.columnIndex + drawer.rowIndex) % fileMaterials.length
    file.userData.folderMeshes.forEach((mesh) => {
      mesh.material = fileMaterials[materialIndex]
    })
    file.userData.hoverProgress = 0
    file.position.set(0, file.userData.closedY, file.userData.baseZ)
    file.rotation.set(0, 0, file.userData.baseRotationZ)
    file.userData.hoverFrame.visible = false
    file.userData.selectionMark.visible = false
  })

  activeFileRack.visible = true
}

function parkActiveFileRack() {
  if (!activeFileRack || !activeFileOwner) return

  setHoveredDocument(null)
  activeFileRack.visible = false
  cabinetRoot.add(activeFileRack)
  activeFileRack.position.set(0, 0, 0)
  activeFileRack.rotation.set(0, 0, 0)
  activeFileOwner = null
}

function updateDrawerHighlight(delta, reducedMotion) {
  if (!drawerHighlight || !drawerHighlightMaterial) return

  const targetDrawer = focusedDrawer ?? hoveredDrawer
  if (targetDrawer && highlightedDrawer !== targetDrawer) {
    highlightedDrawer = targetDrawer
    targetDrawer.group.add(drawerHighlight)
    drawerHighlight.position.set(0, 0.04, 0.137)
    drawerHighlight.rotation.set(0, 0, 0)
    drawerHighlight.visible = true
  }

  const targetOpacity = focusedDrawer ? 0.07 : hoveredDrawer ? 0.16 : 0
  highlightedDrawerProgress = THREE.MathUtils.damp(
    highlightedDrawerProgress,
    targetOpacity,
    reducedMotion ? 22 : 12,
    delta,
  )
  drawerHighlightMaterial.opacity = highlightedDrawerProgress

  if (!targetDrawer && highlightedDrawerProgress < 0.002) {
    drawerHighlight.visible = false
    cabinetRoot.add(drawerHighlight)
    drawerHighlight.position.set(0, 0.04, 0.137)
    highlightedDrawer = null
  }
}

function getColumnPosition(columnIndex) {
  const firstColumnCenter = cabinetLeftEdge + COLUMN_SPACING / 2
  const recycleBoundary = camera.position.x + viewportLeftEdge - COLUMN_RECYCLE_MARGIN
  let position = firstColumnCenter + columnIndex * COLUMN_SPACING

  if (position < recycleBoundary) {
    position += Math.ceil((recycleBoundary - position) / COLUMN_SPAN) * COLUMN_SPAN
  }

  return position
}

function getEnvironmentBayPosition(bayIndex) {
  const firstBayCenter = -ENVIRONMENT_BAY_SPACING * 4
  const recycleBoundary = camera.position.x + viewportLeftEdge - ENVIRONMENT_RECYCLE_MARGIN
  let position = firstBayCenter + bayIndex * ENVIRONMENT_BAY_SPACING

  if (position < recycleBoundary) {
    position += Math.ceil((recycleBoundary - position) / ENVIRONMENT_BAY_SPAN) * ENVIRONMENT_BAY_SPAN
  }

  return position
}

function updateWorldLayout(force = false) {
  const cameraChanged = Math.abs(camera.position.x - lastLayoutCameraX) > 0.0005
  const edgeChanged = Math.abs(cabinetLeftEdge - lastCabinetLeftEdge) > 0.0005
  if (!force && !cameraChanged && !edgeChanged) return

  let worldObjectsMoved = false
  environmentBays.forEach((bay) => {
    const nextX = getEnvironmentBayPosition(bay.userData.bayIndex)
    if (Math.abs(nextX - bay.position.x) > 0.0005) {
      bay.position.x = nextX
      worldObjectsMoved = true
    }
  })

  cabinetColumns.forEach((column) => {
    const nextX = getColumnPosition(column.userData.columnIndex)
    if (Math.abs(nextX - column.position.x) > 0.0005) {
      column.position.x = nextX
      worldObjectsMoved = true
    }
  })

  if (edgeChanged || force) {
    leftArchiveFeature.position.x = cabinetLeftEdge - 0.8
    leftEndCap.position.x = cabinetLeftEdge - 0.06
    worldObjectsMoved = true
  }

  lastLayoutCameraX = camera.position.x
  lastCabinetLeftEdge = cabinetLeftEdge
  if (worldObjectsMoved) shadowDirty = true
}

function updateSceneVisibility() {
  const cabinetVisibilityDistance = viewportHalfWidth + CABINET_VISIBILITY_MARGIN
  const environmentVisibilityDistance = viewportHalfWidth + ENVIRONMENT_VISIBILITY_MARGIN

  cabinetColumns.forEach((column) => {
    const shouldBeVisible =
      Math.abs(column.position.x - camera.position.x) < cabinetVisibilityDistance ||
      activeFileOwner?.column === column
    column.visible = shouldBeVisible
  })

  leftArchiveFeature.visible =
    Math.abs(leftArchiveFeature.position.x - camera.position.x) <
    cabinetVisibilityDistance + COLUMN_SPACING * 2
  leftEndCap.visible =
    Math.abs(leftEndCap.position.x - camera.position.x) < cabinetVisibilityDistance

  let closestShadowBay = null
  let closestShadowDistance = Number.POSITIVE_INFINITY

  environmentBays.forEach((bay) => {
    const distanceFromCamera = Math.abs(bay.position.x - camera.position.x)
    const bayIsVisible = distanceFromCamera < environmentVisibilityDistance
    const lightIsNearby = bayIsVisible && distanceFromCamera < ENVIRONMENT_BAY_SPACING * 1.75
    bay.visible = bayIsVisible
    bay.userData.pendantLight.visible = lightIsNearby
    bay.userData.pendantFillLight.visible = lightIsNearby
    bay.userData.foregroundLights.forEach((light) => {
      light.visible = lightIsNearby
    })

    if (lightIsNearby && distanceFromCamera < closestShadowDistance) {
      closestShadowDistance = distanceFromCamera
      closestShadowBay = bay
    }
  })

  if (activeShadowBay !== closestShadowBay) {
    activeShadowBay = closestShadowBay
    shadowDirty = true
  }

  environmentBays.forEach((bay) => {
    const shouldCastShadow = bay === activeShadowBay
    if (bay.userData.pendantLight.castShadow !== shouldCastShadow) {
      bay.userData.pendantLight.castShadow = shouldCastShadow
      shadowDirty = true
    }
  })
}

function updatePointer(event) {
  const canvas = canvasRef.value
  if (!canvas) return null

  const rect = canvas.getBoundingClientRect()
  return new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  )
}

function pickDrawer(event) {
  const pointer = updatePointer(event)
  if (!pointer || !raycaster || !camera) return null

  raycaster.setFromCamera(pointer, camera)
  const pickTargets = focusedDrawer ? [focusedDrawer.front] : interactiveFronts
  const intersection = raycaster.intersectObjects(pickTargets, false)[0]
  return intersection?.object.userData.drawer ?? null
}

function pickDocument(event) {
  if (
    !focusedDrawer ||
    activeFileOwner !== focusedDrawer ||
    focusedDrawer.progress < 0.72 ||
    pdfPreviewOpen.value
  ) {
    return null
  }

  const pointer = updatePointer(event)
  if (!pointer || !raycaster || !camera) return null

  raycaster.setFromCamera(pointer, camera)
  const pickTargets = activeFiles.flatMap((file) => file.userData.pickTargets)
  const intersection = raycaster.intersectObjects(pickTargets, false)[0]
  return intersection?.object.userData.document ?? null
}

function pauseSceneRendering() {
  if (animationFrame) window.cancelAnimationFrame(animationFrame)
  animationFrame = 0
  clock?.stop()
}

function resumeSceneRendering() {
  if (!renderer || animationFrame) return
  clock?.start()
  animate()
}

function closePdfPreview() {
  if (!pdfPreviewOpen.value) return

  pdfPreviewOpen.value = false
  activeDocumentLabel.value = ''
  emit('preview-visibility-change', false)
  resumeSceneRendering()
}

function openPdfPreview(document) {
  setHoveredDocument(null)
  activeDocumentLabel.value = document.userData.label
  pdfPreviewOpen.value = true
  emit('preview-visibility-change', true)
  pauseSceneRendering()
}

function closeFocusedDrawer() {
  if (!focusedDrawer) return

  setHoveredDocument(null)
  focusedDrawer.open = false
  focusedDrawer = null
  focusedDrawerLabel.value = ''
  setHoveredDrawer(null)
}

function toggleDrawer(drawer) {
  if (focusedDrawer === drawer) {
    closeFocusedDrawer()
    return
  }

  if (focusedDrawer) return

  drawers.forEach((item) => {
    if (item !== drawer) item.open = false
  })
  drawer.open = true
  focusedDrawer = drawer
  focusedDrawerLabel.value = drawer.label
  activateFileRack(drawer)
}

function handleSceneKeydown(event) {
  if (event.key !== 'Escape') return
  if (pdfPreviewOpen.value) {
    closePdfPreview()
    return
  }
  if (focusedDrawer) closeFocusedDrawer()
}

function setHoveredDocument(document, event) {
  const nextDocument = activeFileOwner === focusedDrawer && activeFiles.includes(document) ? document : null

  if (hoveredDocument === nextDocument) {
    if (nextDocument && event) updateHoverPosition(event)
    return
  }

  hoveredDocument = nextDocument
  hoveredDocumentLabel.value = nextDocument?.userData.label ?? ''
  if (nextDocument && event) updateHoverPosition(event)
  if (canvasRef.value) {
    canvasRef.value.style.cursor = nextDocument || hoveredDrawer ? 'pointer' : focusedDrawer ? 'default' : 'grab'
  }
}

function setHoveredDrawer(drawer, event) {
  const nextDrawer = focusedDrawer && drawer !== focusedDrawer ? null : drawer
  if (focusedDrawer) hoveredDrawerLabel.value = ''

  if (hoveredDrawer === nextDrawer) {
    if (nextDrawer && event && !focusedDrawer) updateHoverPosition(event)
    return
  }

  hoveredDrawer = nextDrawer
  hoveredDrawerLabel.value = focusedDrawer ? '' : nextDrawer?.label ?? ''
  if (nextDrawer && event && !focusedDrawer) updateHoverPosition(event)
  if (canvasRef.value) canvasRef.value.style.cursor = nextDrawer ? 'pointer' : focusedDrawer ? 'default' : 'grab'
}

function updateHoverPosition(event) {
  const rootRect = sceneRootRef.value?.getBoundingClientRect()
  if (!rootRect) return

  hoverPosition.value = {
    x: Math.min(event.clientX - rootRect.left + 14, rootRect.width - 152),
    y: Math.min(Math.max(event.clientY - rootRect.top + 14, 52), rootRect.height - 54),
  }
}

function handlePointerDown(event) {
  pointerState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    lastX: event.clientX,
    moved: false,
  }
  dragging.value = !focusedDrawer
  canvasRef.value?.setPointerCapture(event.pointerId)
  if (canvasRef.value) {
    canvasRef.value.style.cursor = focusedDrawer
      ? (hoveredDocument || hoveredDrawer ? 'pointer' : 'default')
      : 'grabbing'
  }
  event.preventDefault()
}

function handlePointerMove(event) {
  if (pointerState) {
    const deltaX = event.clientX - pointerState.lastX
    pointerState.lastX = event.clientX
    if (Math.abs(event.clientX - pointerState.startX) > 4) pointerState.moved = true
    if (pointerState.moved && !focusedDrawer) {
      targetScrollPosition = Math.max(0, targetScrollPosition - deltaX * 0.014)
      atLeftBoundary.value = targetScrollPosition <= 0.001
      setHoveredDrawer(null)
    }
    return
  }

  if (focusedDrawer) {
    const document = pickDocument(event)
    setHoveredDrawer(document ? null : pickDrawer(event), event)
    setHoveredDocument(document, event)
    return
  }

  setHoveredDocument(null)
  setHoveredDrawer(pickDrawer(event), event)
}

function finishPointer(event) {
  if (!pointerState) return

  const shouldOpenDrawer = !pointerState.moved
  const pointerId = pointerState.pointerId
  pointerState = null
  dragging.value = false

  if (canvasRef.value?.hasPointerCapture(pointerId)) {
    canvasRef.value.releasePointerCapture(pointerId)
  }

  if (shouldOpenDrawer) {
    const document = pickDocument(event)
    if (document) {
      openPdfPreview(document)
      setHoveredDrawer(null)
      return
    }

    const drawer = pickDrawer(event)
    if (drawer) {
      toggleDrawer(drawer)
      setHoveredDrawer(drawer, event)
    }
  } else {
    const document = pickDocument(event)
    setHoveredDrawer(document ? null : pickDrawer(event), event)
    setHoveredDocument(document, event)
  }
}

function handlePointerLeave() {
  if (!pointerState) {
    setHoveredDocument(null)
    setHoveredDrawer(null)
  }
}

function handleWheel(event) {
  if (focusedDrawer) {
    event.preventDefault()
    return
  }

  const horizontalDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  targetScrollPosition = Math.max(0, targetScrollPosition + horizontalDelta * 0.007)
  atLeftBoundary.value = targetScrollPosition <= 0.001
  setHoveredDrawer(null)
  event.preventDefault()
}

function resizeScene() {
  const root = sceneRootRef.value
  if (!root || !renderer || !camera) return

  const width = Math.max(root.clientWidth, 1)
  const height = Math.max(root.clientHeight, 1)
  renderer.setSize(width, height, false)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * BROWSE_CAMERA_Z
  viewportHalfWidth = (visibleHeight * camera.aspect) / 2
  viewportLeftEdge = -viewportHalfWidth
  const leftInsetPixels = Math.min(CABINET_LEFT_INSET_PX, width * 0.2)
  cabinetLeftEdge = viewportLeftEdge + leftInsetPixels * (visibleHeight / height)
}

function animate() {
  animationFrame = window.requestAnimationFrame(animate)
  const delta = Math.min(clock.getDelta(), 0.05)
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const motionRate = reducedMotion ? 20 : 7

  scrollPosition = THREE.MathUtils.damp(scrollPosition, targetScrollPosition, motionRate, delta)

  drawers.forEach((drawer) => {
    const previousProgress = drawer.progress
    const previousHoverProgress = drawer.hoverProgress
    drawer.progress = THREE.MathUtils.damp(drawer.progress, drawer.open ? 1 : 0, reducedMotion ? 22 : 8, delta)
    drawer.hoverProgress = THREE.MathUtils.damp(
      drawer.hoverProgress,
      hoveredDrawer === drawer ? 1 : 0,
      reducedMotion ? 22 : 12,
      delta,
    )
    drawer.group.position.z = drawer.progress * DRAWER_OPEN_DISTANCE + drawer.hoverProgress * 0.07
    drawer.middleRailGroup.position.z = drawer.progress * DRAWER_OPEN_DISTANCE * 0.52
    const interiorVisible =
      drawer.open ||
      drawer.progress > 0.015 ||
      drawer.hoverProgress > 0.015 ||
      hoveredDrawer === drawer
    drawer.mechanicsGroup.visible = interiorVisible
    drawer.interiorGroup.visible = interiorVisible

    if (
      Math.abs(drawer.progress - previousProgress) > 0.0005 ||
      Math.abs(drawer.hoverProgress - previousHoverProgress) > 0.0005
    ) {
      shadowDirty = true
    }
  })

  updateDrawerHighlight(delta, reducedMotion)

  if (activeFileOwner) {
    const fileRevealProgress = THREE.MathUtils.smoothstep(activeFileOwner.progress, 0.16, 0.92)
    activeFiles.forEach((file) => {
      const previousDocumentHover = file.userData.hoverProgress
      file.userData.hoverProgress = THREE.MathUtils.damp(
        file.userData.hoverProgress,
        hoveredDocument === file ? 1 : 0,
        reducedMotion ? 22 : 13,
        delta,
      )
      const documentHover = file.userData.hoverProgress
      const restingY = THREE.MathUtils.lerp(file.userData.closedY, file.userData.openY, fileRevealProgress)
      file.position.y = restingY + documentHover * 0.095
      file.position.z = file.userData.baseZ + documentHover * 0.075
      file.rotation.x = documentHover * 0.045
      file.rotation.z = file.userData.baseRotationZ - documentHover * 0.008
      file.userData.hoverFrame.visible = documentHover > 0.015
      file.userData.hoverFrame.scale.setScalar(0.94 + documentHover * 0.06)
      file.userData.selectionMark.visible = documentHover > 0.08
      file.userData.selectionMark.scale.setScalar(0.72 + documentHover * 0.28)
      if (Math.abs(documentHover - previousDocumentHover) > 0.0005) shadowDirty = true
    })

    if (!activeFileOwner.open && activeFileOwner.progress < 0.015) parkActiveFileRack()
  }

  let desiredCameraX = scrollPosition
  let desiredCameraY = BROWSE_CAMERA_Y
  let desiredCameraZ = BROWSE_CAMERA_Z
  let desiredLookX = scrollPosition
  let desiredLookY = BROWSE_LOOK_Y
  let desiredLookZ = BROWSE_LOOK_Z

  if (focusedDrawer) {
    focusedDrawer.front.getWorldPosition(drawerWorldPosition)
    desiredCameraX = drawerWorldPosition.x
    desiredCameraY = drawerWorldPosition.y + INSPECTION_CAMERA_Y_OFFSET
    desiredCameraZ = drawerWorldPosition.z + INSPECTION_CAMERA_Z_OFFSET
    desiredLookX = drawerWorldPosition.x
    desiredLookY = drawerWorldPosition.y + INSPECTION_LOOK_Y_OFFSET
    desiredLookZ = drawerWorldPosition.z + INSPECTION_LOOK_Z_OFFSET
  }

  const cameraMotionRate = reducedMotion ? 22 : focusedDrawer ? 4.8 : 9
  camera.position.x = THREE.MathUtils.damp(camera.position.x, desiredCameraX, cameraMotionRate, delta)
  camera.position.y = THREE.MathUtils.damp(camera.position.y, desiredCameraY, cameraMotionRate, delta)
  camera.position.z = THREE.MathUtils.damp(camera.position.z, desiredCameraZ, cameraMotionRate, delta)
  updateWorldLayout()
  cameraLookTarget.x = THREE.MathUtils.damp(cameraLookTarget.x, desiredLookX, cameraMotionRate, delta)
  cameraLookTarget.y = THREE.MathUtils.damp(cameraLookTarget.y, desiredLookY, cameraMotionRate, delta)
  cameraLookTarget.z = THREE.MathUtils.damp(cameraLookTarget.z, desiredLookZ, cameraMotionRate, delta)
  camera.lookAt(cameraLookTarget)
  if (Math.abs(camera.position.x - lastEnvironmentShellX) > 0.0005) {
    environmentShell.position.x = camera.position.x
    lastEnvironmentShellX = camera.position.x
    shadowDirty = true
  }
  updateSceneVisibility()

  if (environmentDust && !reducedMotion) {
    environmentDust.position.y = Math.sin(clock.elapsedTime * 0.28) * 0.035
    environmentDust.rotation.y = Math.sin(clock.elapsedTime * 0.06) * 0.003
  }

  if (shadowDirty) renderer.shadowMap.needsUpdate = true
  renderer.render(scene, camera)
  shadowDirty = false

  if (import.meta.env.DEV && sceneRootRef.value) {
    const screenLeft = camera.position.x + viewportLeftEdge
    const firstVisibleColumn = cabinetColumns
      .filter((column) => column.visible && column.position.x + COLUMN_SPACING / 2 >= screenLeft)
      .sort((left, right) => left.position.x - right.position.x)[0]
    const leftCoverageGap = firstVisibleColumn
      ? Math.max(0, firstVisibleColumn.position.x - COLUMN_SPACING / 2 - screenLeft)
      : -1

    diagnosticsRenderFrame += 1
    sceneRootRef.value.dataset.renderFrame = String(diagnosticsRenderFrame)
    sceneRootRef.value.dataset.renderCalls = String(renderer.info.render.calls)
    sceneRootRef.value.dataset.renderTriangles = String(renderer.info.render.triangles)
    sceneRootRef.value.dataset.cameraScrollLag = (scrollPosition - camera.position.x).toFixed(4)
    sceneRootRef.value.dataset.leftCoverageGap = leftCoverageGap.toFixed(4)
  }
}

function disposeScene() {
  window.cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()

  const canvas = canvasRef.value
  canvas?.removeEventListener('pointerdown', handlePointerDown)
  canvas?.removeEventListener('pointermove', handlePointerMove)
  canvas?.removeEventListener('pointerup', finishPointer)
  canvas?.removeEventListener('pointercancel', finishPointer)
  canvas?.removeEventListener('pointerleave', handlePointerLeave)
  canvas?.removeEventListener('wheel', handleWheel)
  window.removeEventListener('keydown', handleSceneKeydown)

  const geometries = new Set()
  const materials = new Set()
  const instancedMeshes = new Set()
  scene?.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry)
    if (object.isInstancedMesh) instancedMeshes.add(object)
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
    objectMaterials.filter(Boolean).forEach((material) => materials.add(material))
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
  instancedMeshes.forEach((mesh) => mesh.dispose())
  renderer?.dispose()
  renderer?.forceContextLoss()
}

onMounted(() => {
  try {
    scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x17211c, 24, 48)
    clock = new THREE.Clock()
    raycaster = new THREE.Raycaster()

    camera = new THREE.PerspectiveCamera(20, 1, 0.1, 90)
    camera.position.set(0, BROWSE_CAMERA_Y, BROWSE_CAMERA_Z)
    camera.lookAt(0, BROWSE_LOOK_Y, BROWSE_LOOK_Z)

    renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.value,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.9
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.shadowMap.autoUpdate = false
    renderer.setClearColor(0x101713, 0)

    const ambientLight = new THREE.HemisphereLight(0xb8c9c0, 0x09100c, 0.5)
    const keyLight = new THREE.DirectionalLight(0xcddbd4, 0.54)
    keyLight.position.set(-4, 6, 9)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(1024, 1024)
    keyLight.shadow.camera.left = -14
    keyLight.shadow.camera.right = 14
    keyLight.shadow.camera.top = 8
    keyLight.shadow.camera.bottom = -7
    keyLight.shadow.camera.near = 0.5
    keyLight.shadow.camera.far = 32
    keyLight.shadow.bias = -0.0002
    const fillLight = new THREE.DirectionalLight(0x7770ad, 0.18)
    fillLight.position.set(6, -1, 8)
    scene.add(ambientLight, keyLight, fillLight)

    createEnvironment()
    createCabinet()
    resizeScene()
    updateWorldLayout(true)
    updateSceneVisibility()
    freezeStaticTransforms(scene)
    renderer.shadowMap.needsUpdate = true

    const canvas = canvasRef.value
    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', finishPointer)
    canvas.addEventListener('pointercancel', finishPointer)
    canvas.addEventListener('pointerleave', handlePointerLeave)
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('keydown', handleSceneKeydown)

    resizeObserver = new ResizeObserver(resizeScene)
    resizeObserver.observe(sceneRootRef.value)
    animate()
  } catch (error) {
    sceneError.value = '当前浏览器无法初始化三维文件柜。'
    console.error('Contract cabinet scene initialization failed:', error)
  }
})

onBeforeUnmount(() => {
  emit('preview-visibility-change', false)
  disposeScene()
})
</script>

<template>
  <div
    ref="sceneRootRef"
    class="cabinet-scene"
    :class="{
      'is-dragging': dragging,
      'is-at-left-boundary': atLeftBoundary,
      'is-inspecting': focusedDrawerLabel,
    }"
    :data-browse-position="atLeftBoundary ? 'left-boundary' : 'browsing-right'"
  >
    <canvas ref="canvasRef" aria-label="可交互的无限合同文件柜三维场景"></canvas>

    <div class="cabinet-scene__shade" aria-hidden="true"></div>

    <Transition name="inspection-control">
      <button
        v-if="focusedDrawerLabel"
        class="cabinet-scene__inspection-exit"
        type="button"
        :aria-label="`关闭并退出 ${focusedDrawerLabel}`"
        @click="closeFocusedDrawer"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m11.8 5.2-4.6 4.8 4.6 4.8M7.5 10H16" />
        </svg>
        <span>关闭抽屉</span>
        <small>ESC</small>
      </button>
    </Transition>

    <Transition name="drawer-tooltip">
      <div
        v-if="hoveredDrawerLabel && !dragging"
        class="cabinet-scene__tooltip"
        :style="hoverPositionStyle"
      >
        <strong>{{ hoveredDrawerLabel }}</strong>
        <span>点击开合</span>
      </div>
    </Transition>

    <Transition name="drawer-tooltip">
      <div
        v-if="hoveredDocumentLabel && !dragging"
        class="cabinet-scene__tooltip cabinet-scene__tooltip--document"
        :style="hoverPositionStyle"
      >
        <strong>{{ hoveredDocumentLabel }}</strong>
        <span>点击预览 PDF</span>
      </div>
    </Transition>

    <div v-if="sceneError" class="cabinet-scene__error" role="status">
      {{ sceneError }}
    </div>
  </div>

  <PdfPreviewOverlay
    :open="pdfPreviewOpen"
    :src="moePdfUrl"
    :label="activeDocumentLabel"
    @close="closePdfPreview"
  />
</template>

<style scoped>
.cabinet-scene {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 30%, #2b3932, transparent 48%),
    linear-gradient(180deg, #121b17, #0b120f 72%);
}

.cabinet-scene canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
  outline: none;
  touch-action: none;
}

.cabinet-scene.is-dragging canvas {
  cursor: grabbing;
}

.cabinet-scene__shade {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(90deg, #09100dcc, transparent 11%, transparent 87%, #070d0bcf),
    linear-gradient(180deg, #0a110e94, transparent 20%, transparent 74%, #060b09a6);
  box-shadow: inset 0 0 90px #02050494;
}

.cabinet-scene__inspection-exit {
  position: absolute;
  z-index: 4;
  top: 20px;
  right: 20px;
  display: flex;
  gap: 7px;
  align-items: center;
  min-height: 38px;
  padding: 7px 9px 7px 11px;
  color: #e5eee9;
  font: inherit;
  font-size: 10px;
  font-weight: 650;
  cursor: pointer;
  background: #13211bd9;
  border: 1px solid #ffffff24;
  border-radius: 999px;
  box-shadow: 0 10px 28px #02050473;
  backdrop-filter: blur(14px);
  transition:
    background 0.2s,
    border-color 0.2s,
    transform 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}

.cabinet-scene__inspection-exit:hover {
  background: #24362ee8;
  border-color: #ffffff3d;
  transform: translateY(-1px);
}

.cabinet-scene__inspection-exit:focus-visible {
  outline: 2px solid #a99ee5;
  outline-offset: 3px;
}

.cabinet-scene__inspection-exit svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7px;
}

.cabinet-scene__inspection-exit small {
  padding: 3px 5px;
  color: #a9bbb2;
  font: 8px/1 "SFMono-Regular", Consolas, monospace;
  background: #ffffff0d;
  border: 1px solid #ffffff14;
  border-radius: 5px;
}

.inspection-control-enter-active,
.inspection-control-leave-active {
  transition:
    opacity 0.2s,
    transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}

.inspection-control-enter-from,
.inspection-control-leave-to {
  opacity: 0;
  transform: translateY(-5px) scale(0.94);
}

.cabinet-scene__tooltip {
  position: absolute;
  z-index: 3;
  display: flex;
  flex-direction: column;
  min-width: 132px;
  padding: 8px 10px;
  pointer-events: none;
  background: #29372fdb;
  border: 1px solid #ffffff26;
  border-radius: 9px;
  box-shadow: 0 10px 24px #26372f2b;
  backdrop-filter: blur(12px);
}

.cabinet-scene__tooltip strong {
  color: #f6faf8;
  font-size: 10px;
  font-weight: 600;
}

.cabinet-scene__tooltip span {
  margin-top: 2px;
  color: #b9c9c1;
  font-size: 9px;
}

.cabinet-scene__tooltip--document {
  background: #242a35e8;
  border-color: #bdb3ff4a;
  box-shadow:
    0 12px 30px #04060a70,
    inset 3px 0 #a99ee5;
}

.cabinet-scene__tooltip--document span {
  color: #c7c0f2;
}

.drawer-tooltip-enter-active,
.drawer-tooltip-leave-active {
  transition: opacity 0.14s, transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.drawer-tooltip-enter-from,
.drawer-tooltip-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.96);
}

.cabinet-scene__error {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  color: #6d7772;
  font-size: 12px;
  text-align: center;
  background: #f5f8f7e8;
}

@media (prefers-reduced-motion: reduce) {
  .drawer-tooltip-enter-active,
  .drawer-tooltip-leave-active {
    transition: none;
  }
}
</style>
