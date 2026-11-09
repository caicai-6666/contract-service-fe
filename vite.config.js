import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'
import { developmentCompression } from './config/developmentCompression.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'CONTRACT_')
  const target = env.CONTRACT_BACKEND_URL || 'http://127.0.0.1:17000'
  const backendUrl = new URL(target)
  if (!['http:', 'https:'].includes(backendUrl.protocol) || backendUrl.username || backendUrl.password ||
      backendUrl.pathname !== '/' || backendUrl.search || backendUrl.hash) {
    throw new Error('CONTRACT_BACKEND_URL 必须为不含凭据、路径、查询或片段的 HTTP/HTTPS 根地址')
  }
  return {
    base: '/dev/knowledge-accumulation/contract/',
    plugins: [vue(), developmentCompression()],
    build: {
      // 图标独立输出，使用带内容哈希的 URL 和浏览器图片缓存。
      assetsInlineLimit: (filePath) => /\.(?:avif|webp|png|jpe?g|gif|svg|ico|bmp|tiff?|apng)$/i.test(filePath) ? false : undefined,
    },
    // 非隐藏目录可通过网关，放在 node_modules 外避免安装依赖时被清理。
    cacheDir: 'cache/vite',
    optimizeDeps: {
      include: ['3d-force-graph', 'three'],
      // Nginx 会拦截依赖预打包 URL 中的 `/.vite/` 隐藏目录段。
      exclude: ['pdfjs-dist'],
    },
    server: {
      host: '0.0.0.0',
      port: 17080,
      strictPort: true,
      allowedHosts: ['talent.szkl.com'],
      warmup: { clientFiles: ['./src/main.js', './src/components/ContractLibraryView.vue'] },
      proxy: {
        '/dev/knowledge-accumulation/contract/api': {
          target,
          changeOrigin: true,
        },
      },
    },
  }
})
