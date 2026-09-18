import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/dev/contract/',
  plugins: [vue()],
  build: {
    // 图标独立输出，使用带内容哈希的 URL 和浏览器图片缓存。
    assetsInlineLimit: (filePath) => /\.(?:avif|webp|png|jpe?g|gif|svg|ico|bmp|tiff?|apng)$/i.test(filePath) ? false : undefined,
  },
  // 网关拦截隐藏目录，预打包缓存使用普通目录以支持图引擎依赖。
  cacheDir: 'node_modules/vite-cache',
  optimizeDeps: {
    include: ['3d-force-graph', 'three'],
    // Nginx 会拦截依赖预打包 URL 中的 `/.vite/` 隐藏目录段。
    exclude: ['pdfjs-dist'],
  },
  server: {
    host: '0.0.0.0',
    port: 20080,
    strictPort: true,
    allowedHosts: ['pheno.szkl.com'],
    proxy: {
      '/contract/api': {
        target: 'http://127.0.0.1:20000',
        changeOrigin: true,
      },
    },
  },
})
