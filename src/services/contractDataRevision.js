import { ref } from 'vue'

// 当前登录页面内的写操作通知，不持久化合同数据。
export const contractDataRevision = ref(0)
export function invalidateContractData() { contractDataRevision.value++ }

// 入库单独通知目录，避免新增注意事项或关系时重复拉取整个合同库。
export const contractIngestionRevision = ref(0)
export function notifyContractIngested() {
  invalidateContractData()
  contractIngestionRevision.value++
}

export const reviewDataRevision = ref({ ingestion: 0, deletion: 0 })
export function invalidateReviewData(kind) {
  reviewDataRevision.value = { ...reviewDataRevision.value, [kind]: reviewDataRevision.value[kind] + 1 }
}
