import { sendRequest, runCollection } from './http.mjs';
import { browserPath, runUi, inspectPage, availableBrowsers, openBrowser } from './browser.mjs';
import { parseImport, parseCurl } from './importers.mjs';
import { runtimeCapabilities, withRuntimeSettings } from './runtime.mjs';
import { backend } from './backend.mjs';
import { toolchain } from './toolchain.mjs';
import { getJob, publicJob, startJob, cancelJob, readArtifact, cancelAllJobs } from './jobs.mjs';
import { runPerformance } from './performance.mjs';
import { runUnit } from './unit.mjs';
import { runSecurity } from './security.mjs';
import { runCompatibility } from './compatibility.mjs';
const activeControllers=new Set();
async function shutdown() { for(const controller of activeControllers)controller.abort();await cancelAllJobs(); }

export function runnerMiddleware(req, res, next) {
  if (!req.url?.startsWith('/__runner/')) return next();
  const send = (status, value) => { if (res.destroyed) return; res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const controller = new AbortController();
  activeControllers.add(controller);
  const timer = setTimeout(() => controller.abort(), 180000);
  res.once('close', () => { clearTimeout(timer); if (!res.writableEnded) controller.abort(); });
  (async () => {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return send(403, { message: '仅允许从当前平台调用执行器' });
    const route = req.url.split('?')[0].slice('/__runner/'.length);
    if (route === 'health' && req.method === 'GET') return send(200, { data: { browser: Boolean(browserPath()), engine: 'Playwright + Newman' } });
    await backend(req,'auth/me');
    const settings = await backend(req,'platform/settings');
    return withRuntimeSettings(settings.executor, async () => {
    if (route === 'capabilities' && req.method === 'GET') return send(200, { data: { ...await runtimeCapabilities(), browsers: availableBrowsers() } });
    if (route === 'toolchain' && req.method === 'GET') return send(200, { data: await toolchain() });
    const asset = /^artifact\/([a-f\d-]{36})\/([\w.-]+)$/.exec(route);
    if (asset && req.method === 'GET') {
      const bytes = await readArtifact(asset[1], asset[2]);
      res.writeHead(200, { 'Content-Type': asset[2].endsWith('.png') ? 'image/png' : 'application/octet-stream', 'Cache-Control': 'no-store', ...(asset[2].endsWith('.png') ? {} : { 'Content-Disposition': `attachment; filename="${asset[2]}"` }) });
      return res.end(bytes);
    }
    if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json')) return send(405, { message: '请使用 JSON POST 请求' });
    let raw = '';
    for await (const chunk of req) { raw += chunk.toString('utf8'); if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('请求配置超过 2 MB'); }
    let body;
    try { body = JSON.parse(raw); } catch { throw new Error('请求配置不是有效 JSON'); }
    const variables = body.variables || {};
    let data;
    switch (route) {
      case 'request': data = await sendRequest(body.draft, variables, controller.signal); break;
      case 'collection': data = await runCollection(body.cases, variables, controller.signal); break;
      case 'ui/run': data = await runUi(body.draft, variables, controller.signal); break;
      case 'ui/inspect': data = await inspectPage(body.url, variables, controller.signal); break;
      case 'ui/compose': data = await backend(req,'platform/ai/compose','POST',{text:body.text}); break;
      case 'browser/test': { const session=await openBrowser(controller.signal); await session.close(); data={available:true,path:browserPath()}; break; }
      case 'import/spec': data = parseImport(body.spec); break;
      case 'import/curl': data = parseCurl(body.text); break;
      case 'jobs/start': {
        const runners = { perf: runPerformance, unit: runUnit, security: runSecurity, compat: runCompatibility };
        if (!runners[body.kind]) throw new Error('不支持的执行类型');
        data = await startJob(body.kind, body.payload, variables, runners[body.kind]); break;
      }
      case 'jobs/get': data = publicJob(await getJob(body.id)); break;
      case 'jobs/cancel': data = await cancelJob(body.id); break;
      default: return send(404, { message: '执行入口不存在' });
    }
    send(200, { data });
    });
  })().catch(error => send(error.status || 400, { message: controller.signal.aborted ? '执行已取消或超过 180 秒，请缩短流程后重试' : error.message }))
    .finally(() => {clearTimeout(timer);activeControllers.delete(controller);});
}
export function runnerPlugin() {
  return { name: 'testpilot-local-execution', api:{shutdown}, configureServer(server) { server.middlewares.use(runnerMiddleware); },
    configurePreviewServer(server) { server.middlewares.use(runnerMiddleware); } };
}
