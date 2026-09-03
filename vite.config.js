import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/dev/contract/',
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 10080,
    strictPort: true,
    allowedHosts: ['pheno.szkl.com'],
    proxy: {
      '/contract/api': {
        target: 'http://127.0.0.1:10000',
        changeOrigin: true,
      },
    },
  },
})
