'use strict';
// Dependency-free local host for the prebuilt Vue app. This is a platform API
// proxy, never an executor for the URL/Headers/Cookies entered in Request Debug.
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const HOP_HEADERS = new Set(['host','connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.map':'application/json'};

function readConfiguration(root, args = []) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
  let shutdownAfterMs = 0;
  for (const arg of args) {
    if (arg === '--no-open') config.openBrowser = false;
    else if (arg.startsWith('--port=')) config.port = Number(arg.slice(7));
    else if (arg.startsWith('--backend-url=')) config.backendUrl = arg.slice(14);
    else if (arg.startsWith('--shutdown-after-ms=')) shutdownAfterMs = Number(arg.slice(20));
    else throw new Error('不支持的启动参数。可使用 --no-open、--port=数字 或 --backend-url=http://地址:端口。');
  }
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('config.json 的 port 须为 0～65535 的整数。');
  if (typeof config.openBrowser !== 'boolean') throw new Error('config.json 的 openBrowser 须为 true 或 false。');
  let backend;
  try { backend = new URL(config.backendUrl); } catch { throw new Error('config.json 的 backendUrl 不是有效的 HTTP(S) 地址。'); }
  if (!['http:','https:'].includes(backend.protocol) || backend.username || backend.password || backend.search || backend.hash || backend.pathname !== '/') {
    throw new Error('backendUrl 请只填后端的协议、主机和端口，不含凭据、路径、查询或片段。');
  }
  const startPage = config.startPage ?? '/#/debug';
  if (typeof startPage !== 'string' || !startPage.startsWith('/#/') || /[\r\n\\]/.test(startPage)) throw new Error('startPage 应为 /#/debug 等本地页面。');
  if (!Number.isInteger(shutdownAfterMs) || shutdownAfterMs < 0) throw new Error('自动停止时间无效。');
  const dist = fs.realpathSync(path.join(root, 'dist'));
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('缺少 dist/index.html，请完整解压交付包。');
  return { port: config.port, backend, openBrowser: config.openBrowser, startPage, shutdownAfterMs, dist };
}

function jsonError(res, status, code, message) {
  if (res.headersSent) { res.destroy(); return; }
  const body = JSON.stringify({ code, message, data: null, traceId: crypto.randomUUID() });
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(body);
}
function copyHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP_HEADERS.has(name.toLowerCase())));
}
function createRuntime(config) {
  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch { jsonError(res,400,'INVALID_URL','请求地址无效'); return; }
    if (url.pathname === '/__testpilot__/health' && req.method === 'GET') {
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify({ name:'TestPilot Frontend', frontend:true, backendIncluded:false, port:server.address().port }));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const localPort = server.address().port;
      if (['localhost','127.0.0.1','[::1]'].includes(config.backend.hostname) && Number(config.backend.port || (config.backend.protocol === 'https:' ? 443 : 80)) === localPort) {
        jsonError(res,502,'BACKEND_CONFIGURATION_ERROR','后端地址指向了前端自身，请把 backendUrl 改为 Spring Boot 地址。'); return;
      }
      const target = new URL(url.pathname + url.search, config.backend);
      const transport = target.protocol === 'https:' ? https : http;
      const upstream = transport.request(target, { method:req.method, headers:{...copyHeaders(req.headers),host:target.host},timeout:20000 }, response => {
        res.writeHead(response.statusCode || 502, copyHeaders(response.headers));
        response.on('error', () => res.destroy());
        response.pipe(res);
      });
      upstream.on('timeout', () => upstream.destroy(new Error('PLATFORM_TIMEOUT')));
      upstream.on('error', error => jsonError(res,502,error.message === 'PLATFORM_TIMEOUT' ? 'BACKEND_TIMEOUT' : 'BACKEND_UNAVAILABLE',
        error.message === 'PLATFORM_TIMEOUT' ? '平台后端响应超时。提交结果可能未知，请按原内容重试。' : '无法连接平台后端。请检查 config.json 中的 backendUrl，并确认 Spring Boot 已启动；本地演示功能仍可使用。'));
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
      req.pipe(upstream);
      return;
    }
    if (!['GET','HEAD'].includes(req.method)) { jsonError(res,405,'METHOD_NOT_ALLOWED','静态页面只支持 GET / HEAD'); return; }
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { jsonError(res,400,'INVALID_URL','请求地址编码无效'); return; }
    const candidate = path.resolve(config.dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    const outside = target => { const relative = path.relative(config.dist,target); return relative.startsWith('..') || path.isAbsolute(relative); };
    if (outside(candidate)) { jsonError(res,403,'FILE_NOT_ALLOWED','无法访问此文件'); return; }
    fs.realpath(candidate, (error, real) => {
      if (error || outside(real)) { jsonError(res,404,'NOT_FOUND','文件不存在'); return; }
      fs.stat(real, (error, stat) => {
        if (error || !stat.isFile()) { jsonError(res,404,'NOT_FOUND','文件不存在'); return; }
        res.writeHead(200, {'Content-Type':MIME[path.extname(real)] || 'application/octet-stream','Content-Length':stat.size,
          'Cache-Control':path.basename(real) === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable', 'X-Content-Type-Options':'nosniff'});
        if (req.method === 'HEAD') { res.end(); return; }
        const stream = fs.createReadStream(real); stream.on('error', () => res.destroy()); stream.pipe(res);
      });
    });
  });
  return server;
}

function listenAvailable(server, port) {
  return new Promise((resolve,reject) => {
    let attempt = 0;
    const listen = () => server.listen(port === 0 ? 0 : port + attempt,'127.0.0.1');
    const error = e => {
      if (e.code === 'EADDRINUSE' && port !== 0 && attempt < 20 && port + attempt < 65535) { attempt++; listen(); }
      else { server.removeListener('error',error); reject(e); }
    };
    server.on('error',error);
    server.once('listening',() => { server.removeListener('error',error); resolve(server.address().port); });
    listen();
  });
}
function openBrowser(url) {
  const child = spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'});
  child.on('error',() => console.log('浏览器未自动打开，请复制窗口中的地址。')); child.unref();
}
async function main(root = __dirname, args = process.argv.slice(2)) {
  const config = readConfiguration(root,args);
  const server = createRuntime(config);
  const port = await listenAvailable(server,config.port);
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log('\nTestPilot 前端已启动：' + baseUrl + config.startPage);
  console.log('平台后端：' + config.backend.origin);
  console.log('前端可独立打开；真实任务需要上述 Spring Boot 后端。');
  console.log('端口冲突会自动顺延。请保留此窗口，按 Ctrl+C 停止。');
  console.log('TESTPILOT_READY ' + JSON.stringify({url:baseUrl,port}));
  if (config.openBrowser && process.platform === 'win32') openBrowser(baseUrl + config.startPage);
  let timer;
  const stop = () => { clearTimeout(timer); server.close(); server.closeAllConnections(); };
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  server.once('close',() => { clearTimeout(timer); process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop); });
  if (config.shutdownAfterMs) timer = setTimeout(stop,config.shutdownAfterMs);
  return server;
}
module.exports = { readConfiguration, createRuntime, listenAvailable, main };
if (require.main === module) main().catch(error => { console.error('启动失败：' + error.message); process.exitCode = 1; });
