import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { runnerPlugin } from './runner/plugin.mjs';

export default defineConfig({
  plugins: [vue(), runnerPlugin()],
  resolve: { preserveSymlinks: true, dedupe: ['@codemirror/state', '@codemirror/view', '@codemirror/language'] },
  server: { port: 5173, strictPort: true, proxy: { '/api': { target:process.env.TESTPILOT_BACKEND_URL || 'http://127.0.0.1:8081', changeOrigin:false } } },
  preview: { port: 5173, strictPort: true, proxy: { '/api': { target:process.env.TESTPILOT_BACKEND_URL || 'http://127.0.0.1:8081', changeOrigin:false } } },
  build: { rollupOptions: { output: { manualChunks(id) {
    if (id.includes('/node_modules/echarts/')) return 'echarts';
    if (id.includes('/node_modules/zrender/')) return 'chart-renderer';
    if (id.includes('/node_modules/@codemirror/') || id.includes('/node_modules/@lezer/')) return 'code-editor';
  } } } },
});
