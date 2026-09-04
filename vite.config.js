import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/dev/contract/',
  plugins: [vue()],
  optimizeDeps: {
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
