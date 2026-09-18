export function modelContractReferences(items = []) {
  if (!Array.isArray(items)) throw new Error('引用合同快照格式无效')
  return items.map((item) => {
    if (!item || typeof item.document_id !== 'string' || !/^[a-f0-9]{64}$/.test(item.document_id) || typeof item.file_name !== 'string'
      || !(item.summary === null || typeof item.summary === 'string')) throw new Error('引用合同快照格式无效')
    return { document_id: item.document_id, file_name: item.file_name, summary: item.summary }
  })
}
