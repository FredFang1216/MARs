import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../src/shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3456',
      '/ws': {
        target: 'http://127.0.0.1:3456',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
})
