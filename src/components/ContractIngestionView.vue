<script setup>
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue'
import ExtractionAiControl from './ExtractionAiControl.vue'
import ContractOverviewSummary from './ContractOverviewSummary.vue'
import TruncatedText from './TruncatedText.vue'
import { CONTRACT_OVERVIEW_STAGE_CODE, modelContractOverview } from '../models/contractOverview.js'
import ContractDateWheel from './ContractDateWheel.vue'
import MarkdownMessage from './MarkdownMessage.vue'
import PdfPreviewOverlay from './PdfPreviewOverlay.vue'
import BatchExtractionDialog from './BatchExtractionDialog.vue'
import { deduplicationInteraction } from '../models/deduplicationReview.js'
import { awaitsExtractionFollowup } from '../models/extractionEventLifecycle.js'
import { getSelectedFileKind, convertImageFileToPdf } from '../services/local-file-pdf.js'
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'
import RollingNumber from './RollingNumber.vue'
import sleepyEmptyImage from '../assets/sleep.webp'
import {
  cancelExtractionRun,
  continueExtractionRun,
  createExtractionRun,
  getCoreDefinitions,
  getDeduplicationCandidatePdf,
  getExtractionSnapshot,
  getExtractionPdf,
  ingestExtractionRun,
  listExtractionRuns,
  retryExtractionStage,
  streamExtractionEvents,
} from '../services/contractExtractionApi.js'

defineOptions({ name: 'ContractIngestionView' })

const props = defineProps({ active: { type: Boolean, default: true } })
const emit = defineEmits(['visual-pause-change'])
const batchExtractionOpen = ref(false)

const stageOrder = ['detection', 'duplication', 'preprocessing', 'classification', 'overview', 'field', 'clause', 'retrieval']
const PDF_COVER_MAX_RASTER_SIDE = 1600
const PDFJS_ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`
const branchIds = ['field', 'clause', 'retrieval']
const subProgressStageIds = new Set(['classification', 'field', 'clause', 'retrieval'])
const backendStageToLocal = {
  contract_document_detection: 'detection',
  contract_structure_recognition: 'preprocessing',
  pdf_deduplication: 'duplication',
  contract_classification: 'classification',
  [CONTRACT_OVERVIEW_STAGE_CODE]: 'overview',
  core_extraction: 'field',
  clause_extraction: 'clause',
  retrieval_preparation: 'retrieval',
}
let awaitingExtractionFollowup = false
let restoredCoverController = null
const localStageToBackend = Object.fromEntries(
  Object.entries(backendStageToLocal).map(([backendCode, localId]) => [localId, backendCode]),
)

const stages = reactive({
  detection: {
    id: 'detection',
    eyebrow: '内容识别',
    name: '合同文档识别',
    message: '等待确认上传内容是否属于合同文档。',
    status: 'pending',
    progress: null,
    attempt: 0,
    retryable: false,
    duration: '—',
    summary: '识别上传内容是否具有合同文档的协议关系与权利义务结构。',
  },
  duplication: {
    id: 'duplication',
    eyebrow: '输入校验',
    name: '重复性判断',
    message: '等待判断合同是否已存在。',
    status: 'pending',
    progress: null,
    attempt: 0,
    retryable: false,
    duration: '—',
    summary: '核对当前合同是否已经处理或入库，避免重复创建合同数据。',
  },
  preprocessing: {
    id: 'preprocessing',
    eyebrow: '结构理解',
    name: '文档结构理解',
    message: '等待理解合同的页面与文档结构。',
    status: 'pending',
    progress: null,
    attempt: 0,
    retryable: false,
    duration: '—',
    summary: '理解合同的页面、段落和内容单元，为后续分类与提取建立文档结构。',
  },
  classification: {
    id: 'classification',
    eyebrow: '语义理解',
    name: '合同分类',
    message: '等待判断合同所属类别。',
    status: 'pending',
    progress: null,
    attempt: 0,
    retryable: false,
    duration: '—',
    summary: '结合文档结构判断合同类别，并为后续提取准备统一上下文。',
  },
  overview: {
    id: 'overview',
    eyebrow: '合同概述',
    name: '合同概述生成',
    message: '等待根据合同内容生成建议名称与摘要。',
    status: 'pending',
    progress: null,
    attempt: 0,
    retryable: false,
    duration: '—',
    summary: '结合合同内容、文档结构和分类结果，一次性生成建议名称与内容摘要。',
  },
  field: {
    id: 'field',
    eyebrow: '并行路径 01',
    name: '字段提取',
    message: '等待提取合同核心字段。',
    status: 'pending',
    progress: null,
    attempt: 0,
    retryable: false,
    duration: '—',
    summary: '从合同中提取主体、金额、日期等核心结构化字段。',
  },
  clause: {
    id: 'clause',
    eyebrow: '并行路径 02',
    name: '条款提取',
    message: '等待发现合同条款。',
    status: 'pending',
    progress: null,
    attempt: 0,
    retryable: false,
    duration: '—',
    summary: '发现合同中的候选条款，并并发提取条款正文与关键信息。',
  },
  retrieval: {
    id: 'retrieval',
    eyebrow: '并行路径 03',
    name: '相似度处理',
    message: '等待生成检索问题并构建相似度能力。',
    status: 'pending',
    progress: null,
    attempt: 0,
    retryable: false,
    duration: '—',
    summary: '生成面向合同检索的问题，完成向量化并融合合同级检索向量。',
    error: '批量向量化阶段暂时中断，已生成的问题不会丢失。',
  },
})

const statusCopy = {
  pending: '等待处理',
  running: '正在处理',
  retrying: '正在重试',
  succeeded: '处理完成',
  failed: '处理失败',
}

const selectedStageId = ref('')
const detailMode = ref('')
const detailPanel = ref(null)
const workflowScrollExtension = ref(0)
const workflowSwitchPhase = ref('')
const workflowSwitching = computed(() => Boolean(workflowSwitchPhase.value))
const fileInput = ref(null)
const workflowViewport = ref(null)
const runsPanelOpen = ref(false)
const runsLoading = ref(false)
const runsLoaderVisible = ref(false)
const runsItemsVisible = ref(true)
const runsEmptyVisible = ref(false)
const runsLoadedOnce = ref(false)
const runsError = ref('')
const extractionRuns = ref([])
const updatingRunIds = reactive(new Set())
const runsRestoringId = ref('')
const runsRestoreError = ref('')
const runsRestoreErrorId = ref('')
const blockedExtractionRuns = computed(() => (
  extractionRuns.value.filter((run) => run.status === 'blocked')
))
const processingExtractionRuns = computed(() => (
  extractionRuns.value.filter((run) => run.status === 'processing')
))
const extractionRunGroups = computed(() => [
  {
    key: 'blocked',
    title: '需要你处理',
    description: '流程已暂停，请进入任务完成确认、重试或结果复核。',
    runs: blockedExtractionRuns.value,
  },
  {
    key: 'processing',
    title: '后台处理中',
    description: '流程仍在自动推进，当前无需操作。',
    runs: processingExtractionRuns.value,
  },
].filter((group) => group.runs.length > 0))
const extractionRunsTitle = computed(() => {
  const blockedCount = blockedExtractionRuns.value.length
  const processingCount = processingExtractionRuns.value.length
  if (!blockedCount && !processingCount) return '暂无进行的任务'
  if (blockedCount && processingCount) return `${blockedCount}条需处理 · ${processingCount}条进行中`
  if (blockedCount) return `${blockedCount}条合同需要处理`
  return `${processingCount}条合同后台处理中`
})
const extractionRunsDigitCount = computed(() => String(extractionRuns.value.length).length)
const extractionRunsBadgeWidth = computed(() => (
  Math.max(5, extractionRunsDigitCount.value * 5)
))
const selectedSourceFile = ref(null)
const customFileName = ref('')
const restoredRunFileName = ref('')
const processedDocument = ref(null)
const selectedSourceKind = ref('')
const selectedFile = ref(null)
const selectedFilePageCount = ref(null)
const imageConversionStatus = ref('')
const fileSelectionError = ref('')
const coverReading = ref(false)
const coverCanvas = ref(null)
const coverRendered = ref(false)
const coverPresentationReady = ref(false)
const coverRatio = ref(612 / 792)
const coverDimensions = ref(null)
const workflowStarted = ref(false)
const workflowRunning = ref(false)
const workflowStopped = ref(false)
const workflowRewinding = ref(false)
const uploadInProgress = ref(false)
const cancellationPending = ref(false)
const coreDefinitionsLoading = ref(false)
const coreDefinitionsReady = ref(false)
const coreDefinitions = ref([])
const coreReviewModel = reactive(new Map())
const openBooleanControlKey = ref('')
const workflowError = ref('')
const currentRunId = ref('')
const currentRunStatus = ref('')
const extractionRunCreationPending = computed(() => Boolean(
  workflowStarted.value && !currentRunId.value,
))
const newExtractionDisabled = computed(() => Boolean(
  workflowSwitching.value || cancellationPending.value || extractionRunCreationPending.value,
))
const availableSections = ref([])
const extractionDraft = ref(null)
const documentDetection = ref(null)
const deduplicationReview = ref(null)
const classificationResult = ref(null)
const contractOverview = ref(null)
const continuationPending = ref(false)
const continuationError = ref('')
const candidatePreviewId = ref('')
const candidatePreviewError = ref('')
const candidatePreviewUrl = ref('')
const candidatePreviewLabel = ref('')
const deduplicationContentRefreshing = ref(false)
const queuedDetailMode = ref('')
const queuedDetailStageId = ref('')
const duplicationLoaderVisible = ref(false)
const duplicationLoaderLeaving = ref(false)
const structureLoaderVisible = ref(false)
const structureLoaderLeaving = ref(false)
const classificationLoaderVisible = ref(false)
const classificationLoaderLeaving = ref(false)
const classificationLoaderPreview = false
const elapsedClock = ref(0)
let fileSelectionSequence = 0
let pdfRuntimePromise = null
let pdfWorkerPort = null
let elapsedClockTimer = null
let coverPresentationTimer = null
let coverRasterCanvas = null
let extractionRequestController = null
let cancellationRequestController = null
let ingestionRequestController = null
let eventStreamController = null
let runsListController = null
let runRestoreController = null
let runsRefreshTimer = null
let runsEmptyRevealTimer = null
let reconnectTimer = null
let deduplicationRefreshTimer = null
let workflowScrollExtensionFrame = null
let workflowSwitchTimer = null
let ingestionErrorTimer = null
let lastEventSequence = null
let streamGeneration = 0
let viewActive = false
const resultUpdating = ref(false)
const modifiedFields = reactive(new Set())
const draftOverrides = reactive(new Map())
const editingClauseIds = reactive(new Set())
const clauseReviewModel = ref([])
const clauseReviewListRef = ref(null)
const removingClauseIds = reactive(new Set())
const clausesLocallyModified = ref(false)
const reviewFileName = ref('')
const reviewFileNameModified = ref(false)
const reviewSummary = ref('')
const reviewSummaryModified = ref(false)
const ingestionPending = ref(false)
const ingestionErrors = ref([])
const ingestionIssues = ref([])
const activeIngestionIssueTarget = ref('')
const ingestionReceipt = ref(null)
const clauseInsertIndex = ref(null)
const clauseInsertError = ref('')
const clauseFormAnimating = ref(false)
const clauseInsertCollapsedHeight = ref(18)
const newClauseForm = reactive({
  path: [''],
  startPage: 1,
  endPage: 1,
  content: '',
})
const retractingStageIds = reactive(new Set())
const retractingIncomingEdgeIds = reactive(new Set())
const retractingResultEdgeIds = reactive(new Set())
const timers = new Set()
const booleanReviewOptions = [
  { value: '', label: '未选择' },
  { value: 'true', label: '是' },
  { value: 'false', label: '否' },
]
const coreReviewItemKeys = new WeakMap()
let coreReviewItemSequence = 0

stageOrder.forEach((stageId) => {
  Object.assign(stages[stageId], {
    timerStartedAt: null,
    timerFinishedAt: null,
    timerElapsedMs: 0,
    timerVisible: false,
    timerFading: false,
  })
})

const selectedStage = computed(() => stages[selectedStageId.value] || null)
const isRestoredRun = computed(() => Boolean(restoredRunFileName.value && !selectedSourceFile.value))
const hasInputDocument = computed(() => Boolean(
  selectedSourceFile.value || restoredRunFileName.value || processedDocument.value?.fileName,
))
const selectedFileName = computed(() => (
  processedDocument.value?.fileName
  || customFileName.value.trim()
  || selectedSourceFile.value?.name
  || restoredRunFileName.value
  || '上传合同文件'
))
const selectedFileExtension = computed(() => {
  const extensionMatch = selectedFileName.value.match(/\.([^.]+)$/)
  const mimeFallback = {
    'image/png': 'PNG',
    'image/jpeg': 'JPG',
    'image/webp': 'WEBP',
    'image/gif': 'GIF',
    'image/bmp': 'BMP',
    'image/avif': 'AVIF',
  }
  const extension = extensionMatch?.[1]?.toUpperCase()
    || mimeFallback[selectedSourceFile.value?.type]
    || ''
  if (extension === 'JPEG') return 'JPG'
  return extension.slice(0, 4)
})
const selectedFileBadge = computed(() => (
  selectedSourceKind.value === 'image' ? selectedFileExtension.value || 'IMG' : 'PDF'
))
const selectedFileTypeLabel = computed(() => (
  selectedSourceKind.value === 'image'
    ? `${selectedFileBadge.value} 图片`
    : 'PDF文档'
))
const selectedFileSize = computed(() => {
  const bytes = processedDocument.value?.processedFileSizeBytes ?? selectedSourceFile.value?.size
  if (!Number.isFinite(bytes)) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
})
const selectedFilePageCountLabel = computed(() => {
  const processedPageCount = processedDocument.value?.pageCount
  if (Number.isInteger(processedPageCount)) return `${processedPageCount} 页`
  if (coverReading.value && selectedFilePageCount.value === null) return '读取中'
  if (!Number.isInteger(selectedFilePageCount.value)) return '—'
  return `${selectedFilePageCount.value} 页`
})
const canCancelExtractionRun = computed(() => Boolean(
  currentRunId.value
  && workflowStarted.value
  && !['cancelled', 'expired', 'unavailable', 'ingested'].includes(currentRunStatus.value),
))
const filePreparationLabel = computed(() => {
  if (selectedSourceKind.value === 'image' && imageConversionStatus.value === 'converting') {
    return '正在转换为 PDF'
  }
  if (coverReading.value) return '正在读取封面'
  if (cancellationPending.value) return '正在取消并释放任务资源'
  if (coreDefinitionsLoading.value) return '正在准备 Core 审核表单'
  if (uploadInProgress.value) return '正在上传并校验 PDF'
  if (currentRunStatus.value === 'ingested') return '任务结束'
  if (currentRunStatus.value === 'not_a_contract') return '未识别为合同文档'
  if (currentRunStatus.value === 'duplicate_rejected') return '发现重复合同，处理已终止'
  if (currentRunStatus.value === 'awaiting_deduplication_review') return '等待查重审核'
  if (workflowError.value) return workflowError.value
  if (workflowRewinding.value) return '正在退回起点'
  if (workflowStopped.value) return '任务已取消'
  if (isRestoredRun.value && workflowRunning.value) return '已恢复并保持同步'
  if (isRestoredRun.value && workflowStarted.value) return '已恢复处理结果'
  if (workflowStarted.value) return '处理已开始'
  if (selectedFile.value) return '等待确认'
  return '文件未就绪'
})
const extractionControlLabel = computed(() => {
  if (coverReading.value) return '文件准备中'
  if (cancellationPending.value) return '正在取消任务'
  if (coreDefinitionsLoading.value) return '正在准备表单'
  if (uploadInProgress.value) return '正在创建任务'
  if (currentRunStatus.value === 'ingested') return '任务结束'
  if (canCancelExtractionRun.value) return '取消任务'
  if (workflowRewinding.value) return '正在回退'
  if (workflowStopped.value) return '重新提取'
  if (workflowStarted.value) return '提取已结束'
  return '开始提取'
})
const extractionSecondaryLabel = computed(() => {
  if (cancellationPending.value) return '正在释放任务资源'
  if (coreDefinitionsLoading.value) return '正在加载 Core 定义'
  if (uploadInProgress.value) return '正在上传并校验'
  if (currentRunStatus.value === 'ingested') return '合同已正式入库'
  if (canCancelExtractionRun.value) return workflowRunning.value
    ? '处理中，点击取消'
    : '点击取消并释放任务'
  if (workflowRewinding.value) return '正在退回起点'
  if (workflowStopped.value) return '再次智能提取'
  if (workflowStarted.value) return '本次提取结束'
  return '启动智能处理'
})
const extractionControlVisible = computed(() => (
  Boolean(selectedFile.value && coverPresentationReady.value)
  || canCancelExtractionRun.value
  || cancellationPending.value
  || currentRunStatus.value === 'ingested'
  || (isRestoredRun.value && workflowRewinding.value)
))
const extractionControlDisabled = computed(() => {
  if (workflowRewinding.value || cancellationPending.value) return true
  if (canCancelExtractionRun.value) return false
  if (workflowStarted.value || coreDefinitionsLoading.value || uploadInProgress.value) return true
  return coverReading.value || !selectedFile.value
})
const workflowErrorTitle = computed(() => (
  currentRunId.value || currentRunStatus.value === 'unavailable'
    ? '暂时无法取消任务'
    : '暂时无法开始处理'
))
const uploadCardWidth = computed(() => {
  if (!hasInputDocument.value) return 252
  const ratio = coverRatio.value
  return Math.min(230, Math.max(170, 244 * ratio))
})
const inputNodeStyle = computed(() => ({
  '--pdf-cover-ratio': coverRatio.value,
  '--upload-card-width': `${uploadCardWidth.value}px`,
}))
const coverRenderWidth = computed(() => Math.max(1, uploadCardWidth.value - 22))
const coverDimensionsLabel = computed(() => {
  const processedWidth = processedDocument.value?.coverWidthPixels
  const processedHeight = processedDocument.value?.coverHeightPixels
  if (Number.isInteger(processedWidth) && Number.isInteger(processedHeight)) {
    return `${processedWidth} × ${processedHeight} px`
  }
  if (isRestoredRun.value) return '—'
  if (!coverDimensions.value) return '标准预览比例'
  const { width, height, unit } = coverDimensions.value
  return `${Math.round(width)} × ${Math.round(height)} ${unit}`
})
const resultAvailable = computed(() => (
  !['duplicate_rejected', 'awaiting_deduplication_review'].includes(currentRunStatus.value) && (
  availableSections.value.some((section) => section === 'core' || section === 'clause')
  || extractionDraft.value?.core !== null && extractionDraft.value?.core !== undefined
  || Array.isArray(extractionDraft.value?.clauses)
  )
))
const resultComplete = computed(() => stageOrder.every((stageId) => stages[stageId].status === 'succeeded'))
const canIngestResult = computed(() => (
  !['duplicate_rejected', 'awaiting_deduplication_review'].includes(currentRunStatus.value) &&
  resultComplete.value
  && Boolean(currentRunId.value)
  && !ingestionPending.value
  && !ingestionReceipt.value
))
const ingestionActionCharacters = computed(() => Array.from(
  ingestionPending.value
    ? '正在正式入库'
    : resultComplete.value
      ? '正式入库'
      : '等待全部阶段完成',
))
const unresolvedIngestionIssueCount = computed(() => (
  ingestionIssues.value.filter((issue) => !issue.resolved).length
))
const resultStats = computed(() => ({
  fields: extractionDraft.value?.core && typeof extractionDraft.value.core === 'object'
    ? Object.keys(extractionDraft.value.core).length
    : 0,
  clauses: clauseReviewModel.value.length,
}))
const deduplicationCandidates = computed(() => {
  const candidates = deduplicationReview.value?.candidates
  if (!Array.isArray(candidates)) return []
  return candidates.map((candidate) => ({
    ...candidate,
    reviewer: typeof candidate?.reviewer === 'string' ? candidate.reviewer.trim() : '',
  }))
})
const draftClauses = computed(() => clauseReviewModel.value)
const clauseReviewAvailable = computed(() => (
  availableSections.value.includes('clause') || Array.isArray(extractionDraft.value?.clauses)
))
const coreReviewFields = computed(() => coreDefinitions.value.map((definition) => ({
  ...definition,
  items: coreReviewModel.get(definition.code) || [],
})))
const deduplicationState = computed(() => deduplicationInteraction(currentRunStatus.value, deduplicationReview.value))
const deduplicationReviewPending = computed(() => deduplicationState.value === 'pending')
const deduplicationPresentation = computed(() => ({
  rejected: { label: '重复合同 · 已终止', description: '本次提取已终止，后续阶段不会继续执行。你仍可查看重复合同及判断依据。' },
  pending: { label: '等待审核', description: '发现相似度超过阈值的候选合同，提取流程已暂停。请核对后确认继续。' },
  automatic: { label: '自动通过', description: '未发现重复或相似合同，系统已自动继续后续提取，无需手动确认。' },
  confirmed: { label: '已确认继续', description: '查重审核已经完成，你仍可查看本次返回的候选合同。' },
  recorded: { label: '查重结果', description: '本次查重结果已保留，流程状态以服务端为准。' },
}[deduplicationState.value]))
const deduplicationDeadline = computed(() => {
  const value = deduplicationReview.value?.review_expires_at
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date)
})

function stageTone(status) {
  if (status === 'succeeded') return 'success'
  if (status === 'pending') return 'waiting'
  return status
}

function stageStatusLabel(stage) {
  if (currentRunStatus.value === 'duplicate_rejected') {
    if (stage.id === 'duplication') return '发现重复合同'
    if (!['detection', 'duplication'].includes(stage.id)) return '流程已终止'
  }
  if (currentRunStatus.value === 'awaiting_deduplication_review' && !['detection', 'duplication'].includes(stage.id)) return '等待查重审核'
  if (stage.id === 'detection' && documentDetection.value?.is_contract === false) {
    return '非合同文档'
  }
  return statusCopy[stage.status]
}

function stageProgressPercent(stage) {
  if (retractingStageIds.has(stage.id)) return 0
  if (stage.status === 'succeeded') return 100
  if (!stage.progress) return 0

  const { completed, total } = stage.progress
  if (total === 0) return ['running', 'retrying'].includes(stage.status) ? 100 : 0
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total < 0) return 0
  return Math.min(100, Math.max(0, (completed / total) * 100))
}

function isStageCounting(stage) {
  return ['running', 'retrying'].includes(stage.status) && stage.progress === null
}

function isStageFinalizing(stage) {
  if (!['running', 'retrying'].includes(stage.status) || !stage.progress) return false
  return stage.progress.completed >= stage.progress.total
}

function shouldShowStageProgress(stageId) {
  return subProgressStageIds.has(stageId) && stages[stageId].progress !== null
}

function stageProgressText(stage) {
  if (stage.status === 'pending') return '—'
  if (isStageCounting(stage)) return '统计中'
  if (isStageFinalizing(stage)) return '收尾中'
  if (!stage.progress) return stage.status === 'succeeded' ? '完成' : '—'
  return `${stage.progress.completed}/${stage.progress.total}`
}

function stageProgressDetail(stage) {
  if (stage.status === 'pending') return '尚未开始'
  if (isStageCounting(stage)) return '正在统计数量'
  if (isStageFinalizing(stage)) return `已处理 ${stage.progress.completed}/${stage.progress.total}，等待阶段完成`
  if (!stage.progress) return stage.status === 'succeeded' ? '已完成' : '暂无可量化进度'
  return `已完成 ${stage.progress.completed}/${stage.progress.total}`
}

function stageElapsedMs(stage) {
  // 读取时钟 ref，确保进行中的计时文案按百分之一秒持续刷新。
  const currentTime = elapsedClock.value || Date.now()
  if (stage.timerStartedAt === null) return stage.timerElapsedMs
  const endTime = stage.timerFinishedAt ?? currentTime
  return Math.max(0, endTime - stage.timerStartedAt)
}

function stageElapsedText(stage) {
  return `${(stageElapsedMs(stage) / 1000).toFixed(2)}s`
}

function stageTimingText(stage) {
  const elapsed = stageElapsedText(stage)
  if (['running', 'retrying'].includes(stage.status)) return `已处理 ${elapsed}`
  if (stage.status === 'succeeded') return `完成耗时 ${elapsed}`
  if (stage.status === 'failed') return `失败耗时 ${elapsed}`
  return elapsed
}

function parseStageTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function startStageTimer(stage, startedAt = Date.now()) {
  stage.timerStartedAt = startedAt
  stage.timerFinishedAt = null
  stage.timerElapsedMs = 0
  stage.timerVisible = true
  stage.timerFading = false
}

function freezeStageTimer(stage, finishedAt = Date.now()) {
  if (stage.timerStartedAt === null || stage.timerFinishedAt !== null) return
  stage.timerFinishedAt = Math.max(stage.timerStartedAt, finishedAt)
  stage.timerElapsedMs = stage.timerFinishedAt - stage.timerStartedAt
}

function resetStageTimer(stage) {
  stage.timerStartedAt = null
  stage.timerFinishedAt = null
  stage.timerElapsedMs = 0
  stage.timerVisible = false
  stage.timerFading = false
}

function applyStageTimerSnapshot(stage, stageSnapshot) {
  const startedAt = parseStageTimestamp(stageSnapshot.started_at)
  const activeStatuses = ['running', 'retrying']
  const terminalStatuses = ['succeeded', 'failed']

  if (stageSnapshot.status === 'pending') {
    resetStageTimer(stage)
    return
  }

  // 旧版响应没有 started_at 时保留本地计时，避免兼容期间计时突然消失。
  if (startedAt === null) return

  stage.timerStartedAt = startedAt
  stage.timerElapsedMs = 0
  stage.timerVisible = true
  stage.timerFading = false

  if (activeStatuses.includes(stageSnapshot.status)) {
    stage.timerFinishedAt = null
    return
  }

  if (terminalStatuses.includes(stageSnapshot.status)) {
    const updatedAt = parseStageTimestamp(stageSnapshot.updated_at)
    stage.timerFinishedAt = Math.max(startedAt, updatedAt ?? Date.now())
    stage.timerElapsedMs = stage.timerFinishedAt - startedAt
  }
}

function fadeStageTimer(stage) {
  if (!stage.timerVisible) return
  stage.timerFading = true
  schedule(() => resetStageTimer(stage), 360)
}

function schedule(callback, delay) {
  const timer = window.setTimeout(() => {
    timers.delete(timer)
    callback()
  }, delay)
  timers.add(timer)
}

function clearTimers() {
  timers.forEach((timer) => window.clearTimeout(timer))
  timers.clear()
}

function showDuplicationLoader() {
  duplicationLoaderLeaving.value = false
  duplicationLoaderVisible.value = true
}

function hideDuplicationLoader() {
  if (!duplicationLoaderVisible.value || duplicationLoaderLeaving.value) return
  duplicationLoaderLeaving.value = true
  schedule(() => {
    duplicationLoaderVisible.value = false
    duplicationLoaderLeaving.value = false
  }, 380)
}

function showStructureLoader() {
  structureLoaderLeaving.value = false
  structureLoaderVisible.value = true
}

function hideStructureLoader() {
  if (!structureLoaderVisible.value || structureLoaderLeaving.value) return
  structureLoaderLeaving.value = true
  schedule(() => {
    structureLoaderVisible.value = false
    structureLoaderLeaving.value = false
  }, 380)
}

function showClassificationLoader() {
  classificationLoaderLeaving.value = false
  classificationLoaderVisible.value = true
}

function hideClassificationLoader() {
  if (!classificationLoaderVisible.value || classificationLoaderLeaving.value) return
  classificationLoaderLeaving.value = true
  schedule(() => {
    classificationLoaderVisible.value = false
    classificationLoaderLeaving.value = false
  }, 380)
}

function setStage(stageId, status, progress, duration = '—', message = null) {
  const stage = stages[stageId]
  const previousStatus = stage.status
  const activeStatuses = ['running', 'retrying']
  if (activeStatuses.includes(status) && !activeStatuses.includes(previousStatus)) {
    startStageTimer(stage)
  } else if (!activeStatuses.includes(status) && activeStatuses.includes(previousStatus)) {
    freezeStageTimer(stage)
  }
  if (stageId === 'duplication') {
    if (activeStatuses.includes(status) && !activeStatuses.includes(previousStatus)) {
      showDuplicationLoader()
    } else if (!activeStatuses.includes(status) && activeStatuses.includes(previousStatus)) {
      hideDuplicationLoader()
    }
  }
  if (stageId === 'preprocessing') {
    if (activeStatuses.includes(status) && !activeStatuses.includes(previousStatus)) {
      showStructureLoader()
    } else if (!activeStatuses.includes(status) && activeStatuses.includes(previousStatus)) {
      hideStructureLoader()
    }
  }
  if (stageId === 'classification') {
    if (activeStatuses.includes(status) && !activeStatuses.includes(previousStatus)) {
      showClassificationLoader()
    } else if (!activeStatuses.includes(status) && activeStatuses.includes(previousStatus)) {
      hideClassificationLoader()
    }
  }
  stage.status = status
  stage.progress = progress ? { ...progress } : null
  stage.duration = duration
  if (message !== null) stage.message = message
}

function markResultUpdated() {
  resultUpdating.value = false
  requestAnimationFrame(() => {
    resultUpdating.value = true
    schedule(() => {
      resultUpdating.value = false
    }, 1200)
  })
}

function stopExtractionNetwork() {
  if (restoredCoverController) {
    fileSelectionSequence += 1
    coverReading.value = false
  }
  restoredCoverController?.abort()
  restoredCoverController = null
  awaitingExtractionFollowup = false
  streamGeneration += 1
  extractionRequestController?.abort()
  ingestionRequestController?.abort()
  eventStreamController?.abort()
  extractionRequestController = null
  ingestionRequestController = null
  eventStreamController = null
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function closeCandidatePreview() {
  const wasOpen = Boolean(candidatePreviewUrl.value)
  if (candidatePreviewUrl.value) URL.revokeObjectURL(candidatePreviewUrl.value)
  candidatePreviewUrl.value = ''
  candidatePreviewLabel.value = ''
  if (wasOpen) emit('visual-pause-change', false)
}

function previewInputPdf() {
  if (!selectedFile.value) return
  closeCandidatePreview()
  candidatePreviewUrl.value = URL.createObjectURL(selectedFile.value)
  candidatePreviewLabel.value = selectedFileName.value || '输入合同'
  emit('visual-pause-change', true)
}

function updateDeduplicationReview(review) {
  if (deduplicationRefreshTimer !== null) window.clearTimeout(deduplicationRefreshTimer)
  deduplicationRefreshTimer = null
  deduplicationContentRefreshing.value = false
  deduplicationReview.value = review
}

function presentDeduplicationReview(review) {
  if (!review || typeof review !== 'object') return
  if (runsPanelOpen.value) closeRunsPanel()

  if (queuedDetailMode.value === 'deduplication') {
    deduplicationReview.value = review
    return
  }

  if (detailMode.value === 'deduplication' && deduplicationReview.value) {
    deduplicationContentRefreshing.value = true
    if (deduplicationRefreshTimer !== null) window.clearTimeout(deduplicationRefreshTimer)
    deduplicationRefreshTimer = window.setTimeout(async () => {
      deduplicationRefreshTimer = null
      deduplicationReview.value = review
      await nextTick()
      window.requestAnimationFrame(() => {
        deduplicationContentRefreshing.value = false
      })
    }, 240)
    return
  }

  deduplicationReview.value = review
  requestDetail('deduplication', 'duplication')
}

function handleDetailAfterLeave() {
  if (!queuedDetailMode.value) {
    workflowScrollExtension.value = 0
    return
  }
  const nextMode = queuedDetailMode.value
  const nextStageId = queuedDetailStageId.value
  queuedDetailMode.value = ''
  queuedDetailStageId.value = ''
  selectedStageId.value = nextStageId
  detailMode.value = nextMode
}

function detailIdentity(mode, stageId = '') {
  if (mode === 'stage') return `stage:${stageId}`
  return mode || ''
}

function updateWorkflowScrollExtension() {
  const viewport = workflowViewport.value
  const panel = detailPanel.value
  const canvas = viewport?.querySelector('.workflow-canvas')
  if (!(viewport instanceof HTMLElement) || !(panel instanceof HTMLElement) || !(canvas instanceof HTMLElement)) {
    workflowScrollExtension.value = 0
    return
  }

  const viewportRect = viewport.getBoundingClientRect()
  const panelRect = panel.getBoundingClientRect()
  const cards = canvas.querySelectorAll('.workflow-input-node, .workflow-stage-node, .workflow-result-node')
  const contentRight = [...cards].reduce((rightmost, card) => {
    const cardRect = card.getBoundingClientRect()
    return Math.max(rightmost, cardRect.right - viewportRect.left + viewport.scrollLeft)
  }, 0)
  const availableRight = panelRect.left - viewportRect.left - 16
  const baseMaximumScroll = Math.max(0, canvas.offsetWidth - viewport.clientWidth)

  if (contentRight <= 0 || availableRight <= 0) {
    workflowScrollExtension.value = 0
    return
  }

  workflowScrollExtension.value = Math.ceil(Math.max(
    0,
    contentRight - baseMaximumScroll - availableRight,
  ))
}

function scheduleWorkflowScrollExtension() {
  if (workflowScrollExtensionFrame !== null) window.cancelAnimationFrame(workflowScrollExtensionFrame)
  workflowScrollExtensionFrame = window.requestAnimationFrame(() => {
    workflowScrollExtensionFrame = null
    updateWorkflowScrollExtension()
  })
}

function handleDetailAfterEnter() {
  scheduleWorkflowScrollExtension()
}

function requestDetail(mode, stageId = '') {
  if (!mode) return
  const targetStageId = mode === 'deduplication' ? 'duplication' : stageId
  const targetIdentity = detailIdentity(mode, targetStageId)

  if (!detailMode.value) {
    if (queuedDetailMode.value) {
      queuedDetailMode.value = mode
      queuedDetailStageId.value = targetStageId
      return
    }
    selectedStageId.value = targetStageId
    detailMode.value = mode
    return
  }

  if (detailIdentity(detailMode.value, selectedStageId.value) === targetIdentity) return

  queuedDetailMode.value = mode
  queuedDetailStageId.value = targetStageId
  openBooleanControlKey.value = ''
  detailMode.value = ''
}

function normalizeStageProgress(progress) {
  if (!progress || !Number.isFinite(progress.completed) || !Number.isFinite(progress.total)) return null
  return {
    completed: Math.max(0, progress.completed),
    total: Math.max(0, progress.total),
  }
}

function normalizeProcessedDocument(document) {
  if (!document || typeof document !== 'object') return null
  const positiveInteger = (value) => (
    Number.isInteger(value) && value > 0 ? value : null
  )
  const fileSize = Number.isInteger(document.processed_file_size_bytes)
    && document.processed_file_size_bytes >= 0
    ? document.processed_file_size_bytes
    : null

  return {
    fileId: typeof document.file_id === 'string' ? document.file_id : '',
    fileName: typeof document.file_name === 'string' && document.file_name.trim()
      ? document.file_name.trim()
      : '',
    processedFileSizeBytes: fileSize,
    pageCount: positiveInteger(document.page_count),
    coverWidthPixels: positiveInteger(document.cover_width_pixels),
    coverHeightPixels: positiveInteger(document.cover_height_pixels),
  }
}

function applyProcessedDocument(document) {
  const normalized = normalizeProcessedDocument(document)
  if (!normalized) return
  processedDocument.value = normalized
  if (isRestoredRun.value && normalized.fileName) {
    restoredRunFileName.value = normalized.fileName
  }
  if (normalized.coverWidthPixels && normalized.coverHeightPixels) {
    coverRatio.value = normalized.coverWidthPixels / normalized.coverHeightPixels
  }
}

function normalizeClassificationResult(classification) {
  const supportedStatuses = new Set(['classified', 'unmapped', 'partial'])
  if (!classification || !supportedStatuses.has(classification.status)) return null

  const categories = Array.isArray(classification.categories)
    ? classification.categories
      .filter((category) => (
        category
        && typeof category.code === 'string'
        && category.code.trim()
        && typeof category.name === 'string'
        && category.name.trim()
      ))
      .map((category) => ({
        code: category.code.trim(),
        name: category.name.trim(),
        scenario: typeof category.scenario === 'string' ? category.scenario.trim() : '',
      }))
    : []

  return {
    status: classification.status,
    categories,
    unmappedTypeDescription: typeof classification.unmapped_type_description === 'string'
      ? classification.unmapped_type_description.trim()
      : '',
  }
}

function classificationStatusLabel(status) {
  return {
    classified: '已匹配标准类型',
    unmapped: '未匹配标准类型',
    partial: '已形成部分结果',
  }[status] || '分类已完成'
}

function emptyCoreReviewItem(definition) {
  return Object.fromEntries(definition.properties.map((property) => [property.code, null]))
}

function isSigningDateProperty(property) {
  return property?.type === 'string' && property.name.replaceAll(/\s/g, '') === '签订日期'
}

function normalizeSigningDateValue(value) {
  if (value === null || value === undefined || value === '') return null
  const text = String(value).trim()
  const match = /^(\d{4})\s*(?:[-/.年]\s*)?(\d{1,2})\s*(?:[-/.月]\s*)?(\d{1,2})(?:日)?(?:[T\s].*)?$/.exec(text)
  if (!match) return text

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) return text
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function isValidCanonicalSigningDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '')
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const candidate = new Date(Date.UTC(year, month - 1, day))
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day
}

function normalizeCorePropertyValue(property, value) {
  return isSigningDateProperty(property) ? normalizeSigningDateValue(value) : value
}

function initializeCoreReviewModel(definitions = coreDefinitions.value) {
  coreReviewModel.clear()
  definitions.forEach((definition) => {
    coreReviewModel.set(
      definition.code,
      definition.cardinality === 'single' ? [emptyCoreReviewItem(definition)] : [],
    )
  })
}

function rawDraftCoreValue(definition) {
  const core = extractionDraft.value?.core
  if (core && typeof core === 'object' && Object.hasOwn(core, definition.code)) {
    return { found: true, value: core[definition.code] }
  }
  return { found: false, value: undefined }
}

function normalizeCoreReviewItem(definition, rawValue) {
  const item = emptyCoreReviewItem(definition)
  if (rawValue === null || rawValue === undefined) return item

  if (definition.properties.length === 1 && typeof rawValue !== 'object') {
    const property = definition.properties[0]
    item[property.code] = normalizeCorePropertyValue(property, rawValue)
    return item
  }
  if (typeof rawValue !== 'object' || Array.isArray(rawValue)) return item

  definition.properties.forEach((property) => {
    if (Object.hasOwn(rawValue, property.code)) {
      item[property.code] = normalizeCorePropertyValue(property, rawValue[property.code])
    }
  })
  return item
}

function syncCoreReviewModelFromDraft() {
  coreDefinitions.value.forEach((definition) => {
    const fieldPrefix = `core:${definition.code}:`
    const hasLocalChanges = [...modifiedFields].some((path) => path.startsWith(fieldPrefix))
    if (hasLocalChanges) return

    const extracted = rawDraftCoreValue(definition)
    if (!extracted.found) return
    const rawItems = definition.cardinality === 'multiple'
      ? (Array.isArray(extracted.value) ? extracted.value : extracted.value == null ? [] : [extracted.value])
      : [Array.isArray(extracted.value) ? extracted.value[0] : extracted.value]
    coreReviewModel.set(
      definition.code,
      rawItems.map((value) => normalizeCoreReviewItem(definition, value)),
    )
  })
}

function syncClauseReviewModelFromDraft() {
  if (clausesLocallyModified.value) return
  const clauses = extractionDraft.value?.clauses
  clauseReviewModel.value = Array.isArray(clauses)
    ? clauses.map((clause) => ({ ...clause, path: Array.isArray(clause.path) ? [...clause.path] : [] }))
    : []
}

function syncReviewOverviewFromSuggestion() {
  if (!reviewSummaryModified.value) reviewSummary.value = contractOverview.value?.summary || ''
  if (reviewFileNameModified.value) return
  const suggestedName = contractOverview.value?.file_name
  reviewFileName.value = typeof suggestedName === 'string' && suggestedName.trim()
    ? suggestedName.trim()
    : stripPdfSuffix(selectedFileName.value).trim()
}

async function ensureCoreDefinitions(signal) {
  if (coreDefinitionsReady.value) return
  coreDefinitionsLoading.value = true
  try {
    const definitions = await getCoreDefinitions({ signal })
    coreDefinitions.value = definitions
    coreDefinitionsReady.value = true
    initializeCoreReviewModel(definitions)
  } finally {
    coreDefinitionsLoading.value = false
  }
}

function applyStageSnapshot(stageSnapshot) {
  const localStageId = backendStageToLocal[stageSnapshot?.code]
  const stage = stages[localStageId]
  if (!stage) return

  setStage(
    localStageId,
    stageSnapshot.status,
    normalizeStageProgress(stageSnapshot.progress),
    stage.duration,
    stageSnapshot.message || stage.message,
  )
  applyStageTimerSnapshot(stage, stageSnapshot)
  stage.attempt = Number.isInteger(stageSnapshot.attempt) ? stageSnapshot.attempt : stage.attempt
  stage.retryable = Boolean(stageSnapshot.retryable)
  stage.resultStatus = stageSnapshot.result_status || null
  stage.resultRevision = stageSnapshot.result_revision ?? null
  if (stageSnapshot.status === 'failed') {
    stage.error = stageSnapshot.message || '该阶段处理失败，请稍后重试。'
  }
}

function applyDraft(draft) {
  if (!draft || typeof draft !== 'object') return
  extractionDraft.value = draft
  syncCoreReviewModelFromDraft()
  syncClauseReviewModelFromDraft()
  syncReviewOverviewFromSuggestion()
  markResultUpdated()
}

function applyExtractionSnapshot(snapshot, {
  openDeduplication = true,
  openDocumentRejection = true,
} = {}) {
  const run = snapshot?.run
  if (!run?.run_id) return
  awaitingExtractionFollowup = false

  currentRunId.value = run.run_id
  currentRunStatus.value = run.status || ''
  if (run.document) applyProcessedDocument(run.document)
  availableSections.value = Array.isArray(run.available_sections) ? [...run.available_sections] : []
  Object.entries(run.stages || {}).forEach(([code, stage]) => applyStageSnapshot({ ...stage, code }))
  if (run.document_detection) documentDetection.value = run.document_detection
  if (Object.hasOwn(run, 'classification')) {
    classificationResult.value = normalizeClassificationResult(run.classification)
  }
  contractOverview.value = modelContractOverview(run.contract_overview)
  syncReviewOverviewFromSuggestion()
  if (snapshot.draft) applyDraft(snapshot.draft)

  const hasActiveStage = Object.values(run.stages || {}).some((stage) =>
    ['running', 'retrying'].includes(stage?.status),
  )
  workflowStarted.value = true
  workflowRunning.value = run.status === 'awaiting_deduplication_review'
    || run.status === 'processing'
    || (run.status === 'partial_ready' && hasActiveStage)
  uploadInProgress.value = false
  workflowError.value = ''
  if (run.status === 'failed') workflowError.value = '合同处理未能形成可用结果'

  if (openDocumentRejection && run.status === 'not_a_contract' && run.document_detection) {
    requestDetail('stage', 'detection')
  }

  if (
    openDeduplication
    && ['awaiting_deduplication_review', 'duplicate_rejected'].includes(run.status)
    && run.deduplication
  ) {
    presentDeduplicationReview(run.deduplication)
  } else if (run.deduplication) {
    updateDeduplicationReview(run.deduplication)
  }
}

function presentRestoredRunDetail(snapshot) {
  const run = snapshot?.run
  if (!run) return

  if (
    ['awaiting_deduplication_review', 'duplicate_rejected'].includes(run.status)
    && run.deduplication
    && (run.status === 'duplicate_rejected' || !run.deduplication.continued_at)
  ) {
    presentDeduplicationReview(run.deduplication)
    return
  }

  if (resultAvailable.value) requestDetail('result')
}

async function refreshExtractionSnapshot(generation = streamGeneration) {
  if (!currentRunId.value || generation !== streamGeneration) return
  const snapshot = await getExtractionSnapshot(currentRunId.value)
  if (generation === streamGeneration) applyExtractionSnapshot(snapshot)
}

function scheduleStreamRecovery(generation, message = '') {
  if (generation !== streamGeneration || (!workflowRunning.value && !awaitingExtractionFollowup) || reconnectTimer !== null) return
  if (message) workflowError.value = message
  reconnectTimer = window.setTimeout(async () => {
    reconnectTimer = null
    if (generation !== streamGeneration || (!workflowRunning.value && !awaitingExtractionFollowup)) return
    try {
      await refreshExtractionSnapshot(generation)
      if (generation === streamGeneration && workflowRunning.value) subscribeToExtractionEvents(generation)
    } catch (error) {
      if (error?.name !== 'AbortError') {
        scheduleStreamRecovery(generation, error?.message || '正在重新连接处理事件')
      }
    }
  }, 1200)
}

async function handleExtractionEvent(frame, generation) {
  if (generation !== streamGeneration || frame.event === 'heartbeat') return
  const event = frame.data
  if (!event || typeof event !== 'object') return
  awaitingExtractionFollowup = awaitsExtractionFollowup(event)

  const sequence = Number(frame.id || event.sequence)
  if (Number.isInteger(sequence) && sequence >= 0) lastEventSequence = sequence
  if (event.stage) applyStageSnapshot(event.stage)
  if (event.document_detection) documentDetection.value = event.document_detection
  if (
    event.event_type === 'stage.completed'
    && event.stage?.code === 'contract_classification'
  ) {
    classificationResult.value = normalizeClassificationResult(event.classification)
  }
  if (
    event.event_type === 'stage.completed'
    && event.stage?.code === CONTRACT_OVERVIEW_STAGE_CODE
    && event.stage?.status === 'succeeded'
  ) {
    const overview = modelContractOverview(event.contract_overview)
    if (!overview) throw new TypeError('合同概述完成事件缺少结果，请重新同步任务')
    contractOverview.value = overview
    syncReviewOverviewFromSuggestion()
  } else if (event.stage?.code === CONTRACT_OVERVIEW_STAGE_CODE && ['running', 'retrying', 'failed'].includes(event.stage.status)) {
    contractOverview.value = null
    syncReviewOverviewFromSuggestion()
  }
  if (event.overall_status) {
    currentRunStatus.value = event.overall_status
    const hasActiveStage = stageOrder.some((stageId) =>
      ['running', 'retrying'].includes(stages[stageId].status),
    )
    workflowRunning.value = event.overall_status === 'awaiting_deduplication_review'
      || event.overall_status === 'processing'
      || (event.overall_status === 'partial_ready' && hasActiveStage)
  }
  if (Array.isArray(event.available_sections)) availableSections.value = [...event.available_sections]

  if (event.event_type === 'run.document_rejected') {
    documentDetection.value = event.document_detection || null
    currentRunStatus.value = 'not_a_contract'
    workflowRunning.value = false
    requestDetail('stage', 'detection')
  } else if (event.event_type === 'run.duplicate_rejected') {
    currentRunStatus.value = 'duplicate_rejected'
    workflowRunning.value = false
    uploadInProgress.value = false
    continuationPending.value = false
    continuationError.value = ''
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
    reconnectTimer = null
    presentDeduplicationReview(event.deduplication || deduplicationReview.value)
    eventStreamController?.abort()
  } else if (event.event_type === 'run.deduplication_review_required') {
    currentRunStatus.value = 'awaiting_deduplication_review'
    workflowRunning.value = true
    presentDeduplicationReview(event.deduplication)
  } else if (event.event_type === 'run.continued') {
    continuationPending.value = false
    continuationError.value = ''
    if (event.deduplication) updateDeduplicationReview(event.deduplication)
    else await refreshExtractionSnapshot(generation)
  } else if (['draft.updated', 'run.review_ready'].includes(event.event_type)) {
    await refreshExtractionSnapshot(generation)
  } else if (event.event_type === 'run.cancelled') {
    const cancelledRunId = event.run_id || currentRunId.value
    finalizeCancelledWorkflow(cancelledRunId)
    cancellationRequestController?.abort()
  } else if (event.event_type === 'run.expired') {
    workflowRunning.value = false
    currentRunStatus.value = 'expired'
    workflowError.value = '处理任务已过期，请重新上传 PDF'
    eventStreamController?.abort()
  }

  // 不能只根据阶段事件中的 overall_status 断流，否则会漏掉后续候选或草稿。
  if (!workflowRunning.value && !uploadInProgress.value && !awaitingExtractionFollowup) {
    eventStreamController?.abort()
  }
}

async function subscribeToExtractionEvents(generation = streamGeneration) {
  if (!currentRunId.value || generation !== streamGeneration) return
  eventStreamController?.abort()
  const controller = new AbortController()
  eventStreamController = controller

  try {
    await streamExtractionEvents(currentRunId.value, {
      signal: controller.signal,
      lastEventId: lastEventSequence,
      onEvent: (frame) => handleExtractionEvent(frame, generation),
    })
    if (generation === streamGeneration && (workflowRunning.value || awaitingExtractionFollowup)) {
      scheduleStreamRecovery(generation, '处理事件连接已中断，正在恢复')
    }
  } catch (error) {
    if (error?.name === 'AbortError' || generation !== streamGeneration) return
    if (error?.status === 404) {
      workflowRunning.value = false
      currentRunStatus.value = 'expired'
      workflowError.value = '处理任务不存在或已经过期'
      return
    }
    scheduleStreamRecovery(generation, error?.message || '处理事件连接异常，正在恢复')
  }
}

function resetWorkflowState({ preserveDetail = false } = {}) {
  stopExtractionNetwork()
  closeCandidatePreview()
  clearTimers()
  queuedDetailMode.value = ''
  queuedDetailStageId.value = ''
  if (deduplicationRefreshTimer !== null) window.clearTimeout(deduplicationRefreshTimer)
  deduplicationRefreshTimer = null
  deduplicationContentRefreshing.value = false
  selectedStageId.value = ''
  if (!preserveDetail) detailMode.value = ''
  workflowStarted.value = false
  workflowRunning.value = false
  workflowStopped.value = false
  workflowRewinding.value = false
  uploadInProgress.value = false
  cancellationPending.value = false
  coreDefinitionsLoading.value = false
  workflowError.value = ''
  restoredRunFileName.value = ''
  processedDocument.value = null
  currentRunId.value = ''
  currentRunStatus.value = ''
  availableSections.value = []
  extractionDraft.value = null
  documentDetection.value = null
  deduplicationReview.value = null
  classificationResult.value = null
  contractOverview.value = null
  continuationPending.value = false
  continuationError.value = ''
  candidatePreviewId.value = ''
  candidatePreviewError.value = ''
  lastEventSequence = null
  resultUpdating.value = false
  modifiedFields.clear()
  draftOverrides.clear()
  editingClauseIds.clear()
  clauseReviewModel.value = []
  clausesLocallyModified.value = false
  removingClauseIds.clear()
  clauseInsertIndex.value = null
  clauseInsertError.value = ''
  clauseFormAnimating.value = false
  reviewFileName.value = ''
  reviewFileNameModified.value = false
  reviewSummary.value = ''
  reviewSummaryModified.value = false
  ingestionPending.value = false
  clearIngestionErrors()
  clearIngestionIssues()
  ingestionReceipt.value = null
  initializeCoreReviewModel()
  retractingStageIds.clear()
  retractingIncomingEdgeIds.clear()
  retractingResultEdgeIds.clear()
  duplicationLoaderVisible.value = false
  duplicationLoaderLeaving.value = false
  structureLoaderVisible.value = false
  structureLoaderLeaving.value = false
  classificationLoaderVisible.value = false
  classificationLoaderLeaving.value = false

  stageOrder.forEach((stageId) => {
    const stage = stages[stageId]
    setStage(stageId, 'pending', null, '—', `等待处理${stage.name}。`)
    stage.attempt = 0
    stage.retryable = false
    resetStageTimer(stage)
  })
}

function waitForWorkflowSwitch(delay) {
  return new Promise((resolve) => {
    workflowSwitchTimer = window.setTimeout(() => {
      workflowSwitchTimer = null
      resolve()
    }, delay)
  })
}

function resetWorkflowInput() {
  selectedSourceFile.value = null
  customFileName.value = ''
  restoredRunFileName.value = ''
  selectedSourceKind.value = ''
  selectedFile.value = null
  selectedFilePageCount.value = null
  imageConversionStatus.value = ''
  fileSelectionError.value = ''
  coverReading.value = false
  coverRendered.value = false
  coverPresentationReady.value = false
  coverRasterCanvas = null
  coverRatio.value = 612 / 792
  coverDimensions.value = null
  fileSelectionSequence += 1
  if (fileInput.value) fileInput.value.value = ''
  if (coverPresentationTimer !== null) {
    window.clearTimeout(coverPresentationTimer)
    coverPresentationTimer = null
  }
}

async function createNewExtractionWorkflow() {
  if (newExtractionDisabled.value) return

  closeRunsPanel()
  closeDetail()
  runRestoreController?.abort()
  runRestoreController = null
  runsRestoringId.value = ''
  runsRestoreError.value = ''
  runsRestoreErrorId.value = ''
  stopExtractionNetwork()
  workflowSwitchPhase.value = 'leaving'

  await waitForWorkflowSwitch(440)
  resetWorkflowState()
  resetWorkflowInput()
  workflowScrollExtension.value = 0
  await nextTick()
  if (workflowViewport.value) workflowViewport.value.scrollLeft = 0
  workflowSwitchPhase.value = 'entering'

  await waitForWorkflowSwitch(580)
  workflowSwitchPhase.value = ''
}

function stopWorkflow({ force = false, clearRestoredInput = false } = {}) {
  if (workflowRewinding.value || (!workflowRunning.value && !force)) return

  stopExtractionNetwork()
  clearTimers()
  workflowRunning.value = false
  uploadInProgress.value = false
  coreDefinitionsLoading.value = false
  workflowRewinding.value = true
  workflowStopped.value = false
  resultUpdating.value = false

  stageOrder.forEach((stageId) => freezeStageTimer(stages[stageId]))

  const isActiveStage = (stageId) => {
    const stage = stages[stageId]
    return stage.status !== 'pending' || stage.progress !== null
  }
  const retractProgress = (stageIds) => {
    stageIds.forEach((stageId) => {
      const stage = stages[stageId]
      if (!stage.progress) return
      retractingStageIds.add(stageId)
      stage.progress = { ...stage.progress, completed: 0 }
    })
  }
  const resetStoppedStages = (stageIds) => {
    stageIds.forEach((stageId) => {
      const stage = stages[stageId]
      if (stageId === 'duplication') hideDuplicationLoader()
      if (stageId === 'preprocessing') hideStructureLoader()
      if (stageId === 'classification') hideClassificationLoader()
      stage.status = 'pending'
      stage.progress = null
      stage.duration = '—'
      stage.message = '任务已取消，可重新开始处理。'
      stage.retryable = false
      retractingStageIds.delete(stageId)
      retractingIncomingEdgeIds.delete(stageId)
      retractingResultEdgeIds.delete(stageId)
      fadeStageTimer(stage)
    })
  }

  const branchStageIds = branchIds.filter(isActiveStage)
  let rewindDelay = 0

  if (branchStageIds.length) {
    retractProgress(branchStageIds)
    branchStageIds.forEach((stageId) => retractingResultEdgeIds.add(stageId))

    schedule(() => {
      branchStageIds.forEach((stageId) => {
        retractingIncomingEdgeIds.add(stageId)
      })
    }, 650)
    rewindDelay = 1550
    schedule(() => resetStoppedStages(branchStageIds), rewindDelay)
  }

  const sequentialStageIds = ['overview', 'classification', 'preprocessing', 'duplication', 'detection']
  sequentialStageIds.forEach((stageId) => {
    if (!isActiveStage(stageId)) return
    schedule(() => {
      retractProgress([stageId])
      retractingIncomingEdgeIds.add(stageId)
    }, rewindDelay)
    rewindDelay += 900
    schedule(() => resetStoppedStages([stageId]), rewindDelay)
  })

  if (!rewindDelay) {
    stageOrder.forEach((stageId) => {
      const stage = stages[stageId]
      if (['running', 'retrying'].includes(stage.status)) resetStoppedStages([stageId])
    })
  }

  const finishRewind = () => {
    workflowRewinding.value = false
    workflowStarted.value = false
    workflowStopped.value = true
    if (clearRestoredInput) {
      resetWorkflowInput()
      closeDetail()
    }
  }
  if (rewindDelay) schedule(finishRewind, rewindDelay)
  else finishRewind()
}

function finalizeCancelledWorkflow(runId) {
  if (!runId || currentRunId.value !== runId) return
  const clearRestoredInput = isRestoredRun.value

  runsListController?.abort()
  runsListController = null
  runsLoading.value = false
  extractionRuns.value = extractionRuns.value.filter((run) => run.run_id !== runId)
  stopExtractionNetwork()
  closeCandidatePreview()
  currentRunId.value = ''
  currentRunStatus.value = 'cancelled'
  processedDocument.value = null
  availableSections.value = []
  extractionDraft.value = null
  documentDetection.value = null
  deduplicationReview.value = null
  classificationResult.value = null
  contractOverview.value = null
  continuationPending.value = false
  continuationError.value = ''
  workflowError.value = ''
  modifiedFields.clear()
  draftOverrides.clear()
  editingClauseIds.clear()
  clauseReviewModel.value = []
  clausesLocallyModified.value = false
  removingClauseIds.clear()
  clauseInsertIndex.value = null
  clauseInsertError.value = ''
  clauseFormAnimating.value = false
  reviewFileName.value = ''
  reviewFileNameModified.value = false
  reviewSummary.value = ''
  reviewSummaryModified.value = false
  ingestionPending.value = false
  clearIngestionErrors()
  clearIngestionIssues()
  ingestionReceipt.value = null
  initializeCoreReviewModel()
  stopWorkflow({ force: true, clearRestoredInput })
}

async function cancelCurrentExtractionRun() {
  if (!canCancelExtractionRun.value || cancellationPending.value) return
  const runId = currentRunId.value
  const controller = new AbortController()
  cancellationRequestController = controller
  cancellationPending.value = true
  workflowError.value = ''

  try {
    await cancelExtractionRun(runId, { signal: controller.signal })
    if (cancellationRequestController !== controller) return
    finalizeCancelledWorkflow(runId)
  } catch (error) {
    if (error?.name === 'AbortError') return
    if (currentRunId.value !== runId) return
    if (error?.status === 404) {
      extractionRuns.value = extractionRuns.value.filter((run) => run.run_id !== runId)
      stopExtractionNetwork()
      workflowRunning.value = false
      currentRunStatus.value = 'unavailable'
      workflowError.value = '任务不存在、已经结束，或当前用户无权取消。'
      return
    }
    workflowError.value = error?.message || '暂时无法取消合同处理任务'
  } finally {
    if (cancellationRequestController === controller) {
      cancellationRequestController = null
      cancellationPending.value = false
    }
  }
}

async function retryStage(stageId) {
  if (['duplicate_rejected', 'awaiting_deduplication_review'].includes(currentRunStatus.value)) return
  const stage = stages[stageId]
  const backendStageCode = localStageToBackend[stageId]
  if (!currentRunId.value || !backendStageCode) return
  if (!stage || stage.status !== 'failed' || !stage.retryable) return
  const requestRunId = currentRunId.value
  const generation = streamGeneration

  stage.retryable = false
  continuationError.value = ''
  try {
    const snapshot = await retryExtractionStage(requestRunId, backendStageCode)
    if (generation !== streamGeneration || currentRunId.value !== requestRunId) return
    applyExtractionSnapshot(snapshot, { openDeduplication: false })
    if (workflowRunning.value) subscribeToExtractionEvents(streamGeneration)
  } catch (error) {
    if (generation !== streamGeneration || currentRunId.value !== requestRunId) return
    stage.retryable = true
    stage.error = error?.message || '该阶段暂时无法重试'
    continuationError.value = stage.error
  }
}

function edgeState(targetId) {
  if (retractingIncomingEdgeIds.has(targetId)) return 'retracting'
  const status = stages[targetId]?.status
  if (status === 'succeeded') return 'success'
  if (status === 'failed') return 'failed'
  if (status === 'running' || status === 'retrying') return 'running'
  return 'waiting'
}

function resultEdgeState(stageId) {
  if (retractingResultEdgeIds.has(stageId)) return 'retracting'
  const status = stages[stageId].status
  if (status === 'succeeded') return 'success'
  if (status === 'failed') return 'failed'
  if (status === 'running' || status === 'retrying') return 'running'
  return 'waiting'
}

function openStage(stageId) {
  const mode = stageId === 'duplication' && deduplicationReview.value
    ? 'deduplication'
    : 'stage'
  requestDetail(mode, stageId)
}

function extractionRunStatusLabel(status) {
  return {
    processing: '后台处理中',
    blocked: '等待你的处理',
  }[status] || '状态未知'
}

function extractionRunFileName(run) {
  return run?.suggested_file_name || run?.document?.file_name || '未命名合同.pdf'
}

function formatRunTimestamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function extractionRunUpdateSignature(run) {
  return JSON.stringify([
    run?.status,
    run?.updated_at,
    run?.expires_at,
    run?.document?.file_name,
    run?.document?.processed_file_size_bytes,
    run?.document?.page_count,
  ])
}

function animateUpdatedExtractionRuns(runIds) {
  if (!runsPanelOpen.value || !runIds.length) return
  runIds.forEach((runId) => updatingRunIds.delete(runId))
  nextTick(() => {
    if (!runsPanelOpen.value) return
    runIds.forEach((runId) => updatingRunIds.add(runId))
    schedule(() => {
      runIds.forEach((runId) => updatingRunIds.delete(runId))
    }, 780)
  })
}

async function refreshExtractionRuns({ showLoader = !runsLoadedOnce.value } = {}) {
  if (runsLoading.value) return
  runsListController?.abort()
  const controller = new AbortController()
  runsListController = controller
  runsLoading.value = true
  runsError.value = ''
  const loaderStartedAt = performance.now()
  if (showLoader) {
    runsItemsVisible.value = false
    runsEmptyVisible.value = false
    runsLoaderVisible.value = true
  }

  try {
    const previousRuns = extractionRuns.value
    const hadLoadedOnce = runsLoadedOnce.value
    const nextRuns = await listExtractionRuns({ signal: controller.signal })
    const previousRunsById = new Map(previousRuns.map((run) => [run.run_id, run]))
    const updatedRunIds = hadLoadedOnce
      ? nextRuns
        .filter((run) => {
          const previousRun = previousRunsById.get(run.run_id)
          return previousRun
            && extractionRunUpdateSignature(previousRun) !== extractionRunUpdateSignature(run)
        })
        .map((run) => run.run_id)
      : []

    extractionRuns.value = nextRuns
    runsLoadedOnce.value = true
    if (!showLoader) {
      runsEmptyVisible.value = runsPanelOpen.value && !nextRuns.length
    }
    animateUpdatedExtractionRuns(updatedRunIds)
  } catch (error) {
    if (error?.name !== 'AbortError') {
      runsError.value = error?.message || '暂时无法读取后台处理任务'
    }
  } finally {
    const minimumIndicatorDuration = showLoader ? 1500 : (runsPanelOpen.value ? 800 : 0)
    if (minimumIndicatorDuration > 0) {
      const remainingDuration = Math.max(0, minimumIndicatorDuration - (performance.now() - loaderStartedAt))
      await new Promise((resolve) => window.setTimeout(resolve, remainingDuration))
    }
    if (runsListController === controller) {
      runsListController = null
      runsLoading.value = false
      if (showLoader) runsLoaderVisible.value = false
    }
  }
}

function prepareRestoredRunInput(run) {
  selectedSourceFile.value = null
  customFileName.value = ''
  restoredRunFileName.value = extractionRunFileName(run)
  selectedSourceKind.value = 'pdf'
  selectedFile.value = null
  selectedFilePageCount.value = null
  imageConversionStatus.value = ''
  fileSelectionError.value = ''
  coverReading.value = false
  coverRendered.value = false
  coverPresentationReady.value = false
  coverRasterCanvas = null
  coverRatio.value = 612 / 792
  coverDimensions.value = null
  fileSelectionSequence += 1
  if (coverPresentationTimer !== null) {
    window.clearTimeout(coverPresentationTimer)
    coverPresentationTimer = null
  }
}

async function restoreExtractionRun(run) {
  if (!run?.run_id || runsRestoringId.value) return

  const previousRunId = currentRunId.value
  const resumePreviousStream = Boolean(previousRunId && workflowRunning.value)
  stopExtractionNetwork()
  const controller = new AbortController()
  runRestoreController = controller
  runsRestoringId.value = run.run_id
  runsRestoreError.value = ''
  runsRestoreErrorId.value = ''

  try {
    const [, snapshot] = await Promise.all([
      ensureCoreDefinitions(controller.signal),
      getExtractionSnapshot(run.run_id, { signal: controller.signal }),
    ])
    if (runRestoreController !== controller) return
    if (snapshot?.run?.run_id !== run.run_id) {
      throw new Error('后台任务快照与所选合同不一致')
    }

    const canKeepLocalInput = currentRunId.value === run.run_id && selectedSourceFile.value
    closeRunsPanel()
    resetWorkflowState()
    if (!canKeepLocalInput) prepareRestoredRunInput(run)
    const generation = streamGeneration
    applyExtractionSnapshot(snapshot, {
      openDeduplication: false,
      openDocumentRejection: false,
    })
    presentRestoredRunDetail(snapshot)
    if (workflowRunning.value) subscribeToExtractionEvents(generation)
    if (!canKeepLocalInput) void restoreInputCover(processedDocument.value, generation)
  } catch (error) {
    if (error?.name === 'AbortError') return
    runsRestoreErrorId.value = run.run_id
    runsRestoreError.value = error?.message || '暂时无法恢复该合同处理流'
    if (resumePreviousStream && currentRunId.value === previousRunId && workflowRunning.value) {
      subscribeToExtractionEvents(streamGeneration)
    }
  } finally {
    if (runRestoreController === controller) {
      runRestoreController = null
      runsRestoringId.value = ''
    }
  }
}

async function restoreInputCover(document, generation) {
  if (!document?.fileId) return
  const controller = new AbortController()
  restoredCoverController?.abort()
  restoredCoverController = controller
  const sequence = fileSelectionSequence
  const isCurrent = () => restoredCoverController === controller
    && !controller.signal.aborted && generation === streamGeneration && sequence === fileSelectionSequence
  coverReading.value = true
  try {
    const blob = await getExtractionPdf(document.fileId, { signal: controller.signal })
    if (!isCurrent()) return
    const file = new File([blob], normalizePdfFileName(document.fileName), { type: 'application/pdf' })
    selectedFile.value = file
    await readPdfCover(file, sequence)
  } catch (error) {
    if (!isCurrent() || error?.name === 'AbortError') return
    fileSelectionError.value = error?.message || '临时 PDF 封面恢复失败'
  } finally {
    if (isCurrent()) coverReading.value = false
    if (restoredCoverController === controller) restoredCoverController = null
  }
}

function closeRunsPanel() {
  runsPanelOpen.value = false
  stopRunsRefreshTimer()
  clearRunsEmptyRevealTimer()
  runsListController?.abort()
  runsListController = null
  runsLoading.value = false
  runsLoaderVisible.value = false
  runsItemsVisible.value = true
  runsEmptyVisible.value = false
  updatingRunIds.clear()
}

function clearRunsEmptyRevealTimer() {
  if (runsEmptyRevealTimer !== null) window.clearTimeout(runsEmptyRevealTimer)
  runsEmptyRevealTimer = null
}

function revealExtractionRuns() {
  if (!runsPanelOpen.value) return
  runsItemsVisible.value = true
  clearRunsEmptyRevealTimer()
  if (runsError.value || extractionRuns.value.length) return
  const revealDelay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240
  runsEmptyRevealTimer = window.setTimeout(() => {
    runsEmptyRevealTimer = null
    if (runsPanelOpen.value && !runsError.value && !extractionRuns.value.length) {
      runsEmptyVisible.value = true
    }
  }, revealDelay)
}

function toggleRunsPanel() {
  if (runsPanelOpen.value) {
    closeRunsPanel()
    return
  }

  closeDetail()
  runsPanelOpen.value = true
  if (!runsLoadedOnce.value && runsLoading.value) {
    runsItemsVisible.value = false
    runsEmptyVisible.value = false
    runsLoaderVisible.value = true
  } else {
    runsEmptyVisible.value = runsLoadedOnce.value && !runsError.value && !extractionRuns.value.length
    refreshExtractionRuns()
  }
  startRunsRefreshTimer()
}

function startRunsRefreshTimer() {
  if (!viewActive || !runsPanelOpen.value || runsRefreshTimer !== null) return
  runsRefreshTimer = window.setInterval(() => {
    refreshExtractionRuns({ showLoader: false })
  }, 6000)
}

function stopRunsRefreshTimer() {
  if (runsRefreshTimer !== null) window.clearInterval(runsRefreshTimer)
  runsRefreshTimer = null
}

function openInput() {
  requestDetail('input')
}

function requestFileSelection() {
  fileInput.value?.click()
}

function clearInputDocument() {
  if (
    workflowRunning.value
    || workflowRewinding.value
    || uploadInProgress.value
    || cancellationPending.value
    || currentRunId.value
  ) return

  if (detailMode.value === 'input') closeDetail()
  resetWorkflowState()
  resetWorkflowInput()
}

function stripPdfSuffix(fileName) {
  return typeof fileName === 'string' ? fileName.replace(/(?:\.pdf)+$/i, '') : ''
}

function normalizePdfFileName(fileName, fallback = 'contract') {
  const baseName = stripPdfSuffix(fileName).trim().slice(0, 251) || fallback
  return `${baseName}.pdf`
}

function activateInputNode() {
  if (hasInputDocument.value) {
    openInput()
    return
  }
  requestFileSelection()
}

async function convertImageToPdf(file, selectionSequence) {
  try {
    const pdfFile = await convertImageFileToPdf(file)
    if (selectionSequence !== fileSelectionSequence) return
    selectedFile.value = pdfFile
    imageConversionStatus.value = 'converted'
    await readPdfCover(selectedFile.value, selectionSequence)
  } catch {
    if (selectionSequence !== fileSelectionSequence) return
    selectedFile.value = null
    imageConversionStatus.value = 'failed'
    fileSelectionError.value = '图片转换为 PDF 失败'
    drawCoverFallback(selectedFileBadge.value)
    coverReading.value = false
  }
}

function drawCoverFallback(label) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return
  canvas.width = Math.max(1, Math.round(coverRenderWidth.value))
  canvas.height = Math.max(1, Math.round(coverRenderWidth.value / coverRatio.value))
  context.fillStyle = '#f7f9f8'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#9aa39e'
  context.font = '700 14px sans-serif'
  context.textAlign = 'center'
  context.fillText(label, canvas.width / 2, canvas.height / 2)
  coverRasterCanvas = canvas
  coverRendered.value = paintCoverCanvas()
}

function paintCoverCanvas() {
  const canvas = coverCanvas.value
  const context = canvas?.getContext('2d')
  if (!canvas || !context || !coverRasterCanvas) return false

  canvas.width = coverRasterCanvas.width
  canvas.height = coverRasterCanvas.height
  context.drawImage(coverRasterCanvas, 0, 0)
  return true
}

function queueCoverPresentationReady(selectionSequence) {
  if (coverPresentationTimer !== null) window.clearTimeout(coverPresentationTimer)
  coverPresentationTimer = window.setTimeout(() => {
    coverPresentationTimer = null
    if (
      selectionSequence === fileSelectionSequence
      && coverRendered.value
      && !coverReading.value
    ) {
      coverPresentationReady.value = true
    }
  }, 360)
}

function loadPdfRuntime() {
  if (!pdfRuntimePromise) {
    pdfRuntimePromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfModule) => {
      pdfWorkerPort ??= new PdfWorker()
      pdfModule.GlobalWorkerOptions.workerPort = pdfWorkerPort
      return { getDocument: pdfModule.getDocument }
    })
  }
  return pdfRuntimePromise
}

async function readPdfCover(file, selectionSequence) {
  let loadingTask = null
  let pdfDocument = null
  let dimensionsRead = false

  try {
    const { getDocument } = await loadPdfRuntime()
    const data = new Uint8Array(await file.arrayBuffer())
    loadingTask = getDocument({
      data,
      cMapUrl: `${PDFJS_ASSET_BASE}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
      wasmUrl: `${PDFJS_ASSET_BASE}wasm/`,
      useSystemFonts: true,
    })
    pdfDocument = await loadingTask.promise
    if (selectionSequence !== fileSelectionSequence) return
    selectedFilePageCount.value = pdfDocument.numPages
    const firstPage = await pdfDocument.getPage(1)
    const viewport = firstPage.getViewport({ scale: 1 })

    if (selectionSequence !== fileSelectionSequence) return
    if (viewport.width > 0 && viewport.height > 0) {
      coverRatio.value = viewport.width / viewport.height
      coverDimensions.value = { width: viewport.width, height: viewport.height, unit: 'pt' }
      dimensionsRead = true

      await nextTick()
      if (selectionSequence !== fileSelectionSequence) return
      const renderScale = PDF_COVER_MAX_RASTER_SIDE / Math.max(viewport.width, viewport.height)
      const renderViewport = firstPage.getViewport({ scale: renderScale })
      const rasterCanvas = document.createElement('canvas')
      const rasterContext = rasterCanvas.getContext('2d', { alpha: false })
      if (!rasterContext) throw new Error('Canvas is unavailable')
      rasterCanvas.width = Math.max(1, Math.floor(renderViewport.width))
      rasterCanvas.height = Math.max(1, Math.floor(renderViewport.height))
      await firstPage.render({
        canvasContext: rasterContext,
        viewport: renderViewport,
        background: '#fff',
      }).promise
      if (selectionSequence === fileSelectionSequence) {
        coverRasterCanvas = rasterCanvas
        coverRendered.value = paintCoverCanvas()
      }
    }
  } catch (error) {
    if (selectionSequence !== fileSelectionSequence) return
    console.error('PDF cover rendering failed:', error)
    fileSelectionError.value = '封面预览生成失败'
    if (!dimensionsRead) {
      coverRatio.value = 612 / 792
      coverDimensions.value = null
    }
    drawCoverFallback('PDF')
  } finally {
    if (loadingTask) {
      try {
        await loadingTask.destroy()
      } catch {
        // 尺寸已读取完成时，清理失败不应阻断当前上传流程。
      }
    }

    if (selectionSequence === fileSelectionSequence) {
      coverReading.value = false
      if (coverRendered.value) queueCoverPresentationReady(selectionSequence)
    }
  }
}

async function startWorkflow() {
  if (!selectedFile.value || !coverPresentationReady.value || coverReading.value || workflowStarted.value || workflowRewinding.value) return
  const fileName = selectedFileName.value

  resetWorkflowState({ preserveDetail: true })
  fileSelectionError.value = ''
  const generation = streamGeneration
  const controller = new AbortController()
  extractionRequestController = controller
  workflowStarted.value = true
  workflowRunning.value = true
  uploadInProgress.value = true

  try {
    await ensureCoreDefinitions(controller.signal)
    if (generation !== streamGeneration) return
    const snapshot = await createExtractionRun(selectedFile.value, {
      signal: controller.signal,
      fileName,
    })
    if (generation !== streamGeneration) return
    applyExtractionSnapshot(snapshot, { openDeduplication: false })
    subscribeToExtractionEvents(generation)
  } catch (error) {
    if (error?.name === 'AbortError' || generation !== streamGeneration) return
    workflowStarted.value = false
    workflowRunning.value = false
    uploadInProgress.value = false
    workflowError.value = error?.message || '合同任务创建失败，请稍后重试'
    fileSelectionError.value = workflowError.value
  } finally {
    if (extractionRequestController === controller) extractionRequestController = null
    if (generation === streamGeneration) uploadInProgress.value = false
  }
}

function toggleWorkflowExtraction() {
  if (canCancelExtractionRun.value) {
    cancelCurrentExtractionRun()
    return
  }
  if (workflowStarted.value || cancellationPending.value) return
  startWorkflow()
}

async function continueAfterDeduplication() {
  if (!currentRunId.value || !deduplicationReviewPending.value || continuationPending.value) return
  const requestRunId = currentRunId.value
  const generation = streamGeneration
  continuationPending.value = true
  continuationError.value = ''

  try {
    const snapshot = await continueExtractionRun(requestRunId)
    if (generation !== streamGeneration || currentRunId.value !== requestRunId) return
    applyExtractionSnapshot(snapshot, { openDeduplication: false })
    requestDetail('stage', 'preprocessing')
    if (workflowRunning.value) subscribeToExtractionEvents(streamGeneration)
  } catch (error) {
    if (generation !== streamGeneration || currentRunId.value !== requestRunId) return
    continuationError.value = error?.message || '暂时无法继续处理'
  } finally {
    if (generation === streamGeneration && currentRunId.value === requestRunId) {
      continuationPending.value = false
    }
  }
}

function candidateRelationLabel(relation) {
  return {
    duplicate: '重复合同',
    similar: '相似合同',
    different: '不同合同',
    failed: '判断未完成',
  }[relation] || '待确认'
}

function candidateSimilarityLabel(similarity) {
  if (!Number.isFinite(similarity)) return '—'
  return `${(similarity * 100).toFixed(1)}%`
}

function candidateSimilarityProgress(similarity) {
  if (!Number.isFinite(similarity)) return 0
  return Math.min(100, Math.max(0, similarity * 100))
}

async function previewDeduplicationCandidate(candidate) {
  const fileUri = candidate?.file_uri
  if (!fileUri || candidatePreviewId.value) return
  const requestRunId = currentRunId.value
  const generation = streamGeneration

  candidatePreviewId.value = candidate.document_id
  candidatePreviewError.value = ''
  try {
    const pdfBlob = await getDeduplicationCandidatePdf(fileUri)
    if (generation !== streamGeneration || currentRunId.value !== requestRunId) return
    closeCandidatePreview()
    const objectUrl = URL.createObjectURL(pdfBlob)
    candidatePreviewUrl.value = objectUrl
    candidatePreviewLabel.value = candidate.file_name || '候选合同'
    emit('visual-pause-change', true)
  } catch (error) {
    if (generation !== streamGeneration || currentRunId.value !== requestRunId) return
    candidatePreviewError.value = error?.message || '候选 PDF 预览失败'
  } finally {
    if (generation === streamGeneration && currentRunId.value === requestRunId) {
      candidatePreviewId.value = ''
    }
  }
}

function handleFileSelection(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  runRestoreController?.abort()
  runRestoreController = null
  runsRestoringId.value = ''

  const fileKind = getSelectedFileKind(file)
  if (!fileKind) {
    fileSelectionError.value = '请选择 PDF 或常见图片文件'
    return
  }

  resetWorkflowState()

  selectedSourceFile.value = file
  if (fileKind === 'image') {
    const extensionIndex = file.name.lastIndexOf('.')
    const baseName = (extensionIndex > 0 ? file.name.slice(0, extensionIndex) : file.name).trim()
      || 'contract-image'
    customFileName.value = normalizePdfFileName(baseName, 'contract-image')
  } else {
    customFileName.value = file.name
  }
  selectedSourceKind.value = fileKind
  selectedFile.value = fileKind === 'pdf' ? file : null
  imageConversionStatus.value = fileKind === 'image' ? 'converting' : ''
  fileSelectionError.value = ''
  coverReading.value = true
  coverRendered.value = false
  coverPresentationReady.value = false
  coverRasterCanvas = null
  if (coverPresentationTimer !== null) {
    window.clearTimeout(coverPresentationTimer)
    coverPresentationTimer = null
  }
  coverRatio.value = 612 / 792
  coverDimensions.value = null
  selectedFilePageCount.value = null
  fileSelectionSequence += 1
  openInput()
  if (fileKind === 'pdf') readPdfCover(file, fileSelectionSequence)
  else convertImageToPdf(file, fileSelectionSequence)
}

function openResult() {
  if (!resultAvailable.value) return
  requestDetail('result')
}

function closeDetail() {
  queuedDetailMode.value = ''
  queuedDetailStageId.value = ''
  detailMode.value = ''
  selectedStageId.value = ''
  openBooleanControlKey.value = ''
}

function editableDraftValue(path, fallback) {
  return draftOverrides.has(path) ? draftOverrides.get(path) : fallback
}

function updateDraftValue(path, event) {
  draftOverrides.set(path, event.target.value)
  modifiedFields.add(path)
}

function coreReviewPath(definitionCode, itemIndex, propertyCode) {
  return `core:${definitionCode}:${itemIndex}:${propertyCode}`
}

function coreReviewInputValue(definitionCode, itemIndex, property) {
  const item = coreReviewModel.get(definitionCode)?.[itemIndex]
  const value = item?.[property.code]
  if (property.type === 'boolean') {
    if (value === true) return 'true'
    if (value === false) return 'false'
    return ''
  }
  return value ?? ''
}

function coreReviewValuePresent(value) {
  return value !== null
    && value !== undefined
    && (typeof value !== 'string' || Boolean(value.trim()))
}

function coreReviewItemActive(definitionCode, itemIndex) {
  const definition = coreDefinitions.value.find((item) => item.code === definitionCode)
  const item = coreReviewModel.get(definitionCode)?.[itemIndex]
  if (!definition || !item) return false
  if (definition.cardinality === 'multiple') return true
  return definition.properties.some((property) => coreReviewValuePresent(item[property.code]))
}

function coreReviewValueMissing(definitionCode, itemIndex, property) {
  if (!isSigningDateProperty(property) && (!property.required || !coreReviewItemActive(definitionCode, itemIndex))) return false
  const value = coreReviewModel.get(definitionCode)?.[itemIndex]?.[property.code]
  return !coreReviewValuePresent(value)
}

function booleanReviewControlKey(definitionCode, itemIndex, propertyCode) {
  return coreReviewPath(definitionCode, itemIndex, propertyCode)
}

function booleanReviewOptionId(definitionCode, itemIndex, propertyCode, optionIndex) {
  return `core-boolean-${definitionCode}-${itemIndex}-${propertyCode}-${optionIndex}`
}

function booleanReviewLabel(value) {
  return booleanReviewOptions.find((option) => option.value === value)?.label || '未选择'
}

function booleanReviewOptionIndex(value) {
  return Math.max(0, booleanReviewOptions.findIndex((option) => option.value === value))
}

function toggleBooleanReviewControl(definitionCode, itemIndex, propertyCode) {
  const key = booleanReviewControlKey(definitionCode, itemIndex, propertyCode)
  openBooleanControlKey.value = openBooleanControlKey.value === key ? '' : key
}

function selectBooleanReviewValue(definition, itemIndex, property, rawValue) {
  const item = coreReviewModel.get(definition.code)?.[itemIndex]
  if (!item) return

  item[property.code] = rawValue === '' ? null : rawValue === 'true'
  modifiedFields.add(coreReviewPath(definition.code, itemIndex, property.code))
  const key = booleanReviewControlKey(definition.code, itemIndex, property.code)
  schedule(() => {
    if (openBooleanControlKey.value === key) openBooleanControlKey.value = ''
  }, 520)
}

function updateCoreReviewValue(definition, itemIndex, property, event) {
  const item = coreReviewModel.get(definition.code)?.[itemIndex]
  if (!item) return
  const rawValue = event.target.value
  item[property.code] = property.type === 'boolean'
    ? rawValue === '' ? null : rawValue === 'true'
    : rawValue
  modifiedFields.add(coreReviewPath(definition.code, itemIndex, property.code))
}

function updateSigningDateValue(definition, itemIndex, property, value) {
  const item = coreReviewModel.get(definition.code)?.[itemIndex]
  if (!item) return
  item[property.code] = value || null
  modifiedFields.add(coreReviewPath(definition.code, itemIndex, property.code))
}

function updateReviewFileName(event) {
  reviewFileName.value = event.target.value
  reviewFileNameModified.value = true
}

function updateReviewSummary(value) {
  reviewSummary.value = value
  reviewSummaryModified.value = true
}

function serializeCoreProperty(value, type) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null
  if (type === 'integer') return Number.parseInt(value, 10)
  if (type === 'number') return Number(value)
  if (type === 'boolean') return value === true || value === 'true'
  return String(value)
}

function serializeCoreReview() {
  return Object.fromEntries(coreDefinitions.value.map((definition) => {
    const items = coreReviewModel.get(definition.code) || []
    const serializedItems = items.map((item) => Object.fromEntries(
      definition.properties
        .map((property) => [
          property.code,
          serializeCoreProperty(item?.[property.code], property.type),
          property.required,
        ])
        // 顶层 Core 空值使用 null；对象内部的可选空属性必须省略，否则后端会按类型错误拒绝。
        .filter(([, value, required]) => required || value !== null)
        .map(([code, value]) => [code, value]),
    ))
    if (definition.cardinality === 'multiple') {
      return [definition.code, serializedItems.length ? serializedItems : null]
    }
    const item = serializedItems[0] || emptyCoreReviewItem(definition)
    if (definition.properties.length === 1) {
      return [definition.code, item[definition.properties[0].code]]
    }
    return [definition.code, Object.values(item).some((value) => value !== null) ? item : null]
  }))
}

function ingestionIssue(id, message, target, detail = null) {
  return { id, message, target, detail, resolved: false, baseline: ingestionTargetFingerprint(target) }
}

function validateIngestionDraft(core, clauses) {
  const issues = []
  const fileName = stripPdfSuffix(reviewFileName.value.trim()).trim()
  if (!fileName) issues.push(ingestionIssue('file-name:required', '请填写最终展示文件名', 'file-name'))
  if ([...fileName].length > 255) {
    issues.push(ingestionIssue('file-name:max-length', '最终展示文件名不能超过 255 个字符', 'file-name'))
  }
  const summary = reviewSummary.value.trim()
  if (!summary) issues.push(ingestionIssue('summary:required', '请填写合同摘要', 'summary'))
  if ([...summary].length > 3000) {
    issues.push(ingestionIssue('summary:max-length', '合同摘要不能超过 3000 个字符', 'summary'))
  }
  for (const definition of coreDefinitions.value) {
    const value = core[definition.code]
    const items = definition.cardinality === 'multiple'
      ? (Array.isArray(value) ? value : [])
      : value === null ? [] : [definition.properties.length === 1 ? { [definition.properties[0].code]: value } : value]
    // 签订日期是入库必填项，整个 Core 对象为空时也不能跳过校验。
    if (!items.length) {
      definition.properties.filter(isSigningDateProperty).forEach((property) => {
        const target = coreReviewPath(definition.code, 0, property.code)
        issues.push(ingestionIssue(`${target}:required`, '正式入库前请填写签订日期', target))
      })
    }
    for (const [itemIndex, item] of items.entries()) {
      definition.properties.filter((property) => (
        (property.required || isSigningDateProperty(property)) && !coreReviewValuePresent(item?.[property.code])
      )).forEach((property) => {
        const target = coreReviewPath(definition.code, itemIndex, property.code)
        issues.push(ingestionIssue(
          `${target}:required`,
          isSigningDateProperty(property) ? '正式入库前请填写签订日期' : `请填写“${definition.name}”中的必填项“${property.name}”`,
          target,
        ))
      })
      definition.properties.filter((property) => (
        isSigningDateProperty(property)
        && coreReviewValuePresent(item?.[property.code])
        && !isValidCanonicalSigningDate(item[property.code])
      )).forEach((property) => {
        const target = coreReviewPath(definition.code, itemIndex, property.code)
        issues.push(ingestionIssue(
          `${target}:date-format`,
          '请选择有效的签订日期',
          target,
        ))
      })
    }
  }
  if (!clauses.length) issues.push(ingestionIssue('clauses:required', '至少需要保留一条合同条款', 'clauses'))
  const pageCount = processedDocument.value?.pageCount
  for (const [index, clause] of clauses.entries()) {
    const target = `clause:${clause.clause_id || clause.order}`
    if (!clause.content.trim()) {
      issues.push(ingestionIssue(`${target}:content`, `第 ${index + 1} 条条款正文不能为空`, target))
    }
    if (Number.isInteger(pageCount) && clause.end_page > pageCount) {
      issues.push(ingestionIssue(
        `${target}:page-range`,
        `第 ${index + 1} 条条款页码不能超过处理版 PDF 的 ${pageCount} 页`,
        target,
      ))
    }
  }
  return issues
}

function ingestionTargetFromLocation(location) {
  const fields = Array.isArray(location) ? location.filter((item) => item !== 'body') : []
  if (fields[0] === 'file_name') return 'file-name'
  if (fields[0] === 'summary') return 'summary'
  if (fields[0] === 'core') {
    const definition = coreDefinitions.value.find((item) => item.code === fields[1])
    if (!definition) return 'core'
    const itemIndex = fields.find((item, index) => index > 1 && Number.isInteger(item)) || 0
    const property = definition.properties.find((item) => fields.includes(item.code))
    return property ? coreReviewPath(definition.code, itemIndex, property.code) : `core:${definition.code}`
  }
  if (fields[0] === 'clauses') {
    const clauseIndex = fields.find((item) => Number.isInteger(item))
    const clause = Number.isInteger(clauseIndex) ? draftClauses.value[clauseIndex] : null
    return clause ? `clause:${clause.clause_id || clause.order}` : 'clauses'
  }
  return 'result'
}

function ingestionTargetFingerprint(target) {
  if (target === 'file-name') return reviewFileName.value
  if (target === 'summary') return reviewSummary.value
  if (target === 'clauses') return String(draftClauses.value.length)
  if (target.startsWith('core:')) {
    const [, definitionCode, rawItemIndex, propertyCode] = target.split(':')
    return JSON.stringify(coreReviewModel.get(definitionCode)?.[Number(rawItemIndex)]?.[propertyCode] ?? null)
  }
  if (target.startsWith('clause:')) {
    const clauseId = target.slice('clause:'.length)
    const clause = draftClauses.value.find((item) => String(item.clause_id || item.order) === clauseId)
    return clause ? JSON.stringify({
      content: clauseEditableContent(clause),
      startPage: clause.start_page,
      endPage: clause.end_page,
    }) : ''
  }
  return ''
}

function ingestionFieldLabel(location) {
  const fields = Array.isArray(location) ? location.filter((item) => item !== 'body') : []
  if (!fields.length) return '提交内容'
  if (fields[0] === 'file_name') return '最终展示文件名'
  if (fields[0] === 'summary') return '合同摘要'
  if (fields[0] === 'core') {
    const definition = coreDefinitions.value.find((item) => item.code === fields[1])
    const propertyCode = fields.find((item) => typeof item === 'string' && definition?.properties.some((property) => property.code === item))
    const property = definition?.properties.find((item) => item.code === propertyCode)
    return [definition?.name || '核心字段', property?.name].filter(Boolean).join('的')
  }
  if (fields[0] === 'clauses') {
    const clauseIndex = fields.find((item) => Number.isInteger(item))
    const clauseField = {
      clause_id: '条款 ID', order: '顺序', identifier: '原文编号', title: '标题', path: '层级路径',
      parent_clause_id: '父条款', level: '层级', start_page: '起始页', end_page: '结束页', content: '正文',
    }[fields.at(-1)]
    const clauseLabel = Number.isInteger(clauseIndex) ? `第 ${clauseIndex + 1} 条条款` : '合同条款'
    return [clauseLabel, clauseField].filter(Boolean).join('的')
  }
  return '提交内容'
}

function localizedIngestionDetail(detail) {
  const label = ingestionFieldLabel(detail?.loc)
  const type = detail?.type || ''
  if (type === 'missing') return `${label}不能为空`
  if (type === 'extra_forbidden') return `${label}包含不允许提交的字段`
  if (type.includes('string_too_short')) return `${label}不能为空`
  if (type.includes('string_too_long')) return `${label}长度超过允许范围`
  if (type.includes('int_')) return `${label}必须填写整数`
  if (type.includes('float_') || type.includes('number_')) return `${label}必须填写有效数字`
  if (type.includes('bool_')) return `${label}必须选择“是”或“否”`
  if (type === 'greater_than_equal') return `${label}不能小于允许的最小值`
  if (type === 'less_than_equal') return `${label}不能超过允许的最大值`
  if (type === 'list_type') return `${label}必须是列表`
  if (type === 'dict_type') return `${label}必须是完整对象`

  const message = typeof detail?.msg === 'string' ? detail.msg.trim() : ''
  const normalizedMessage = message.replace(/^Value error,\s*/i, '')
  if (normalizedMessage && !/[A-Za-z_]{3,}/.test(normalizedMessage)) {
    return `${label}：${normalizedMessage}`
  }
  return `${label}格式不符合入库要求，请检查后重试`
}

function ingestionFailureMessages(error) {
  const details = error?.payload?.detail
  if (Array.isArray(details)) {
    const detailsByField = new Map()
    details.forEach((detail) => {
      const label = ingestionFieldLabel(detail?.loc)
      const fieldDetails = detailsByField.get(label) || []
      fieldDetails.push(detail)
      detailsByField.set(label, fieldDetails)
    })
    const messages = [...detailsByField.entries()].map(([label, fieldDetails]) => {
      if (fieldDetails.length === 1) return localizedIngestionDetail(fieldDetails[0])
      const missingDetail = fieldDetails.find((detail) => (
        detail?.type === 'missing' || detail?.type === 'string_too_short'
      ))
      if (missingDetail) return localizedIngestionDetail(missingDetail)
      return `${label}的值或数据类型不符合入库要求，请检查后重试`
    }).filter(Boolean)
    if (messages.length) return messages
  }
  const genericMessages = {
    404: '处理任务不存在、已经过期、已经入库，或当前用户无权操作',
    409: '仍有业务阶段或入库所需结果尚未成功，请等待处理完成或重试失败阶段',
    422: '最终文件名、Core 或条款不符合入库要求，请检查表单内容',
    502: '处理版 PDF 或合同索引写入失败，审核内容已保留，可以重新入库',
  }
  const fallbackMessage = typeof error?.message === 'string' && !/[A-Za-z_]{3,}/.test(error.message)
    ? error.message
    : '网络请求异常，请检查连接后重新入库'
  return [genericMessages[error?.status] || fallbackMessage]
}

function ingestionFailureIssues(error) {
  if (error?.status !== 422) return []
  const details = error?.payload?.detail
  if (!Array.isArray(details) || !details.length) {
    // 业务校验返回字符串 detail，保留原始原因，不用通用提示覆盖。
    const message = typeof details === 'string' ? details.trim() : ''
    const isClauseParentError = message.includes('父条款必须先于当前条款出现')
    return [ingestionIssue(
      'backend:result:validation',
      message || '入库校验未通过，服务端未返回具体原因，请稍后重试',
      'result',
      isClauseParentError ? {
        suggestion: '条款层级关系可能存在提取偏差，建议通过“新建提取”重新上传原文件并执行提取流程。',
      } : null,
    )]
  }

  const detailsByTarget = new Map()
  details.forEach((detail) => {
    const target = ingestionTargetFromLocation(detail?.loc)
    const targetDetails = detailsByTarget.get(target) || []
    targetDetails.push(detail)
    detailsByTarget.set(target, targetDetails)
  })

  return [...detailsByTarget.entries()].map(([target, targetDetails]) => {
    const missingDetail = targetDetails.find((detail) => (
      detail?.type === 'missing' || detail?.type === 'string_too_short'
    ))
    const preferredDetail = missingDetail || targetDetails[0]
    const message = missingDetail || targetDetails.length === 1
      ? localizedIngestionDetail(preferredDetail)
      : `${ingestionFieldLabel(preferredDetail?.loc)}的值或数据类型不符合入库要求，请检查后重试`
    const locationKey = Array.isArray(preferredDetail?.loc) ? preferredDetail.loc.join('.') : target
    return ingestionIssue(
      `backend:${locationKey}:${preferredDetail?.type || 'validation'}`,
      message,
      target,
      preferredDetail,
    )
  })
}

function clearIngestionErrors() {
  if (ingestionErrorTimer !== null) window.clearTimeout(ingestionErrorTimer)
  ingestionErrorTimer = null
  ingestionErrors.value = []
}

function showIngestionErrors(errors) {
  clearIngestionErrors()
  ingestionErrors.value = [...new Set(errors.filter(Boolean))]
  if (!ingestionErrors.value.length) return
  ingestionErrorTimer = window.setTimeout(() => {
    ingestionErrorTimer = null
    ingestionErrors.value = []
  }, 8000)
}

function serializeClauseReview() {
  return draftClauses.value.map((clause, index) => ({
    clause_id: clause.clause_id,
    order: index + 1,
    identifier: clause.identifier,
    title: clause.title ?? null,
    path: Array.isArray(clause.path) ? [...clause.path] : [],
    parent_clause_id: clause.parent_clause_id ?? null,
    level: clause.level,
    start_page: clause.start_page,
    end_page: clause.end_page,
    content: clauseEditableContent(clause),
  }))
}

function clearIngestionIssues() {
  ingestionIssues.value = []
  activeIngestionIssueTarget.value = ''
}

function issueTargetSelector(target) {
  return `[data-ingestion-target="${String(target).replaceAll('"', '\\"')}"]`
}

function scrollToIngestionIssue(issue) {
  if (!issue?.target || issue.target === 'result') return
  const panel = detailPanel.value?.querySelector('.ingestion-detail')
  const target = panel?.querySelector(issueTargetSelector(issue.target))
  if (!(panel instanceof HTMLElement) || !(target instanceof HTMLElement)) return

  const panelRect = panel.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  activeIngestionIssueTarget.value = issue.target
  panel.scrollTo({
    top: Math.max(0, panel.scrollTop + targetRect.top - panelRect.top - 58),
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  })
  schedule(() => {
    if (activeIngestionIssueTarget.value === issue.target) activeIngestionIssueTarget.value = ''
  }, 1600)
}

function showIngestionIssues(issues) {
  clearIngestionErrors()
  const uniqueIssues = new Map(issues.filter(Boolean).map((issue) => [issue.id, issue]))
  ingestionIssues.value = [...uniqueIssues.values()]
  const firstIssue = ingestionIssues.value.find((issue) => !issue.resolved)
  if (firstIssue) nextTick(() => scrollToIngestionIssue(firstIssue))
}

function refreshIngestionIssues(targets) {
  if (!ingestionIssues.value.length) return
  const targetSet = targets instanceof Set ? targets : new Set(targets || [])
  if (!targetSet.size) return
  const currentIssues = validateIngestionDraft(serializeCoreReview(), serializeClauseReview())
  const currentIds = new Set(currentIssues.map((issue) => issue.id))
  const currentTargets = new Set(currentIssues.map((issue) => issue.target))
  const existingIssues = new Map(ingestionIssues.value.map((issue) => [issue.id, issue]))
  currentIssues.forEach((issue) => {
    if (targetSet.has(issue.target) && !existingIssues.has(issue.id)) existingIssues.set(issue.id, issue)
  })

  let issueResolved = false
  const nextIssues = [...existingIssues.values()].map((issue) => {
    if (!targetSet.has(issue.target)) return issue
    const resolved = issue.id.startsWith('backend:')
      ? !currentTargets.has(issue.target) && ingestionTargetFingerprint(issue.target) !== issue.baseline
      : !currentIds.has(issue.id)
    if (!issue.resolved && resolved) issueResolved = true
    return { ...issue, resolved }
  })
  ingestionIssues.value = nextIssues

  if (issueResolved) {
    const nextIssue = nextIssues.find((issue) => !issue.resolved)
      || [...nextIssues].reverse().find((issue) => issue.resolved)
    if (nextIssue) nextTick(() => scrollToIngestionIssue(nextIssue))
  }
}

function handleIngestionIssueFocusout(event) {
  if (!ingestionIssues.value.length || !(event.target instanceof Element)) return

  const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null
  const editor = event.currentTarget
  const targets = new Set()
  let container = event.target.closest('[data-ingestion-target]')
  while (container && editor instanceof Element && editor.contains(container)) {
    if (!relatedTarget || !container.contains(relatedTarget)) {
      targets.add(container.dataset.ingestionTarget)
    }
    container = container.parentElement?.closest('[data-ingestion-target]') || null
  }
  if (targets.size) nextTick(() => refreshIngestionIssues(targets))
}

async function submitIngestion() {
  if (!canIngestResult.value) return
  reviewFileName.value = stripPdfSuffix(reviewFileName.value.trim()).trim()
  const core = serializeCoreReview()
  const clauses = serializeClauseReview()
  const validationIssues = validateIngestionDraft(core, clauses)
  if (validationIssues.length) {
    showIngestionIssues(validationIssues)
    return
  }

  const runId = currentRunId.value
  const controller = new AbortController()
  ingestionRequestController = controller
  ingestionPending.value = true
  clearIngestionErrors()
  try {
    const receipt = await ingestExtractionRun(runId, {
      file_name: reviewFileName.value.trim(),
      summary: reviewSummary.value.trim(),
      core,
      clauses,
    }, { signal: controller.signal })
    if (ingestionRequestController !== controller || currentRunId.value !== runId) return
    ingestionReceipt.value = receipt
    currentRunStatus.value = 'ingested'
    workflowRunning.value = false
    extractionRuns.value = extractionRuns.value.filter((run) => run.run_id !== runId)
    eventStreamController?.abort()
    clearIngestionIssues()
  } catch (error) {
    if (error?.name !== 'AbortError') {
      const validationIssues = ingestionFailureIssues(error)
      if (validationIssues.length) showIngestionIssues(validationIssues)
      else showIngestionErrors(ingestionFailureMessages(error))
    }
  } finally {
    if (ingestionRequestController === controller) {
      ingestionRequestController = null
      ingestionPending.value = false
    }
  }
}

function addCoreReviewItem(definition) {
  if (definition.cardinality !== 'multiple') return
  const items = coreReviewModel.get(definition.code)
  if (!items) return
  items.push(emptyCoreReviewItem(definition))
  modifiedFields.add(`core:${definition.code}:$items`)
}

function removeCoreReviewItem(definition, itemIndex) {
  if (definition.cardinality !== 'multiple') return
  const items = coreReviewModel.get(definition.code)
  if (!items) return
  openBooleanControlKey.value = ''
  items.splice(itemIndex, 1)
  modifiedFields.add(`core:${definition.code}:$items`)
}

function coreReviewItemKey(definitionCode, item, itemIndex) {
  if (!item || typeof item !== 'object') return `${definitionCode}-${itemIndex}`
  if (!coreReviewItemKeys.has(item)) {
    coreReviewItemSequence += 1
    coreReviewItemKeys.set(item, `${definitionCode}-${coreReviewItemSequence}`)
  }
  return coreReviewItemKeys.get(item)
}

function corePropertyStep(type) {
  return type === 'integer' ? '1' : 'any'
}

function isCoreNumericProperty(type) {
  return type === 'integer' || type === 'number'
}

function adjustCoreReviewNumber(definition, itemIndex, property, direction) {
  const item = coreReviewModel.get(definition.code)?.[itemIndex]
  if (!item || !isCoreNumericProperty(property.type)) return

  const currentValue = Number(item[property.code])
  const numericValue = Number.isFinite(currentValue) ? currentValue : 0
  const nextValue = numericValue + direction
  item[property.code] = property.type === 'integer'
    ? Math.trunc(nextValue)
    : Number(nextValue.toFixed(10))
  modifiedFields.add(coreReviewPath(definition.code, itemIndex, property.code))
}

function clauseValuePath(clause) {
  return `clause:${clause.clause_id || clause.order}`
}

function clauseEditableContent(clause) {
  const content = editableDraftValue(clauseValuePath(clause), clause.content)
  return typeof content === 'string' ? content : ''
}

function clauseEditingId(clause) {
  return String(clause.clause_id || clause.order)
}

function resetNewClauseForm() {
  Object.assign(newClauseForm, {
    path: [''],
    startPage: 1,
    endPage: 1,
    content: '',
  })
  clauseInsertError.value = ''
}

async function openClauseInsert(index) {
  if (clauseFormAnimating.value) return
  const slot = document.querySelector(`[data-clause-insert-index="${index}"]`)
  const collapsedHeight = slot instanceof HTMLElement ? slot.getBoundingClientRect().height : 18
  clauseInsertCollapsedHeight.value = collapsedHeight
  resetNewClauseForm()
  clauseInsertIndex.value = index
  await nextTick()
  const expandedSlot = document.querySelector(`[data-clause-insert-index="${index}"]`)
  const form = expandedSlot?.querySelector('.clause-insert-form')
  if (!(expandedSlot instanceof HTMLElement) || !(form instanceof HTMLElement)) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  clauseFormAnimating.value = true
  const expandedHeight = expandedSlot.getBoundingClientRect().height
  expandedSlot.style.overflow = 'hidden'
  await Promise.all([
    expandedSlot.animate([
      { height: `${collapsedHeight}px` },
      { height: `${expandedHeight}px` },
    ], { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }).finished.catch(() => {}),
    form.animate([
      { opacity: 0, filter: 'blur(4px)', transform: 'translateY(-8px) scale(0.99)' },
      { opacity: 1, filter: 'blur(0)', transform: 'translateY(0) scale(1)' },
    ], { duration: 360, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }).finished.catch(() => {}),
  ])
  expandedSlot.style.overflow = ''
  clauseFormAnimating.value = false
}

async function cancelClauseInsert() {
  if (!Number.isInteger(clauseInsertIndex.value)) return
  const index = clauseInsertIndex.value
  const slot = document.querySelector(`[data-clause-insert-index="${index}"]`)
  const form = slot?.querySelector('.clause-insert-form')
  let slotAnimation = null
  let formAnimation = null
  if (
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    && slot instanceof HTMLElement
    && form instanceof HTMLElement
  ) {
    clauseFormAnimating.value = true
    const expandedHeight = slot.getBoundingClientRect().height
    slot.style.overflow = 'hidden'
    slotAnimation = slot.animate([
      { height: `${expandedHeight}px` },
      { height: `${clauseInsertCollapsedHeight.value}px` },
    ], {
      duration: 360,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      fill: 'forwards',
    })
    formAnimation = form.animate([
      { opacity: 1, filter: 'blur(0)', transform: 'translateY(0) scale(1)' },
      { opacity: 0, filter: 'blur(3px)', transform: 'translateY(-7px) scale(0.99)' },
    ], { duration: 260, easing: 'ease', fill: 'forwards' })
    await Promise.all([
      slotAnimation.finished.catch(() => {}),
      formAnimation.finished.catch(() => {}),
    ])
  }
  clauseInsertIndex.value = null
  await nextTick()
  slotAnimation?.cancel()
  formAnimation?.cancel()
  if (slot instanceof HTMLElement) slot.style.overflow = ''
  resetNewClauseForm()
  clauseFormAnimating.value = false
}

function createManualClauseId() {
  const occupiedIds = new Set(draftClauses.value.map((clause) => clause.clause_id))
  let sequence = 1
  let candidate = ''
  do {
    candidate = `clause-manual-${String(sequence).padStart(4, '0')}`
    sequence += 1
  } while (occupiedIds.has(candidate))
  return candidate
}

function addClausePathItem() {
  newClauseForm.path.push('')
}

function removeClausePathItem(index) {
  if (newClauseForm.path.length === 1) return
  newClauseForm.path.splice(index, 1)
}

function useClauseSymbolPath(index) {
  const value = newClauseForm.path[index].trim()
  if (!value.startsWith('◆')) newClauseForm.path[index] = `◆${value ? ` ${value}` : ''}`
}

function sameClausePath(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((item, index) => item === right[index])
}

function clauseIdentityFromPath(pathLabel) {
  const identifierMatch = pathLabel.match(/^(第.+?[章节条款项]|\d+(?:\.\d+)*|\([^)]+\)|（[^）]+）|◆)(?:\s+|$)/)
  if (!identifierMatch) return { identifier: '◆', title: pathLabel }

  const identifier = identifierMatch[1]
  const title = pathLabel.slice(identifierMatch[0].length).trim()
  return { identifier, title: title || null }
}

async function addManualClause() {
  if (!Number.isInteger(clauseInsertIndex.value)) return
  const insertionIndex = clauseInsertIndex.value

  const content = newClauseForm.content.trim()
  const path = newClauseForm.path.map((item) => item.trim())
  const startPage = Number(newClauseForm.startPage)
  const endPage = Number(newClauseForm.endPage)
  const parentPath = path.slice(0, -1)
  const parentClause = parentPath.length
    ? draftClauses.value.find((clause) => sameClausePath(clause.path, parentPath))
    : null

  if (path.some((item) => !item)) clauseInsertError.value = '请完整填写每一级条款路径'
  else if (!Number.isInteger(startPage) || startPage < 1) clauseInsertError.value = '起始页必须是从 1 开始的整数'
  else if (!Number.isInteger(endPage) || endPage < startPage) clauseInsertError.value = '结束页必须是不小于起始页的整数'
  else if (!content) clauseInsertError.value = '请填写条款正文'
  else clauseInsertError.value = ''
  if (clauseInsertError.value) return
  const { identifier, title } = clauseIdentityFromPath(path.at(-1))

  const clause = {
    clause_id: createManualClauseId(),
    order: insertionIndex + 1,
    identifier,
    title: title || null,
    path,
    parent_clause_id: parentClause?.clause_id ?? null,
    level: path.length,
    start_page: startPage,
    end_page: endPage,
    content,
  }

  await cancelClauseInsert()
  clauseReviewModel.value.splice(insertionIndex, 0, clause)
  clauseReviewModel.value = clauseReviewModel.value.map((item, index) => ({
    ...item,
    order: index + 1,
  }))
  clausesLocallyModified.value = true
  modifiedFields.add('clause:$items')
  await animateClauseInsertion(clause.clause_id)
}

async function animateClauseInsertion(clauseId) {
  await nextTick()
  const list = clauseReviewListRef.value
  if (!(list instanceof HTMLElement)) return
  const element = [...list.children].find((candidate) => (
    candidate instanceof HTMLElement && candidate.dataset.clauseId === clauseId
  ))
  if (!(element instanceof HTMLElement)) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const height = element.getBoundingClientRect().height
  const marginBottom = Number.parseFloat(window.getComputedStyle(element).marginBottom) || 0
  element.style.overflow = 'hidden'
  await element.animate([
    { height: '0px', marginBottom: '0px', opacity: 0, filter: 'blur(4px)', transform: 'translateY(-9px) scale(0.985)' },
    { height: `${height}px`, marginBottom: `${marginBottom}px`, opacity: 1, filter: 'blur(0)', transform: 'translateY(0) scale(1)' },
  ], {
    duration: 480,
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  }).finished.catch(() => {})
  element.style.overflow = ''
}

function toggleClauseEditing(clause) {
  const id = clauseEditingId(clause)
  if (editingClauseIds.has(id)) editingClauseIds.delete(id)
  else editingClauseIds.add(id)
}

async function removeClause(clause) {
  if (removingClauseIds.size) return
  const removedIds = new Set([clause.clause_id])
  let foundDescendant = true
  while (foundDescendant) {
    foundDescendant = false
    draftClauses.value.forEach((candidate) => {
      if (!removedIds.has(candidate.clause_id) && removedIds.has(candidate.parent_clause_id)) {
        removedIds.add(candidate.clause_id)
        foundDescendant = true
      }
    })
  }

  await cancelClauseInsert()
  removedIds.forEach((clauseId) => removingClauseIds.add(clauseId))
  await animateClauseRemoval(removedIds)
  if (![...removedIds].every((clauseId) => removingClauseIds.has(clauseId))) return

  removedIds.forEach((clauseId) => {
    editingClauseIds.delete(String(clauseId))
    draftOverrides.delete(`clause:${clauseId}`)
  })
  clauseReviewModel.value = draftClauses.value
    .filter((candidate) => !removedIds.has(candidate.clause_id))
    .map((candidate, index) => ({ ...candidate, order: index + 1 }))
  clausesLocallyModified.value = true
  modifiedFields.add('clause:$items')
  removingClauseIds.clear()
}

async function animateClauseRemoval(removedIds) {
  const list = clauseReviewListRef.value
  if (!(list instanceof HTMLElement)) return

  const shells = [...list.children].filter((element) => (
    element instanceof HTMLElement && removedIds.has(element.dataset.clauseId)
  ))
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  await Promise.all(shells.map((element) => {
    const height = element.getBoundingClientRect().height
    const marginBottom = Number.parseFloat(window.getComputedStyle(element).marginBottom) || 0
    element.style.overflow = 'hidden'
    return element.animate([
      { height: `${height}px`, marginBottom: `${marginBottom}px`, opacity: 1, filter: 'blur(0)', transform: 'translateY(0) scale(1)' },
      { height: '0px', marginBottom: '0px', opacity: 0, filter: 'blur(4px)', transform: 'translateY(-9px) scale(0.985)' },
    ], {
      duration: 480,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'forwards',
    }).finished.catch(() => {})
  }))
}

function clauseDisplayPath(clause) {
  const path = Array.isArray(clause.path) ? clause.path.filter((item) => typeof item === 'string' && item.trim()) : []
  return path.length ? path : [clause.identifier || clause.title || `条款 ${clause.order}`]
}

function clausePageLabel(clause) {
  if (!Number.isInteger(clause.start_page) || !Number.isInteger(clause.end_page)) return ''
  return clause.start_page === clause.end_page
    ? `第 ${clause.start_page} 页`
    : `第 ${clause.start_page}–${clause.end_page} 页`
}

function handleKeydown(event) {
  if (event.key !== 'Escape') return
  if (candidatePreviewUrl.value) {
    closeCandidatePreview()
    return
  }
  if (runsPanelOpen.value) {
    closeRunsPanel()
    return
  }
  closeDetail()
}

function handleWorkflowWheel(event) {
  const viewport = event.currentTarget
  if (!(viewport instanceof HTMLElement) || viewport.scrollWidth <= viewport.clientWidth) return
  if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || event.deltaY === 0) return

  event.preventDefault()
  viewport.scrollLeft += event.deltaY
}

function handleWorkspaceClick(event) {
  if (!detailMode.value && !queuedDetailMode.value) return
  if (!(event.target instanceof Element)) return
  if (event.target.closest('.ingestion-detail, .ingestion-validation-panel')) return
  if (event.target.closest([
    '.workflow-input-node',
    '.workflow-stage-node',
    '.workflow-result-node',
    '.contract-runs-trigger',
    '.contract-new-trigger',
    '.contract-runs-panel',
  ].join(','))) return
  closeDetail()
}

function handleBooleanReviewOutsidePointer(event) {
  if (!openBooleanControlKey.value || !(event.target instanceof Element)) return
  if (event.target.closest('.extraction-result-boolean-control')) return
  openBooleanControlKey.value = ''
}

function activateIngestionView() {
  if (viewActive) return
  viewActive = true
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('pointerdown', handleBooleanReviewOutsidePointer)
  window.addEventListener('resize', scheduleWorkflowScrollExtension)
  elapsedClock.value = Date.now()
  elapsedClockTimer = window.setInterval(() => {
    elapsedClock.value = Date.now()
  }, 31)
  startRunsRefreshTimer()
  if (candidatePreviewUrl.value) emit('visual-pause-change', true)
  scheduleWorkflowScrollExtension()
  if (coverRasterCanvas) {
    nextTick(() => {
      if (paintCoverCanvas()) coverRendered.value = true
    })
  }
}

function deactivateIngestionView() {
  if (!viewActive) return
  viewActive = false
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('pointerdown', handleBooleanReviewOutsidePointer)
  window.removeEventListener('resize', scheduleWorkflowScrollExtension)
  if (elapsedClockTimer !== null) window.clearInterval(elapsedClockTimer)
  elapsedClockTimer = null
  stopRunsRefreshTimer()
  emit('visual-pause-change', false)
}

onMounted(() => {
  if (props.active) activateIngestionView()
  loadPdfRuntime().catch(() => {})
})

onActivated(activateIngestionView)
onDeactivated(deactivateIngestionView)
watch(() => props.active, (active) => {
  if (active) activateIngestionView()
  else deactivateIngestionView()
})

onBeforeUnmount(() => {
  deactivateIngestionView()
  stopExtractionNetwork()
  cancellationRequestController?.abort()
  cancellationRequestController = null
  runRestoreController?.abort()
  runRestoreController = null
  closeCandidatePreview()
  closeRunsPanel()
  stopRunsRefreshTimer()
  clearTimers()
  if (deduplicationRefreshTimer !== null) window.clearTimeout(deduplicationRefreshTimer)
  if (elapsedClockTimer !== null) window.clearInterval(elapsedClockTimer)
  if (coverPresentationTimer !== null) window.clearTimeout(coverPresentationTimer)
  if (workflowSwitchTimer !== null) window.clearTimeout(workflowSwitchTimer)
  workflowSwitchTimer = null
  fileSelectionSequence += 1
  if (workflowScrollExtensionFrame !== null) window.cancelAnimationFrame(workflowScrollExtensionFrame)
  workflowScrollExtensionFrame = null
  pdfWorkerPort?.terminate()
  pdfWorkerPort = null
  pdfRuntimePromise = null
})
</script>

<template>
  <section class="contract-ingestion" aria-label="合同处理流" @click="handleWorkspaceClick">
    <input
      ref="fileInput"
      class="contract-ingestion__file-input"
      type="file"
      accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif"
      @change="handleFileSelection"
    />

    <div class="contract-ingestion__actions">
      <div class="contract-action-pedestal">
        <button
          type="button"
          class="contract-runs-trigger"
          :class="{ 'has-blocked': blockedExtractionRuns.length > 0 }"
          :disabled="workflowSwitching || cancellationPending"
          :aria-expanded="runsPanelOpen"
          aria-controls="contract-runs-panel"
          @click="toggleRunsPanel"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 7.5h14M5 12h14M5 16.5h9" />
            <circle cx="18" cy="16.5" r="2.5" />
          </svg>
          <span>处理任务</span>
          <b
            :class="{ 'is-visible': extractionRuns.length > 0 }"
            :style="{ '--run-count-width': `${extractionRunsBadgeWidth}px` }"
          >
            <RollingNumber :value="extractionRuns.length" />
          </b>
        </button>
      </div>

      <div class="contract-action-pedestal">
        <button
          type="button"
          class="contract-new-trigger"
          :disabled="newExtractionDisabled"
          aria-label="新建合同提取任务"
          @click="createNewExtractionWorkflow"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>新建提取</span>
        </button>
      </div>
      <div class="contract-action-pedestal">
        <button type="button" class="contract-new-trigger" @click="batchExtractionOpen = true">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h12v14H8zM4 7v14h12M11 8h6M11 12h6" /></svg>
          <span>批量提取</span>
        </button>
      </div>
    </div>

    <div
      v-if="runsPanelOpen"
      class="contract-runs-backdrop"
      aria-hidden="true"
      @click="closeRunsPanel"
    ></div>

    <Transition name="contract-runs-panel">
      <aside
        v-if="runsPanelOpen"
        id="contract-runs-panel"
        class="contract-runs-panel"
        aria-label="合同处理任务"
      >
        <header class="contract-runs-panel__header">
          <div>
            <span>任务恢复</span>
            <h2>{{ extractionRunsTitle }}</h2>
          </div>
          <button
            type="button"
            :class="{ 'is-loading': runsLoading }"
            :disabled="runsLoading"
            aria-label="刷新任务列表"
            @click="refreshExtractionRuns()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 8a7 7 0 1 0 1 5M19 4v4h-4" />
            </svg>
          </button>
        </header>

        <p class="contract-runs-panel__summary">
          需要处理的任务优先展示；后台处理中任务无需操作。
        </p>

        <div v-if="runsError" class="contract-runs-panel__error">
          <strong>任务列表读取失败</strong>
          <p>{{ runsError }}</p>
        </div>

        <Transition name="contract-runs-empty" appear>
          <div
            v-if="!runsError && !extractionRuns.length && runsItemsVisible && runsEmptyVisible"
            class="contract-runs-panel__empty"
          >
            <img :src="sleepyEmptyImage" alt="暂无进行的任务" />
          </div>
        </Transition>

        <div
          v-if="extractionRuns.length"
          class="contract-runs-groups"
          :class="{ 'is-concealed': !runsItemsVisible }"
        >
          <section
            v-for="group in extractionRunGroups"
            :key="group.key"
            class="contract-runs-group"
            :class="`is-${group.key}`"
          >
            <header class="contract-runs-group__header">
              <div>
                <i aria-hidden="true"></i>
                <h3>{{ group.title }}</h3>
              </div>
              <span><RollingNumber :value="group.runs.length" /> 条</span>
            </header>
            <p class="contract-runs-group__description">{{ group.description }}</p>

            <TransitionGroup
              appear
              tag="ul"
              name="contract-run-item"
              class="contract-runs-list"
            >
              <li
                v-for="(run, index) in group.runs"
                :key="run.run_id"
                :class="[
                  `is-${run.status}`,
                  {
                    'is-current': run.run_id === currentRunId,
                    'is-restoring': run.run_id === runsRestoringId,
                    'is-edge-active': run.run_id === (runsRestoringId || currentRunId),
                    'is-data-updated': updatingRunIds.has(run.run_id),
                  },
                ]"
                :style="{ '--run-index': index }"
                tabindex="0"
                role="button"
                :aria-busy="run.run_id === runsRestoringId"
                :aria-label="`恢复 ${extractionRunFileName(run)} 的合同处理流`"
                @click="restoreExtractionRun(run)"
                @keydown.enter="restoreExtractionRun(run)"
                @keydown.space.prevent="restoreExtractionRun(run)"
              >
                <span class="contract-runs-list__refresh-wash" aria-hidden="true"></span>
                <div class="contract-runs-list__top">
                  <span class="contract-runs-list__document" aria-hidden="true">
                    <svg viewBox="0 0 32 38">
                      <path d="M7 2.5h11.5L26 10v25.5H7z" />
                      <path d="M18.5 2.5V10H26M11.5 17h10M11.5 21.5h10M11.5 26h7" />
                    </svg>
                    <i></i>
                  </span>
                  <div class="contract-runs-list__content">
                    <h3 :title="extractionRunFileName(run)">{{ extractionRunFileName(run) }}</h3>
                    <div class="contract-runs-list__state">
                      <span>
                        <i></i>{{ run.run_id === runsRestoringId
                          ? '正在恢复处理流'
                          : extractionRunStatusLabel(run.status) }}
                      </span>
                      <b v-if="run.run_id === currentRunId">本页任务</b>
                    </div>
                  </div>
                </div>

                <div class="contract-runs-list__activity" aria-hidden="true">
                  <i></i>
                </div>

                <dl>
                  <div><dt>最近更新</dt><dd>{{ formatRunTimestamp(run.updated_at) }}</dd></div>
                  <div><dt>保留至</dt><dd>{{ formatRunTimestamp(run.expires_at) }}</dd></div>
                </dl>
                <p
                  v-if="runsRestoreErrorId === run.run_id && runsRestoreError"
                  class="contract-runs-list__restore-error"
                >
                  {{ runsRestoreError }}
                </p>
              </li>
            </TransitionGroup>
          </section>
        </div>

        <Transition name="contract-runs-loader" @after-leave="revealExtractionRuns">
          <div
            v-if="runsLoaderVisible"
            class="contract-runs-loader-layer"
            role="status"
            aria-label="正在同步后台任务"
          >
            <div class="capybaraloader" aria-hidden="true">
              <div class="capybara">
                <div class="capyhead">
                  <div class="capyear"><div class="capyear2"></div></div>
                  <div class="capyear"></div>
                  <div class="capymouth">
                    <div class="capylips"></div>
                    <div class="capylips"></div>
                  </div>
                  <div class="capyeye"></div>
                  <div class="capyeye"></div>
                </div>
                <div class="capyleg"></div>
                <div class="capyleg2"></div>
                <div class="capyleg2"></div>
                <div class="capy"></div>
              </div>
              <div class="capybara-track">
                <div class="capybara-track__line"></div>
              </div>
            </div>
            <span>正在同步后台任务</span>
          </div>
        </Transition>
      </aside>
    </Transition>

    <div
      ref="workflowViewport"
      class="contract-ingestion__viewport"
      :class="{
        'is-switching-out': workflowSwitchPhase === 'leaving',
        'is-switching-in': workflowSwitchPhase === 'entering',
      }"
      :aria-busy="workflowSwitching"
      @wheel="handleWorkflowWheel"
    >
      <div class="workflow-canvas">
        <div class="workflow-canvas__content">
          <div class="workflow-canvas__glow workflow-canvas__glow--one"></div>
          <div class="workflow-canvas__glow workflow-canvas__glow--two"></div>

        <svg
          class="workflow-links"
          viewBox="0 0 2380 620"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <filter
              id="flow-glow"
              x="-120"
              y="-120"
              width="2620"
              height="860"
              filterUnits="userSpaceOnUse"
              color-interpolation-filters="sRGB"
            >
              <feGaussianBlur stdDeviation="3.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g class="workflow-link" :class="`is-${edgeState('detection')}`">
            <path class="workflow-link__bed" d="M260 321 C280 321 300 321 320 321" />
            <path class="workflow-link__signal" pathLength="100" d="M260 321 C280 321 300 321 320 321" />
            <path class="workflow-link__comet" pathLength="100" d="M260 321 C280 321 300 321 320 321" />
          </g>
          <g class="workflow-link" :class="`is-${edgeState('duplication')}`">
            <path class="workflow-link__bed" d="M550 321 C570 321 590 321 610 321" />
            <path class="workflow-link__signal" pathLength="100" d="M550 321 C570 321 590 321 610 321" />
            <path class="workflow-link__comet" pathLength="100" d="M550 321 C570 321 590 321 610 321" />
          </g>
          <g class="workflow-link" :class="`is-${edgeState('preprocessing')}`">
            <path class="workflow-link__bed" d="M840 321 C860 321 880 321 900 321" />
            <path class="workflow-link__signal" pathLength="100" d="M840 321 C860 321 880 321 900 321" />
            <path class="workflow-link__comet" pathLength="100" d="M840 321 C860 321 880 321 900 321" />
          </g>
          <g class="workflow-link" :class="`is-${edgeState('classification')}`">
            <path class="workflow-link__bed" d="M1130 321 C1150 321 1170 321 1190 321" />
            <path class="workflow-link__signal" pathLength="100" d="M1130 321 C1150 321 1170 321 1190 321" />
            <path class="workflow-link__comet" pathLength="100" d="M1130 321 C1150 321 1170 321 1190 321" />
          </g>

          <g class="workflow-link" :class="`is-${edgeState('overview')}`">
            <path class="workflow-link__bed" d="M1420 321 C1440 321 1460 321 1480 321" />
            <path class="workflow-link__signal" pathLength="100" d="M1420 321 C1440 321 1460 321 1480 321" />
            <path class="workflow-link__comet" pathLength="100" d="M1420 321 C1440 321 1460 321 1480 321" />
          </g>

          <g class="workflow-link" :class="`is-${edgeState('field')}`">
            <path class="workflow-link__bed" d="M1710 321 C1750 321 1730 144 1770 144" />
            <path class="workflow-link__signal" pathLength="100" d="M1710 321 C1750 321 1730 144 1770 144" />
            <path class="workflow-link__comet" pathLength="100" d="M1710 321 C1750 321 1730 144 1770 144" />
          </g>
          <g class="workflow-link" :class="`is-${edgeState('clause')}`">
            <path class="workflow-link__bed" d="M1710 321 C1730 321 1750 321 1770 321" />
            <path class="workflow-link__signal" pathLength="100" d="M1710 321 C1730 321 1750 321 1770 321" />
            <path class="workflow-link__comet" pathLength="100" d="M1710 321 C1730 321 1750 321 1770 321" />
          </g>
          <g class="workflow-link" :class="`is-${edgeState('retrieval')}`">
            <path class="workflow-link__bed" d="M1710 321 C1750 321 1730 498 1770 498" />
            <path class="workflow-link__signal" pathLength="100" d="M1710 321 C1750 321 1730 498 1770 498" />
            <path class="workflow-link__comet" pathLength="100" d="M1710 321 C1750 321 1730 498 1770 498" />
          </g>

          <g class="workflow-link" :class="`is-${resultEdgeState('field')}`">
            <path class="workflow-link__bed" d="M2040 144 C2080 144 2070 321 2110 321" />
            <path class="workflow-link__signal" pathLength="100" d="M2040 144 C2080 144 2070 321 2110 321" />
            <path class="workflow-link__comet" pathLength="100" d="M2040 144 C2080 144 2070 321 2110 321" />
          </g>
          <g class="workflow-link" :class="`is-${resultEdgeState('clause')}`">
            <path class="workflow-link__bed" d="M2040 321 C2065 321 2085 321 2110 321" />
            <path class="workflow-link__signal" pathLength="100" d="M2040 321 C2065 321 2085 321 2110 321" />
            <path class="workflow-link__comet" pathLength="100" d="M2040 321 C2065 321 2085 321 2110 321" />
          </g>
          <g class="workflow-link" :class="`is-${resultEdgeState('retrieval')}`">
            <path class="workflow-link__bed" d="M2040 498 C2080 498 2070 321 2110 321" />
            <path class="workflow-link__signal" pathLength="100" d="M2040 498 C2080 498 2070 321 2110 321" />
            <path class="workflow-link__comet" pathLength="100" d="M2040 498 C2080 498 2070 321 2110 321" />
          </g>
        </svg>

        <article
          class="workflow-input-node"
          :class="{ 'is-filled': hasInputDocument }"
          :style="inputNodeStyle"
        >
          <div
            class="workflow-input-node__document"
            tabindex="0"
            role="button"
            :aria-label="hasInputDocument ? `查看输入合同 ${selectedFileName}` : '点击上传合同文件'"
            @click="activateInputNode"
            @keydown.enter="activateInputNode"
            @keydown.space.prevent="activateInputNode"
          >
            <div class="workflow-upload-card" :class="{ 'is-filled': hasInputDocument }">
              <div class="workflow-upload-card__header">
                <template v-if="!hasInputDocument">
                <svg viewBox="0 0 24 24">
                  <path d="M7 10V9a5 5 0 0 1 10 0v1a4 4 0 0 1 2 7.47M7 10a4 4 0 0 0-2 7.47M7 10c.43 0 .85.07 1.24.2M12 12v9m0-9 3 3m-3-3-3 3" />
                </svg>
                <strong>浏览并上传合同</strong>
                <small>支持 PDF 或单张图片</small>
                </template>
                <canvas
                  v-if="selectedSourceFile || isRestoredRun"
                  ref="coverCanvas"
                  class="workflow-upload-card__cover"
                  :class="{ 'is-visible': coverRendered && !coverReading }"
                  :aria-label="`${selectedFileName} 第一页封面`"
                ></canvas>
                <div v-if="isRestoredRun && !coverRendered && !coverReading" class="workflow-input-node__restored">
                  <span>
                    <svg viewBox="0 0 42 50">
                      <path d="M9 3h16l8 8v36H9z" />
                      <path d="M25 3v8h8M15 22h12M15 28h12M15 34h8" />
                    </svg>
                    <i></i>
                  </span>
                  <strong>任务已恢复</strong>
                  <small>{{ fileSelectionError || '已同步后台文件信息' }}</small>
                </div>
                <div
                  v-if="selectedSourceFile || (isRestoredRun && (coverReading || coverRendered))"
                  class="workflow-input-node__cover-loading"
                  :class="{ 'is-hidden': coverRendered && !coverReading }"
                  aria-hidden="true"
                >
                  <span><i></i><i></i><i></i></span>
                </div>
                <span
                  v-if="hasInputDocument"
                  class="workflow-input-node__file-type"
                  :class="{ 'is-image': selectedSourceKind === 'image' }"
                >
                  {{ selectedFileBadge }}
                </span>
              </div>
              <div class="workflow-upload-card__footer" :class="{ 'is-filled': hasInputDocument }">
                <p v-if="!hasInputDocument">尚未选择文件</p>
                <span
                  v-else
                  class="workflow-upload-card__clear-icon"
                  :class="{ 'is-disabled': workflowRunning || workflowRewinding || uploadInProgress || cancellationPending || currentRunId }"
                  role="button"
                  :tabindex="workflowRunning || workflowRewinding || uploadInProgress || cancellationPending || currentRunId ? -1 : 0"
                  aria-label="清除当前合同文件"
                  :aria-disabled="Boolean(workflowRunning || workflowRewinding || uploadInProgress || cancellationPending || currentRunId)"
                  @click.stop="clearInputDocument"
                  @keydown.enter.stop.prevent="clearInputDocument"
                  @keydown.space.stop.prevent="clearInputDocument"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M5.17 10.15A2 2 0 0 1 7.16 8h9.68a2 2 0 0 1 1.99 2.15l-.69 9A2 2 0 0 1 16.15 21h-8.3a2 2 0 0 1-1.99-1.85zM19.5 5h-15M10 5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2" />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </article>

        <article
          v-for="stageId in stageOrder"
          :key="stageId"
          class="workflow-stage-node"
          :class="[
            `workflow-stage-node--${stageId}`,
            `is-${stageTone(stages[stageId].status)}`,
            {
              'is-selected': selectedStageId === stageId,
              'is-rejected': stageId === 'detection' && documentDetection?.is_contract === false,
            },
          ]"
          tabindex="0"
          role="button"
          :aria-label="`${stages[stageId].name}，${stageStatusLabel(stages[stageId])}`"
          @click="openStage(stageId)"
          @keydown.enter="openStage(stageId)"
          @keydown.space.prevent="openStage(stageId)"
        >
          <div class="workflow-stage-node__topline">
            <span class="workflow-stage-node__state">
              <i></i>{{ stageStatusLabel(stages[stageId]) }}
            </span>
          </div>
          <div class="workflow-stage-node__body">
            <span
              class="workflow-stage-node__icon"
              :class="{
                'has-duplication-loader': stageId === 'duplication' && duplicationLoaderVisible,
                'has-structure-loader': stageId === 'preprocessing' && structureLoaderVisible,
                'has-classification-loader': stageId === 'classification'
                  && (classificationLoaderPreview || classificationLoaderVisible),
              }"
              aria-hidden="true"
            >
              <svg
                v-if="stages[stageId].status === 'pending'
                  && !(stageId === 'duplication' && duplicationLoaderVisible)
                  && !(stageId === 'preprocessing' && structureLoaderVisible)
                  && !(stageId === 'classification'
                    && (classificationLoaderPreview || classificationLoaderVisible))"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="12" r="7.5" />
                <path d="M12 7.8v4.6l3 1.8" />
              </svg>
              <span
                v-else-if="stageId === 'duplication' && duplicationLoaderVisible"
                class="workflow-duplication-loader"
                :class="{ 'is-leaving': duplicationLoaderLeaving }"
              >
                <span class="workflow-duplication-loader__mini">
                  <span class="workflow-duplication-loader__bars">
                    <i></i>
                    <i></i>
                  </span>
                  <svg viewBox="0 0 101 114">
                    <circle cx="46.1726" cy="46.1727" r="29.5497"></circle>
                    <line x1="61.7089" y1="67.7837" x2="97.7088" y2="111.784"></line>
                  </svg>
                </span>
              </span>
              <span
                v-else-if="stageId === 'classification'
                  && (classificationLoaderPreview || classificationLoaderVisible)"
                class="workflow-classification-loader"
                :class="{ 'is-leaving': !classificationLoaderPreview && classificationLoaderLeaving }"
              >
                <svg class="workflow-classification-loader__routes" viewBox="0 0 96 48">
                  <path d="M22 24H44C56 24 56 7 70 7" />
                  <path d="M22 24H70" />
                  <path d="M22 24H44C56 24 56 41 70 41" />
                </svg>
                <span class="workflow-classification-loader__source">
                  <i></i><i></i><i></i>
                </span>
                <span class="workflow-classification-loader__scanner">
                  <i></i><i></i>
                </span>
                <span class="workflow-classification-loader__bin is-top"><i></i></span>
                <span class="workflow-classification-loader__bin is-middle"><i></i></span>
                <span class="workflow-classification-loader__bin is-bottom"><i></i></span>
                <span class="workflow-classification-loader__document is-first"><i></i></span>
                <span class="workflow-classification-loader__document is-second"><i></i></span>
                <span class="workflow-classification-loader__document is-third"><i></i></span>
              </span>
              <span
                v-else-if="stageId === 'preprocessing' && structureLoaderVisible"
                class="workflow-structure-loader"
                :class="{ 'is-leaving': structureLoaderLeaving }"
              >
                <span class="workflow-structure-loader__book">
                  <ul>
                    <li v-for="page in 6" :key="page">
                      <svg viewBox="0 0 90 120">
                        <path d="M90,0 L90,120 L11,120 C4.925,120 0,115.075 0,109 L0,11 C0,4.925 4.925,0 11,0 L90,0 Z M71.5,81 L18.5,81 C17.119,81 16,82.119 16,83.5 C16,84.88 17.119,86 18.5,86 L71.5,86 C72.881,86 74,84.881 74,83.5 C74,82.119 72.881,81 71.5,81 Z M71.5,57 L18.5,57 C17.119,57 16,58.119 16,59.5 C16,60.881 17.119,62 18.5,62 L71.5,62 C72.881,62 74,60.881 74,59.5 C74,58.119 72.881,57 71.5,57 Z M71.5,33 L18.5,33 C17.119,33 16,34.119 16,35.5 C16,36.881 17.119,38 18.5,38 L71.5,38 C72.881,38 74,36.881 74,35.5 C74,34.119 72.881,33 71.5,33 Z" />
                      </svg>
                    </li>
                  </ul>
                </span>
              </span>
              <span
                v-else-if="['running', 'retrying'].includes(stages[stageId].status)"
                class="workflow-stage-node__cube-spinner"
              >
                <i></i><i></i><i></i><i></i><i></i><i></i>
              </span>
              <svg
                v-else-if="stageId === 'detection' && documentDetection?.is_contract === false"
                class="workflow-stage-node__document-rejected"
                viewBox="0 0 28 28"
              >
                <path d="M8.5 4.5h7l4 4v15h-11z" />
                <path d="M15.5 4.5v4h4M11.3 13.2l5.4 5.4m0-5.4-5.4 5.4" />
              </svg>
              <svg
                v-else-if="stages[stageId].status === 'succeeded'"
                class="workflow-stage-node__apple-success"
                viewBox="0 0 28 28"
              >
                <circle class="workflow-stage-node__success-halo" cx="14" cy="14" r="10.5" />
                <circle class="workflow-stage-node__success-disc" cx="14" cy="14" r="9.5" />
                <path class="workflow-stage-node__success-check" d="m9.7 14.2 2.9 2.9 5.9-6.2" />
              </svg>
              <svg v-else class="workflow-stage-node__failure" viewBox="0 0 28 28">
                <circle class="workflow-stage-node__failure-halo" cx="14" cy="14" r="10.5" />
                <circle class="workflow-stage-node__failure-disc" cx="14" cy="14" r="9.5" />
                <path class="workflow-stage-node__failure-cross workflow-stage-node__failure-cross--first" d="m10.7 10.7 6.6 6.6" />
                <path class="workflow-stage-node__failure-cross workflow-stage-node__failure-cross--second" d="m17.3 10.7-6.6 6.6" />
              </svg>
            </span>
            <div>
              <h3>{{ stages[stageId].name }}</h3>
              <p v-if="!['succeeded', 'failed'].includes(stages[stageId].status)">
                {{ stages[stageId].message }}
              </p>
            </div>
          </div>
          <div
            v-if="shouldShowStageProgress(stageId) || (stages[stageId].status === 'failed' && stages[stageId].retryable)"
            class="workflow-stage-node__footer"
          >
            <div
              v-if="shouldShowStageProgress(stageId)"
              class="workflow-stage-node__progress"
              :class="{
                'is-finalizing': isStageFinalizing(stages[stageId]),
                'is-retracting': retractingStageIds.has(stageId),
              }"
              aria-hidden="true"
            >
              <span
                :style="{ '--stage-progress': stageProgressPercent(stages[stageId]) / 100 }"
              ></span>
            </div>
            <span v-if="shouldShowStageProgress(stageId)" class="workflow-stage-node__count">
              {{ stageProgressText(stages[stageId]) }}
            </span>
            <button
              v-if="stages[stageId].status === 'failed' && stages[stageId].retryable"
              type="button"
              class="workflow-stage-node__retry"
              @click.stop="retryStage(stageId)"
            >
              重试
            </button>
          </div>
          <span
            v-if="stages[stageId].timerVisible"
            class="workflow-stage-node__timer"
            :class="{ 'is-fading': stages[stageId].timerFading }"
          >
            {{ stageTimingText(stages[stageId]) }}
          </span>
        </article>

        <article
          class="workflow-result-node"
          :class="{
            'is-available': resultAvailable,
            'is-complete': resultComplete,
            'is-updating': resultUpdating,
          }"
          :tabindex="resultAvailable ? 0 : -1"
          :role="resultAvailable ? 'button' : undefined"
          :aria-label="resultAvailable ? '查看并校对合同提取结果' : '等待提取结果'"
          @click="openResult"
          @keydown.enter="openResult"
          @keydown.space.prevent="openResult"
        >
          <span class="workflow-result-node__halo" aria-hidden="true"></span>
          <div class="workflow-result-node__topline">
            <span>输出</span>
          </div>
          <h3>合同提取结果</h3>
          <p v-if="!resultAvailable">等待 Core 或条款结果形成</p>
          <p v-else-if="resultComplete">处理结果已全部形成</p>
          <p v-else>已获得部分结果，可立即查看</p>

          <div class="workflow-result-node__stats">
            <span><strong>{{ resultStats.fields }}</strong>字段</span>
            <span><strong>{{ resultStats.clauses }}</strong>条款</span>
          </div>
          <span v-if="resultAvailable" class="workflow-result-node__action">
            查看并校对
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg>
          </span>
          </article>
        </div>
      </div>
      <div
        class="workflow-scroll-extension"
        :style="{ width: `${workflowScrollExtension}px` }"
        aria-hidden="true"
      ></div>
    </div>

    <div
      v-if="detailMode || queuedDetailMode"
      class="ingestion-detail-backdrop"
      aria-hidden="true"
    ></div>

    <Transition
      name="ingestion-detail"
      @after-enter="handleDetailAfterEnter"
      @after-leave="handleDetailAfterLeave"
    >
      <div
        v-if="detailMode"
        ref="detailPanel"
        class="ingestion-detail-shell"
        :class="[
          `is-${detailMode}`,
          {
            'is-classification': detailMode === 'stage' && selectedStageId === 'classification',
            'is-detection': detailMode === 'stage' && selectedStageId === 'detection',
            'is-overview': detailMode === 'stage' && selectedStageId === 'overview',
          },
        ]"
      >
      <Transition name="ingestion-validation-panel">
        <aside
          v-if="detailMode === 'result' && ingestionIssues.length"
          class="ingestion-validation-panel"
          aria-label="入库校验问题"
          aria-live="polite"
        >
          <header>
            <div>
              <span>入库检查</span>
              <strong>{{ unresolvedIngestionIssueCount ? `${unresolvedIngestionIssueCount} 项待处理` : '全部已解决' }}</strong>
            </div>
            <small>{{ ingestionIssues.length }} 项</small>
          </header>
          <ul>
            <li
              v-for="issue in ingestionIssues"
              :key="issue.id"
              :class="{ 'is-resolved': issue.resolved }"
            >
              <button
                type="button"
                :disabled="!issue.target || issue.target === 'result'"
                @click="scrollToIngestionIssue(issue)"
              >
                <span class="ingestion-validation-panel__mark" aria-hidden="true">
                  <svg v-if="issue.resolved" viewBox="0 0 16 16"><path d="m3.2 8.2 3 3 6.6-6.6" /></svg>
                  <svg v-else viewBox="0 0 16 16"><path d="m4.2 4.2 7.6 7.6m0-7.6-7.6 7.6" /></svg>
                </span>
                <span class="ingestion-validation-panel__copy">
                  <strong>{{ issue.message }}</strong>
                  <small>{{ issue.resolved ? '已解决' : issue.detail?.suggestion || (!issue.target || issue.target === 'result' ? '服务端未提供字段位置，请按提示检查后重新提交' : '点击定位') }}</small>
                </span>
              </button>
            </li>
          </ul>
        </aside>
      </Transition>
      <aside
        class="ingestion-detail"
        :class="[
          `is-${detailMode}`,
          {
            'is-classification': detailMode === 'stage' && selectedStageId === 'classification',
            'is-detection': detailMode === 'stage' && selectedStageId === 'detection',
            'is-overview': detailMode === 'stage' && selectedStageId === 'overview',
          },
        ]"
      >
        <button v-if="detailMode !== 'result'" type="button" class="ingestion-detail__close" aria-label="关闭详情" @click="closeDetail">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>

        <template v-if="detailMode === 'input'">
          <dl class="ingestion-detail__facts">
            <div><dt>文件类型</dt><dd>{{ selectedFileTypeLabel }}</dd></div>
            <div><dt>文件大小</dt><dd>{{ selectedFileSize }}</dd></div>
            <div><dt>页数</dt><dd>{{ selectedFilePageCountLabel }}</dd></div>
            <div><dt>封面尺寸</dt><dd>{{ coverDimensionsLabel }}</dd></div>
            <div v-if="selectedSourceKind === 'image'">
              <dt>转换结果</dt>
              <dd>{{ imageConversionStatus === 'converted' ? '已生成单页 PDF' : imageConversionStatus === 'failed' ? '转换失败' : '正在转换' }}</dd>
            </div>
            <div>
              <dt>处理状态</dt>
              <dd>{{ filePreparationLabel }}</dd>
            </div>
          </dl>
          <div class="ingestion-detail__preview-slot">
            <Transition name="ingestion-preview" appear>
              <button v-if="selectedFile" type="button" class="ingestion-detail__preview-pdf" @click="previewInputPdf">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5" /><circle cx="11" cy="13" r="3" /><path d="m13.2 15.2 2.3 2.3" /></svg>
                <span>预览 PDF</span>
              </button>
            </Transition>
          </div>
          <div class="ingestion-detail__ai-control" aria-live="polite">
            <Transition name="ingestion-ai-control" appear>
              <ExtractionAiControl
                v-if="extractionControlVisible"
                :label="extractionControlLabel"
                :secondary-label="extractionSecondaryLabel"
                :running="workflowRunning || cancellationPending"
                :rewinding="workflowRewinding"
                :disabled="extractionControlDisabled"
                @activate="toggleWorkflowExtraction"
              />
            </Transition>
          </div>
          <div v-if="workflowError" class="ingestion-detail__error">
            <strong>{{ workflowErrorTitle }}</strong>
            <p>{{ workflowError }}</p>
          </div>
        </template>

        <template v-else-if="detailMode === 'deduplication'">
          <div
            class="deduplication-detail-content"
            :class="{ 'is-refreshing': deduplicationContentRefreshing }"
          >
          <span class="ingestion-detail__eyebrow">查重审核</span>
          <h3>{{ currentRunStatus === 'duplicate_rejected' ? '已发现重复合同' : deduplicationCandidates.length ? '发现可能相关的合同' : '未发现重复或相似合同' }}</h3>
          <p class="ingestion-detail__lead">
            {{ deduplicationPresentation.description }}
          </p>

          <div
            class="ingestion-detail__status"
            :class="currentRunStatus === 'duplicate_rejected' ? 'is-failed' : deduplicationReviewPending ? 'is-running' : 'is-success'"
          >
            <span><i></i>{{ deduplicationPresentation.label }}</span>
            <strong>
              {{ deduplicationReviewPending ? `截止 ${deduplicationDeadline}` : deduplicationState === 'automatic' ? '无需人工确认' : deduplicationCandidates.length ? '候选记录已保留' : '无候选合同' }}
            </strong>
          </div>

          <div v-if="deduplicationCandidates.length" class="deduplication-candidates">
            <article
              v-for="(candidate, candidateIndex) in deduplicationCandidates"
              :key="candidate.document_id || candidate.rank"
              class="deduplication-candidate"
              :class="`is-${candidate.relation || 'unknown'}`"
              :style="{ '--candidate-delay': `${candidateIndex * 70}ms` }"
            >
              <div class="deduplication-candidate__identity">
                <span class="deduplication-candidate__document" aria-hidden="true">
                  <svg viewBox="0 0 32 40">
                    <path d="M7 2.5h11.5L26 10v27.5H7z" />
                    <path d="M18.5 2.5V10H26" />
                    <path d="M11 17h11M11 22h11M11 27h7" />
                  </svg>
                  <small>PDF</small>
                </span>
                <div class="deduplication-candidate__title">
                  <span>候选 {{ String(candidate.rank || candidateIndex + 1).padStart(2, '0') }} · {{ candidate.page_count || '—' }} 页</span>
                  <h4 :title="candidate.file_name || '未命名候选合同'">
                    {{ candidate.file_name || '未命名候选合同' }}
                  </h4>
                  <div v-if="candidate.reviewer" class="deduplication-candidate__reviewer">
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <circle cx="10" cy="7" r="3" />
                      <path d="M4.5 16c.45-3.05 2.3-4.6 5.5-4.6s5.05 1.55 5.5 4.6" />
                    </svg>
                    <span>审核人</span>
                    <strong :title="candidate.reviewer">{{ candidate.reviewer }}</strong>
                  </div>
                </div>
                <strong class="deduplication-candidate__relation">
                  <i></i>{{ candidateRelationLabel(candidate.relation) }}
                </strong>
              </div>

              <div class="deduplication-candidate__similarity">
                <div>
                  <span>语义相似度</span>
                  <strong>{{ candidateSimilarityLabel(candidate.cosine_similarity) }}</strong>
                </div>
                <span class="deduplication-candidate__track" aria-hidden="true">
                  <i :style="{ width: `${candidateSimilarityProgress(candidate.cosine_similarity)}%` }"></i>
                </span>
              </div>

              <div class="deduplication-candidate__reasoning">
                <span>判断依据</span>
                <p>{{ candidate.reasoning_summary || candidate.message || '该候选暂时没有可展示的判断说明。' }}</p>
              </div>

              <button
                type="button"
                :disabled="candidatePreviewId === candidate.document_id"
                @click="previewDeduplicationCandidate(candidate)"
              >
                <span>{{ candidatePreviewId === candidate.document_id ? '正在载入文档' : '预览候选 PDF' }}</span>
                <svg v-if="candidatePreviewId !== candidate.document_id" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M4 10h11M11 6l4 4-4 4" />
                </svg>
                <i v-else aria-hidden="true"></i>
              </button>
            </article>
          </div>

          <div v-else class="ingestion-detail__notice">
            {{ deduplicationState === 'automatic' ? '后续流程由系统自动推进，无需点击继续。' : '本次查重未返回候选合同。' }}
          </div>
          <div v-if="candidatePreviewError || continuationError" class="ingestion-detail__error">
            <strong>操作未完成</strong>
            <p>{{ candidatePreviewError || continuationError }}</p>
          </div>
          <button
            v-if="deduplicationReviewPending"
            type="button"
            class="ingestion-detail__primary"
            :disabled="continuationPending"
            @click="continueAfterDeduplication"
          >
            {{ continuationPending ? '正在继续…' : '确认并继续提取' }}
          </button>
          </div>
        </template>

        <template v-else-if="detailMode === 'stage' && selectedStage">
          <span class="ingestion-detail__eyebrow">{{ selectedStage.eyebrow }}</span>
          <h3>{{ selectedStage.name }}</h3>
          <p class="ingestion-detail__lead">{{ selectedStage.summary }}</p>

          <div
            class="ingestion-detail__status"
            :class="[
              `is-${stageTone(selectedStage.status)}`,
              { 'is-rejected': selectedStage.id === 'detection' && documentDetection?.is_contract === false },
            ]"
          >
            <span><i></i>{{ stageStatusLabel(selectedStage) }}</span>
            <strong>{{ stageProgressText(selectedStage) }}</strong>
          </div>

          <section
            v-if="selectedStage.id === 'classification' && selectedStage.status === 'succeeded'"
            class="classification-stage-result"
            :class="`is-${classificationResult?.status || 'unavailable'}`"
          >
            <template v-if="classificationResult">
              <header class="classification-stage-result__header">
                <span class="classification-stage-result__visual" aria-hidden="true">
                  <svg viewBox="0 0 40 40">
                    <path d="M6 8h9c3 0 5 2 5 5v14c0 3 2 5 5 5h9" />
                    <path d="M20 20h14M20 13h8c3 0 5-2 5-5" />
                    <rect x="4" y="5" width="7" height="6" rx="2" />
                    <rect x="29" y="5" width="7" height="6" rx="2" />
                    <rect x="31" y="17" width="7" height="6" rx="2" />
                    <rect x="31" y="29" width="7" height="6" rx="2" />
                  </svg>
                </span>
                <div>
                  <small>分类结果</small>
                  <strong>{{ classificationStatusLabel(classificationResult.status) }}</strong>
                </div>
                <span class="classification-stage-result__count">
                  {{ classificationResult.categories.length
                    ? `${classificationResult.categories.length} 个类别`
                    : '未映射' }}
                </span>
              </header>

              <div
                v-if="classificationResult.categories.length"
                class="classification-stage-result__categories"
              >
                <article
                  v-for="category in classificationResult.categories"
                  :key="category.code"
                >
                  <div>
                    <h4>{{ category.name }}</h4>
                    <code>{{ category.code }}</code>
                    <p v-if="category.scenario">{{ category.scenario }}</p>
                  </div>
                </article>
              </div>

              <div
                v-if="classificationResult.unmappedTypeDescription"
                class="classification-stage-result__description"
              >
                <span>类型说明</span>
                <p>{{ classificationResult.unmappedTypeDescription }}</p>
              </div>
            </template>

            <div v-else class="classification-stage-result__unavailable">
              分类阶段已经完成，但当前快照没有返回可展示的分类详情。
            </div>
          </section>

          <section
            v-if="selectedStage.id === 'overview' && selectedStage.status === 'succeeded'"
            class="classification-stage-result overview-stage-result"
          >
            <template v-if="contractOverview">
              <header class="classification-stage-result__header">
                <div>
                  <small>建议名称</small>
                  <strong>{{ contractOverview.file_name }}</strong>
                </div>
              </header>
              <ContractOverviewSummary :summary="contractOverview.summary" />
              <div class="classification-stage-result__description">
                <span>命名依据</span>
                <p>{{ contractOverview.reasoning }}</p>
              </div>
              <div v-if="contractOverview.evidence?.length" class="classification-stage-result__categories">
                <article v-for="(evidence, index) in contractOverview.evidence" :key="`${evidence.page_number}-${index}`">
                  <div>
                    <h4>第 {{ evidence.page_number }} 页</h4>
                    <p>{{ evidence.content }}</p>
                  </div>
                </article>
              </div>
            </template>
            <div v-else class="classification-stage-result__unavailable">
              合同概述阶段已经完成，但当前快照没有返回可展示的概述详情。
            </div>
          </section>

          <div
            v-if="selectedStage.id === 'detection' && documentDetection"
            class="document-detection-result"
            :class="{ 'is-contract': documentDetection.is_contract }"
          >
            <strong>{{ documentDetection.is_contract ? '已确认属于合同文档' : '未识别为合同文档' }}</strong>
            <p>{{ documentDetection.reasoning_summary }}</p>
            <ul v-if="documentDetection.evidence?.length">
              <li v-for="(evidence, index) in documentDetection.evidence" :key="`${evidence.page_number}-${index}`">
                <span>第 {{ evidence.page_number }} 页</span>
                {{ evidence.observation }}
              </li>
            </ul>
          </div>

          <dl class="ingestion-detail__facts">
            <div><dt>处理进度</dt><dd>{{ stageProgressDetail(selectedStage) }}</dd></div>
            <div><dt>当前尝试</dt><dd>第 {{ selectedStage.attempt }} 次</dd></div>
            <div><dt>本次耗时</dt><dd>{{ selectedStage.timerVisible ? stageElapsedText(selectedStage) : '—' }}</dd></div>
            <div><dt>执行方式</dt><dd>{{ branchIds.includes(selectedStage.id) ? '并行处理' : '顺序处理' }}</dd></div>
          </dl>

          <div v-if="selectedStage.status === 'failed'" class="ingestion-detail__error">
            <strong>本阶段未完成</strong>
            <p>{{ selectedStage.error }}</p>
          </div>

          <button
            v-if="selectedStage.status === 'failed' && selectedStage.retryable"
            type="button"
            class="ingestion-detail__primary"
            @click="retryStage(selectedStage.id)"
          >
            单独重试该阶段
          </button>
        </template>

        <template v-else-if="detailMode === 'result'">
          <span class="ingestion-detail__eyebrow">提取结果</span>
          <h3>{{ resultComplete ? '结果已完整汇聚' : '部分结果可供校对' }}</h3>
          <p class="ingestion-detail__lead">
            成功路径的结果会持续更新。你修改过的字段不会被后续重试结果直接覆盖。
          </p>

          <div v-if="!resultComplete" class="ingestion-detail__notice">
            当前仍有处理路径未完成，可以先校对已有结果。
          </div>

          <div class="extraction-result-editor" @focusout="handleIngestionIssueFocusout">
            <section class="extraction-result-section extraction-result-section--file-name">
              <header><strong>合同名称</strong><span>最终展示名称</span></header>
              <label
                class="extraction-result-file-name"
                :class="{ 'is-issue-focused': activeIngestionIssueTarget === 'file-name' }"
                data-ingestion-target="file-name"
              >
                <span>文件名主体<b>必填</b></span>
                <input
                  type="text"
                  :value="reviewFileName"
                  :disabled="Boolean(ingestionReceipt)"
                  placeholder="请输入最终展示文件名（无需扩展名）"
                  @input="updateReviewFileName"
                />
              </label>
            </section>
            <section class="extraction-result-section">
              <header><strong>合同摘要</strong><span>最终入库摘要</span></header>
              <label
                class="extraction-result-file-name extraction-result-summary"
                :class="{ 'is-issue-focused': activeIngestionIssueTarget === 'summary' }"
                data-ingestion-target="summary"
              >
                <span>摘要内容<b>必填</b></span>
                <textarea
                  :value="reviewSummary"
                  :disabled="ingestionPending || Boolean(ingestionReceipt)"
                  :aria-invalid="!reviewSummary.trim() || [...reviewSummary.trim()].length > 3000"
                  placeholder="请核对并填写最终合同摘要"
                  rows="6"
                  required
                  @input="updateReviewSummary($event.target.value)"
                ></textarea>
                <small :class="{ 'is-over-limit': [...reviewSummary.trim()].length > 3000 }">{{ [...reviewSummary.trim()].length }} / 3000</small>
              </label>
            </section>
            <section v-if="coreReviewFields.length" class="extraction-result-section">
              <header>
                <strong>核心字段</strong>
                <span>{{ extractionDraft?.core ? `${coreReviewFields.length} 项待审核` : '等待提取结果' }}</span>
              </header>
              <div v-if="!extractionDraft?.core" class="ingestion-detail__notice">
                Core 结果尚未形成，仍可先按表单定义补充内容。
              </div>
              <article
                v-for="field in coreReviewFields"
                :key="field.code"
                class="extraction-result-item"
                :class="{
                  'is-single': field.cardinality === 'single',
                  'is-issue-focused': activeIngestionIssueTarget === `core:${field.code}`,
                }"
                :data-ingestion-target="`core:${field.code}`"
              >
                <h4 class="extraction-result-item__title">
                  <span>{{ field.name }}</span>
                  <span
                    v-if="field.cardinality === 'single' && field.properties.length === 1"
                    class="extraction-result-item__title-meta"
                  >
                    <b v-if="isSigningDateProperty(field.properties[0])">入库必填</b>
                    <b v-else-if="field.properties[0].required">对象内必填</b>
                    <i
                      v-if="modifiedFields.has(coreReviewPath(field.code, 0, field.properties[0].code))"
                    >已修改</i>
                  </span>
                </h4>
                <TransitionGroup
                  name="core-review-item"
                  tag="div"
                  class="extraction-result-item__objects"
                >
                  <div
                    v-for="(item, itemIndex) in field.items"
                    :key="coreReviewItemKey(field.code, item, itemIndex)"
                    class="extraction-result-item__object-shell"
                  >
                    <div
                      class="extraction-result-object"
                      :class="{ 'is-direct': field.cardinality === 'single' }"
                    >
                  <div v-if="field.cardinality === 'multiple'" class="extraction-result-object__heading">
                    <span>第 {{ itemIndex + 1 }} 项</span>
                    <button type="button" @click.stop="removeCoreReviewItem(field, itemIndex)">移除</button>
                  </div>
                  <div
                    v-for="property in field.properties"
                    :key="property.code"
                    class="extraction-result-property"
                    :class="{
                      'is-required-empty': coreReviewValueMissing(field.code, itemIndex, property),
                      'is-issue-focused': activeIngestionIssueTarget === coreReviewPath(field.code, itemIndex, property.code),
                    }"
                    :data-ingestion-target="coreReviewPath(field.code, itemIndex, property.code)"
                  >
                    <span v-if="field.cardinality === 'multiple' || field.properties.length > 1">
                      {{ property.name }}<b v-if="isSigningDateProperty(property)">入库必填</b><b v-else-if="property.required">对象内必填</b>
                      <i v-if="modifiedFields.has(coreReviewPath(field.code, itemIndex, property.code))">已修改</i>
                    </span>
                    <ContractDateWheel
                      v-if="isSigningDateProperty(property)"
                      :model-value="coreReviewInputValue(field.code, itemIndex, property)"
                      :disabled="Boolean(ingestionReceipt)"
                      :required="property.required && coreReviewItemActive(field.code, itemIndex)"
                      @update:model-value="updateSigningDateValue(field, itemIndex, property, $event)"
                    />
                    <div
                      v-else-if="property.type === 'boolean'"
                      class="extraction-result-boolean-control"
                      :class="{
                        'is-open': openBooleanControlKey === booleanReviewControlKey(field.code, itemIndex, property.code),
                      }"
                      @click.stop
                    >
                      <button
                        type="button"
                        class="extraction-result-boolean-control__trigger"
                        :aria-expanded="openBooleanControlKey === booleanReviewControlKey(field.code, itemIndex, property.code)"
                        @click="toggleBooleanReviewControl(field.code, itemIndex, property.code)"
                      >
                        <span>{{ booleanReviewLabel(coreReviewInputValue(field.code, itemIndex, property)) }}</span>
                        <i aria-hidden="true"></i>
                      </button>
                      <div class="extraction-result-boolean-control__expander">
                        <div class="extraction-result-boolean-control__clip">
                          <div
                            class="extraction-result-boolean-control__options"
                            role="radiogroup"
                            :aria-label="property.name"
                            :class="{
                              'is-selected-true': coreReviewInputValue(field.code, itemIndex, property) === 'true',
                              'is-selected-false': coreReviewInputValue(field.code, itemIndex, property) === 'false',
                            }"
                            :style="{
                              '--boolean-option-index': booleanReviewOptionIndex(coreReviewInputValue(field.code, itemIndex, property)),
                            }"
                          >
                            <template v-for="(option, optionIndex) in booleanReviewOptions" :key="option.value">
                              <input
                                :id="booleanReviewOptionId(field.code, itemIndex, property.code, optionIndex)"
                                :name="booleanReviewControlKey(field.code, itemIndex, property.code)"
                                type="radio"
                                :value="option.value"
                                :tabindex="openBooleanControlKey === booleanReviewControlKey(field.code, itemIndex, property.code) ? 0 : -1"
                                :checked="coreReviewInputValue(field.code, itemIndex, property) === option.value"
                                @change="selectBooleanReviewValue(field, itemIndex, property, option.value)"
                              />
                              <label :for="booleanReviewOptionId(field.code, itemIndex, property.code, optionIndex)">
                                {{ option.label }}
                              </label>
                            </template>
                            <div class="extraction-result-boolean-control__glider"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div
                      v-else-if="isCoreNumericProperty(property.type)"
                      class="extraction-result-number-control"
                    >
                      <input
                        type="number"
                        :step="corePropertyStep(property.type)"
                        :value="coreReviewInputValue(field.code, itemIndex, property)"
                        :required="property.required && coreReviewItemActive(field.code, itemIndex)"
                        :placeholder="`请输入${property.name}`"
                        @input="updateCoreReviewValue(field, itemIndex, property, $event)"
                      />
                      <div class="extraction-result-number-control__buttons">
                        <button
                          type="button"
                          aria-label="减少数值"
                          @click="adjustCoreReviewNumber(field, itemIndex, property, -1)"
                        >
                          <span class="extraction-result-number-control__button"></span>
                          <span class="extraction-result-number-control__label">−</span>
                        </button>
                        <button
                          type="button"
                          aria-label="增加数值"
                          @click="adjustCoreReviewNumber(field, itemIndex, property, 1)"
                        >
                          <span class="extraction-result-number-control__button"></span>
                          <span class="extraction-result-number-control__label">+</span>
                        </button>
                      </div>
                    </div>
                    <input
                      v-else
                      type="text"
                      :value="coreReviewInputValue(field.code, itemIndex, property)"
                      :required="property.required && coreReviewItemActive(field.code, itemIndex)"
                      :placeholder="`请输入${property.name}`"
                      @input="updateCoreReviewValue(field, itemIndex, property, $event)"
                    />
                      </div>
                    </div>
                  </div>
                </TransitionGroup>
                <Transition name="core-review-empty">
                  <div v-if="field.cardinality === 'multiple' && !field.items.length" class="extraction-result-item__empty">
                    暂无提取值，可以手动新增一项。
                  </div>
                </Transition>
                <button
                  v-if="field.cardinality === 'multiple'"
                  type="button"
                  class="extraction-result-item__add"
                  @click.stop="addCoreReviewItem(field)"
                >
                  <span>＋</span>新增{{ field.name }}
                </button>
              </article>
            </section>

            <section
              v-if="clauseReviewAvailable"
              class="extraction-result-section extraction-result-section--clauses"
              :class="{ 'is-issue-focused': activeIngestionIssueTarget === 'clauses' }"
              data-ingestion-target="clauses"
            >
              <header><strong>合同条款</strong><span>{{ draftClauses.length }} 条</span></header>
              <div
                ref="clauseReviewListRef"
                class="clause-review-list"
              >
                <div
                  v-for="(clause, clauseIndex) in draftClauses"
                  :key="clause.clause_id"
                  class="clause-review-item-shell"
                  :class="{
                    'is-removing': removingClauseIds.has(clause.clause_id),
                    'is-issue-focused': activeIngestionIssueTarget === `clause:${clause.clause_id || clause.order}`,
                  }"
                  :data-clause-id="clause.clause_id"
                  :data-ingestion-target="`clause:${clause.clause_id || clause.order}`"
                >
                  <div class="clause-review-item-shell__content">
                <div
                  class="clause-insert-slot"
                  :class="{ 'is-open': clauseInsertIndex === clauseIndex }"
                  :data-clause-insert-index="clauseIndex"
                >
                  <button
                    v-if="clauseInsertIndex !== clauseIndex"
                    type="button"
                    class="clause-insert-slot__trigger"
                    :aria-label="clauseIndex === 0 ? '在第一条条款前新增' : '在相邻条款之间新增'"
                    @click.stop="openClauseInsert(clauseIndex)"
                  >
                    <span>＋</span><i>{{ clauseIndex === 0 ? '在开头新增' : '在此新增条款' }}</i>
                  </button>
                  <form v-else class="clause-insert-form" @submit.prevent.stop="addManualClause">
                    <header><strong>新增条款</strong><span>插入为第 {{ clauseIndex + 1 }} 条</span></header>
                    <fieldset class="clause-path-editor">
                      <legend>完整层级路径 <b>必填</b></legend>
                      <div v-for="(_, pathIndex) in newClauseForm.path" :key="pathIndex" class="clause-path-editor__item">
                        <span>{{ pathIndex + 1 }}</span>
                        <input v-model="newClauseForm.path[pathIndex]" type="text" :placeholder="pathIndex === newClauseForm.path.length - 1 ? '当前条款，例如：10.1 首付款' : '上级路径，例如：第三章 付款与结算'" />
                        <button type="button" title="使用特殊符号作为编号" @click.stop="useClauseSymbolPath(pathIndex)">◆</button>
                        <button type="button" :disabled="newClauseForm.path.length === 1" @click.stop="removeClausePathItem(pathIndex)">移除</button>
                      </div>
                      <button type="button" class="clause-path-editor__add" @click.stop="addClausePathItem">＋ 新增一级路径</button>
                    </fieldset>
                    <div class="clause-insert-form__row clause-insert-form__row--pages">
                      <label><span>起始页<b>必填</b></span><input v-model.number="newClauseForm.startPage" type="number" min="1" step="1" /></label>
                      <label><span>结束页<b>必填</b></span><input v-model.number="newClauseForm.endPage" type="number" min="1" step="1" /></label>
                    </div>
                    <label><span>条款正文<b>必填</b></span><textarea v-model="newClauseForm.content" placeholder="请输入完整条款正文"></textarea></label>
                    <p v-if="clauseInsertError" class="clause-insert-form__error">{{ clauseInsertError }}</p>
                    <footer>
                      <button type="button" @click.stop="cancelClauseInsert">取消</button>
                      <button type="submit">确认新增</button>
                    </footer>
                  </form>
                </div>
                <article class="extraction-result-item">
                  <div class="extraction-result-item__heading clause-review-heading">
                    <ol class="clause-review-path" aria-label="条款层级路径">
                      <li v-for="(path, pathIndex) in clauseDisplayPath(clause)" :key="pathIndex">
                        <TruncatedText :text="path" :max-characters="24" />
                      </li>
                    </ol>
                    <div class="extraction-result-item__clause-actions">
                      <span v-if="clausePageLabel(clause)">{{ clausePageLabel(clause) }}</span>
                      <button type="button" @click="toggleClauseEditing(clause)">
                        {{ editingClauseIds.has(clauseEditingId(clause)) ? '完成' : '编辑' }}
                      </button>
                      <button
                        type="button"
                        class="is-danger"
                        :aria-label="`删除条款：${clause.identifier || clause.title || clause.order}`"
                        @click.stop="removeClause(clause)"
                      >删除</button>
                    </div>
                  </div>
                  <textarea
                    v-if="editingClauseIds.has(clauseEditingId(clause))"
                    :value="clauseEditableContent(clause)"
                    @input="updateDraftValue(clauseValuePath(clause), $event)"
                  ></textarea>
                  <MarkdownMessage
                    v-else-if="clauseEditableContent(clause)"
                    class="extraction-result-item__markdown"
                    :content="clauseEditableContent(clause)"
                  />
                  <button
                    v-else
                    type="button"
                    class="extraction-result-item__markdown-empty"
                    @click="toggleClauseEditing(clause)"
                  >
                    暂无条款正文，点击补充
                  </button>
                </article>
                  </div>
                </div>
              </div>
              <div
                class="clause-insert-slot clause-insert-slot--last"
                :class="{ 'is-open': clauseInsertIndex === draftClauses.length }"
                :data-clause-insert-index="draftClauses.length"
              >
                <button
                  v-if="clauseInsertIndex !== draftClauses.length"
                  type="button"
                  class="clause-insert-slot__trigger"
                  :aria-label="draftClauses.length ? '在最后一条条款后新增' : '新增第一条条款'"
                  @click.stop="openClauseInsert(draftClauses.length)"
                >
                  <span>＋</span><i>{{ draftClauses.length ? '在末尾新增' : '新增第一条条款' }}</i>
                </button>
                <form v-else class="clause-insert-form" @submit.prevent.stop="addManualClause">
                  <header><strong>新增条款</strong><span>插入为第 {{ draftClauses.length + 1 }} 条</span></header>
                  <fieldset class="clause-path-editor">
                    <legend>完整层级路径 <b>必填</b></legend>
                    <div v-for="(_, pathIndex) in newClauseForm.path" :key="pathIndex" class="clause-path-editor__item">
                      <span>{{ pathIndex + 1 }}</span>
                      <input v-model="newClauseForm.path[pathIndex]" type="text" :placeholder="pathIndex === newClauseForm.path.length - 1 ? '当前条款，例如：10.1 首付款' : '上级路径，例如：第三章 付款与结算'" />
                      <button type="button" title="使用特殊符号作为编号" @click.stop="useClauseSymbolPath(pathIndex)">◆</button>
                      <button type="button" :disabled="newClauseForm.path.length === 1" @click.stop="removeClausePathItem(pathIndex)">移除</button>
                    </div>
                    <button type="button" class="clause-path-editor__add" @click.stop="addClausePathItem">＋ 新增一级路径</button>
                  </fieldset>
                  <div class="clause-insert-form__row clause-insert-form__row--pages">
                    <label><span>起始页<b>必填</b></span><input v-model.number="newClauseForm.startPage" type="number" min="1" step="1" /></label>
                    <label><span>结束页<b>必填</b></span><input v-model.number="newClauseForm.endPage" type="number" min="1" step="1" /></label>
                  </div>
                  <label><span>条款正文<b>必填</b></span><textarea v-model="newClauseForm.content" placeholder="请输入完整条款正文"></textarea></label>
                  <p v-if="clauseInsertError" class="clause-insert-form__error">{{ clauseInsertError }}</p>
                  <footer>
                    <button type="button" @click.stop="cancelClauseInsert">取消</button>
                    <button type="submit">确认新增</button>
                  </footer>
                </form>
              </div>
            </section>

            <div v-if="!coreReviewFields.length && !draftClauses.length" class="ingestion-detail__notice">
              当前草稿已创建，但暂时没有可展示的提取分区。
            </div>
            <button
              type="button"
              class="extraction-ingestion-button"
              :class="{
                'is-submitting': ingestionPending,
                'is-sent': Boolean(ingestionReceipt),
              }"
              :disabled="!canIngestResult"
              :aria-label="ingestionReceipt ? '已正式入库' : ingestionActionCharacters.join('')"
              @click="submitIngestion"
            >
              <span class="extraction-ingestion-button__outline" aria-hidden="true"></span>
              <span class="extraction-ingestion-button__state is-default" aria-hidden="true">
                <span class="extraction-ingestion-button__icon">
                  <svg viewBox="0 0 24 24">
                    <path d="M14.22 21.63c-1.18 0-2.85-.83-4.17-4.8l-.72-2.16-2.16-.72c-3.96-1.32-4.79-2.99-4.79-4.17 0-1.17.83-2.85 4.79-4.18l8.49-2.83c2.12-.71 3.89-.5 4.98.58s1.3 2.86.59 4.98l-2.83 8.49c-1.33 3.98-3 4.81-4.18 4.81ZM7.64 7.03c-2.78.93-3.77 2.03-3.77 2.75s.99 1.82 3.77 2.74l2.52.84c.22.07.4.25.47.47l.84 2.52c.92 2.78 2.03 3.77 2.75 3.77s1.82-.99 2.75-3.77l2.83-8.49c.51-1.54.42-2.8-.23-3.45s-1.91-.73-3.44-.22L7.64 7.03Z" />
                    <path d="M10.11 14.4a.75.75 0 0 1-.53-1.28l3.58-3.59a.75.75 0 0 1 1.06 1.06l-3.58 3.59a.73.73 0 0 1-.53.22Z" />
                  </svg>
                </span>
                <span class="extraction-ingestion-button__label">
                  <i
                    v-for="(character, index) in ingestionActionCharacters"
                    :key="`${character}-${index}`"
                    :style="{ '--i': index }"
                  >{{ character }}</i>
                </span>
              </span>
              <span class="extraction-ingestion-button__state is-sent" aria-hidden="true">
                <span class="extraction-ingestion-button__icon">
                  <svg viewBox="0 0 24 24">
                    <path d="M12 22.75C6.07 22.75 1.25 17.93 1.25 12S6.07 1.25 12 1.25 22.75 6.07 22.75 12 17.93 22.75 12 22.75Zm0-20C6.9 2.75 2.75 6.9 2.75 12s4.15 9.25 9.25 9.25 9.25-4.15 9.25-9.25S17.1 2.75 12 2.75Z" />
                    <path d="M10.58 15.58a.75.75 0 0 1-.53-.22l-2.83-2.83a.75.75 0 0 1 1.06-1.06l2.3 2.3 5.14-5.14a.75.75 0 0 1 1.06 1.06l-5.67 5.67a.75.75 0 0 1-.53.22Z" />
                  </svg>
                </span>
                <span class="extraction-ingestion-button__label">
                  <i v-for="(character, index) in Array.from('已正式入库')" :key="index" :style="{ '--i': index }">
                    {{ character }}
                  </i>
                </span>
              </span>
            </button>
          </div>
        </template>
      </aside>
        <Transition name="ingestion-error-toast">
          <div
            v-if="detailMode === 'result' && ingestionErrors.length"
            class="ingestion-detail__error ingestion-error-toast"
            role="alert"
          >
            <strong>暂时无法入库</strong>
            <ol>
              <li v-for="(error, index) in ingestionErrors" :key="`${index}-${error}`">
                {{ error }}
              </li>
            </ol>
          </div>
        </Transition>
        <button
          v-if="detailMode === 'result'"
          type="button"
          class="ingestion-detail-floating-close"
          aria-label="关闭结果"
          @click="closeDetail"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>
    </Transition>

    <BatchExtractionDialog :open="active && batchExtractionOpen" @close="batchExtractionOpen = false" @created="refreshExtractionRuns({ showLoader: false })" @tasks="runsPanelOpen || toggleRunsPanel()" />

    <PdfPreviewOverlay
      :open="active && Boolean(candidatePreviewUrl)"
      :src="candidatePreviewUrl"
      :label="candidatePreviewLabel"
      @close="closeCandidatePreview"
    />

  </section>
</template>

<style scoped>
.contract-ingestion {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: #26332c;
  background:
    radial-gradient(circle at 48% 45%, #ffffffd9 0, #ffffff00 37%),
    linear-gradient(180deg, #f8fafbd9, #f4f7f7d4);
}

.contract-ingestion__file-input {
  display: none;
}

.contract-ingestion__actions {
  position: absolute;
  z-index: 22;
  top: 14px;
  left: 14px;
  display: flex;
  gap: 9px;
  align-items: center;
}

.contract-action-pedestal {
  position: relative;
  display: flex;
  padding: 7px 8px 10px;
  isolation: isolate;
  border-radius: 20px 20px 24px 24px;
}

.contract-action-pedestal::before {
  position: absolute;
  z-index: -2;
  inset: 0;
  content: '';
  background:
    radial-gradient(ellipse at 35% 5%, #ffffff3d 0, #ffffff00 54%),
    linear-gradient(145deg, #ffffff0d, #7d8d8408);
  border: 1px solid #ffffff73;
  border-radius: inherit;
  box-shadow:
    inset 2px 2px 3px #ffffffa8,
    inset -3px -4px 7px #87968e14,
    4px 6px 10px #56686012;
}

.contract-action-pedestal::after {
  position: absolute;
  z-index: -1;
  right: 13px;
  bottom: 3px;
  left: 13px;
  height: 14px;
  pointer-events: none;
  content: '';
  background: linear-gradient(180deg, #ffffff00, #82918912);
  border-radius: 0 0 50% 50%;
}

.contract-runs-trigger,
.contract-new-trigger {
  position: relative;
  display: inline-flex;
  gap: 8px;
  align-items: center;
  min-height: 37px;
  padding: 0 15px;
  color: #34413a;
  font-size: 11px;
  font-weight: 720;
  cursor: pointer;
  background:
    radial-gradient(circle at 30% 8%, #ffffffb8 0, #ffffff00 48%),
    linear-gradient(145deg, #ffffff70 0%, #e2e8e454 58%, #bdc8c240 100%);
  border: 1px solid #ffffffa8;
  border-radius: 12px;
  box-shadow:
    0 4px 0 #b8c2bd73,
    0 7px 9px #73827a1c,
    inset 2px 2px 3px #ffffffd9,
    inset -2px -2px 4px #8b999124;
  transform: translateY(-2px);
  transition: color 0.2s, box-shadow 0.18s, transform 0.18s, background 0.2s;
}

.contract-runs-trigger:hover,
.contract-new-trigger:hover {
  color: #5f53ba;
  background:
    radial-gradient(circle at 30% 8%, #ffffffd9 0, #ffffff00 48%),
    linear-gradient(145deg, #ffffff8c 0%, #e8edea66 58%, #c8d1cc4d 100%);
  transform: translateY(-3px);
}

.contract-runs-trigger.has-blocked {
  color: #9b5e34;
}

.contract-runs-trigger.has-blocked:hover {
  color: #824825;
}

.contract-runs-trigger:active,
.contract-new-trigger:active {
  color: #666e69;
  box-shadow:
    0 1px 0 #b8c2bd73,
    0 2px 3px #73827a18,
    inset 3px 3px 6px #bac3be8c,
    inset -2px -2px 4px #fff;
  transform: translateY(1px) scale(0.992);
}

.contract-runs-trigger:disabled,
.contract-new-trigger:disabled {
  cursor: wait;
  opacity: 0.64;
  transform: translateY(-1px);
}

.contract-runs-trigger svg,
.contract-new-trigger svg {
  width: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
}

.contract-runs-trigger b {
  display: grid;
  box-sizing: border-box;
  place-items: center;
  width: 0;
  height: 16px;
  padding: 0;
  margin-left: -8px;
  overflow: hidden;
  color: #675bc5;
  font-size: 8px;
  font-weight: 800;
  opacity: 0;
  transform: scale(0.72);
  transform-origin: left center;
  transition:
    width 0.46s cubic-bezier(0.16, 1, 0.3, 1),
    margin-left 0.46s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.22s ease 0.08s,
    transform 0.42s cubic-bezier(0.16, 1, 0.3, 1);
}

.contract-runs-trigger b.is-visible {
  width: var(--run-count-width, 5px);
  margin-left: 0;
  opacity: 1;
  transform: scale(1);
}

.contract-runs-trigger.has-blocked b {
  color: #a35f32;
}

.contract-runs-backdrop {
  position: absolute;
  z-index: 21;
  inset: 0;
  background: transparent;
}

.contract-runs-panel {
  position: absolute;
  z-index: 23;
  top: 70px;
  bottom: 18px;
  left: 18px;
  display: flex;
  flex-direction: column;
  width: min(370px, calc(100% - 36px));
  min-height: 0;
  padding: 22px;
  overflow: hidden;
  background: #f1f4f2f2;
  border: 1px solid #fff;
  border-radius: 20px;
  box-shadow:
    18px 24px 58px #35483d26,
    inset 1px 1px 0 #fff,
    inset -1px -1px 0 #cbd2ce80;
  backdrop-filter: blur(22px) saturate(1.18);
  transform-origin: top left;
}

.contract-runs-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.contract-runs-panel__header > div > span {
  color: #766aca;
  font-size: 8px;
  font-weight: 780;
  letter-spacing: 0.11em;
}

.contract-runs-panel__header h2 {
  margin: 5px 0 0;
  color: #2f3c35;
  font-size: 17px;
  letter-spacing: -0.025em;
}

.contract-runs-panel__header button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  color: #737d77;
  cursor: pointer;
  background: #e9edea;
  border: 1px solid #f9faf9;
  border-radius: 9px;
  box-shadow:
    3px 3px 7px #c9cfcc,
    -3px -3px 7px #fff;
  transition: color 0.2s, box-shadow 0.2s;
}

.contract-runs-panel__header button:active {
  box-shadow:
    inset 2px 2px 5px #c9cfcc,
    inset -2px -2px 5px #fff;
}

.contract-runs-panel__header button:disabled {
  cursor: wait;
}

.contract-runs-panel__header button svg {
  width: 15px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
}

.contract-runs-panel__header button.is-loading svg {
  animation: contract-runs-refresh 0.8s linear infinite;
}

.contract-runs-panel__summary {
  margin: 12px 0 15px;
  color: #818b85;
  font-size: 9px;
  line-height: 1.65;
}

.contract-runs-loader-layer {
  position: absolute;
  z-index: 4;
  inset: 72px 10px 10px;
  display: grid;
  place-content: center;
  justify-items: center;
  overflow: hidden;
  background: #f1f4f2ed;
  border-radius: 16px;
  backdrop-filter: blur(7px) saturate(1.05);
}

.contract-runs-loader-layer > span {
  margin-top: -4px;
  color: #7d7064;
  font-size: 8px;
  font-weight: 720;
  letter-spacing: 0.08em;
}

.capybaraloader {
  --capybara-color: rgb(204 125 45);
  --capybara-color-dark: rgb(83 56 28);

  position: relative;
  z-index: 1;
  width: 14em;
  height: 10em;
  font-size: 11px;
  transform: scale(0.86);
  transform-origin: center;
}

.capybara {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 7.5em;
}

.capy {
  position: relative;
  z-index: 1;
  width: 85%;
  height: 100%;
  background: linear-gradient(var(--capybara-color), 90%, var(--capybara-color-dark));
  border-radius: 45%;
  animation: contract-capybara-body 1s linear infinite;
}

.capyhead {
  position: absolute;
  right: 0;
  bottom: 0;
  z-index: 3;
  width: 7.5em;
  height: 7em;
  background-color: var(--capybara-color);
  border-radius: 3.5em;
  box-shadow: -1em 0 var(--capybara-color-dark);
  animation: contract-capybara-body 1s linear infinite;
}

.capyear {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 3;
  width: 2em;
  height: 2em;
  overflow: hidden;
  background: linear-gradient(-45deg, var(--capybara-color), 90%, var(--capybara-color-dark));
  border-radius: 100%;
}

.capyear:nth-child(2) {
  left: 5em;
  background: linear-gradient(25deg, var(--capybara-color), 90%, var(--capybara-color-dark));
}

.capyear2 {
  position: absolute;
  bottom: 0;
  left: 0.5em;
  width: 100%;
  height: 1em;
  background-color: var(--capybara-color-dark);
  border-radius: 100%;
  transform: rotate(-45deg);
}

.capymouth {
  position: absolute;
  bottom: 0;
  left: 2.5em;
  display: flex;
  align-items: center;
  justify-content: space-around;
  box-sizing: border-box;
  width: 3.5em;
  height: 2em;
  padding: 0.5em;
  background-color: var(--capybara-color-dark);
  border-radius: 50%;
}

.capylips {
  width: 0.25em;
  height: 0.75em;
  background-color: var(--capybara-color);
  border-radius: 100%;
  transform: rotate(-45deg);
}

.capylips:nth-child(2) {
  transform: rotate(45deg);
}

.capyeye {
  position: absolute;
  bottom: 3.5em;
  left: 1.5em;
  width: 2em;
  height: 0.5em;
  background-color: var(--capybara-color-dark);
  border-radius: 5em;
  transform: rotate(45deg);
}

.capyeye:nth-child(5) {
  left: 5.5em;
  width: 1.75em;
  transform: rotate(-45deg);
}

.capyleg {
  position: absolute;
  bottom: 0;
  left: 0;
  z-index: 2;
  width: 6em;
  height: 5em;
  background: linear-gradient(var(--capybara-color), 95%, var(--capybara-color-dark));
  border-radius: 2em;
  animation: contract-capybara-body 1s linear infinite;
}

.capyleg2 {
  position: absolute;
  bottom: 0;
  left: 3.25em;
  z-index: 2;
  width: 1.75em;
  height: 3em;
  background: linear-gradient(var(--capybara-color), 80%, var(--capybara-color-dark));
  border-radius: 0.75em;
  box-shadow: inset 0 -0.5em var(--capybara-color-dark);
  animation: contract-capybara-leg 1s linear infinite;
}

.capyleg2:nth-child(3) {
  left: 0.5em;
  width: 1.25em;
  height: 2em;
  animation: contract-capybara-leg-back 1s linear infinite 75ms;
}

.capybara-track {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 2.5em;
  overflow: hidden;
}

.capybara-track__line {
  width: 50em;
  height: 0.5em;
  border-top: 0.5em dashed var(--capybara-color-dark);
  animation: contract-capybara-line 10s linear infinite;
}

.contract-runs-loader-enter-active,
.contract-runs-loader-leave-active {
  transition:
    opacity 0.32s ease,
    filter 0.38s ease,
    transform 0.42s cubic-bezier(0.16, 1, 0.3, 1);
}

.contract-runs-loader-enter-from,
.contract-runs-loader-leave-to {
  opacity: 0;
  filter: blur(7px);
  transform: scale(0.965);
}

.contract-runs-panel__empty,
.contract-runs-panel__error {
  display: grid;
  place-items: center;
  margin: auto 0;
  padding: 26px 18px;
  text-align: center;
}

.contract-runs-panel__empty img {
  display: block;
  width: min(132px, 48vw);
  height: auto;
  object-fit: contain;
  user-select: none;
  filter: drop-shadow(0 12px 17px rgb(84 94 88 / 10%));
  -webkit-user-drag: none;
}

.contract-runs-empty-enter-active {
  transition:
    opacity 1.4s ease,
    filter 1.45s ease,
    transform 1.55s cubic-bezier(0.16, 1, 0.3, 1);
}

.contract-runs-empty-enter-from {
  opacity: 0;
  filter: blur(8px);
  transform: translateY(10px) scale(0.9);
}

.contract-runs-panel__empty strong,
.contract-runs-panel__error strong {
  color: #46524c;
  font-size: 11px;
}

.contract-runs-panel__empty p,
.contract-runs-panel__error p {
  margin: 6px 0 0;
  color: #8b948f;
  font-size: 8.5px;
  line-height: 1.6;
}

.contract-runs-groups {
  flex: 1;
  min-height: 0;
  padding: 2px 9px 18px 2px;
  overflow: auto;
  scrollbar-color: #7165d72e transparent;
  scrollbar-width: thin;
}

.contract-runs-group + .contract-runs-group {
  padding-top: 17px;
  margin-top: 18px;
  border-top: 1px solid #7a87801c;
}

.contract-runs-group__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px;
}

.contract-runs-group__header > div {
  display: flex;
  gap: 7px;
  align-items: center;
}

.contract-runs-group__header i {
  width: 7px;
  height: 7px;
  background: #7468cc;
  border: 2px solid #f2f4f2;
  border-radius: 50%;
  box-shadow: 0 0 0 3px #7468cc18;
}

.contract-runs-group__header h3 {
  margin: 0;
  color: #39463f;
  font-size: 11px;
  font-weight: 760;
  letter-spacing: -0.01em;
}

.contract-runs-group__header > span {
  display: inline-flex;
  gap: 3px;
  align-items: center;
  min-width: 30px;
  padding: 4px 7px;
  color: #6f668f;
  font-size: 7px;
  font-weight: 760;
  background: #7468cc0b;
  border: 1px solid #7468cc18;
  border-radius: 999px;
}

.contract-runs-group__description {
  margin: 6px 2px 10px;
  color: #939b96;
  font-size: 7.5px;
  line-height: 1.55;
}

.contract-runs-group.is-blocked .contract-runs-group__header i {
  background: #b66d3d;
  box-shadow: 0 0 0 3px #b66d3d1a;
}

.contract-runs-group.is-blocked .contract-runs-group__header > span {
  color: #9c5b31;
  background: #b66d3d0b;
  border-color: #b66d3d1b;
}

.contract-runs-list {
  display: grid;
  gap: 10px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.contract-runs-list li {
  --run-accent: #7468cc;
  --run-soft: #7568df0b;
  --run-border: #7568df18;
  --run-index: 0;

  position: relative;
  padding: 14px 15px 12px;
  overflow: hidden;
  opacity: 1;
  cursor: pointer;
  outline: none;
  background:
    radial-gradient(circle at 100% 0, var(--run-soft) 0, transparent 45%),
    linear-gradient(145deg, #fffffff2, #f1f5f2e8);
  border: 1px solid #ffffffd9;
  border-radius: 17px;
  box-shadow:
    0 7px 18px #71807814,
    0 2px 4px #7180780a,
    inset 0 0 0 1px var(--run-border);
  transform: translateX(0) scale(1);
  transition:
    opacity 0.34s ease calc(var(--run-index) * 72ms),
    border-color 0.24s ease,
    box-shadow 0.24s ease,
    transform 0.54s cubic-bezier(0.16, 1, 0.3, 1) calc(var(--run-index) * 72ms);
}

.contract-run-item-enter-from,
.contract-run-item-leave-to {
  opacity: 0 !important;
  transform: translateX(-28px) scale(0.98) !important;
}

.contract-run-item-leave-active {
  transition-delay: 0ms !important;
}

.contract-run-item-move {
  transition: transform 0.52s cubic-bezier(0.16, 1, 0.3, 1) !important;
}

.contract-runs-list__refresh-wash {
  position: absolute;
  z-index: 3;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    105deg,
    transparent 10%,
    color-mix(in srgb, var(--run-accent) 5%, #fff) 38%,
    color-mix(in srgb, var(--run-accent) 16%, #fff) 50%,
    color-mix(in srgb, var(--run-accent) 5%, #fff) 62%,
    transparent 90%
  );
  opacity: 0;
  transform: translateX(-115%);
}

.contract-runs-list li.is-data-updated .contract-runs-list__refresh-wash {
  animation: contract-run-data-update 0.76s cubic-bezier(0.22, 0.75, 0.25, 1) both;
}

.contract-runs-list li::before {
  position: absolute;
  inset: 17px auto 17px 0;
  width: 2px;
  content: '';
  background: linear-gradient(180deg, transparent, var(--run-accent), transparent);
  border-radius: 0 3px 3px 0;
  opacity: 0.72;
}

.contract-runs-list li::after {
  position: absolute;
  z-index: 2;
  inset: 0;
  padding: 2px;
  pointer-events: none;
  content: '';
  background: conic-gradient(
    from var(--run-edge-angle),
    transparent 0deg 196deg,
    color-mix(in srgb, var(--run-accent) 8%, transparent) 218deg,
    color-mix(in srgb, var(--run-accent) 72%, #fff) 252deg,
    #fff 268deg,
    var(--run-accent) 282deg,
    color-mix(in srgb, var(--run-accent) 16%, transparent) 318deg,
    transparent 342deg 360deg
  );
  border-radius: inherit;
  opacity: 0;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--run-accent) 38%, transparent));
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  transition: opacity 0.34s ease;
}

.contract-runs-list li.is-edge-active::after {
  opacity: 1;
  animation: contract-run-edge-marquee 2.35s linear infinite;
}

.contract-runs-list li:hover {
  border-color: color-mix(in srgb, var(--run-accent) 13%, #fff);
  box-shadow:
    0 8px 20px #64756b17,
    0 2px 5px #64756b0b,
    inset 0 1px 0 #fff,
    inset 0 0 22px var(--run-soft),
    inset 0 0 0 1px color-mix(in srgb, var(--run-accent) 18%, transparent);
}

.contract-runs-list li:focus-visible {
  border-color: color-mix(in srgb, var(--run-accent) 35%, #fff);
  box-shadow:
    0 8px 20px #64756b17,
    0 0 0 3px color-mix(in srgb, var(--run-accent) 13%, transparent),
    inset 0 0 0 1px color-mix(in srgb, var(--run-accent) 24%, transparent);
}

.contract-runs-list li.is-restoring {
  cursor: wait;
}

.contract-runs-groups.is-concealed li {
  opacity: 0;
  transform: translateX(-34px) scale(0.975);
  transition-delay: 0ms;
}

.contract-runs-list li.is-blocked {
  --run-accent: #ad683b;
  --run-soft: #b971410d;
  --run-border: #b971411d;
}

.contract-runs-list li.is-current {
  box-shadow:
    0 8px 20px #64756b17,
    0 2px 5px #64756b0b,
    inset 0 0 0 1px color-mix(in srgb, var(--run-accent) 32%, transparent);
}

.contract-runs-list li.is-current:hover {
  border-color: color-mix(in srgb, var(--run-accent) 18%, #fff);
  box-shadow:
    0 9px 21px #64756b19,
    0 2px 5px #64756b0b,
    inset 0 1px 0 #fff,
    inset 0 0 24px var(--run-soft),
    inset 0 0 0 1px color-mix(in srgb, var(--run-accent) 38%, transparent);
}

.contract-runs-list__top,
.contract-runs-list__state,
.contract-runs-list dl div {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.contract-runs-list__top {
  gap: 12px;
}

.contract-runs-list__document {
  position: relative;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 43px;
  height: 49px;
  color: var(--run-accent);
  background: color-mix(in srgb, var(--run-soft) 72%, #fff);
  border: 1px solid color-mix(in srgb, var(--run-accent) 12%, #fff);
  border-radius: 12px;
  box-shadow:
    inset 1px 1px 0 #fff,
    0 4px 10px color-mix(in srgb, var(--run-accent) 8%, transparent);
}

.contract-runs-list__document svg {
  width: 25px;
  fill: color-mix(in srgb, var(--run-accent) 5%, #fff);
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.25;
}

.contract-runs-list__document > i {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 9px;
  height: 9px;
  background: var(--run-accent);
  border: 2px solid #f7f9f7;
  border-radius: 50%;
  box-shadow: 0 2px 5px color-mix(in srgb, var(--run-accent) 25%, transparent);
}

.contract-runs-list li.is-restoring .contract-runs-list__document > i {
  background: transparent;
  border-color: color-mix(in srgb, var(--run-accent) 22%, #fff);
  border-top-color: var(--run-accent);
  animation: contract-runs-refresh 0.72s linear infinite;
}

.contract-runs-list__content {
  min-width: 0;
  flex: 1;
}

.contract-runs-list__content h3 {
  margin: 0;
  overflow: hidden;
  color: #303c35;
  font-size: 12px;
  font-weight: 730;
  letter-spacing: -0.015em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contract-runs-list__state {
  justify-content: flex-start;
  gap: 7px;
  margin-top: 8px;
}

.contract-runs-list__state > span {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  color: var(--run-accent);
  font-size: 8px;
  font-weight: 720;
}

.contract-runs-list__state > span > i {
  width: 5px;
  height: 5px;
  background: currentColor;
  border-radius: 50%;
  box-shadow: 0 0 0 3px var(--run-soft);
}

.contract-runs-list__state b {
  padding: 3px 6px;
  color: var(--run-accent);
  font-size: 7px;
  font-weight: 720;
  background: var(--run-soft);
  border: 1px solid var(--run-border);
  border-radius: 999px;
}

.contract-runs-list__activity {
  position: relative;
  height: 3px;
  margin: 12px 0 10px;
  overflow: hidden;
  background: color-mix(in srgb, var(--run-accent) 9%, transparent);
  border-radius: 999px;
}

.contract-runs-list__activity i {
  position: absolute;
  inset: 0;
  display: block;
  background: linear-gradient(90deg, transparent, var(--run-accent), transparent);
  opacity: 0.82;
  transform: translateX(-75%);
  animation: contract-run-activity 1.8s ease-in-out infinite;
}

.contract-runs-list li.is-blocked .contract-runs-list__activity i {
  background: repeating-linear-gradient(90deg, var(--run-accent) 0 7px, transparent 7px 12px);
  opacity: 0.62;
  transform: none;
  animation: contract-run-awaiting 1.35s ease-in-out infinite;
}

.contract-runs-list dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 0;
}

.contract-runs-list dl div {
  display: grid;
  justify-content: initial;
  gap: 3px;
}

.contract-runs-list dt,
.contract-runs-list dd {
  margin: 0;
  color: #9aa29e;
  font-size: 7px;
}

.contract-runs-list__restore-error {
  padding: 7px 9px;
  margin: 10px 0 0;
  color: #a45151;
  font-size: 7.5px;
  line-height: 1.5;
  background: #c958580b;
  border: 1px solid #c9585818;
  border-radius: 8px;
}

.contract-runs-list dd {
  color: #65716a;
  font-size: 8px;
  font-weight: 620;
  font-variant-numeric: tabular-nums;
}

.contract-runs-panel-enter-active,
.contract-runs-panel-leave-active {
  transition:
    opacity 0.24s ease,
    filter 0.3s ease,
    transform 0.38s cubic-bezier(0.16, 1, 0.3, 1);
}

.contract-runs-panel-enter-from,
.contract-runs-panel-leave-to {
  opacity: 0;
  filter: blur(7px);
  transform: translateY(-9px) scale(0.96);
}

@keyframes contract-runs-refresh {
  to { transform: rotate(360deg); }
}

@property --run-edge-angle {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}

@keyframes contract-run-edge-marquee {
  to { --run-edge-angle: 360deg; }
}

@keyframes contract-capybara-leg {
  0%, 100% { transform: rotate(-45deg) translateX(-5%); }
  50% { transform: rotate(45deg) translateX(5%); }
}

@keyframes contract-capybara-leg-back {
  0%, 100% { transform: rotate(45deg); }
  50% { transform: rotate(-45deg); }
}

@keyframes contract-capybara-body {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(2%); }
}

@keyframes contract-capybara-line {
  0% {
    opacity: 0;
    transform: translateX(0);
  }
  5%, 95% { opacity: 1; }
  100% {
    opacity: 0;
    transform: translateX(-70%);
  }
}

@keyframes contract-run-activity {
  0% { transform: translateX(-78%); }
  58%, 100% { transform: translateX(78%); }
}

@keyframes contract-run-awaiting {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.85; }
}

@keyframes contract-run-data-update {
  0% {
    opacity: 0;
    transform: translateX(-115%);
  }
  34% { opacity: 0.72; }
  100% {
    opacity: 0;
    transform: translateX(115%);
  }
}

.contract-ingestion__viewport {
  position: relative;
  display: flex;
  align-items: stretch;
  flex: 1;
  min-height: 0;
  overflow: auto hidden;
  overscroll-behavior-x: contain;
  scrollbar-color: #7165d734 transparent;
  scrollbar-width: thin;
}

.contract-ingestion__viewport.is-switching-out {
  pointer-events: none;
  will-change: opacity, transform;
  animation: workflow-scene-leave-up 0.44s cubic-bezier(0.4, 0, 0.7, 0.2) both;
}

.contract-ingestion__viewport.is-switching-in {
  pointer-events: none;
  will-change: opacity, transform;
  animation: workflow-scene-enter-from-bottom 0.58s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes workflow-scene-leave-up {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(-96px) scale(0.985);
  }
}

@keyframes workflow-scene-enter-from-bottom {
  from {
    opacity: 0;
    transform: translateY(54px) scale(0.982);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.workflow-canvas {
  position: relative;
  flex: 0 0 auto;
  width: 100%;
  min-width: 2580px;
  height: 620px;
  min-height: 100%;
  overflow: hidden;
  background-image: radial-gradient(circle, #68766e17 0.7px, transparent 0.8px);
  background-size: 24px 24px;
}

.workflow-scroll-extension {
  flex: 0 0 auto;
  height: 100%;
  pointer-events: none;
  transition: width 0.48s cubic-bezier(0.16, 1, 0.3, 1);
}

.workflow-canvas__content {
  position: absolute;
  top: 50%;
  left: 0;
  width: 100%;
  height: 620px;
  transform: translateY(-50%);
}

.workflow-canvas__glow {
  position: absolute;
  z-index: 0;
  width: 300px;
  height: 300px;
  pointer-events: none;
  border-radius: 50%;
  filter: blur(10px);
}

.workflow-canvas__glow--one {
  top: 35px;
  left: 50.71%;
  background: radial-gradient(circle, #7266dc12, transparent 70%);
}

.workflow-canvas__glow--two {
  right: 20px;
  bottom: 16px;
  background: radial-gradient(circle, #65aa8710, transparent 70%);
}

.workflow-links {
  position: absolute;
  z-index: 1;
  inset: 0;
  width: 100%;
  height: 620px;
  overflow: visible;
  pointer-events: none;
}

.workflow-link path {
  fill: none;
  stroke-linecap: round;
}

.workflow-link__bed {
  stroke: #7c89822f;
  stroke-width: 1.6;
}

.workflow-link__signal {
  stroke: #a3aaa6;
  stroke-width: 1.9;
  transition:
    stroke 0.72s cubic-bezier(0.22, 1, 0.36, 1),
    stroke-width 0.72s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.52s,
    filter 0.52s;
}

.workflow-link__comet {
  opacity: 0;
  stroke: #8f80ff;
  stroke-width: 5.4;
  stroke-dasharray: 12 88;
  stroke-dashoffset: 100;
  transition: opacity 0.42s, stroke 0.52s, stroke-width 0.52s;
}

.workflow-link.is-waiting .workflow-link__signal {
  opacity: 0.24;
  stroke-dasharray: 2 8;
}

.workflow-link.is-running .workflow-link__signal {
  stroke: #6557d6;
  stroke-width: 2.6;
  stroke-dasharray: 100 100;
  filter: url(#flow-glow);
  animation: flow-reveal 0.62s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.workflow-link.is-running .workflow-link__comet {
  opacity: 1;
  filter: url(#flow-glow);
  animation: flow-comet 1.05s linear infinite;
}

.workflow-link.is-success .workflow-link__signal {
  stroke: #59a77d;
  stroke-width: 2.15;
  stroke-dasharray: none;
  filter: url(#flow-glow);
  animation: flow-success-settle 0.92s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.workflow-link.is-success .workflow-link__comet {
  stroke: #a8e8c2;
  stroke-width: 4.8;
  stroke-dasharray: 14 86;
  filter: url(#flow-glow);
  animation: flow-success-sweep 0.82s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.workflow-link.is-failed .workflow-link__signal {
  opacity: 0.3;
  stroke: #d5786c;
  stroke-width: 1.6;
  stroke-dasharray: none;
  animation: flow-failure-settle 0.78s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.workflow-link.is-failed .workflow-link__comet {
  opacity: 0.78;
  stroke: #d5786c;
  stroke-width: 2.1;
  stroke-dasharray: 4 7;
  stroke-dashoffset: 0;
  filter: none;
  animation: flow-failure-texture 0.68s ease-out both;
}

.workflow-link.is-retracting .workflow-link__signal {
  opacity: 0.9;
  stroke: #796de0;
  stroke-width: 2.5;
  stroke-dasharray: 100 100;
  filter: url(#flow-glow);
  animation: flow-retract 0.9s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.workflow-link.is-retracting .workflow-link__comet {
  opacity: 0.9;
  stroke: #b0a7f5;
  stroke-width: 4.2;
  stroke-dasharray: 10 90;
  filter: url(#flow-glow);
  animation: flow-retract-comet 0.72s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.workflow-input-node,
.workflow-stage-node,
.workflow-result-node {
  position: absolute;
  z-index: 2;
  cursor: pointer;
  outline: none;
}

.workflow-input-node__document:focus-visible,
.workflow-stage-node:focus-visible,
.workflow-result-node:focus-visible {
  box-shadow: 0 0 0 4px #7467dc28;
}

.workflow-input-node {
  top: 321px;
  right: 87.56%;
  width: var(--upload-card-width, 252px);
  padding: 0;
  cursor: default;
  border-radius: 17px;
  transform: translateY(-50%);
  transition: width 0.32s cubic-bezier(0.16, 1, 0.3, 1);
}

.workflow-input-node__document {
  cursor: pointer;
  border-radius: 17px;
  outline: none;
  transition: transform 0.38s cubic-bezier(0.16, 1, 0.3, 1);
}

.workflow-input-node__document:hover {
  transform: translateY(-5px) rotate(-0.6deg);
}

.workflow-upload-card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  height: 286px;
  padding: 10px;
  background: #7568df0a;
  border: 1px solid #ffffffd9;
  border-radius: 15px;
  box-shadow:
    0 19px 38px #31443a1c,
    0 4px 10px #27362f12,
    inset 0 1px #fff;
  transition: background 0.28s ease, box-shadow 0.28s ease;
}

.workflow-upload-card.is-filled {
  height: auto;
}

.workflow-input-node__document:hover .workflow-upload-card {
  background: #7568df10;
  box-shadow:
    0 23px 42px #31443a22,
    0 5px 12px #27362f14,
    inset 0 1px #fff;
}

.workflow-upload-card__header {
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 7px;
  align-items: center;
  justify-content: center;
  width: 100%;
  color: #4d5a53;
  background:
    radial-gradient(circle at 50% 43%, #7568df13, transparent 38%),
    #ffffff70;
  border: 1.5px dashed #7568df8a;
  border-radius: 11px;
  transition: color 0.28s ease, background 0.28s ease, border-color 0.28s ease;
}

.workflow-upload-card.is-filled .workflow-upload-card__header {
  flex: 0 0 auto;
  aspect-ratio: var(--pdf-cover-ratio, 0.7727);
  max-height: 260px;
  overflow: hidden;
  background: #f5f7f6;
}

.workflow-input-node__document:hover .workflow-upload-card__header {
  color: #6458c6;
  background:
    radial-gradient(circle at 50% 43%, #7568df1b, transparent 42%),
    #ffffff94;
  border-color: #6f62d8;
}

.workflow-upload-card__header > svg {
  width: 86px;
  height: 86px;
  fill: none;
  stroke: #6256c3;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.35;
  filter: drop-shadow(0 8px 13px #584ca322);
  transform: translateY(0);
  transition: filter 0.3s ease, transform 0.42s cubic-bezier(0.16, 1, 0.3, 1);
}

.workflow-input-node__document:hover .workflow-upload-card__header > svg {
  filter: drop-shadow(0 11px 16px #584ca335);
  transform: translateY(-5px);
}

.workflow-upload-card__header strong {
  font-size: 12px;
  font-weight: 750;
  letter-spacing: -0.01em;
}

.workflow-upload-card__header small {
  color: #929b96;
  font-size: 8px;
}

.workflow-upload-card__cover {
  opacity: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #fff;
}

.workflow-upload-card__cover.is-visible {
  opacity: 1;
  transition: opacity .6s ease;
}
@media (prefers-reduced-motion: reduce) {
  .workflow-upload-card__cover.is-visible { transition: none; }
}

.workflow-upload-card__footer {
  box-sizing: border-box;
  display: flex;
  flex: 0 0 46px;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 7px 9px;
  color: #435149;
  background: #7568df0f;
  border: 1px solid #7568df12;
  border-radius: 10px;
}

.workflow-upload-card__footer p {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 9px;
  font-weight: 650;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-upload-card__clear-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 28px;
  height: 28px;
  color: #87918c;
  background: #ffffffa6;
  border: 1px solid #7568df15;
  border-radius: 50%;
  box-shadow: 0 4px 12px #47405f12;
}

.workflow-upload-card__clear-icon {
  cursor: pointer;
  outline: none;
  transition: color 0.2s ease, background 0.2s ease, transform 0.2s ease;
}

.workflow-upload-card__clear-icon:not(.is-disabled):hover,
.workflow-upload-card__clear-icon:not(.is-disabled):focus-visible {
  color: #fff;
  background: #d57068;
  transform: scale(1.05);
}

.workflow-upload-card__clear-icon.is-disabled {
  color: #aeb5b1;
  cursor: default;
  opacity: 0.48;
}

.workflow-upload-card__clear-icon svg {
  width: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.55;
}

.workflow-input-node__restored {
  position: absolute;
  z-index: 2;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
  align-items: center;
  justify-content: center;
  color: #68756e;
  text-align: center;
}

.workflow-input-node__restored > span {
  position: relative;
  display: grid;
  place-items: center;
  width: 58px;
  height: 68px;
  color: #6d61cb;
  background: #ffffffb8;
  border: 1px solid #7568df1c;
  border-radius: 11px 16px 11px 11px;
  box-shadow: 0 12px 26px #4f466f16, inset 0 1px #fff;
}

.workflow-input-node__restored svg {
  width: 33px;
  fill: #7568df08;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.4;
}

.workflow-input-node__restored > span > i {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 11px;
  height: 11px;
  background: #5d9b78;
  border: 3px solid #f6f8f7;
  border-radius: 50%;
  box-shadow: 0 2px 7px #47765c35;
}

.workflow-input-node__restored strong {
  font-size: 10px;
  font-weight: 760;
}

.workflow-input-node__restored small {
  color: #99a29d;
  font-size: 7px;
}

.workflow-input-node__cover-loading {
  position: absolute;
  z-index: 3;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  background: linear-gradient(145deg, #fbfcfc, #f0f3f2);
  opacity: 1;
  visibility: visible;
  transition: opacity 0.2s ease, visibility 0.2s;
}

.workflow-input-node__cover-loading.is-hidden {
  opacity: 0;
  visibility: hidden;
}

.workflow-input-node__cover-loading > span {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 54%;
  padding: 18px 14px;
  background: #fff;
  border: 1px solid #66756d12;
  border-radius: 8px;
  box-shadow: 0 10px 24px #34463c0d;
}

.workflow-input-node__cover-loading i {
  display: block;
  height: 4px;
  overflow: hidden;
  background: #69766f12;
  border-radius: 999px;
}

.workflow-input-node__cover-loading i::after {
  display: block;
  width: 55%;
  height: 100%;
  content: '';
  background: linear-gradient(90deg, transparent, #7568df42, transparent);
  transform: translateX(-120%);
  animation: pdf-cover-skeleton 1.05s ease-in-out infinite;
}

.workflow-input-node__cover-loading i:nth-child(2) { width: 82%; }
.workflow-input-node__cover-loading i:nth-child(3) { width: 64%; }

.workflow-input-node__file-type {
  position: absolute;
  z-index: 4;
  top: 10px;
  left: 10px;
  padding: 4px 6px;
  color: #fff;
  font-size: 7px;
  font-weight: 800;
  letter-spacing: 0.08em;
  background: #d66359;
  border-radius: 5px;
  box-shadow: 0 4px 10px #aa44343d;
}

.workflow-input-node__file-type.is-image {
  background: #5e76c8;
  box-shadow: 0 4px 10px #4059a53d;
}

.workflow-stage-node {
  --stage-color: #a7afaa;
  --stage-color-soft: #a7afaa12;
  width: 235px;
  min-height: 168px;
  padding: 18px 18px 16px;
  overflow: visible;
  background:
    radial-gradient(circle at 8% 16%, var(--stage-color-soft), transparent 35%),
    linear-gradient(145deg, #fffffff7, #f6f9f8eb),
    #fff;
  border: 1px solid color-mix(in srgb, var(--stage-color) 16%, #ffffff);
  border-radius: 22px;
  box-shadow:
    0 17px 38px #31443a13,
    0 3px 9px #31443a08,
    inset 0 1px #ffffff,
    inset 0 0 0 1px #4f5f5608;
  transition:
    transform 0.38s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.3s,
    border-color 0.3s,
    background 0.3s;
}

.workflow-stage-node.is-running,
.workflow-stage-node.is-retrying {
  --stage-color: #7568df;
  --stage-color-soft: #7568df18;
}

.workflow-stage-node.is-success {
  --stage-color: #55a379;
  --stage-color-soft: #55a37914;
}

.workflow-stage-node.is-failed {
  --stage-color: #d9776c;
  --stage-color-soft: #d9776c17;
}

.workflow-stage-node.is-rejected {
  --stage-color: #d49a55;
  --stage-color-soft: #d49a5519;
}

.workflow-stage-node:hover,
.workflow-stage-node.is-selected {
  z-index: 3;
  border-color: color-mix(in srgb, var(--stage-color) 29%, #ffffff);
  transform: translateY(-5px) scale(1.012);
  box-shadow:
    0 25px 52px #2e423722,
    0 6px 14px var(--stage-color-soft),
    inset 0 1px #ffffff,
    inset 0 0 0 1px var(--stage-color-soft);
}

.workflow-stage-node--detection { top: 237px; left: 13.45%; width: 9.66%; }
.workflow-stage-node--duplication { top: 237px; left: 25.63%; width: 9.66%; }
.workflow-stage-node--preprocessing { top: 237px; left: 37.82%; width: 9.66%; }
.workflow-stage-node--classification { top: 237px; left: 50%; width: 9.66%; }
.workflow-stage-node--overview { top: 237px; left: 62.18%; width: 9.66%; }
.workflow-stage-node--field { top: 60px; left: 74.37%; width: 11.34%; }
.workflow-stage-node--clause { top: 237px; left: 74.37%; width: 11.34%; }
.workflow-stage-node--retrieval { top: 414px; left: 74.37%; width: 11.34%; }

.workflow-stage-node::before {
  position: absolute;
  z-index: 2;
  top: 50%;
  left: -5px;
  width: 10px;
  height: 10px;
  content: '';
  background: var(--stage-color);
  border: 3px solid #f8faf9;
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--stage-color-soft), 0 3px 8px #33443b21;
  transform: translateY(-50%);
  transition: background 0.3s, box-shadow 0.3s, transform 0.3s;
}

.workflow-stage-node::after {
  position: absolute;
  z-index: 2;
  top: 50%;
  right: -5px;
  width: 10px;
  height: 10px;
  content: '';
  background: var(--stage-color);
  border: 3px solid #f8faf9;
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--stage-color-soft), 0 3px 8px #33443b21;
  transform: translateY(-50%);
  transition: background 0.3s, box-shadow 0.3s, transform 0.3s;
}

.workflow-stage-node:hover::before,
.workflow-stage-node:hover::after,
.workflow-stage-node.is-selected::before,
.workflow-stage-node.is-selected::after {
  transform: translateY(-50%) scale(1.18);
}

.workflow-stage-node.is-running::before,
.workflow-stage-node.is-running::after,
.workflow-stage-node.is-retrying::before,
.workflow-stage-node.is-retrying::after {
  animation: port-relay 1.05s ease-in-out infinite;
}

.workflow-stage-node.is-running::after,
.workflow-stage-node.is-retrying::after {
  animation-delay: 0.2s;
}

.workflow-stage-node__topline,
.workflow-stage-node__footer,
.workflow-stage-node__body,
.workflow-stage-node__state {
  display: flex;
  align-items: center;
}

.workflow-stage-node__topline {
  position: absolute;
  z-index: 2;
  top: 18px;
  right: 18px;
  margin: 0;
  color: #9ba29e;
  font-size: 9.5px;
  font-weight: 720;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.workflow-stage-node__state {
  gap: 6px;
  padding: 5px 9px;
  color: #929b96;
  font-size: 9px;
  font-weight: 680;
  letter-spacing: 0;
  background: #79857e0a;
  border: 1px solid #69776f0a;
  border-radius: 999px;
  transition: color 0.3s, background 0.3s, border-color 0.3s;
}

.workflow-stage-node__state i {
  width: 6px;
  height: 6px;
  background: #aeb5b1;
  border-radius: 50%;
}

.workflow-stage-node.is-running .workflow-stage-node__state,
.workflow-stage-node.is-retrying .workflow-stage-node__state {
  color: #6659ca;
  background: #7568df0d;
  border-color: #7568df12;
}
.workflow-stage-node.is-running .workflow-stage-node__state i,
.workflow-stage-node.is-retrying .workflow-stage-node__state i {
  background: #7568df;
  box-shadow: 0 0 0 4px #7568df16;
  animation: ingestion-pulse 1.5s ease-in-out infinite;
}
.workflow-stage-node.is-success .workflow-stage-node__state {
  color: #468b67;
  background: #55a3790c;
  border-color: #55a37910;
}
.workflow-stage-node.is-success .workflow-stage-node__state i { background: #55a379; }
.workflow-stage-node.is-failed .workflow-stage-node__state {
  color: #bd6259;
  background: #d9776c0d;
  border-color: #d9776c12;
}
.workflow-stage-node.is-failed .workflow-stage-node__state i { background: #d9776c; }

.workflow-stage-node.is-rejected .workflow-stage-node__state {
  color: #9b6b32;
  background: #d49a550e;
  border-color: #d49a5517;
}

.workflow-stage-node.is-rejected .workflow-stage-node__state i { background: #d49a55; }

.workflow-stage-node__body {
  display: block;
}

.workflow-stage-node__body > div {
  min-width: 0;
  margin-top: 12px;
}

.workflow-stage-node__icon {
  position: relative;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  color: #65726b;
  background: linear-gradient(145deg, #f2f5f4, #e8eeeb);
  border: 1px solid #ffffff;
  border-radius: 14px;
  box-shadow:
    0 5px 12px #34463c0c,
    inset 0 0 0 1px #45584e0b,
    inset 0 1px #fff;
  transition: color 0.3s, background 0.3s, transform 0.35s;
}

.workflow-stage-node:hover .workflow-stage-node__icon {
  transform: rotate(-2deg) scale(1.04);
}

.workflow-stage-node .workflow-stage-node__icon.has-duplication-loader,
.workflow-stage-node:hover .workflow-stage-node__icon.has-duplication-loader {
  width: 96px;
  height: 44px;
  overflow: hidden;
  background: linear-gradient(145deg, #fff, #7568df0d);
  border-color: #7568df20;
  transform: none;
}

.workflow-stage-node .workflow-stage-node__icon.has-structure-loader,
.workflow-stage-node:hover .workflow-stage-node__icon.has-structure-loader {
  width: 78px;
  height: 48px;
  overflow: visible;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  transform: none;
}

.workflow-stage-node .workflow-stage-node__icon.has-classification-loader,
.workflow-stage-node:hover .workflow-stage-node__icon.has-classification-loader {
  width: 104px;
  height: 50px;
  overflow: visible;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  transform: none;
}

.workflow-duplication-loader {
  display: grid;
  place-items: center;
  width: 88px;
  height: 40px;
  animation: duplication-loader-enter 0.42s cubic-bezier(0.16, 1, 0.3, 1) both;
  will-change: opacity, filter, transform;
}

.workflow-duplication-loader.is-leaving {
  pointer-events: none;
  animation: duplication-loader-leave 0.38s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.workflow-duplication-loader__mini {
  position: relative;
  display: flex;
  align-items: center;
  width: 78px;
  height: 34px;
}

.workflow-duplication-loader__bars {
  display: flex;
  flex-direction: column;
  gap: 7px;
  align-items: flex-start;
  justify-content: center;
  width: 68px;
  margin-left: 6px;
}

.workflow-duplication-loader__bars i {
  width: 100%;
  height: 5px;
  background: linear-gradient(90deg, #7568df, #d9d2ff, #7568df);
  background-size: 200% 100%;
  border-radius: 999px;
  box-shadow: 0 2px 5px #6659ca13;
  animation: duplication-loader-bars 3s ease-in-out infinite alternate-reverse;
}

.workflow-duplication-loader__bars i:last-child {
  width: 52%;
}

.workflow-stage-node__icon .workflow-duplication-loader svg {
  position: absolute;
  z-index: 2;
  top: -3px;
  left: -5px;
  width: 38px;
  height: 43px;
  overflow: visible;
  fill: none;
  stroke: #8b54e8;
  stroke-linecap: round;
  stroke-width: 7;
  filter: drop-shadow(0 3px 4px #7347ba2e);
  animation: duplication-loader-search 3s ease-in-out infinite alternate-reverse;
}

.workflow-stage-node__icon .workflow-duplication-loader circle {
  fill: #7550aa26;
}

.workflow-structure-loader {
  position: relative;
  display: grid;
  place-items: center;
  width: 74px;
  height: 46px;
  animation: duplication-loader-enter 0.42s cubic-bezier(0.16, 1, 0.3, 1) both;
  will-change: opacity, filter, transform;
}

.workflow-structure-loader.is-leaving {
  pointer-events: none;
  animation: duplication-loader-leave 0.38s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.workflow-structure-loader::before,
.workflow-structure-loader::after {
  position: absolute;
  z-index: 0;
  right: 8px;
  bottom: 3px;
  left: 8px;
  height: 20px;
  content: '';
  border-radius: 50%;
  box-shadow: 0 11px 9px #5145b842;
  transform: rotate(-5deg);
}

.workflow-structure-loader::after {
  transform: rotate(5deg);
}

.workflow-structure-loader__book {
  position: relative;
  z-index: 1;
  display: block;
  width: 66px;
  height: 44px;
  overflow: hidden;
  background: linear-gradient(135deg, #8b79ed, #5c50bd);
  border: 1px solid #ffffff59;
  border-radius: 7px;
  box-shadow:
    0 5px 10px #5145b833,
    inset 0 1px #ffffff52;
  perspective: 300px;
}

.workflow-structure-loader__book::after {
  position: absolute;
  z-index: 3;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  content: '';
  background: #463b9d55;
  box-shadow: 0 0 5px #2e276f52;
}

.workflow-structure-loader__book ul {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 0;
  margin: 0;
  list-style: none;
}

.workflow-structure-loader__book li {
  --page-rotation: 180deg;
  --page-opacity: 0;
  position: absolute;
  top: 4px;
  left: 5px;
  width: 28px;
  height: 36px;
  color: #ffffff8f;
  opacity: var(--page-opacity);
  transform: rotateY(var(--page-rotation));
  transform-origin: 100% 50%;
  animation-duration: 3s;
  animation-timing-function: ease;
  animation-iteration-count: infinite;
}

.workflow-structure-loader__book li:first-child {
  --page-rotation: 0deg;
  --page-opacity: 1;
}

.workflow-structure-loader__book li:last-child { --page-opacity: 1; }
.workflow-structure-loader__book li:nth-child(2) { animation-name: structure-page-two; }
.workflow-structure-loader__book li:nth-child(3) { animation-name: structure-page-three; }
.workflow-structure-loader__book li:nth-child(4) { animation-name: structure-page-four; }
.workflow-structure-loader__book li:nth-child(5) { animation-name: structure-page-five; }

.workflow-stage-node__icon .workflow-structure-loader svg {
  display: block;
  width: 28px;
  height: 36px;
  fill: currentColor;
  stroke: none;
  filter: drop-shadow(0 1px 1px #31297433);
}

.workflow-classification-loader {
  position: relative;
  display: block;
  width: 96px;
  height: 48px;
  overflow: visible;
  filter: drop-shadow(0 6px 8px #5046a522);
  animation: duplication-loader-enter 0.42s cubic-bezier(0.16, 1, 0.3, 1) both;
  will-change: opacity, filter, transform;
}

.workflow-classification-loader.is-leaving {
  pointer-events: none;
  animation: duplication-loader-leave 0.38s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.workflow-stage-node__icon .workflow-classification-loader__routes {
  position: absolute;
  inset: 0;
  width: 96px;
  height: 48px;
  overflow: visible;
  fill: none;
  stroke: #776bd06b;
  stroke-width: 1.1;
  stroke-dasharray: 3 4;
  stroke-linecap: round;
  filter: none;
  animation: classification-route-flow 1.4s linear infinite;
}

.workflow-classification-loader__source {
  position: absolute;
  top: 14px;
  left: 2px;
  width: 16px;
  height: 20px;
}

.workflow-classification-loader__source i {
  position: absolute;
  inset: 0;
  background: linear-gradient(145deg, #fff, #e8e5fb);
  border: 1px solid #7568df42;
  border-radius: 3px;
  box-shadow: 0 2px 4px #4037841c;
}

.workflow-classification-loader__source i::before,
.workflow-classification-loader__document i::before,
.workflow-classification-loader__document i::after {
  position: absolute;
  right: 3px;
  left: 3px;
  height: 1px;
  content: '';
  background: #7468c75c;
  border-radius: 999px;
}

.workflow-classification-loader__source i::before { top: 6px; }
.workflow-classification-loader__source i:nth-child(2) { transform: translate(-2px, 2px); opacity: 0.58; }
.workflow-classification-loader__source i:nth-child(3) { transform: translate(-4px, 4px); opacity: 0.3; }

.workflow-classification-loader__scanner {
  position: absolute;
  z-index: 3;
  top: 13px;
  left: 38px;
  width: 19px;
  height: 22px;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 45%, #ffffff78, transparent 46%),
    linear-gradient(145deg, #9185ec, #5b50ba);
  border: 1px solid #ffffff70;
  border-radius: 7px;
  box-shadow:
    0 5px 9px #50469d34,
    inset 0 1px #ffffff5c;
}

.workflow-classification-loader__scanner::before {
  position: absolute;
  inset: 4px;
  content: '';
  border: 1px solid #ffffff52;
  border-radius: 4px;
}

.workflow-classification-loader__scanner i:first-child {
  position: absolute;
  z-index: 2;
  top: 2px;
  bottom: 2px;
  left: 3px;
  width: 2px;
  background: linear-gradient(180deg, transparent, #d9ffef, transparent);
  border-radius: 999px;
  box-shadow: 0 0 6px #c7ffe8;
  animation: classification-scan 1.1s ease-in-out infinite alternate;
}

.workflow-classification-loader__scanner i:last-child {
  position: absolute;
  right: 4px;
  bottom: 4px;
  left: 4px;
  height: 2px;
  background: #ffffff47;
  border-radius: 999px;
}

.workflow-classification-loader__bin {
  position: absolute;
  z-index: 2;
  right: 1px;
  width: 18px;
  height: 12px;
  overflow: hidden;
  background: #ffffffc7;
  border: 1px solid currentColor;
  border-radius: 4px;
  box-shadow: 0 3px 6px #3b345f17, inset 0 1px #fff;
}

.workflow-classification-loader__bin::before {
  position: absolute;
  top: 2px;
  right: 3px;
  left: 3px;
  height: 2px;
  content: '';
  background: currentColor;
  border-radius: 999px;
  opacity: 0.55;
}

.workflow-classification-loader__bin i {
  position: absolute;
  right: 3px;
  bottom: 2px;
  left: 3px;
  height: 2px;
  background: currentColor;
  border-radius: 999px;
  opacity: 0.24;
}

.workflow-classification-loader__bin.is-top { top: 1px; color: #ef8fa4; animation: classification-bin-pulse 2.4s ease 1.68s infinite; }
.workflow-classification-loader__bin.is-middle { top: 18px; color: #6cbba1; animation: classification-bin-pulse 2.4s ease 2.48s infinite; }
.workflow-classification-loader__bin.is-bottom { top: 35px; color: #8d7ce0; animation: classification-bin-pulse 2.4s ease 3.28s infinite; }

.workflow-classification-loader__document {
  position: absolute;
  z-index: 4;
  top: 0;
  left: 0;
  width: 11px;
  height: 14px;
  overflow: hidden;
  background: linear-gradient(145deg, #fff, #eeeafd);
  border: 1px solid #7568df73;
  border-radius: 2.5px;
  box-shadow: 0 3px 6px #473e922c;
  opacity: 0;
  animation-duration: 2.4s;
  animation-timing-function: cubic-bezier(0.45, 0, 0.2, 1);
  animation-iteration-count: infinite;
  will-change: transform, opacity;
}

.workflow-classification-loader__document i::before { top: 4px; }
.workflow-classification-loader__document i::after { top: 8px; right: 5px; }
.workflow-classification-loader__document.is-first { animation-name: classification-sort-top; }
.workflow-classification-loader__document.is-second { animation-name: classification-sort-middle; animation-delay: 0.8s; }
.workflow-classification-loader__document.is-third { animation-name: classification-sort-bottom; animation-delay: 1.6s; }

.is-running .workflow-stage-node__icon,
.is-retrying .workflow-stage-node__icon {
  color: #6659ca;
  background: #7467dc10;
}

.is-success .workflow-stage-node__icon {
  color: #3f8b63;
  background: #58a77c10;
}

.is-failed .workflow-stage-node__icon {
  color: #bd6259;
  background: #d9776c10;
}

.is-rejected .workflow-stage-node__icon {
  color: #a36d2f;
  background: #d49a5512;
}

.workflow-stage-node__icon .workflow-stage-node__document-rejected {
  width: 27px;
  height: 27px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
  animation: document-rejected-enter 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.workflow-stage-node__icon svg {
  width: 21px;
  height: 21px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.45;
}

.workflow-stage-node__cube-spinner {
  position: relative;
  width: 18px;
  height: 18px;
  animation: workflow-stage-cube 2s infinite ease;
  transform-style: preserve-3d;
  will-change: transform;
}

.workflow-stage-node__cube-spinner > i {
  position: absolute;
  width: 100%;
  height: 100%;
  background: #7568df30;
  border: 1px solid #7568df;
}

.workflow-stage-node__cube-spinner i:nth-of-type(1) {
  transform: translateZ(-9px) rotateY(180deg);
}

.workflow-stage-node__cube-spinner i:nth-of-type(2) {
  transform: rotateY(-270deg) translateX(50%);
  transform-origin: top right;
}

.workflow-stage-node__cube-spinner i:nth-of-type(3) {
  transform: rotateY(270deg) translateX(-50%);
  transform-origin: center left;
}

.workflow-stage-node__cube-spinner i:nth-of-type(4) {
  transform: rotateX(90deg) translateY(-50%);
  transform-origin: top center;
}

.workflow-stage-node__cube-spinner i:nth-of-type(5) {
  transform: rotateX(-90deg) translateY(50%);
  transform-origin: bottom center;
}

.workflow-stage-node__cube-spinner i:nth-of-type(6) {
  transform: translateZ(9px);
}

.workflow-stage-node__icon .workflow-stage-node__apple-success {
  width: 27px;
  height: 27px;
  overflow: visible;
}

.workflow-stage-node__success-halo {
  fill: none;
  stroke: #55a379;
  stroke-width: 1.2;
  opacity: 0;
  transform-origin: center;
  animation: apple-success-halo 0.72s ease-out 0.2s both;
}

.workflow-stage-node__success-disc {
  fill: #55a379;
  stroke: none;
  transform-origin: center;
  animation: apple-success-disc 0.62s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.workflow-stage-node__success-check {
  fill: none;
  stroke: #fff;
  stroke-dasharray: 13;
  stroke-dashoffset: 13;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
  animation: apple-success-check 0.5s cubic-bezier(0.65, 0, 0.35, 1) 0.28s forwards;
}

.workflow-stage-node__icon .workflow-stage-node__failure {
  width: 27px;
  height: 27px;
  overflow: visible;
  animation: workflow-failure-nudge 0.42s ease-out 0.52s both;
}

.workflow-stage-node__failure-halo {
  fill: none;
  stroke: #d9776c;
  stroke-width: 1.2;
  opacity: 0;
  transform-origin: center;
  animation: workflow-failure-halo 0.72s ease-out 0.2s both;
}

.workflow-stage-node__failure-disc {
  fill: #d9776c;
  stroke: none;
  transform-origin: center;
  animation: workflow-failure-disc 0.58s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.workflow-stage-node__failure-cross {
  fill: none;
  stroke: #fff;
  stroke-dasharray: 10;
  stroke-dashoffset: 10;
  stroke-linecap: round;
  stroke-width: 2;
  animation: workflow-failure-cross 0.34s cubic-bezier(0.65, 0, 0.35, 1) forwards;
}

.workflow-stage-node__failure-cross--first {
  animation-delay: 0.24s;
}

.workflow-stage-node__failure-cross--second {
  animation-delay: 0.37s;
}

.workflow-stage-node__body h3,
.workflow-stage-node__body p {
  margin: 0;
}

.workflow-stage-node__body h3 {
  font-size: 16px;
  font-weight: 770;
  letter-spacing: -0.01em;
}

.workflow-stage-node__body p {
  margin-top: 6px;
  overflow: hidden;
  color: #909994;
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-stage-node__footer {
  gap: 10px;
  padding-right: 92px;
  margin-top: 14px;
  color: #909994;
  font-size: 9.5px;
}

.workflow-stage-node__timer {
  position: absolute;
  z-index: 2;
  right: 18px;
  bottom: 16px;
  min-width: 82px;
  color: #7f8984;
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
  font-weight: 650;
  letter-spacing: 0.01em;
  text-align: right;
  opacity: 1;
  transition: color 0.3s, opacity 0.34s ease, filter 0.34s ease, transform 0.34s ease;
}

.workflow-stage-node.is-running .workflow-stage-node__timer,
.workflow-stage-node.is-retrying .workflow-stage-node__timer {
  color: #6c61c9;
}

.workflow-stage-node__timer.is-fading {
  opacity: 0;
  filter: blur(2px);
  transform: translateY(3px);
}

.workflow-stage-node__progress {
  --progress-color: #a8afab;
  flex: 1;
  height: 7px;
  overflow: hidden;
  padding: 0;
  background: #5c6b630d;
  border: 1px solid #5c6b6312;
  border-radius: 999px;
  box-shadow: inset 0 1px 2px #4150480b;
}

.workflow-stage-node__progress span {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--progress-color) 82%, #fff),
    var(--progress-color)
  );
  border-radius: inherit;
  transform: scaleX(var(--stage-progress, 0));
  transform-origin: left center;
  transition: transform 1.05s cubic-bezier(0.16, 1, 0.3, 1), background 0.3s;
  will-change: transform;
}

.workflow-stage-node__progress.is-retracting span {
  transition: transform 0.9s cubic-bezier(0.4, 0, 0.2, 1);
}

.workflow-stage-node__progress span::after {
  position: absolute;
  inset: 0;
  content: '';
  background: linear-gradient(105deg, transparent 18%, #ffffffbf 50%, transparent 82%);
  transform: translateX(-130%);
}

.workflow-stage-node__progress.is-finalizing span {
  transform: scaleX(1) !important;
  background: linear-gradient(90deg, #6659ce, #a297f2, #6659ce);
  background-size: 220% 100%;
  animation: stage-finalizing 1.25s linear infinite;
}

.is-running .workflow-stage-node__progress:not(.is-finalizing) span::after,
.is-retrying .workflow-stage-node__progress:not(.is-finalizing) span::after {
  animation: stage-progress-glint 1.55s ease-in-out infinite;
}

.workflow-stage-node__count {
  min-width: 44px;
  color: #9aa29e;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.workflow-stage-node__count strong {
  color: #59665f;
  font-size: 10px;
  font-weight: 760;
}

.is-running .workflow-stage-node__progress,
.is-retrying .workflow-stage-node__progress { --progress-color: #7568df; }
.is-success .workflow-stage-node__progress { --progress-color: #55a379; }
.is-failed .workflow-stage-node__progress { --progress-color: #d9776c; }

.workflow-stage-node__retry {
  margin-left: auto;
  padding: 5px 10px;
  color: #b95e56;
  font-size: 9.5px;
  font-weight: 700;
  cursor: pointer;
  background: #d9776c10;
  border: 0;
  border-radius: 999px;
  transition: color 0.2s, background 0.2s;
}

.workflow-stage-node__retry:hover {
  color: #fff;
  background: #cc6b61;
}

.workflow-result-node {
  top: 191px;
  left: 88.66%;
  width: 9.66%;
  min-height: 260px;
  padding: 22px;
  overflow: hidden;
  cursor: default;
  background:
    radial-gradient(circle at 86% 10%, #7467dc0f, transparent 34%),
    linear-gradient(145deg, #ffffffed, #f3f7f5df);
  border: 1px solid #ffffff;
  border-radius: 24px;
  box-shadow:
    0 20px 48px #2e423717,
    inset 0 0 0 1px #4b5e5310;
  transition:
    transform 0.45s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.35s,
    opacity 0.35s;
}

.workflow-result-node:not(.is-available) {
  opacity: 0.66;
}

.workflow-result-node.is-available {
  cursor: pointer;
  box-shadow:
    0 25px 58px #2e423720,
    0 0 0 1px #7568df13,
    inset 0 1px #fff;
}

.workflow-result-node.is-available:hover {
  transform: translateY(-5px) scale(1.01);
  box-shadow:
    0 31px 68px #2e423728,
    0 0 0 1px #7568df1f,
    inset 0 1px #fff;
}

.workflow-result-node.is-updating {
  animation: result-arrival 1.05s cubic-bezier(0.16, 1, 0.3, 1);
}

.workflow-result-node__halo {
  position: absolute;
  top: -52px;
  right: -46px;
  width: 138px;
  height: 138px;
  pointer-events: none;
  background: radial-gradient(circle, #7467dc1f, transparent 68%);
  border-radius: 50%;
  opacity: 0;
  transform: scale(0.7);
}

.is-updating .workflow-result-node__halo {
  animation: result-halo 1.1s ease-out;
}

.workflow-result-node__topline,
.workflow-result-node__stats,
.workflow-result-node__action {
  display: flex;
  align-items: center;
}

.workflow-result-node__topline {
  color: #9ba29e;
  font-size: 9px;
  font-weight: 760;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.workflow-result-node h3,
.workflow-result-node p {
  margin: 0;
}

.workflow-result-node h3 {
  margin-top: 32px;
  font-size: 18px;
  font-weight: 780;
  letter-spacing: -0.02em;
}

.workflow-result-node p {
  margin-top: 7px;
  color: #8b9590;
  font-size: 11px;
}

.workflow-result-node__stats {
  gap: 5px;
  margin-top: 19px;
}

.workflow-result-node__stats span {
  flex: 1;
  padding: 9px 5px;
  color: #8a938e;
  font-size: 9px;
  text-align: center;
  background: #eef2f0a3;
  border-radius: 8px;
}

.workflow-result-node__stats strong {
  display: block;
  margin-bottom: 2px;
  color: #3e4b44;
  font-size: 14px;
}

.workflow-result-node__action {
  gap: 3px;
  justify-content: flex-end;
  margin-top: 16px;
  color: #6257ba;
  font-size: 10px;
  font-weight: 720;
}

.workflow-result-node__action svg {
  width: 13px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
  transition: transform 0.2s;
}

.workflow-result-node:hover .workflow-result-node__action svg {
  transform: translateX(2px);
}

.ingestion-detail-backdrop {
  position: absolute;
  z-index: 19;
  inset: 0;
  pointer-events: none;
  background: transparent;
}

.ingestion-detail-shell {
  position: absolute;
  z-index: 20;
  top: 18px;
  right: 18px;
  bottom: 18px;
  width: min(370px, calc(100% - 36px));
  overflow: visible;
  transform-origin: right center;
}

.ingestion-detail {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  padding: 29px 26px 24px;
  overflow: auto;
  background: #f9fbfaf2;
  border: 1px solid #ffffff;
  border-radius: 24px;
  box-shadow:
    0 34px 80px #26392f35,
    inset 0 1px #fff;
  backdrop-filter: blur(24px) saturate(1.25);
}

.ingestion-validation-panel {
  position: absolute;
  z-index: 1;
  top: 36px;
  right: calc(100% - 18px);
  display: flex;
  flex-direction: column;
  width: 310px;
  max-height: calc(100% - 72px);
  padding: 20px 30px 20px 20px;
  overflow: hidden;
  color: #493b38;
  background:
    radial-gradient(circle at 100% 8%, rgb(212 86 78 / 10%), transparent 34%),
    linear-gradient(145deg, rgb(255 251 249 / 97%), rgb(247 241 238 / 94%));
  border: 1px solid rgb(255 255 255 / 88%);
  border-radius: 20px 0 0 20px;
  box-shadow:
    -18px 24px 52px rgb(84 42 37 / 19%),
    inset 0 1px #fff;
  backdrop-filter: blur(22px) saturate(1.1);
  transform-origin: right center;
}

.ingestion-validation-panel > header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px 14px;
  border-bottom: 1px solid rgb(112 69 61 / 11%);
}

.ingestion-validation-panel > header div > span {
  display: block;
  margin-bottom: 4px;
  color: #a15b55;
  font-size: 9px;
  font-weight: 760;
  letter-spacing: 0.08em;
}

.ingestion-validation-panel > header strong {
  display: block;
  color: #443532;
  font-size: 15px;
  font-weight: 790;
}

.ingestion-validation-panel > header > small {
  padding: 5px 8px;
  color: #96605a;
  font-size: 9px;
  font-weight: 720;
  background: rgb(202 91 81 / 8%);
  border: 1px solid rgb(181 78 69 / 12%);
  border-radius: 999px;
}

.ingestion-validation-panel ul {
  display: grid;
  gap: 9px;
  min-height: 0;
  padding: 12px 1px 2px;
  margin: 0;
  overflow: hidden auto;
  list-style: none;
}

.ingestion-validation-panel li {
  border-radius: 12px;
  transition: opacity 0.3s ease, transform 0.36s cubic-bezier(0.16, 1, 0.3, 1);
}

.ingestion-validation-panel li.is-resolved {
  opacity: 0.72;
}

.ingestion-validation-panel li button {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  width: 100%;
  padding: 11px;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: rgb(255 255 255 / 57%);
  border: 1px solid rgb(139 74 67 / 10%);
  border-radius: inherit;
  box-shadow: inset 0 1px rgb(255 255 255 / 78%);
  transition: background 0.22s ease, border-color 0.22s ease, transform 0.22s ease;
}

.ingestion-validation-panel li button:disabled {
  cursor: default;
  opacity: 1;
}

.ingestion-validation-panel li button:hover:not(:disabled),
.ingestion-validation-panel li button:focus-visible {
  background: rgb(255 255 255 / 85%);
  border-color: rgb(180 80 72 / 20%);
  outline: none;
  transform: translateX(-2px);
}

.ingestion-validation-panel__mark {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  color: #fff;
  background: #cf5f58;
  border: 2px solid rgb(255 255 255 / 86%);
  border-radius: 50%;
  box-shadow: 0 4px 9px rgb(159 54 47 / 24%);
  transition: background 0.38s ease, box-shadow 0.38s ease, transform 0.48s cubic-bezier(0.16, 1.4, 0.3, 1);
}

.ingestion-validation-panel li.is-resolved .ingestion-validation-panel__mark {
  background: #4c9a6e;
  box-shadow: 0 4px 9px rgb(54 132 88 / 22%);
  transform: rotate(360deg) scale(1.04);
}

.ingestion-validation-panel__mark svg {
  width: 11px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.1;
}

.ingestion-validation-panel__copy {
  min-width: 0;
}

.ingestion-validation-panel__copy strong {
  display: block;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  color: #70433f;
  font-size: 10.5px;
  font-weight: 680;
  line-height: 1.55;
}

.ingestion-validation-panel li.is-resolved .ingestion-validation-panel__copy strong {
  color: #50705e;
}

.ingestion-validation-panel__copy small {
  display: block;
  margin-top: 5px;
  color: #ad6e68;
  font-size: 8px;
  font-weight: 680;
}

.ingestion-validation-panel li.is-resolved .ingestion-validation-panel__copy small {
  color: #56906e;
}

.ingestion-validation-panel-enter-active,
.ingestion-validation-panel-leave-active {
  transition:
    opacity 0.3s ease,
    filter 0.38s ease,
    transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.ingestion-validation-panel-enter-from,
.ingestion-validation-panel-leave-to {
  opacity: 0;
  filter: blur(6px);
  transform: translateX(54px) scaleX(0.88);
}

[data-ingestion-target] {
  scroll-margin-top: 58px;
}

.extraction-result-file-name.is-issue-focused,
.extraction-result-section.is-issue-focused,
.extraction-result-item.is-issue-focused,
.extraction-result-property.is-issue-focused,
.clause-review-item-shell.is-issue-focused {
  position: relative;
  border-radius: 12px;
  animation: ingestion-issue-target-pulse 1.45s ease both;
}

@keyframes ingestion-issue-target-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgb(207 95 88 / 0%); }
  28% { box-shadow: 0 0 0 4px rgb(207 95 88 / 28%), 0 0 24px rgb(207 95 88 / 16%); }
  62% { box-shadow: 0 0 0 2px rgb(207 95 88 / 18%), 0 0 14px rgb(207 95 88 / 10%); }
}

.ingestion-detail-shell.is-deduplication,
.ingestion-detail-shell.is-classification,
.ingestion-detail-shell.is-detection,
.ingestion-detail-shell.is-overview {
  width: min(540px, calc(100% - 36px));
}

.ingestion-detail.is-deduplication,
.ingestion-detail.is-classification,
.ingestion-detail.is-detection,
.ingestion-detail.is-overview {
  width: 100%;
  padding: 34px 32px 28px;
}

.ingestion-detail-shell.is-result {
  width: min(660px, calc(100% - 36px));
}

.ingestion-detail.is-result {
  width: 100%;
  padding: 34px 32px 28px;
}

.ingestion-detail__error.ingestion-error-toast {
  position: absolute;
  z-index: 5;
  right: 24px;
  bottom: 24px;
  left: 24px;
  margin: 0;
  pointer-events: auto;
  color: #762f2a;
  background: linear-gradient(145deg, #fff7f5f7, #fceae7f2);
  border: 1px solid #c85f566b;
  box-shadow: 0 18px 42px #7d30283d, 0 4px 12px #40252024, inset 0 1px #fff;
  backdrop-filter: blur(18px) saturate(1.15);
}

.ingestion-detail__error.ingestion-error-toast > strong {
  color: #8f352f;
  font-size: 14px;
  font-weight: 780;
}

.ingestion-error-toast ol {
  display: grid;
  gap: 5px;
  max-height: min(240px, 42vh);
  padding: 0 0 0 18px;
  margin: 7px 0 0;
  overflow: hidden auto;
}

.ingestion-error-toast li {
  padding-left: 2px;
  color: #7d3732;
  font-size: 12px;
  font-weight: 620;
  line-height: 1.65;
}

.ingestion-error-toast li::marker {
  color: #bd4e46;
  font-weight: 800;
}

.ingestion-error-toast-enter-active,
.ingestion-error-toast-leave-active {
  transition:
    opacity 0.24s ease,
    filter 0.3s ease,
    transform 0.34s cubic-bezier(0.16, 1, 0.3, 1);
}

.ingestion-error-toast-enter-from,
.ingestion-error-toast-leave-to {
  opacity: 0;
  filter: blur(5px);
  transform: translateY(12px) scale(0.985);
}

.ingestion-detail:is(.is-deduplication, .is-classification, .is-detection, .is-overview, .is-result) h3 {
  font-size: 25px;
}

.ingestion-detail:is(.is-deduplication, .is-classification, .is-detection, .is-overview, .is-result) .ingestion-detail__eyebrow {
  font-size: 10px;
}

.ingestion-detail:is(.is-deduplication, .is-classification, .is-detection, .is-overview, .is-result) .ingestion-detail__lead {
  font-size: 12.5px;
  line-height: 1.8;
}

.ingestion-detail:is(.is-deduplication, .is-classification, .is-detection, .is-overview) .ingestion-detail__status {
  padding: 15px 17px;
  font-size: 11.5px;
}

.ingestion-detail:is(.is-classification, .is-detection, .is-overview) .ingestion-detail__facts dt,
.ingestion-detail:is(.is-classification, .is-detection, .is-overview) .ingestion-detail__facts dd {
  font-size: 11.5px;
}

.ingestion-detail__close {
  position: sticky;
  z-index: 2;
  top: -13px;
  display: grid;
  place-items: center;
  width: 31px;
  height: 31px;
  margin: -8px -6px -23px auto;
  color: #76817b;
  cursor: pointer;
  background: #edf1ef;
  border: 0;
  border-radius: 50%;
  transition: color 0.2s, background 0.2s, transform 0.2s;
}

.ingestion-detail__close:hover {
  color: #302c58;
  background: #e5e2f6;
  transform: rotate(4deg);
}

.ingestion-detail__close svg {
  width: 14px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.7;
}

.ingestion-detail__eyebrow {
  display: block;
  color: #766aca;
  font-size: 9px;
  font-weight: 750;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.ingestion-detail h3 {
  margin: 10px 0 0;
  color: #26332c;
  font-size: 21px;
  font-weight: 790;
  letter-spacing: -0.025em;
}

.ingestion-detail__lead {
  margin: 10px 0 0;
  color: #7d8882;
  font-size: 11px;
  line-height: 1.75;
}

.ingestion-detail__status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 22px;
  padding: 13px 15px;
  color: #777f7b;
  font-size: 10px;
  background: #eef2f0;
  border-radius: 13px;
}

.ingestion-detail__status span {
  display: flex;
  gap: 7px;
  align-items: center;
}

.ingestion-detail__status i {
  width: 6px;
  height: 6px;
  background: #a5ada9;
  border-radius: 50%;
}

.ingestion-detail__status.is-running,
.ingestion-detail__status.is-retrying { color: #6155c2; background: #7467dc0e; }
.ingestion-detail__status.is-running i,
.ingestion-detail__status.is-retrying i { background: #7467dc; }
.ingestion-detail__status.is-success { color: #438b65; background: #55a3790e; }
.ingestion-detail__status.is-success i { background: #55a379; }
.ingestion-detail__status.is-failed { color: #b85e56; background: #d9776c0e; }
.ingestion-detail__status.is-failed i { background: #d9776c; }
.ingestion-detail__status.is-rejected { color: #93642e; background: #d49a5510; }
.ingestion-detail__status.is-rejected i { background: #d49a55; }

.classification-stage-result {
  --classification-accent: #5e8f75;
  --classification-soft: #5e8f750d;
  --classification-border: #5e8f751c;

  display: grid;
  gap: 16px;
  margin-top: 18px;
  padding: 18px;
  overflow: hidden;
  background:
    radial-gradient(circle at 95% 0%, var(--classification-soft), transparent 42%),
    #ffffff9c;
  border: 1px solid var(--classification-border);
  border-radius: 15px;
  box-shadow: inset 0 1px #fff;
  animation: classification-result-in 0.52s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.classification-stage-result.is-partial {
  --classification-accent: #b08049;
  --classification-soft: #c28b4d0e;
  --classification-border: #c28b4d20;
}

.classification-stage-result.is-unmapped {
  --classification-accent: #7669c9;
  --classification-soft: #7568df0d;
  --classification-border: #7568df1d;
}

.classification-stage-result.is-unavailable {
  --classification-accent: #7f8984;
  --classification-soft: #65716a0a;
  --classification-border: #65716a17;
}

.classification-stage-result__header {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  gap: 13px;
  align-items: center;
}

.classification-stage-result__visual {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  color: var(--classification-accent);
  background: var(--classification-soft);
  border: 1px solid var(--classification-border);
  border-radius: 12px;
}

.classification-stage-result__visual svg {
  width: 31px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.4;
}

.classification-stage-result__visual rect {
  fill: #fff;
}

.classification-stage-result__header > div {
  min-width: 0;
}

.classification-stage-result__header small {
  display: block;
  margin-bottom: 3px;
  color: #929a96;
  font-size: 9px;
  font-weight: 680;
  letter-spacing: 0.07em;
}

.classification-stage-result__header strong {
  display: block;
  overflow: hidden;
  color: #37443d;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overview-stage-result .classification-stage-result__header {
  grid-template-columns: minmax(0, 1fr);
}

.overview-stage-result .classification-stage-result__header strong {
  overflow: visible;
  font-size: 18px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  text-overflow: clip;
  white-space: normal;
}

.classification-stage-result__count {
  padding: 6px 9px;
  color: var(--classification-accent);
  font-size: 9px;
  font-weight: 750;
  white-space: nowrap;
  background: var(--classification-soft);
  border: 1px solid var(--classification-border);
  border-radius: 999px;
}

.classification-stage-result__categories {
  display: grid;
  gap: 10px;
}

.classification-stage-result__categories article {
  padding: 16px 17px;
  background: #fff9;
  border: 1px solid #5261580d;
  border-radius: 11px;
  animation: classification-category-in 0.42s both cubic-bezier(0.16, 1, 0.3, 1);
}

.classification-stage-result__categories article:nth-child(2) { animation-delay: 55ms; }
.classification-stage-result__categories article:nth-child(3) { animation-delay: 110ms; }
.classification-stage-result__categories article:nth-child(n + 4) { animation-delay: 165ms; }

.classification-stage-result__categories h4 {
  display: inline;
  margin: 0 8px 0 0;
  color: #36423b;
  font-size: 17px;
  font-weight: 760;
  letter-spacing: -0.015em;
}

.classification-stage-result__categories code {
  padding: 3px 5px;
  color: var(--classification-accent);
  font-size: 10px;
  background: var(--classification-soft);
  border-radius: 4px;
}

.classification-stage-result__categories p,
.classification-stage-result__description p {
  margin: 7px 0 0;
  color: #78827d;
  font-size: 12px;
  line-height: 1.7;
}

.classification-stage-result__description {
  padding: 13px 14px;
  background: var(--classification-soft);
  border: 1px solid var(--classification-border);
  border-radius: 11px;
}

.classification-stage-result__description > span {
  color: var(--classification-accent);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: 0.06em;
}

.classification-stage-result__unavailable {
  color: #7f8984;
  font-size: 11px;
  line-height: 1.65;
}

@keyframes classification-result-in {
  from { opacity: 0; filter: blur(5px); transform: translateY(8px) scale(0.985); }
  to { opacity: 1; filter: blur(0); transform: translateY(0) scale(1); }
}

@keyframes classification-category-in {
  from { opacity: 0; transform: translateX(7px); }
  to { opacity: 1; transform: translateX(0); }
}

.document-detection-result {
  display: grid;
  gap: 8px;
  margin-top: 14px;
  padding: 14px 15px;
  color: #80592e;
  background: #d49a550d;
  border: 1px solid #d49a551b;
  border-radius: 13px;
}

.document-detection-result.is-contract {
  color: #3f7c5b;
  background: #55a3790d;
  border-color: #55a37918;
}

.document-detection-result strong { font-size: 10px; }

.document-detection-result p {
  margin: 0;
  font-size: 9px;
  line-height: 1.65;
}

.document-detection-result ul {
  display: grid;
  gap: 7px;
  padding: 0;
  margin: 2px 0 0;
  list-style: none;
}

.document-detection-result li {
  padding-top: 7px;
  font-size: 8.5px;
  line-height: 1.6;
  border-top: 1px solid currentColor;
  border-top-color: color-mix(in srgb, currentColor 13%, transparent);
}

.document-detection-result li span {
  display: block;
  margin-bottom: 2px;
  font-size: 8px;
  font-weight: 750;
  opacity: 0.72;
}

.ingestion-detail__facts {
  margin: 22px 0 0;
}

.ingestion-detail__facts div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 210px);
  gap: 16px;
  align-items: center;
  padding: 11px 2px;
  border-bottom: 1px solid #52615910;
}

.ingestion-detail__facts dt,
.ingestion-detail__facts dd {
  margin: 0;
  font-size: 10px;
}

.ingestion-detail__facts dt { color: #919a95; }
.ingestion-detail__facts dd { color: #3d4943; font-weight: 650; }

.ingestion-detail__facts dd {
  min-width: 0;
  width: 100%;
  text-align: right;
}

.ingestion-detail__preview-slot {
  height: 42px;
  margin-top: 20px;
}
.ingestion-preview-enter-active,
.ingestion-preview-leave-active { transition: opacity .4s ease; }
.ingestion-detail__preview-pdf.ingestion-preview-enter-from,
.ingestion-detail__preview-pdf.ingestion-preview-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .ingestion-detail__preview-pdf.ingestion-preview-enter-active,
  .ingestion-detail__preview-pdf.ingestion-preview-leave-active { transition: none; }
}

.ingestion-detail__preview-pdf {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  min-height: 42px;
  padding: 10px 16px;
  color: #446354;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  background: linear-gradient(145deg, #fff, #f0f5f1);
  border: 1px solid #dce6df;
  border-radius: 13px;
  box-shadow: 0 3px 9px #304c3b08;
  cursor: pointer;
  transition: background .2s, box-shadow .2s, opacity .4s ease;
}
.ingestion-detail__preview-pdf:hover { background: #edf4ee; box-shadow: 0 4px 12px #304c3b12; }
.ingestion-detail__preview-pdf:focus-visible { outline: 2px solid #719583; outline-offset: 3px; }
.ingestion-detail__preview-pdf svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

.ingestion-detail__ai-control {
  position: relative;
  display: grid;
  place-items: center;
  height: 196px;
  margin: 14px 0 0;
  isolation: isolate;
}

.ingestion-ai-control-enter-active {
  transition:
    opacity 1.45s cubic-bezier(0.4, 0, 0.2, 1),
    transform 1.45s cubic-bezier(0.22, 0.72, 0.32, 1),
    filter 1.25s ease;
}

.ingestion-ai-control-leave-active {
  transition:
    opacity 0.32s ease,
    transform 0.32s ease,
    filter 0.32s ease;
}

.ingestion-ai-control-enter-from,
.ingestion-ai-control-leave-to {
  opacity: 0;
  filter: blur(7px);
  transform: translateY(12px) scale(0.96);
}

.ingestion-detail__error,
.ingestion-detail__notice {
  margin-top: 20px;
  padding: 14px 15px;
  border-radius: 14px;
}

.ingestion-detail__error {
  color: #965149;
  background: #d9776c10;
  border: 1px solid #d9776c17;
}

.ingestion-detail__error strong {
  font-size: 10px;
}

.ingestion-detail__error p {
  margin: 6px 0 0;
  font-size: 9px;
  line-height: 1.65;
}

.ingestion-detail__notice {
  color: #8c654b;
  font-size: 9px;
  line-height: 1.65;
  background: #dd946310;
  border: 1px solid #dd946319;
}

.deduplication-detail-content {
  transition:
    opacity 0.24s ease,
    filter 0.24s ease,
    transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
}

.deduplication-detail-content.is-refreshing {
  opacity: 0;
  filter: blur(5px);
  transform: translateY(7px) scale(0.99);
}

.deduplication-candidates {
  display: grid;
  gap: 16px;
  margin-top: 22px;
}

.deduplication-candidate {
  --candidate-accent: #786bd0;
  --candidate-soft: #7568df0c;
  --candidate-border: #7568df1c;

  position: relative;
  display: grid;
  gap: 16px;
  padding: 18px;
  overflow: hidden;
  isolation: isolate;
  background:
    linear-gradient(145deg, #ffffffdb 0%, #f9fbfaad 68%, var(--candidate-soft) 100%);
  border: 1px solid var(--candidate-border);
  border-radius: 18px;
  box-shadow:
    0 12px 28px #35483d0a,
    inset 0 1px #fff;
  animation: deduplication-candidate-in 0.55s var(--candidate-delay) both cubic-bezier(0.16, 1, 0.3, 1);
  transition:
    border-color 0.25s ease,
    box-shadow 0.35s ease,
    transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.deduplication-candidate::before {
  position: absolute;
  top: 0;
  right: 18px;
  left: 18px;
  height: 1px;
  content: '';
  background: linear-gradient(90deg, transparent, var(--candidate-accent), transparent);
  opacity: 0.42;
}

.deduplication-candidate::after {
  position: absolute;
  z-index: -1;
  top: -36px;
  right: -32px;
  width: 100px;
  height: 100px;
  content: '';
  background: var(--candidate-accent);
  border-radius: 50%;
  opacity: 0.055;
  filter: blur(16px);
  transition: opacity 0.3s, transform 0.4s;
}

.deduplication-candidate:hover {
  border-color: color-mix(in srgb, var(--candidate-accent) 28%, transparent);
  box-shadow:
    0 18px 36px #35483d12,
    inset 0 1px #fff;
  transform: translateY(-2px);
}

.deduplication-candidate:hover::after {
  opacity: 0.09;
  transform: scale(1.12);
}

.deduplication-candidate.is-duplicate {
  --candidate-accent: #cf7168;
  --candidate-soft: #d9776c0c;
  --candidate-border: #d9776c1d;
}

.deduplication-candidate.is-similar {
  --candidate-accent: #c48a52;
  --candidate-soft: #d59a670c;
  --candidate-border: #d59a671d;
}

.deduplication-candidate.is-different {
  --candidate-accent: #4e9870;
  --candidate-soft: #55a3790c;
  --candidate-border: #55a3791c;
}

.deduplication-candidate.is-failed {
  --candidate-accent: #8b948f;
  --candidate-soft: #7d87820a;
  --candidate-border: #7d87821a;
}

.deduplication-candidate__identity {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
}

.deduplication-candidate__document {
  position: relative;
  display: grid;
  flex: 0 0 48px;
  place-items: center;
  width: 48px;
  height: 57px;
  color: var(--candidate-accent);
  background: linear-gradient(150deg, #fff, var(--candidate-soft));
  border: 1px solid var(--candidate-border);
  border-radius: 10px;
  box-shadow: 0 7px 14px #35483d0a;
}

.deduplication-candidate__document svg {
  width: 28px;
  fill: #fff;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.2;
}

.deduplication-candidate__document small {
  position: absolute;
  right: -4px;
  bottom: 5px;
  padding: 2px 3px;
  color: #fff;
  font-size: 6px;
  font-weight: 800;
  letter-spacing: 0.06em;
  background: var(--candidate-accent);
  border: 2px solid #fff;
  border-radius: 4px;
}

.deduplication-candidate__title {
  min-width: 0;
}

.deduplication-candidate__title > span {
  display: block;
  margin-bottom: 5px;
  color: #909994;
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.04em;
}

.deduplication-candidate__title h4 {
  margin: 0;
  overflow: hidden;
  color: #303d36;
  font-size: 14px;
  font-weight: 760;
  letter-spacing: -0.015em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.deduplication-candidate__reviewer {
  display: inline-grid;
  grid-template-columns: 18px auto minmax(0, 1fr);
  gap: 6px;
  align-items: center;
  max-width: 100%;
  margin-top: 8px;
  color: #7b8580;
  font-size: 9px;
}

.deduplication-candidate__reviewer svg {
  width: 18px;
  height: 18px;
  padding: 3px;
  fill: none;
  stroke: var(--candidate-accent);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.45;
  background: var(--candidate-soft);
  border: 1px solid var(--candidate-border);
  border-radius: 50%;
}

.deduplication-candidate__reviewer > span {
  white-space: nowrap;
}

.deduplication-candidate__reviewer > strong {
  min-width: 0;
  overflow: hidden;
  color: #4e5a54;
  font-size: 10px;
  font-weight: 720;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.deduplication-candidate__relation {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  align-self: start;
  padding: 6px 9px;
  color: var(--candidate-accent);
  font-size: 9px;
  font-weight: 760;
  white-space: nowrap;
  background: var(--candidate-soft);
  border: 1px solid var(--candidate-border);
  border-radius: 999px;
}

.deduplication-candidate__relation i {
  width: 4px;
  height: 4px;
  background: currentColor;
  border-radius: 50%;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 10%, transparent);
}

.deduplication-candidate__similarity {
  display: grid;
  gap: 7px;
  padding: 0 2px;
}

.deduplication-candidate__similarity > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.deduplication-candidate__similarity span {
  color: #858f89;
  font-size: 10px;
}

.deduplication-candidate__similarity strong {
  color: var(--candidate-accent);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.deduplication-candidate__track {
  display: block;
  height: 5px;
  overflow: hidden;
  background: #5261580b;
  border-radius: 999px;
}

.deduplication-candidate__track i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, color-mix(in srgb, var(--candidate-accent) 56%, white), var(--candidate-accent));
  border-radius: inherit;
  box-shadow: 0 0 8px color-mix(in srgb, var(--candidate-accent) 30%, transparent);
  transform-origin: left;
  animation: deduplication-similarity-in 0.75s calc(180ms + var(--candidate-delay)) both cubic-bezier(0.16, 1, 0.3, 1);
}

.deduplication-candidate__reasoning {
  padding: 13px 14px;
  background: #f4f7f57a;
  border: 1px solid #5261580c;
  border-radius: 11px;
}

.deduplication-candidate__reasoning > span {
  display: block;
  margin-bottom: 4px;
  color: var(--candidate-accent);
  font-size: 9px;
  font-weight: 740;
  letter-spacing: 0.06em;
}

.deduplication-candidate__reasoning p {
  margin: 0;
  color: #69756f;
  font-size: 11px;
  line-height: 1.7;
}

.deduplication-candidate button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 40px;
  padding: 0 13px;
  color: var(--candidate-accent);
  font-size: 10.5px;
  font-weight: 700;
  cursor: pointer;
  background: var(--candidate-soft);
  border: 1px solid var(--candidate-border);
  border-radius: 10px;
  transition: color 0.2s, background 0.2s, border-color 0.2s, transform 0.2s;
}

.deduplication-candidate button svg {
  width: 14px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
  transition: transform 0.25s;
}

.deduplication-candidate button:hover:not(:disabled) {
  color: #fff;
  background: var(--candidate-accent);
  border-color: var(--candidate-accent);
  transform: translateY(-1px);
}

.deduplication-candidate button:hover:not(:disabled) svg {
  transform: translateX(2px);
}

.deduplication-candidate button:disabled {
  justify-content: center;
  gap: 7px;
  cursor: wait;
  opacity: 0.7;
}

.deduplication-candidate button > i {
  width: 10px;
  height: 10px;
  border: 1.5px solid color-mix(in srgb, var(--candidate-accent) 24%, transparent);
  border-top-color: var(--candidate-accent);
  border-radius: 50%;
  animation: deduplication-preview-spin 0.7s linear infinite;
}

@keyframes deduplication-candidate-in {
  from { opacity: 0; filter: blur(5px); transform: translateY(10px) scale(0.985); }
  to { opacity: 1; filter: blur(0); transform: translateY(0) scale(1); }
}

@keyframes deduplication-similarity-in {
  from { opacity: 0; transform: scaleX(0); }
  to { opacity: 1; transform: scaleX(1); }
}

@keyframes deduplication-preview-spin {
  to { transform: rotate(360deg); }
}

.ingestion-detail__primary {
  display: flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 42px;
  margin-top: 22px;
  color: #fff;
  font-size: 10px;
  font-weight: 720;
  cursor: pointer;
  background: linear-gradient(135deg, #6559c9, #4e448e);
  border: 0;
  border-radius: 13px;
  box-shadow: 0 11px 24px #5b50aa2e;
  transition: transform 0.22s, box-shadow 0.22s, background 0.22s;
}

.ingestion-detail__primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 15px 30px #5b50aa3b;
}

.ingestion-detail__primary:disabled {
  color: #ffffffb8;
  cursor: not-allowed;
  background: linear-gradient(135deg, #8f8aa9, #77728c);
  box-shadow: none;
  transform: none;
}

.ingestion-detail__primary.is-complete {
  background: linear-gradient(135deg, #4f9d73, #397656);
  box-shadow: 0 11px 24px #377b5728;
}

.ingestion-detail__primary svg {
  width: 15px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.extraction-result-editor {
  display: grid;
  gap: 18px;
  margin-top: 25px;
}

.extraction-result-section {
  display: grid;
  gap: 14px;
  padding: 18px;
  background: #ffffff96;
  border: 1px solid #52615812;
  border-radius: 14px;
  box-shadow: inset 0 1px #fff;
}

.extraction-result-section > header,
.extraction-result-item__heading,
.extraction-result-object .extraction-result-property > span {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.extraction-result-section > header {
  padding-bottom: 11px;
  border-bottom: 1px solid #52615810;
}

.extraction-result-section > header strong {
  color: #354139;
  font-size: 14px;
}

.extraction-result-section > header span {
  color: #8176cc;
  font-size: 10px;
}

.extraction-result-file-name {
  display: grid;
  gap: 7px;
}

.extraction-result-file-name > span {
  color: #56625b;
  font-size: 11px;
  font-weight: 700;
}

.extraction-result-file-name b {
  margin-left: 5px;
  color: #b7645d;
  font-size: 8px;
}

.extraction-result-file-name :is(input, textarea) {
  box-sizing: border-box;
  width: 100%;
  height: 44px;
  padding: 0 13px;
  color: #354139;
  font: inherit;
  font-weight: 650;
  background: #fffdf9;
  border: 1px solid #8c795329;
  border-radius: 9px;
  outline: none;
  box-shadow: inset 0 2px 5px #6d5c3710;
}

.extraction-result-file-name :is(input, textarea):focus {
  border-color: #9b7d4970;
  box-shadow: inset 0 2px 5px #6d5c3710, 0 0 0 3px #b6904d12;
}

.extraction-result-file-name :is(input, textarea):disabled {
  color: #737b76;
  background: #f2f1ed;
}

.extraction-result-summary textarea {
  height: auto;
  min-height: 150px;
  max-height: 360px;
  padding: 12px 13px;
  resize: vertical;
  line-height: 1.95;
}

.extraction-result-summary small {
  text-align: right;
  color: #715526;
  font-size: 11px;
}

.extraction-result-summary small.is-over-limit { color: #a43e32; }

.extraction-ingestion-button {
  --ingestion-action-primary: #ff5569;
  --ingestion-action-neutral-1: #f7f8f7;
  --ingestion-action-neutral-2: #e7e7e7;

  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 200px;
  height: 68px;
  padding: 20px;
  overflow: visible;
  color: #2d3430;
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  text-shadow: 0 1px 1px rgb(0 0 0 / 18%);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 14px;
  box-shadow:
    0 0.5px 0.5px 1px rgb(255 255 255 / 20%),
    0 10px 20px rgb(61 42 9 / 22%),
    0 4px 5px rgb(0 0 0 / 5%);
  transition: box-shadow 0.3s ease, opacity 0.3s ease, transform 0.3s ease;
}

.extraction-ingestion-button::after {
  position: absolute;
  z-index: 0;
  inset: 0;
  content: '';
  background:
    linear-gradient(var(--ingestion-action-neutral-1), var(--ingestion-action-neutral-2)) padding-box,
    linear-gradient(to bottom, rgb(0 0 0 / 10%), rgb(0 0 0 / 45%)) border-box;
  border: 2.5px solid transparent;
  border-radius: inherit;
  transition: box-shadow 0.4s ease, transform 0.4s ease;
}

.extraction-ingestion-button::before {
  position: absolute;
  z-index: 2;
  inset: 7px 6px 6px;
  content: '';
  background: linear-gradient(to top, var(--ingestion-action-neutral-1), var(--ingestion-action-neutral-2));
  border-radius: 10px;
  filter: blur(0.5px);
}

.extraction-ingestion-button:hover:not(:disabled) {
  box-shadow:
    0 0 1px 2px rgb(255 255 255 / 30%),
    0 15px 30px rgb(56 37 7 / 30%),
    0 10px 3px -3px rgb(0 0 0 / 4%);
  transform: scale(1.02);
}

.extraction-ingestion-button:hover:not(:disabled)::after {
  box-shadow: inset 0 -1px 3px #fff;
  transform: scale(1.025, 1.08);
}

.extraction-ingestion-button:active:not(:disabled) {
  box-shadow:
    0 0 1px 2px rgb(255 255 255 / 30%),
    0 10px 3px -3px rgb(0 0 0 / 20%);
  transform: scale(1);
}

.extraction-ingestion-button:focus-visible {
  outline: 3px solid rgb(255 85 105 / 32%);
  outline-offset: 4px;
}

.extraction-ingestion-button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.extraction-ingestion-button.is-submitting:disabled,
.extraction-ingestion-button.is-sent:disabled {
  opacity: 1;
}

.extraction-ingestion-button__outline {
  position: absolute;
  z-index: 1;
  inset: -2px -3.5px;
  overflow: hidden;
  border-radius: inherit;
  opacity: 0;
  transition: opacity 0.4s ease;
}

.extraction-ingestion-button__outline::before {
  position: absolute;
  inset: -100%;
  content: '';
  background: conic-gradient(from 180deg, transparent 60%, white 80%, transparent 100%);
  animation: extraction-ingestion-outline-spin 2s linear infinite paused;
}

.extraction-ingestion-button:hover:not(:disabled) .extraction-ingestion-button__outline {
  opacity: 1;
}

.extraction-ingestion-button:hover:not(:disabled) .extraction-ingestion-button__outline::before {
  animation-play-state: running;
}

.extraction-ingestion-button__state {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  min-width: 0;
  padding-left: 31px;
}

.extraction-ingestion-button__state.is-sent {
  display: none;
}

.extraction-ingestion-button__icon {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: auto;
  transform: scale(1.25);
  transition: transform 0.3s ease;
}

.extraction-ingestion-button__icon svg {
  width: 1em;
  overflow: visible;
  fill: currentColor;
  filter: drop-shadow(0 1px 0.6px rgb(0 0 0 / 50%));
}

.extraction-ingestion-button__state.is-default .extraction-ingestion-button__icon svg {
  animation: extraction-ingestion-plane-land 0.6s ease forwards;
}

.extraction-ingestion-button:hover:not(:disabled) .is-default .extraction-ingestion-button__icon {
  transform: rotate(45deg) scale(1.25);
}

.extraction-ingestion-button__state.is-default .extraction-ingestion-button__icon::before {
  position: absolute;
  top: 50%;
  left: -5px;
  width: 0;
  height: 2px;
  content: '';
  background: linear-gradient(to right, transparent, rgb(0 0 0 / 50%));
}

.extraction-ingestion-button__label {
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}

.extraction-ingestion-button__label i {
  display: block;
  font-style: normal;
  opacity: 0;
  animation: extraction-ingestion-letter-in 0.8s ease forwards calc(var(--i) * 0.03s);
}

.extraction-ingestion-button:hover:not(:disabled) .is-default .extraction-ingestion-button__label i {
  animation: extraction-ingestion-letter-wave 0.5s ease forwards calc(var(--i) * 0.02s);
}

.extraction-ingestion-button.is-submitting .is-default .extraction-ingestion-button__label i {
  animation: extraction-ingestion-letter-out 0.6s ease forwards calc(var(--i) * 0.03s);
}

.extraction-ingestion-button.is-submitting .is-default .extraction-ingestion-button__icon {
  transform: rotate(0) scale(1.25);
}

.extraction-ingestion-button.is-submitting .is-default .extraction-ingestion-button__icon svg {
  animation: extraction-ingestion-plane-takeoff 0.8s linear forwards;
}

.extraction-ingestion-button.is-submitting .is-default .extraction-ingestion-button__icon::before {
  animation: extraction-ingestion-contrail 0.8s linear forwards;
}

.extraction-ingestion-button.is-sent .extraction-ingestion-button__state.is-default {
  display: none;
}

.extraction-ingestion-button.is-sent .extraction-ingestion-button__state.is-sent {
  display: flex;
}

.extraction-ingestion-button.is-sent .is-sent .extraction-ingestion-button__icon svg {
  opacity: 0;
  animation: extraction-ingestion-success-icon 1.2s ease forwards 0.35s;
}

.extraction-ingestion-button.is-sent .is-sent .extraction-ingestion-button__label i {
  animation-delay: calc(var(--i) * 0.12s);
}

@keyframes extraction-ingestion-outline-spin {
  to { transform: rotate(360deg); }
}

@keyframes extraction-ingestion-letter-in {
  0% { color: var(--ingestion-action-primary); opacity: 0; filter: blur(5px); transform: translate(5px, -20px) rotate(-90deg); }
  30% { opacity: 1; filter: blur(0); transform: translateY(4px); }
  50% { opacity: 1; transform: translateY(-3px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes extraction-ingestion-letter-wave {
  30% { opacity: 1; transform: translateY(4px); }
  50% { color: var(--ingestion-action-primary); opacity: 1; transform: translateY(-3px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes extraction-ingestion-letter-out {
  from { opacity: 1; }
  to { color: var(--ingestion-action-primary); opacity: 0; filter: blur(5px); transform: translate(5px, 20px); }
}

@keyframes extraction-ingestion-plane-land {
  from { opacity: 0; filter: blur(3px); transform: translate(-60px, 30px) rotate(-50deg) scale(2); }
  to { opacity: 1; filter: blur(0); transform: translate(0) rotate(0) scale(1); }
}

@keyframes extraction-ingestion-plane-takeoff {
  0%, 60% { opacity: 1; }
  60% { transform: translateX(70px) rotate(45deg) scale(2); }
  100% { opacity: 0; transform: translateX(160px) rotate(45deg) scale(0); }
}

@keyframes extraction-ingestion-contrail {
  0% { width: 0; opacity: 1; }
  8% { width: 15px; }
  60% { width: 80px; opacity: 0.7; }
  100% { width: 160px; opacity: 0; }
}

@keyframes extraction-ingestion-success-icon {
  0% { color: var(--ingestion-action-primary); opacity: 0; filter: blur(4px); transform: scale(4) rotate(-40deg); }
  30% { opacity: 1; filter: blur(1px); transform: scale(0.6); }
  50% { opacity: 1; filter: blur(0); transform: scale(1.2); }
  100% { opacity: 1; transform: scale(1); }
}

.extraction-result-item {
  display: grid;
  gap: 11px;
  padding: 15px;
  background: #f8faf994;
  border: 1px solid #5261580e;
  border-radius: 11px;
}

.extraction-result-item__objects {
  display: grid;
  gap: 11px;
}

.extraction-result-item__object-shell {
  display: grid;
  grid-template-rows: 1fr;
  min-width: 0;
}

.extraction-result-item__object-shell > .extraction-result-object {
  min-height: 0;
}

.core-review-item-enter-active,
.core-review-item-leave-active {
  overflow: hidden;
  transition:
    grid-template-rows 0.48s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.3s ease,
    filter 0.38s ease,
    transform 0.48s cubic-bezier(0.16, 1, 0.3, 1);
}

.core-review-item-enter-from,
.core-review-item-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
  filter: blur(4px);
  transform: translateY(-9px) scale(0.985);
}

.core-review-item-move {
  transition: transform 0.44s cubic-bezier(0.16, 1, 0.3, 1);
}

.core-review-empty-enter-active,
.core-review-empty-leave-active {
  max-height: 48px;
  overflow: hidden;
  transition:
    max-height 0.36s cubic-bezier(0.16, 1, 0.3, 1),
    padding 0.36s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.24s ease,
    transform 0.36s cubic-bezier(0.16, 1, 0.3, 1);
}

.core-review-empty-enter-from,
.core-review-empty-leave-to {
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  opacity: 0;
  transform: translateY(-5px);
}

.extraction-result-item__heading h4 {
  margin: 0;
  color: #354139;
  font-size: 13px;
}

.extraction-result-item__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 0;
  padding-bottom: 10px;
  color: #303d35;
  font-size: 15px;
  font-weight: 730;
  letter-spacing: -0.015em;
  border-bottom: 1px solid #52615810;
}

.extraction-result-item__title-meta {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 6px;
  align-items: center;
}

.extraction-result-item__title-meta b,
.extraction-result-item__title-meta i {
  padding: 3px 6px;
  font-size: 8px;
  font-style: normal;
  font-weight: 700;
  border-radius: 5px;
}

.extraction-result-item__title-meta b {
  color: #a3655e;
  background: #d9776c0e;
}

.extraction-result-item__title-meta i {
  color: #7165c8;
  background: #7568df0d;
}

.extraction-result-item__heading span {
  color: #559072;
  font-size: 10px;
}

.clause-review-heading { align-items: flex-start; gap: 16px; }
.clause-review-path { display: grid; gap: 7px; flex: 1; min-width: 0; margin: 0; padding: 0; list-style: none; }
.clause-review-path li { position: relative; min-width: 0; padding-left: 12px; border-left: 2px solid #98722c40; color: #806432; font-size: 12px; line-height: 1.6; }
.clause-review-path li:last-child { border-left-color: #98722c; color: #513b18; font-size: 13px; font-weight: 700; }
.clause-review-path :deep(.truncated-text__value) { color: inherit; font-size: inherit; }

.extraction-result-item__clause-actions {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 9px;
  align-items: center;
}

.extraction-result-item__clause-actions button {
  padding: 4px 8px;
  color: #6e63c2;
  font-size: 9px;
  font-weight: 680;
  cursor: pointer;
  background: #7568df0b;
  border: 1px solid #7568df16;
  border-radius: 6px;
  transition: color 0.2s ease, background 0.2s ease, border-color 0.2s ease;
}

.extraction-result-item__clause-actions button:hover {
  color: #fff;
  background: #7165c8;
  border-color: #7165c8;
}

.clause-review-list {
  display: grid;
  gap: 0;
}

.clause-review-item-shell {
  display: grid;
  grid-template-rows: 1fr;
  min-width: 0;
  margin-bottom: 14px;
}

.clause-review-item-shell:last-child {
  margin-bottom: 0;
}

.clause-review-item-shell.is-removing {
  pointer-events: none;
}

.clause-review-item-shell__content {
  display: grid;
  min-height: 0;
  gap: 14px;
}

.clause-insert-slot {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 18px;
}

.clause-insert-slot__trigger {
  display: inline-flex;
  gap: 0;
  align-items: center;
  padding: 3px 9px;
  color: #796a39;
  cursor: pointer;
  background: rgb(255 247 216 / 72%);
  border: 1px dashed rgb(113 85 29 / 24%);
  border-radius: 999px;
  opacity: 0.58;
  transition: gap 0.24s ease, opacity 0.2s ease, transform 0.2s ease, background 0.2s ease;
}

.clause-insert-slot__trigger span {
  font-size: 13px;
  line-height: 1;
}

.clause-insert-slot__trigger i {
  max-width: 0;
  overflow: hidden;
  font-size: 9px;
  font-style: normal;
  white-space: nowrap;
  opacity: 0;
  transition: max-width 0.24s ease, opacity 0.2s ease;
}

.clause-insert-slot__trigger:hover,
.clause-insert-slot__trigger:focus-visible {
  gap: 6px;
  opacity: 1;
  transform: translateY(-1px);
}

.clause-insert-slot__trigger:hover i,
.clause-insert-slot__trigger:focus-visible i {
  max-width: 100px;
  opacity: 1;
}

.clause-insert-form {
  display: grid;
  width: 100%;
  gap: 12px;
  padding: 16px;
  background: rgb(255 246 207 / 58%);
  border: 1px solid rgb(100 66 10 / 15%);
  border-radius: 12px;
  box-shadow: inset 2px 2px 6px rgb(91 55 7 / 10%);
}

.clause-insert-form > header,
.clause-insert-form footer,
.clause-insert-form__row {
  display: flex;
  gap: 12px;
}

.clause-insert-form > header,
.clause-insert-form footer {
  align-items: center;
  justify-content: space-between;
}

.clause-insert-form > header strong {
  color: #49330f;
  font-size: 13px;
}

.clause-insert-form > header span {
  color: #806d42;
  font-size: 9px;
}

.clause-insert-form label {
  display: grid;
  flex: 1 1 0;
  gap: 6px;
  color: #5d471e;
  font-size: 10px;
}

.clause-insert-form label span {
  display: flex;
  gap: 5px;
  align-items: center;
}

.clause-insert-form label b {
  color: #a15d58;
  font-size: 8px;
}

.clause-insert-form input,
.clause-insert-form select,
.clause-insert-form textarea {
  width: 100%;
  padding: 9px 10px;
  color: #493916;
  font: inherit;
  background: rgb(255 252 237 / 72%);
  border: 1px solid rgb(92 57 8 / 16%);
  border-radius: 8px;
  outline: none;
}

.clause-insert-form textarea {
  min-height: 110px;
  resize: vertical;
}

.clause-insert-form input:focus,
.clause-insert-form select:focus,
.clause-insert-form textarea:focus {
  border-color: rgb(155 104 22 / 50%);
  box-shadow: 0 0 0 3px rgb(208 168 62 / 12%);
}

.clause-insert-form__row--pages label {
  flex: 0 1 150px;
}

.clause-path-editor {
  display: grid;
  gap: 8px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.clause-path-editor legend {
  margin-bottom: 7px;
  color: #5d471e;
  font-size: 10px;
}

.clause-path-editor legend b {
  margin-left: 5px;
  color: #a15d58;
  font-size: 8px;
}

.clause-path-editor__item {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto auto;
  gap: 7px;
  align-items: center;
}

.clause-path-editor__item > span {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  color: #76551b;
  font-size: 9px;
  background: rgb(255 244 199 / 55%);
  border: 1px solid rgb(91 55 7 / 15%);
  border-radius: 50%;
}

.clause-path-editor__item button,
.clause-path-editor__add {
  padding: 7px 9px;
  color: #674a18;
  font-size: 9px;
  cursor: pointer;
  background: rgb(255 247 218 / 55%);
  border: 1px solid rgb(91 55 7 / 16%);
  border-radius: 7px;
}

.clause-path-editor__item button:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.clause-path-editor__add {
  justify-self: start;
}

.clause-insert-form__error {
  margin: 0;
  color: #a8504d;
  font-size: 10px;
}

.clause-insert-form footer {
  justify-content: flex-end;
}

.clause-insert-form footer button {
  padding: 7px 13px;
  color: #594016;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  background: rgb(255 247 218 / 55%);
  border: 1px solid rgb(91 55 7 / 18%);
  border-radius: 8px;
}

.clause-insert-form footer button[type='submit'] {
  background: linear-gradient(135deg, #e4c253, #c9942e);
}

.extraction-result-item__markdown {
  padding: 13px 14px;
  color: #39463f;
  font-size: 12px;
  background: #ffffffa3;
  border: 1px solid #5261580d;
  border-radius: 10px;
}

.extraction-result-item__markdown-empty {
  width: 100%;
  min-height: 74px;
  color: #929b96;
  font-size: 10px;
  cursor: pointer;
  background: #ffffff70;
  border: 1px dashed #5261581c;
  border-radius: 10px;
  transition: color 0.2s ease, background 0.2s ease, border-color 0.2s ease;
}

.extraction-result-item__markdown-empty:hover {
  color: #7165c8;
  background: #fff;
  border-color: #7568df36;
}

.extraction-result-object {
  display: grid;
  gap: 11px;
  padding: 13px;
  background: #fff9;
  border: 1px solid #5261580d;
  border-radius: 9px;
}

.extraction-result-object.is-direct {
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
}

.extraction-result-object__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 6px;
  color: #7f8984;
  font-size: 10px;
  border-bottom: 1px solid #5261580d;
}

.extraction-result-object__heading button {
  padding: 2px 5px;
  color: #a65f58;
  font-size: 9px;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 5px;
  transition: color 0.18s, background 0.18s;
}

.extraction-result-object__heading button:hover {
  color: #fff;
  background: #d9776c;
}

.extraction-result-property {
  display: grid;
  gap: 5px;
}

.extraction-result-object .extraction-result-property > span {
  color: #68736d;
  font-size: 11px;
  font-weight: 650;
}

.extraction-result-object .extraction-result-property b {
  padding: 2px 4px;
  margin-right: auto;
  margin-left: 5px;
  color: #a3655e;
  font-size: 8px;
  font-weight: 700;
  background: #d9776c0e;
  border-radius: 4px;
}

.extraction-result-object .extraction-result-property > span i {
  color: #7165c8;
  font-size: 9px;
  font-style: normal;
  font-weight: 680;
}

.extraction-result-object input,
.extraction-result-object select,
.extraction-result-item textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 12px 13px;
  color: #2e3b34;
  font-size: 12px;
  background: #ffffffb8;
  border: 1px solid #4b5b5215;
  border-radius: 10px;
  outline: none;
  resize: vertical;
  transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
}

.extraction-result-number-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 9px;
  align-items: stretch;
  width: 100%;
}

.extraction-result-number-control input[type='number'] {
  min-width: 0;
  appearance: textfield;
}

.extraction-result-number-control input[type='number']::-webkit-inner-spin-button,
.extraction-result-number-control input[type='number']::-webkit-outer-spin-button {
  margin: 0;
  appearance: none;
}

.extraction-result-number-control__buttons {
  display: flex;
  gap: 5px;
  padding: 3px;
  background: #bdc2be;
  border: 1px solid rgb(43 50 46 / 13%);
  border-radius: 10px;
  box-shadow:
    inset 4px 4px 8px rgb(41 48 44 / 27%),
    inset -3px -3px 6px rgb(255 255 255 / 70%),
    0 1px 1px rgb(255 255 255 / 48%);
}

.extraction-result-number-control__buttons button {
  position: relative;
  width: 34px;
  min-width: 34px;
  padding: 0;
  overflow: hidden;
  color: rgb(40 45 42 / 58%);
  cursor: pointer;
  background: rgb(53 61 56 / 9%);
  border: 1px solid rgb(48 55 51 / 12%);
  border-radius: 7px;
  box-shadow:
    inset 2px 2px 4px rgb(36 43 39 / 25%),
    inset -2px -2px 3px rgb(255 255 255 / 56%);
  transition: filter 0.22s ease, transform 0.22s cubic-bezier(0.23, 1, 0.32, 1);
}

.extraction-result-number-control__button {
  position: absolute;
  inset: 4px;
  display: block;
  background: #d4d8d5;
  border-radius: 50%;
  box-shadow:
    0 5px 7px -3px rgb(29 34 31 / 48%),
    0 -3px 6px -2px rgb(255 255 255 / 78%),
    inset 0 -2px 3px rgb(37 43 39 / 18%),
    inset 0 2px 3px rgb(255 255 255 / 62%);
  transition: transform 0.2s cubic-bezier(0.23, 1, 0.32, 1), box-shadow 0.2s ease;
}

.extraction-result-number-control__label {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  font-size: 19px;
  font-weight: 780;
  line-height: 1;
  text-shadow: 1px 1px 2px #fff, 0 0 0 rgb(24 29 26 / 70%);
  transition: transform 0.2s ease, color 0.2s ease;
}

.extraction-result-number-control__buttons button:hover {
  filter: brightness(1.035);
}

.extraction-result-number-control__buttons button:focus-visible {
  outline: 2px solid #7467dc80;
  outline-offset: 2px;
}

.extraction-result-number-control__buttons button:active .extraction-result-number-control__button {
  box-shadow:
    0 1px 2px rgb(29 34 31 / 18%),
    inset -2px -2px 5px rgb(255 255 255 / 44%),
    inset 3px 3px 7px rgb(37 43 39 / 38%);
  transform: translateY(2px) scale(0.92);
}

.extraction-result-number-control__buttons button:active .extraction-result-number-control__label {
  color: rgb(28 33 30 / 66%);
  transform: translateY(1px) scale(0.94);
}

.extraction-result-boolean-control {
  position: relative;
  display: grid;
  width: 100%;
}

.extraction-result-boolean-control.is-open {
  z-index: 30;
}

.extraction-result-boolean-control__trigger {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 42px;
  padding: 0 13px;
  color: #2e3b34;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  background: #ffffffb8;
  border: 1px solid #4b5b5215;
  border-radius: 10px;
  box-shadow: none;
  transition:
    color 0.25s ease,
    background 0.3s ease,
    border-color 0.25s ease,
    box-shadow 0.3s ease,
    border-radius 0.3s ease;
}

.extraction-result-boolean-control__trigger > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.extraction-result-boolean-control__trigger > i {
  width: 7px;
  height: 7px;
  margin-right: 2px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  opacity: 0.62;
  transform: translateY(-2px) rotate(45deg);
  transition: transform 0.38s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
}

.extraction-result-boolean-control.is-open .extraction-result-boolean-control__trigger > i {
  opacity: 0.9;
  transform: translateY(2px) rotate(225deg);
}

.extraction-result-boolean-control__trigger:focus-visible {
  outline: 2px solid #7467dc80;
  outline-offset: 2px;
}

.extraction-result-boolean-control__expander {
  position: absolute;
  top: 100%;
  right: 0;
  left: 0;
  z-index: 20;
  opacity: 0;
  visibility: hidden;
  filter: blur(4px);
  clip-path: inset(0 0 100% 0 round 12px);
  pointer-events: none;
  transform: translateY(-5px) scaleY(0.96);
  transform-origin: top;
  transition:
    opacity 0.24s ease,
    filter 0.32s ease,
    clip-path 0.46s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.46s cubic-bezier(0.16, 1, 0.3, 1),
    visibility 0s linear 0.46s;
}

.extraction-result-boolean-control.is-open .extraction-result-boolean-control__expander {
  opacity: 1;
  visibility: visible;
  filter: blur(0);
  clip-path: inset(0 round 12px);
  pointer-events: auto;
  transform: translateY(0) scaleY(1);
  transition-delay: 0s;
}

.extraction-result-boolean-control__clip {
  min-height: 0;
  overflow: hidden;
}

.extraction-result-boolean-control__options {
  position: relative;
  display: grid;
  grid-template-rows: repeat(3, 38px);
  margin-top: 7px;
  overflow: hidden;
  background: rgb(246 248 247 / 82%);
  border: 1px solid rgb(255 255 255 / 72%);
  border-radius: 12px;
  box-shadow:
    inset 1px 1px 4px rgb(255 255 255 / 48%),
    inset -1px -1px 6px rgb(42 49 45 / 18%),
    0 7px 16px rgb(42 50 45 / 10%);
  backdrop-filter: blur(16px) saturate(1.08);
}

.extraction-result-boolean-control__options input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  opacity: 0;
  pointer-events: none;
}

.extraction-result-boolean-control__options label {
  z-index: 2;
  display: grid;
  place-items: center;
  color: #59655f;
  font-size: 12px;
  font-weight: 680;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: color 0.26s ease, text-shadow 0.26s ease;
}

.extraction-result-boolean-control__options label:hover,
.extraction-result-boolean-control__options input:checked + label {
  color: #26332c;
  text-shadow: 0 1px 5px rgb(255 255 255 / 45%);
}

.extraction-result-boolean-control__options input:focus-visible + label {
  outline: 2px solid #7467dc75;
  outline-offset: -3px;
}

.extraction-result-boolean-control__glider {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  width: 100%;
  height: 38px;
  background: linear-gradient(135deg, rgb(192 192 192 / 34%), #e8e9e8b8);
  border-radius: 11px;
  box-shadow: 0 0 15px rgb(192 192 192 / 32%), inset 0 0 9px rgb(255 255 255 / 42%);
  transform: translateY(calc(var(--boolean-option-index) * 100%));
  transition:
    transform 0.5s cubic-bezier(0.37, 1.55, 0.66, 0.76),
    background 0.35s ease,
    box-shadow 0.35s ease;
}

.extraction-result-boolean-control__options.is-selected-true .extraction-result-boolean-control__glider {
  background: linear-gradient(135deg, rgb(98 205 146 / 28%), #82d9a8c7);
  box-shadow: 0 0 16px rgb(91 207 142 / 28%), inset 0 0 9px rgb(205 255 226 / 38%);
}

.extraction-result-boolean-control__options.is-selected-false .extraction-result-boolean-control__glider {
  background: linear-gradient(135deg, rgb(239 108 155 / 25%), #ef91b3c7);
  box-shadow: 0 0 16px rgb(235 100 149 / 26%), inset 0 0 9px rgb(255 215 230 / 38%);
}

.extraction-result-object input:focus,
.extraction-result-object select:focus,
.extraction-result-item textarea:focus {
  background: #fff;
  border-color: #7467dc4d;
  box-shadow: 0 0 0 3px #7467dc10;
}

.extraction-result-object .extraction-result-property.is-required-empty > input,
.extraction-result-object .extraction-result-property.is-required-empty > select,
.extraction-result-object .extraction-result-property.is-required-empty .extraction-result-number-control > input,
.extraction-result-object .extraction-result-property.is-required-empty .extraction-result-boolean-control__trigger {
  border-color: #b75ee96b;
  box-shadow: 0 0 0 1px #ee64bd2e;
}

.extraction-result-item__empty {
  padding: 10px;
  color: #8b938e;
  font-size: 10px;
  text-align: center;
  background: #52615808;
  border: 1px dashed #52615819;
  border-radius: 9px;
}

.extraction-result-item__add {
  display: flex;
  gap: 5px;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  color: #685dc1;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  background: #7568df09;
  border: 1px solid #7568df16;
  border-radius: 9px;
  transition: color 0.18s, background 0.18s, border-color 0.18s;
}

.extraction-result-item__add span { font-size: 15px; font-weight: 400; }

.extraction-result-item__add:hover {
  color: #fff;
  background: #6a5ec9;
  border-color: #6a5ec9;
}

.extraction-result-item textarea {
  min-height: 112px;
  line-height: 1.65;
}

/* 最终审核面板延续金属表单的浮起外壳与内嵌控件，同时保留长内容的可读性。 */
.ingestion-detail.is-result {
  --result-gold-light: #f2d77d;
  --result-gold: #c89e3e;
  --result-gold-deep: #9f6f1f;
  --result-ink: #493613;
  --result-shadow: rgb(92 58 10 / 38%);

  color: var(--result-ink);
  background:
    radial-gradient(circle, rgb(255 236 157 / 25%) 1px, transparent 1.3px) 0 0 / 20px 20px,
    radial-gradient(circle, rgb(113 72 13 / 10%) 1px, transparent 1.3px) 10px 10px / 20px 20px,
    linear-gradient(138deg, #dfc269 0%, #c69a3b 52%, #ac7926 100%);
  border: 1px solid rgb(255 232 145 / 58%);
  border-radius: 22px;
  box-shadow:
    13px 15px 32px var(--result-shadow),
    -8px -8px 24px rgb(255 230 135 / 22%),
    inset 2px 2px 5px rgb(255 235 158 / 48%),
    inset -2px -2px 5px rgb(103 63 9 / 30%);
  scrollbar-color: rgb(91 57 12 / 34%) transparent;
}

.ingestion-detail-floating-close {
  position: absolute;
  z-index: 3;
  top: -10px;
  right: -10px;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  padding: 0;
  color: #674916;
  cursor: pointer;
  background: linear-gradient(145deg, #e7ca6c, #bd8d32);
  border: 1px solid rgb(255 232 151 / 34%);
  border-radius: 50%;
  box-shadow:
    4px 4px 9px rgb(91 56 9 / 30%),
    -3px -3px 8px rgb(255 232 142 / 28%),
    inset 1px 1px 2px rgb(255 239 178 / 44%);
  backdrop-filter: blur(14px) saturate(0.82);
  transition:
    color 0.18s,
    background 0.18s,
    border-color 0.18s,
    transform 0.26s cubic-bezier(0.16, 1, 0.3, 1);
}

.ingestion-detail-floating-close:hover {
  color: #3f2b0d;
  background: linear-gradient(145deg, #efd77e, #c79738);
  box-shadow:
    3px 3px 7px rgb(91 56 9 / 34%),
    -2px -2px 6px rgb(255 235 153 / 34%),
    inset 2px 2px 4px rgb(112 70 10 / 12%);
  transform: scale(1.06);
}

.ingestion-detail-floating-close:active {
  transform: scale(0.96);
}

.ingestion-detail-floating-close:focus-visible {
  outline: 2px solid #aaa0ed;
  outline-offset: 3px;
}

.ingestion-detail-floating-close svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.7;
}

.ingestion-detail.is-result .ingestion-detail__eyebrow {
  color: #6f4b10;
  text-shadow: 0 1px rgb(255 234 154 / 48%);
}

.ingestion-detail.is-result h3 {
  color: #412e0f;
  text-shadow: 0 1px rgb(255 237 169 / 45%);
}

.ingestion-detail.is-result .ingestion-detail__lead {
  color: #5e451b;
}

.ingestion-detail.is-result > .ingestion-detail__notice,
.ingestion-detail.is-result .extraction-result-editor > .ingestion-detail__notice,
.ingestion-detail.is-result .extraction-result-section > .ingestion-detail__notice {
  color: #684817;
  background: rgb(255 233 153 / 22%);
  border-color: rgb(100 61 7 / 16%);
  box-shadow: inset 2px 2px 5px rgb(102 63 9 / 13%);
}

.ingestion-detail.is-result .extraction-result-editor {
  gap: 20px;
}

.ingestion-detail.is-result .extraction-result-section {
  gap: 16px;
  padding: 20px;
  background: linear-gradient(138deg, rgb(236 207 112 / 68%), rgb(170 119 31 / 48%));
  border: 1px solid rgb(255 232 148 / 35%);
  border-radius: 17px;
  box-shadow:
    7px 7px 16px rgb(93 57 8 / 27%),
    -5px -5px 14px rgb(255 232 143 / 23%),
    inset 2px 2px 4px rgb(255 239 176 / 35%),
    inset -2px -2px 4px rgb(101 61 7 / 18%);
}

.ingestion-detail.is-result .extraction-result-section > header {
  border-bottom-color: rgb(81 49 7 / 17%);
}

.ingestion-detail.is-result .extraction-result-section > header strong,
.ingestion-detail.is-result .extraction-result-item__heading h4,
.ingestion-detail.is-result .extraction-result-item__title {
  color: #473310;
}

.ingestion-detail.is-result .extraction-result-section > header span {
  color: #6f4c13;
  font-weight: 720;
}

.ingestion-detail.is-result .extraction-result-item {
  padding: 16px;
  background: rgb(106 67 10 / 8%);
  border-color: rgb(255 232 152 / 20%);
  border-radius: 13px;
  box-shadow:
    inset 2px 2px 5px rgb(92 56 8 / 13%),
    inset -1px -1px 3px rgb(255 235 162 / 18%);
}

.ingestion-detail.is-result .extraction-result-item__title,
.ingestion-detail.is-result .extraction-result-object__heading {
  border-bottom-color: rgb(81 49 7 / 14%);
}

.ingestion-detail.is-result .extraction-result-item__title-meta b,
.ingestion-detail.is-result .extraction-result-object .extraction-result-property b {
  color: #7d3f27;
  background: rgb(131 55 31 / 10%);
}

.ingestion-detail.is-result .extraction-result-item__title-meta i,
.ingestion-detail.is-result .extraction-result-object .extraction-result-property > span i {
  color: #67470f;
  background: rgb(255 231 143 / 18%);
}

.ingestion-detail.is-result .extraction-result-object {
  background: rgb(255 232 146 / 11%);
  border-color: rgb(87 52 7 / 10%);
  box-shadow: inset 2px 2px 5px rgb(91 55 8 / 10%);
}

.ingestion-detail.is-result .extraction-result-object.is-direct {
  background: transparent;
  box-shadow: none;
}

.ingestion-detail.is-result .extraction-result-object__heading,
.ingestion-detail.is-result .extraction-result-object .extraction-result-property > span {
  color: #5b431c;
}

.ingestion-detail.is-result .extraction-result-file-name :is(input, textarea),
.ingestion-detail.is-result .extraction-result-object input,
.ingestion-detail.is-result .extraction-result-object select,
.ingestion-detail.is-result .extraction-result-boolean-control__trigger,
.ingestion-detail.is-result .extraction-result-item textarea {
  color: #fff0bb;
  font-weight: 650;
  background: linear-gradient(135deg, #bd8e2d, #9f6e1d);
  border: 1px solid rgb(255 218 102 / 14%);
  box-shadow:
    5px 5px 10px rgb(87 51 6 / 38%),
    -4px -4px 9px rgb(255 226 126 / 25%),
    inset 2px 2px 4px rgb(91 52 5 / 28%),
    inset -2px -2px 4px rgb(255 225 124 / 24%);
  transition:
    color 0.25s ease,
    background 0.35s cubic-bezier(0.5, 0, 0.1, 1),
    border-color 0.35s ease,
    box-shadow 0.35s cubic-bezier(0.5, 0, 0.1, 1),
    transform 0.25s ease;
}

.ingestion-detail.is-result .extraction-result-boolean-control__options input {
  width: 1px;
  height: 1px;
  padding: 0;
  background: transparent;
  border: 0;
  box-shadow: none;
}

.ingestion-detail.is-result .extraction-result-file-name :is(input, textarea)::placeholder,
.ingestion-detail.is-result .extraction-result-object input::placeholder,
.ingestion-detail.is-result .extraction-result-item textarea::placeholder {
  color: rgb(255 240 187 / 55%);
}

.ingestion-detail.is-result .extraction-result-object select option {
  color: #f9e7a8;
  background: #9f6e1d;
}

.ingestion-detail.is-result .extraction-result-boolean-control__trigger > i {
  color: #ffe9a5;
}

.ingestion-detail.is-result .extraction-result-boolean-control__options {
  background: linear-gradient(145deg, rgb(119 76 14 / 94%), rgb(82 47 5 / 92%));
  border-color: rgb(255 231 147 / 32%);
  box-shadow:
    inset 1px 1px 4px rgb(255 237 169 / 28%),
    inset -1px -1px 6px rgb(58 31 2 / 34%),
    0 9px 18px rgb(64 36 3 / 31%);
}

.ingestion-detail.is-result .extraction-result-boolean-control__options label {
  color: #ead692;
}

.ingestion-detail.is-result .extraction-result-boolean-control__options label:hover,
.ingestion-detail.is-result .extraction-result-boolean-control__options input:checked + label {
  color: #fff3c2;
  text-shadow: 0 1px 7px rgb(255 234 151 / 34%);
}

.ingestion-detail.is-result .extraction-result-boolean-control__glider {
  background: linear-gradient(135deg, rgb(235 205 122 / 48%), #d1aa55e8);
  box-shadow: 0 0 15px rgb(238 204 112 / 32%), inset 0 0 9px rgb(255 239 183 / 32%);
}

.ingestion-detail.is-result .extraction-result-boolean-control__options.is-selected-true .extraction-result-boolean-control__glider {
  background: linear-gradient(135deg, rgb(102 198 137 / 48%), #72ba80e6);
  box-shadow: 0 0 16px rgb(106 207 143 / 30%), inset 0 0 9px rgb(213 255 222 / 32%);
}

.ingestion-detail.is-result .extraction-result-boolean-control__options.is-selected-false .extraction-result-boolean-control__glider {
  background: linear-gradient(135deg, rgb(230 102 151 / 48%), #d9799be6);
  box-shadow: 0 0 16px rgb(235 100 149 / 30%), inset 0 0 9px rgb(255 215 230 / 32%);
}

.ingestion-detail.is-result .extraction-result-number-control__buttons button {
  color: rgb(70 40 4 / 66%);
  background: rgb(72 39 3 / 14%);
  border-color: rgb(69 37 2 / 22%);
  box-shadow:
    inset 2px 2px 4px rgb(64 34 2 / 38%),
    inset -2px -2px 3px rgb(255 229 139 / 25%);
}

.ingestion-detail.is-result .extraction-result-number-control__buttons {
  background: linear-gradient(145deg, #895712, #bc8932);
  border-color: rgb(70 38 3 / 30%);
  box-shadow:
    inset 5px 5px 9px rgb(65 34 2 / 46%),
    inset -3px -3px 6px rgb(255 224 124 / 32%),
    0 1px 1px rgb(255 235 161 / 30%);
}

.ingestion-detail.is-result .extraction-result-number-control__button {
  background: linear-gradient(145deg, #d2aa56, #ad7828);
  box-shadow:
    0 5px 7px -3px rgb(56 29 1 / 68%),
    0 -3px 6px -2px rgb(255 233 147 / 62%),
    inset 0 -2px 3px rgb(72 39 2 / 25%),
    inset 0 2px 3px rgb(255 234 153 / 48%);
}

.ingestion-detail.is-result .extraction-result-number-control__label {
  text-shadow:
    1px 1px 2px rgb(255 229 139 / 52%),
    0 0 0 rgb(56 31 2 / 82%);
}

.ingestion-detail.is-result .extraction-result-number-control__buttons button:focus-visible {
  outline-color: rgb(255 229 132 / 72%);
}

.ingestion-detail.is-result .extraction-result-number-control__buttons button:active .extraction-result-number-control__button {
  box-shadow:
    0 1px 2px rgb(57 29 1 / 22%),
    inset -2px -2px 5px rgb(255 233 147 / 35%),
    inset 3px 3px 7px rgb(60 31 1 / 52%);
}

.ingestion-detail.is-result .extraction-result-file-name :is(input, textarea):focus,
.ingestion-detail.is-result .extraction-result-object input:focus,
.ingestion-detail.is-result .extraction-result-object select:focus,
.ingestion-detail.is-result .extraction-result-item textarea:focus {
  color: #fff4ca;
  background: linear-gradient(135deg, #b68627, #986718);
  border-color: rgb(255 221 111 / 52%);
  box-shadow:
    3px 3px 7px rgb(83 48 5 / 43%),
    -3px -3px 7px rgb(255 231 140 / 31%),
    inset 4px 4px 8px rgb(78 43 3 / 34%),
    inset -3px -3px 7px rgb(255 225 126 / 28%);
}

.ingestion-detail.is-result .extraction-result-file-name :is(input, textarea):disabled {
  color: rgb(255 240 187 / 62%);
  cursor: not-allowed;
  filter: saturate(0.7);
  opacity: 0.72;
}

.ingestion-detail.is-result .extraction-result-object .extraction-result-property.is-required-empty > input,
.ingestion-detail.is-result .extraction-result-object .extraction-result-property.is-required-empty > select,
.ingestion-detail.is-result .extraction-result-object .extraction-result-property.is-required-empty .extraction-result-number-control > input,
.ingestion-detail.is-result .extraction-result-object .extraction-result-property.is-required-empty .extraction-result-boolean-control__trigger {
  border: 1.5px solid transparent;
  background:
    linear-gradient(135deg, #bd8e2d, #9f6e1d) padding-box,
    conic-gradient(
      from var(--result-required-angle),
      transparent 0deg 198deg,
      rgb(129 88 255 / 28%) 220deg,
      #9b72ff 247deg,
      #ed65d1 278deg,
      #ffacd9 307deg,
      rgb(168 88 255 / 64%) 330deg,
      transparent 350deg 360deg
    ) border-box;
  box-shadow:
    5px 5px 10px rgb(87 51 6 / 35%),
    -4px -4px 9px rgb(255 226 126 / 22%),
    0 0 12px rgb(204 91 244 / 16%),
    inset 2px 2px 4px rgb(91 52 5 / 28%),
    inset -2px -2px 4px rgb(255 225 124 / 24%);
  animation: result-required-marquee 2.4s linear infinite;
}

@property --result-required-angle {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}

@keyframes result-required-marquee {
  to { --result-required-angle: 360deg; }
}

.ingestion-detail.is-result .extraction-result-item__clause-actions button,
.ingestion-detail.is-result .extraction-result-object__heading button {
  color: #624310;
  background: rgb(255 231 143 / 18%);
  border: 1px solid rgb(91 54 6 / 13%);
  box-shadow: inset 1px 1px 2px rgb(255 239 181 / 30%);
}

.ingestion-detail.is-result .extraction-result-item__clause-actions button:hover,
.ingestion-detail.is-result .extraction-result-object__heading button:hover {
  color: #3e2a0c;
  background: #dfbc53;
  border-color: rgb(255 233 151 / 34%);
}

.ingestion-detail.is-result .extraction-result-item__clause-actions button.is-danger {
  color: #7d3831;
  background: rgb(172 61 48 / 8%);
  border-color: rgb(132 48 38 / 18%);
}

.ingestion-detail.is-result .extraction-result-item__clause-actions button.is-danger:hover {
  color: #fff4e8;
  background: #a64c40;
  border-color: #a64c40;
}

.ingestion-detail.is-result .extraction-result-item__markdown {
  color: #493916;
  background: rgb(255 245 204 / 52%);
  border-color: rgb(92 57 8 / 12%);
  box-shadow:
    inset 2px 2px 5px rgb(92 57 8 / 12%),
    inset -1px -1px 3px rgb(255 248 216 / 28%);
}

.ingestion-detail.is-result .extraction-result-item__markdown-empty,
.ingestion-detail.is-result .extraction-result-item__empty {
  color: #654a1d;
  background: rgb(255 237 173 / 20%);
  border-color: rgb(90 54 7 / 17%);
}

.ingestion-detail.is-result .extraction-result-item__markdown-empty:hover {
  color: #432f0f;
  background: rgb(255 242 190 / 35%);
  border-color: rgb(91 55 7 / 28%);
}

.ingestion-detail.is-result .extraction-result-item__add,
.ingestion-detail.is-result .ingestion-detail__primary:disabled {
  color: #49330f;
  background: linear-gradient(135deg, #e4c253, #d5a73c, #c58f2d);
  border: 1px solid rgb(255 232 141 / 23%);
  box-shadow:
    7px 7px 14px rgb(91 55 7 / 32%),
    -5px -5px 12px rgb(255 231 139 / 28%),
    inset 2px 2px 4px rgb(255 239 176 / 38%),
    inset -2px -2px 4px rgb(101 61 7 / 21%);
}

.ingestion-detail.is-result .extraction-result-item__add:hover {
  color: #38260a;
  background: linear-gradient(135deg, #ead064, #dcb344, #c8952e);
  border-color: rgb(255 236 160 / 35%);
  transform: translateY(-1px);
}

.ingestion-detail.is-result .ingestion-detail__primary:disabled {
  cursor: not-allowed;
  opacity: 0.72;
  transform: none;
}

.ingestion-detail-enter-active {
  transition:
    opacity 0.32s ease,
    filter 0.42s ease,
    transform 0.52s cubic-bezier(0.16, 1, 0.3, 1);
}

.ingestion-detail-leave-active {
  transition:
    opacity 0.42s ease,
    filter 0.36s ease,
    transform 0.44s cubic-bezier(0.4, 0, 0.7, 0.2);
}

.ingestion-detail-enter-from {
  opacity: 0;
  filter: blur(8px);
  transform: translateX(44px) scale(0.97);
}

.ingestion-detail-leave-to {
  opacity: 0;
  filter: blur(7px);
  transform: translateX(calc(100% + 40px)) scale(0.98);
}

@keyframes flow-reveal {
  from { stroke-dashoffset: 100; opacity: 0.2; }
  to { stroke-dashoffset: 0; opacity: 0.88; }
}

@keyframes flow-comet {
  from { stroke-dashoffset: 100; }
  to { stroke-dashoffset: 0; }
}

@keyframes flow-success-settle {
  0% {
    opacity: 0.88;
    stroke: #6557d6;
    stroke-width: 2.6;
  }
  48% {
    opacity: 1;
    stroke: #83d4a5;
    stroke-width: 4;
  }
  100% {
    opacity: 1;
    stroke: #59a77d;
    stroke-width: 2.15;
  }
}

@keyframes flow-success-sweep {
  0% {
    opacity: 0.95;
    stroke-dashoffset: 100;
  }
  72% {
    opacity: 0.82;
  }
  100% {
    opacity: 0;
    stroke-dashoffset: 0;
  }
}

@keyframes flow-failure-settle {
  0% {
    opacity: 0.88;
    stroke: #6557d6;
    stroke-width: 2.6;
  }
  45% {
    opacity: 0.68;
    stroke: #e28b80;
    stroke-width: 3.2;
  }
  100% {
    opacity: 0.3;
    stroke: #d5786c;
    stroke-width: 1.6;
  }
}

@keyframes flow-failure-texture {
  from { opacity: 0; stroke-dashoffset: -12; }
  to { opacity: 0.78; stroke-dashoffset: 0; }
}

@keyframes flow-retract {
  from { opacity: 0.9; stroke-dashoffset: 0; }
  to { opacity: 0.08; stroke-dashoffset: 100; }
}

@keyframes flow-retract-comet {
  from { opacity: 0.9; stroke-dashoffset: 0; }
  to { opacity: 0; stroke-dashoffset: 100; }
}

@keyframes port-relay {
  0%, 100% {
    box-shadow: 0 0 0 1px var(--stage-color-soft), 0 3px 8px #33443b21;
  }
  50% {
    box-shadow: 0 0 0 6px var(--stage-color-soft), 0 3px 12px #33443b2b;
  }
}

@keyframes stage-finalizing {
  to { background-position: -220% 0; }
}

@keyframes stage-progress-glint {
  0%, 18% { transform: translateX(-130%); }
  72%, 100% { transform: translateX(130%); }
}

@keyframes workflow-stage-cube {
  0% {
    transform: rotate(45deg) rotateX(-25deg) rotateY(25deg);
  }
  50% {
    transform: rotate(45deg) rotateX(-385deg) rotateY(25deg);
  }
  100% {
    transform: rotate(45deg) rotateX(-385deg) rotateY(385deg);
  }
}

@keyframes duplication-loader-bars {
  from { background-position: left; }
  to { background-position: right; }
}

@keyframes duplication-loader-search {
  from { transform: translateX(0) rotate(70deg); }
  to { transform: translateX(43px) rotate(10deg); }
}

@keyframes duplication-loader-enter {
  from {
    opacity: 0;
    filter: blur(3px);
    transform: translateY(3px) scale(0.96);
  }
  to {
    opacity: 1;
    filter: blur(0);
    transform: translateY(0) scale(1);
  }
}

@keyframes duplication-loader-leave {
  from {
    opacity: 1;
    filter: blur(0);
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    filter: blur(3px);
    transform: translateY(-3px) scale(0.97);
  }
}

@keyframes structure-page-two {
  0% { opacity: 0; transform: rotateY(180deg); }
  20% { opacity: 1; }
  35%, 100% { opacity: 0; }
  50%, 100% { transform: rotateY(0deg); }
}

@keyframes structure-page-three {
  15% { opacity: 0; transform: rotateY(180deg); }
  35% { opacity: 1; }
  50%, 100% { opacity: 0; }
  65%, 100% { transform: rotateY(0deg); }
}

@keyframes structure-page-four {
  30% { opacity: 0; transform: rotateY(180deg); }
  50% { opacity: 1; }
  65%, 100% { opacity: 0; }
  80%, 100% { transform: rotateY(0deg); }
}

@keyframes structure-page-five {
  45% { opacity: 0; transform: rotateY(180deg); }
  65% { opacity: 1; }
  80%, 100% { opacity: 0; }
  95%, 100% { transform: rotateY(0deg); }
}

@keyframes classification-route-flow {
  to { stroke-dashoffset: -14; }
}

@keyframes classification-scan {
  from { transform: translateX(0); opacity: 0.6; }
  to { transform: translateX(11px); opacity: 1; }
}

@keyframes classification-sort-top {
  0%, 4% { opacity: 0; transform: translate(7px, 17px) rotate(-5deg) scale(0.9); }
  10% { opacity: 1; }
  34% { opacity: 1; transform: translate(40px, 17px) rotate(0) scale(0.94); }
  48% { opacity: 1; transform: translate(44px, 17px) rotate(0) scale(0.86); }
  82% { opacity: 1; transform: translate(78px, 0) rotate(2deg) scale(0.82); }
  92%, 100% { opacity: 0; transform: translate(78px, 0) rotate(2deg) scale(0.72); }
}

@keyframes classification-sort-middle {
  0%, 4% { opacity: 0; transform: translate(7px, 17px) rotate(-5deg) scale(0.9); }
  10% { opacity: 1; }
  34% { opacity: 1; transform: translate(40px, 17px) rotate(0) scale(0.94); }
  48% { opacity: 1; transform: translate(44px, 17px) rotate(0) scale(0.86); }
  82% { opacity: 1; transform: translate(78px, 17px) rotate(0) scale(0.82); }
  92%, 100% { opacity: 0; transform: translate(78px, 17px) rotate(0) scale(0.72); }
}

@keyframes classification-sort-bottom {
  0%, 4% { opacity: 0; transform: translate(7px, 17px) rotate(-5deg) scale(0.9); }
  10% { opacity: 1; }
  34% { opacity: 1; transform: translate(40px, 17px) rotate(0) scale(0.94); }
  48% { opacity: 1; transform: translate(44px, 17px) rotate(0) scale(0.86); }
  82% { opacity: 1; transform: translate(78px, 34px) rotate(-2deg) scale(0.82); }
  92%, 100% { opacity: 0; transform: translate(78px, 34px) rotate(-2deg) scale(0.72); }
}

@keyframes classification-bin-pulse {
  0%, 68%, 100% { filter: brightness(1); transform: scale(1); }
  76% { filter: brightness(1.08); transform: scale(1.08); }
  86% { filter: brightness(1); transform: scale(1); }
}

@keyframes apple-success-disc {
  0% {
    opacity: 0;
    transform: scale(0.18);
  }
  58% {
    opacity: 1;
    transform: scale(1.14);
  }
  78% { transform: scale(0.96); }
  100% { transform: scale(1); }
}

@keyframes apple-success-halo {
  0% {
    opacity: 0.42;
    transform: scale(0.72);
  }
  100% {
    opacity: 0;
    transform: scale(1.42);
  }
}

@keyframes apple-success-check {
  to { stroke-dashoffset: 0; }
}

@keyframes workflow-failure-disc {
  0% {
    opacity: 0;
    transform: scale(0.18);
  }
  58% {
    opacity: 1;
    transform: scale(1.12);
  }
  78% { transform: scale(0.97); }
  100% { transform: scale(1); }
}

@keyframes workflow-failure-halo {
  0% {
    opacity: 0.38;
    transform: scale(0.72);
  }
  100% {
    opacity: 0;
    transform: scale(1.42);
  }
}

@keyframes workflow-failure-cross {
  to { stroke-dashoffset: 0; }
}

@keyframes workflow-failure-nudge {
  0%, 100% { transform: translateX(0); }
  28% { transform: translateX(-1.4px); }
  55% { transform: translateX(1px); }
  78% { transform: translateX(-0.45px); }
}

@keyframes document-rejected-enter {
  from { opacity: 0; filter: blur(2px); transform: translateY(3px) scale(0.82); }
  to { opacity: 1; filter: blur(0); transform: translateY(0) scale(1); }
}

@keyframes ingestion-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(0.72); opacity: 0.62; }
}

@keyframes result-arrival {
  0% { transform: scale(1); }
  35% { transform: scale(1.025); }
  100% { transform: scale(1); }
}

@keyframes result-halo {
  0% { opacity: 0; transform: scale(0.55); }
  35% { opacity: 1; }
  100% { opacity: 0; transform: scale(1.5); }
}

@keyframes pdf-cover-skeleton {
  0%, 12% { transform: translateX(-120%); }
  82%, 100% { transform: translateX(220%); }
}

@media (max-width: 1050px) {
  .ingestion-validation-panel {
    z-index: 3;
    right: auto;
    left: 18px;
    width: min(310px, calc(100% - 36px));
    padding-right: 20px;
    border-radius: 18px;
  }
}

@media (max-height: 790px) {
  .workflow-canvas {
    height: 590px;
    transform: scale(0.9);
    transform-origin: top left;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ingestion-validation-panel,
  .ingestion-validation-panel li,
  .ingestion-validation-panel li button,
  .ingestion-validation-panel__mark {
    transition: none;
  }

  .ingestion-validation-panel li.is-resolved .ingestion-validation-panel__mark {
    transform: none;
  }

  .extraction-result-file-name.is-issue-focused,
  .extraction-result-section.is-issue-focused,
  .extraction-result-item.is-issue-focused,
  .extraction-result-property.is-issue-focused,
  .clause-review-item-shell.is-issue-focused {
    animation: none;
    box-shadow: 0 0 0 3px rgb(207 95 88 / 24%);
  }

  .extraction-ingestion-button,
  .extraction-ingestion-button::after,
  .extraction-ingestion-button__outline,
  .extraction-ingestion-button__icon {
    transition: none;
  }

  .extraction-ingestion-button:hover:not(:disabled),
  .extraction-ingestion-button:hover:not(:disabled)::after,
  .extraction-ingestion-button:hover:not(:disabled) .is-default .extraction-ingestion-button__icon {
    transform: none;
  }

  .extraction-ingestion-button__outline::before,
  .extraction-ingestion-button__label i,
  .extraction-ingestion-button__state.is-default .extraction-ingestion-button__icon svg,
  .extraction-ingestion-button.is-submitting .is-default .extraction-ingestion-button__icon svg,
  .extraction-ingestion-button.is-submitting .is-default .extraction-ingestion-button__icon::before,
  .extraction-ingestion-button.is-sent .is-sent .extraction-ingestion-button__icon svg {
    animation: none;
  }

  .extraction-ingestion-button__label i,
  .extraction-ingestion-button.is-submitting .is-default .extraction-ingestion-button__label i,
  .extraction-ingestion-button.is-sent .is-sent .extraction-ingestion-button__icon svg {
    color: inherit;
    opacity: 1;
    filter: none;
    transform: none;
  }

  .extraction-ingestion-button.is-submitting .is-default .extraction-ingestion-button__icon::before {
    display: none;
  }

  .contract-runs-empty-enter-active {
    transition: none;
  }

  .workflow-scroll-extension {
    transition: none;
  }

  .workflow-link.is-running .workflow-link__signal,
  .workflow-link.is-running .workflow-link__comet,
  .workflow-link.is-success .workflow-link__signal,
  .workflow-link.is-success .workflow-link__comet,
  .workflow-link.is-failed .workflow-link__signal,
  .workflow-link.is-failed .workflow-link__comet,
  .workflow-stage-node.is-running::before,
  .workflow-stage-node.is-running::after,
  .workflow-stage-node.is-retrying::before,
  .workflow-stage-node.is-retrying::after,
  .workflow-stage-node.is-running .workflow-stage-node__state i,
  .workflow-stage-node.is-retrying .workflow-stage-node__state i,
  .workflow-stage-node__cube-spinner,
  .workflow-duplication-loader,
  .workflow-duplication-loader__bars i,
  .workflow-duplication-loader svg,
  .workflow-structure-loader,
  .workflow-structure-loader__book li,
  .workflow-classification-loader,
  .workflow-classification-loader__routes,
  .workflow-classification-loader__scanner i,
  .workflow-classification-loader__bin,
  .workflow-classification-loader__document,
  .workflow-stage-node__success-halo,
  .workflow-stage-node__success-disc,
  .workflow-stage-node__success-check,
  .workflow-stage-node__failure,
  .workflow-stage-node__failure-halo,
  .workflow-stage-node__failure-disc,
  .workflow-stage-node__failure-cross,
  .workflow-stage-node__document-rejected,
  .workflow-stage-node__progress span::after,
  .workflow-stage-node__progress.is-finalizing span,
  .workflow-input-node__cover-loading i::after,
  .workflow-result-node.is-updating,
  .is-updating .workflow-result-node__halo,
  .classification-stage-result,
  .classification-stage-result__categories article,
  .deduplication-candidate,
  .deduplication-candidate__track i,
  .deduplication-candidate button > i,
  .capy,
  .capyhead,
  .capyleg,
  .capyleg2,
  .capybara-track__line,
  .contract-runs-list__activity i,
  .contract-runs-list li.is-edge-active::after,
  .contract-runs-list li.is-restoring .contract-runs-list__document > i,
  .contract-runs-list li.is-data-updated .contract-runs-list__refresh-wash,
  .ingestion-detail.is-result .extraction-result-object .extraction-result-property.is-required-empty > input,
  .ingestion-detail.is-result .extraction-result-object .extraction-result-property.is-required-empty > select,
  .ingestion-detail.is-result .extraction-result-object .extraction-result-property.is-required-empty .extraction-result-number-control > input,
  .ingestion-detail.is-result .extraction-result-object .extraction-result-property.is-required-empty .extraction-result-boolean-control__trigger {
    animation: none;
  }

  .workflow-stage-node__success-check,
  .workflow-stage-node__failure-cross {
    stroke-dashoffset: 0;
  }

  .workflow-stage-node__progress span {
    transition: none;
  }

  .core-review-item-enter-active,
  .core-review-item-leave-active,
  .core-review-item-move,
  .clause-review-list,
  .core-review-empty-enter-active,
  .core-review-empty-leave-active {
    transition: none;
  }

  .ingestion-detail.is-result .extraction-result-object .extraction-result-property.is-required-empty > input,
  .ingestion-detail.is-result .extraction-result-object .extraction-result-property.is-required-empty > select,
  .ingestion-detail.is-result .extraction-result-object .extraction-result-property.is-required-empty .extraction-result-number-control > input,
  .ingestion-detail.is-result .extraction-result-object .extraction-result-property.is-required-empty .extraction-result-boolean-control__trigger {
    background:
      linear-gradient(135deg, #bd8e2d, #9f6e1d) padding-box,
      linear-gradient(135deg, #9070ff, #f06bcf) border-box;
  }
}
</style>
