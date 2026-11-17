import http from 'node:http';
import { pathToFileURL } from 'node:url';

export async function startFixture(port = 0) {
  const observed = { paths: [], active: 0, maxConcurrent: 0 };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    observed.paths.push(url.pathname);
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (url.pathname === '/load') {
      observed.active++; observed.maxConcurrent = Math.max(observed.maxConcurrent, observed.active);
      await new Promise(resolve => setTimeout(resolve, 25)); observed.active--;
      res.writeHead(Number(url.searchParams.get('status') || 200), { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return;
    }
    if (url.pathname === '/.env') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('APP_KEY=fixture-secret-only\nDB_PASSWORD=fixture-value'); return; }
    if (url.pathname === '/actuator/env') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"propertySources":[{"name":"fixture"}]}'); return; }
    if (url.pathname === '/v3/api-docs') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"openapi":"3.0.0","paths":{}}'); return; }
    if (['/secure', '/insecure', '/responsive', '/overflow'].includes(url.pathname)) {
      if (url.pathname === '/insecure' && url.searchParams.has('next')) { res.writeHead(302, { Location: url.searchParams.get('next') }); res.end(); return; }
      const headers = { 'Content-Type': 'text/html;charset=utf-8' };
      if (url.pathname === '/secure') Object.assign(headers, { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'", 'X-Frame-Options': 'DENY', 'Set-Cookie': 'session=fixture; HttpOnly; SameSite=Lax' });
      if (url.pathname === '/insecure') Object.assign(headers, { 'Access-Control-Allow-Origin': req.headers.origin || '*', 'Access-Control-Allow-Credentials': 'true', 'Server': 'Fixture/1.0', 'Set-Cookie': 'session=fixture-value' });
      res.writeHead(200, headers);
      const q = url.searchParams.get('q') || '';
      res.end(`<!doctype html><html><head><title>兼容性夹具</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font:16px system-ui;background:#f8fafc;color:#334155}.content{box-sizing:border-box;padding:24px;width:${url.pathname === '/overflow' ? '1200px' : '100%'};min-height:240px}button{padding:12px}</style></head><body><main class="content"><h1>TestPilot 验收</h1><button id="ready">可以操作</button>${q}${q.includes("'") ? '<pre>java.sql.SQLException: fixture syntax error</pre>' : ''}</main></body></html>`); return;
    }
    if (url.pathname === '/slow') { const timer = setTimeout(() => { if (!res.destroyed) res.end('late'); }, 3000); res.once('close', () => clearTimeout(timer)); return; }
    if (url.pathname === '/redirect') { res.writeHead(302, { Location: '/echo' }); res.end(); return; }
    if (url.pathname === '/ui') {
      res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
      res.end(`<!doctype html><html lang="zh-CN"><head><title>TestPilot 本地验收页</title><style>body{font:16px system-ui;max-width:540px;margin:70px auto;background:#f8fafc;color:#334155}form{padding:32px;background:white;border:1px solid #e2e8f0;border-radius:16px}label{display:block;margin:16px 0}input{padding:10px;border:1px solid #cbd5e1;border-radius:6px;width:90%}button{padding:11px 22px;border:0;border-radius:6px;background:#6958e9;color:white}.form-error{color:#dc2626}.user-chip{color:#059669}h1{font-size:25px}</style></head><body><form><h1>本地验收页</h1><label>用户名<input id="username" name="username" autocomplete="off"></label><label>密码<input id="password" type="password" name="password" autocomplete="off"></label><button id="login-submit">登录</button><p class="form-error" hidden></p><p class="user-chip" hidden></p></form><script>document.querySelector('form').onsubmit=e=>{e.preventDefault();const name=document.querySelector('#username').value;const password=document.querySelector('#password').value;document.querySelector('.form-error').hidden=!!(name&&password);document.querySelector('.form-error').textContent='请填写用户名和密码';document.querySelector('.user-chip').hidden=!(name&&password);document.querySelector('.user-chip').textContent='欢迎 '+name;}</script></body></html>`);
      return;
    }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    if (url.pathname === '/protected') {
      const authorized = req.headers.authorization === 'Bearer fixture-token';
      res.writeHead(authorized ? 200 : 401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ authorized })); return;
    }
    res.writeHead(url.pathname === '/token' ? 200 : Number(url.searchParams.get('status') || 201), { 'Content-Type': 'application/json', 'X-Fixture': 'testpilot' });
    res.end(JSON.stringify({ token: 'fixture-token', method: req.method, query: [...url.searchParams], headers: req.headers, body, items: [{ id: 7 }, { id: 8 }] }));
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, observed, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startFixture(Number(process.argv[2] || 18769)); console.log('验收夹具：' + fixture.url);
}
