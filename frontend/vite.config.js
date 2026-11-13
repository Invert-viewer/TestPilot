import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const target = 'http://127.0.0.1:8080'

/** A dead backend must reach the UI as a named cause, not an empty HTTP 500 from the proxy. */
function backendUnavailable(proxy) {
  proxy.on('error', (error, req, res) => {
    if (!res || typeof res.writeHead !== 'function') return
    if (res.headersSent) { res.end(); return }
    const body = JSON.stringify({
      code: 'BACKEND_UNAVAILABLE',
      message: `无法连接后端服务（${target}）：请先在 8080 端口启动 Spring Boot，再刷新页面。`,
      data: {},
      traceId: `proxy-${Date.now().toString(36)}`,
    })
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(body)
  })
}

const proxy = { '/api': { target, changeOrigin: true, configure: backendUnavailable } }

export default defineConfig({ plugins: [vue()], server: { port: 5173, strictPort: true, proxy }, preview: { port: 4173, proxy } })
