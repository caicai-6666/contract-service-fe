import { createExtractionRun } from './contractExtractionApi.js'
import { getSelectedFileKind, convertImageFileToPdf } from './local-file-pdf.js'

export function validateBatchFiles(files) {
  if (!files.length || files.length > 5) throw new Error('每批请选择 1～5 份文件')
  for (const file of files) {
    if (!getSelectedFileKind(file)) throw new Error(`${file.name}：请选择 PDF 或支持的图片`)
    if (!file.size) throw new Error(`${file.name}：文件内容为空`)
  }
}

export function createBatchExtraction({ items, onCreated = () => {}, create = createExtractionRun, convert = convertImageFileToPdf, waitingNoticeMs = 60000 }) {
  let busy = false, disposed = false
  const controllers = new Set()
  const waitingTimers = new Set()
  async function start() {
    if (busy || disposed) return
    busy = true
    try {
      // 只排序调度副本，界面保持选择顺序；以原文件大小决定图片转换前的优先级。
      const pending = items.filter(item => item.status === 'queued' && !item.runId)
        .sort((left, right) => left.file.size - right.file.size)
      let nextIndex = 0, authorizationFailed = false
      async function submitItem(item) {
        if (disposed) return
        let submitted = false
        let waitingTimer = null
        const controller = new AbortController()
        controllers.add(controller)
        item.error = ''
        item.waitingLong = false
        try {
          item.status = 'preparing'
          const file = item.pdf || (getSelectedFileKind(item.file) === 'pdf' ? item.file : await convert(item.file))
          if (disposed) return
          item.pdf = file
          item.status = 'submitting'
          item.attempts++
          submitted = true
          // 仅改变等待提示，不中断原请求、不释放并发名额，也不重复创建。
          waitingTimer = setTimeout(() => {
            waitingTimers.delete(waitingTimer)
            if (!disposed && item.status === 'submitting') item.waitingLong = true
          }, waitingNoticeMs)
          waitingTimers.add(waitingTimer)
          const snapshot = await create(file, { signal: controller.signal, fileName: file.name })
          if (disposed) return
          const id = snapshot?.run?.run_id
          if (typeof id !== 'string' || !id.trim()) throw new Error('创建响应缺少 run_id')
          item.runId = id
          item.status = 'created'
          item.file = null
          item.pdf = null
          onCreated(id)
        } catch (error) {
          if (disposed) return
          const definiteFailure = !submitted || [400, 401, 403, 413, 422].includes(error?.status)
          item.status = definiteFailure ? 'failed' : 'uncertain'
          item.error = definiteFailure ? (error?.message || '文件处理失败') : '未能确认是否创建成功，请先核对处理任务列表，避免重复创建。'
          if ([401, 403].includes(error?.status)) authorizationFailed = true
        } finally {
          clearTimeout(waitingTimer)
          waitingTimers.delete(waitingTimer)
          controllers.delete(controller)
          if (!disposed) item.waitingLong = false
        }
      }
      async function worker() {
        while (!disposed && !authorizationFailed && nextIndex < pending.length) {
          const item = pending[nextIndex++]
          await submitItem(item)
        }
      }
      // 转换和创建共用两个名额，避免图片同时解码也造成内存峰值。
      await Promise.all(Array.from({ length: Math.min(2, pending.length) }, worker))
    } finally { busy = false }
  }
  return {
    start,
    get busy() { return busy },
    dispose() { disposed = true; waitingTimers.forEach(clearTimeout); waitingTimers.clear(); controllers.forEach(controller => controller.abort()); controllers.clear(); items.forEach(item => { item.file = null; item.pdf = null }) },
  }
}
