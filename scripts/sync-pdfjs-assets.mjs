import { cp, mkdir, rename, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'))
const publicRoot = join(projectRoot, 'public')
const targetRoot = join(publicRoot, 'pdfjs')
const temporaryRoot = join(publicRoot, `.pdfjs-sync-${process.pid}`)
const assetDirectories = ['cmaps', 'standard_fonts', 'wasm']

async function requireDirectory(path, label) {
  let pathStat

  try {
    pathStat = await stat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`pdfjs-dist 缺少 ${label} 资源目录：${path}`)
    }
    throw error
  }

  if (!pathStat.isDirectory()) {
    throw new Error(`pdfjs-dist 的 ${label} 资源路径不是目录：${path}`)
  }
}

async function syncPdfjsAssets() {
  await Promise.all(assetDirectories.map((directoryName) => (
    requireDirectory(join(pdfjsRoot, directoryName), directoryName)
  )))

  await mkdir(publicRoot, { recursive: true })
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot)

  try {
    await Promise.all(assetDirectories.map((directoryName) => (
      cp(
        join(pdfjsRoot, directoryName),
        join(temporaryRoot, directoryName),
        { recursive: true, force: true },
      )
    )))

    // 整体替换目标目录，避免升级 PDF.js 后残留旧版本资源。
    await rm(targetRoot, { recursive: true, force: true })
    await rename(temporaryRoot, targetRoot)
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true })
    throw error
  }

  console.log(`PDF.js 运行时资源已同步到 ${targetRoot}`)
}

await syncPdfjsAssets()
