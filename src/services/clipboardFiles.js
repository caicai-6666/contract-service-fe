const extensions = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/avif': 'avif' }

export function clipboardFiles(clipboard) {
  if (!clipboard) return []
  // 两种表示通常指向同一批文件，只读取其中一种，避免一份附件添加两次。
  const items = Array.from(clipboard.items ?? []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean)
  const files = items.length ? items : Array.from(clipboard.files ?? [])
  return files.map((file, index) => {
    const extension = extensions[file.type]
    if (!extension || /\.[^./]+$/.test(file.name)) return file
    const name = file.name.trim() || `粘贴文件-${index + 1}`
    return new File([file], `${name}.${extension}`, { type: file.type, lastModified: file.lastModified })
  })
}
