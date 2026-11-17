import { randomUUID } from 'node:crypto';
import { httpUrl, substitute } from './http.mjs';

const groups = new Set(['headers', 'cookies', 'exposure', 'reflection', 'sql', 'cors', 'redirect', 'fingerprint']);
async function inspectHttp(url, signal, headers = {}) {
  const response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
  const chunks = []; let length = 0, truncated = false;
  const reader = response.body?.getReader();
  if (reader) try { for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    const left = 262144 - length; chunks.push(value.subarray(0, left)); length += Math.min(left, value.length);
    if (value.length > left) { truncated = true; await reader.cancel(); break; }
  } } finally { reader.releaseLock(); }
  return { status: response.status, headers: Object.fromEntries(response.headers), cookies: response.headers.getSetCookie?.() || [], body: Buffer.concat(chunks).toString('utf8'), truncated };
}
export async function runSecurity(payload, variables, ctx) {
  const url = httpUrl(substitute(payload.url, variables));
  const checks = [...new Set(payload.checks || [])];
  if (!checks.length || checks.some(key => !groups.has(key))) throw new Error('请至少选择一个有效的安全检查组');
  if (payload.active && !payload.authorized) throw new Error('轻量主动探测需要确认已获得目标授权');
  const parameter = payload.parameter || 'q';
  if (!/^[a-zA-Z_][\w.-]{0,39}$/.test(parameter)) throw new Error('探测参数名须为有效的 Query 名称');
  const findings = [], started = performance.now();
  const add = (group, title, status, severity, evidence, recommendation) => findings.push({ id: randomUUID(), group, title, status, severity, evidence, recommendation });
  ctx.update({ phase: '读取目标响应', progress: 5 });
  const baseline = await inspectHttp(url, ctx.signal);
  add('target', '目标可访问性', baseline.status >= 200 && baseline.status < 400 ? 'PASS' : 'ERROR', 'info', `GET ${url.href} → HTTP ${baseline.status}`, '目标应返回预期业务页面；错误页的检查结果不能代表完整业务。');
  const run = async (group, callback) => {
    if (!checks.includes(group)) return;
    if (ctx.signal.aborted) throw new Error('执行已取消');
    ctx.update({ phase: `检查 ${group}`, progress: Math.round((checks.indexOf(group) + 1) / checks.length * 90) });
    try { await callback(); }
    catch (error) { if (ctx.signal.aborted) throw error; add(group, '检查未完成', 'ERROR', 'info', error.message, '检查网络、证书和目标可访问性后重试。'); }
    ctx.update({ result: { engine: 'TestPilot HTTP / Spring 基线', url: url.href, findings: [...findings] } });
  };
  await run('headers', () => {
    const headers = baseline.headers;
    const html = /text\/html/i.test(headers['content-type'] || '');
    add('headers', 'Content-Type 防嗅探', headers['x-content-type-options']?.toLowerCase() === 'nosniff' ? 'PASS' : 'RISK', 'low', `X-Content-Type-Options: ${headers['x-content-type-options'] || '未设置'}`, '设置 X-Content-Type-Options: nosniff。');
    add('headers', '内容安全策略 CSP', !html ? 'SKIPPED' : headers['content-security-policy'] ? 'PASS' : 'RISK', 'medium', !html ? '当前响应不是 HTML，本项不适用' : `Content-Security-Policy: ${headers['content-security-policy'] || '未设置'}`, '为 HTML 页面设置与实际资源来源匹配的 CSP；存在策略不等于策略足够严格。');
    const framePolicy = headers['x-frame-options'] || (/frame-ancestors/i.test(headers['content-security-policy'] || '') ? 'CSP frame-ancestors' : '');
    add('headers', '页面嵌入限制', !html ? 'SKIPPED' : framePolicy ? 'PASS' : 'RISK', 'medium', !html ? '当前响应不是 HTML，本项不适用' : framePolicy || '未设置 X-Frame-Options / frame-ancestors', '通过 CSP frame-ancestors 限制可嵌入页面的来源。');
    add('headers', 'HTTPS 严格传输', url.protocol !== 'https:' ? 'SKIPPED' : headers['strict-transport-security'] ? 'PASS' : 'RISK', 'low', url.protocol !== 'https:' ? '当前为 HTTP，不能据此判断 HTTPS 的 HSTS 配置' : headers['strict-transport-security'] || '未设置 HSTS', '生产 HTTPS 站点按部署要求配置 HSTS。');
  });
  await run('cookies', () => {
    if (!baseline.cookies.length) return add('cookies', 'Cookie 属性', 'SKIPPED', 'info', '本次响应没有 Set-Cookie，未能检查登录后的会话 Cookie', '需要时对实际建立会话的接口单独检查。');
    for (const cookie of baseline.cookies) {
      const name = cookie.split('=')[0], attributes = cookie.split(';').slice(1).join(';').trim();
      const missing = [];
      if (!/\bhttponly\b/i.test(attributes)) missing.push('HttpOnly');
      if (!/\bsamesite\s*=/i.test(attributes)) missing.push('SameSite');
      if (url.protocol === 'https:' && !/\bsecure\b/i.test(attributes)) missing.push('Secure');
      add('cookies', `Cookie ${name}`, missing.length ? 'REVIEW' : 'PASS', 'low', `${name}=[已隐藏]; ${attributes || '无属性'}${missing.length ? '\n待核实属性：' + missing.join(', ') : ''}`, '根据 Cookie 用途确认属性；会话 Cookie 通常应设置 HttpOnly、Secure 和合适的 SameSite，偏好 Cookie 不一定需要 HttpOnly。');
    }
  });
  await run('exposure', async () => {
    if (!payload.active) return add('exposure', 'Spring / 配置暴露', 'SKIPPED', 'info', '未开启主动探测，未访问额外路径', '如已获授权，可开启轻量主动探测。');
    const probes = [['/.env', /(?:^|\n)\s*(?:DB_PASSWORD|DATABASE_URL|APP_KEY|SECRET_KEY)\s*=/i], ['/actuator/env', /"propertySources"\s*:/], ['/v3/api-docs', /"openapi"\s*:/]];
    for (const [pathname, pattern] of probes) {
      const probe = new URL(pathname, url.origin), result = await inspectHttp(probe, ctx.signal);
      const detected = result.status === 200 && pattern.test(result.body);
      const docs = pathname === '/v3/api-docs';
      add('exposure', pathname, detected ? docs ? 'REVIEW' : 'RISK' : 'PASS', docs ? 'info' : 'high', `GET ${probe.href} → ${result.status}；${detected ? '匹配对应配置 / 文档结构，具体敏感值未展示' : '未匹配配置文件或接口结构（不能仅凭 HTTP 200 判定暴露）'}`, docs ? '确认 API 文档是否按预期公开；公开文档本身不等于漏洞。' : '限制生产环境敏感配置与 Actuator env 的访问，避免对外返回凭据。');
    }
  });
  await run('reflection', async () => {
    if (!payload.active) return add('reflection', '输入反射线索', 'SKIPPED', 'info', '未启用轻量主动探测', '此检查仅发现 HTML 反射线索，不能确认脚本可执行。');
    const marker = `<testpilot-probe data-id="${randomUUID()}">`;
    const probe = new URL(url); probe.searchParams.set(parameter, marker);
    const result = await inspectHttp(probe, ctx.signal);
    const reflected = /text\/html/i.test(result.headers['content-type'] || '') && result.body.includes(marker);
    add('reflection', '未转义 HTML 反射线索', reflected ? 'REVIEW' : 'PASS', 'medium', `${parameter} 参数发送无脚本自定义标签；HTTP ${result.status}；${reflected ? '标签原文出现在 HTML 响应中' : '未观察到原样 HTML 标签反射'}`, '结合输出位置检查上下文编码；本项不执行脚本，不能作为已确认 XSS 的结论。');
  });
  await run('sql', async () => {
    const pattern = /SQL syntax[^\n<]{0,120}|java\.sql\.[\w.]+|org\.postgresql\.[\w.]+|ORA-\d{4,6}|SQLite(?:Exception| error)[^\n<]{0,100}|org\.springframework\.[\w.]+Exception/i;
    let result = baseline;
    if (payload.active) { const probe = new URL(url); probe.searchParams.set(parameter, "testpilot'"); result = await inspectHttp(probe, ctx.signal); }
    const matched = pattern.exec(result.body)?.[0];
    add('sql', '数据库 / Java 异常信息', matched ? 'RISK' : 'PASS', 'medium', `HTTP ${result.status}；${matched ? '观察到异常特征：' + matched : '未观察到 SQL / Java 异常特征'}`, '服务端统一处理异常，避免回传堆栈和数据库细节；未发现异常特征不能排除 SQL 注入。');
  });
  await run('cors', async () => {
    const origin = 'https://testpilot.invalid';
    const result = await inspectHttp(url, ctx.signal, { Origin: origin });
    const allowed = result.headers['access-control-allow-origin'], credentials = result.headers['access-control-allow-credentials'];
    const reflected = allowed === origin && credentials === 'true';
    add('cors', '跨源访问策略', reflected ? 'REVIEW' : allowed === '*' ? 'REVIEW' : 'PASS', reflected ? 'high' : 'info', `Origin: ${origin}\nAccess-Control-Allow-Origin: ${allowed || '未设置'}\nAccess-Control-Allow-Credentials: ${credentials || '未设置'}`, '敏感接口应校验允许的来源；公共资源使用通配来源可能是预期行为，需结合鉴权与数据敏感性人工确认。');
  });
  await run('redirect', async () => {
    if (!payload.active) return add('redirect', '外部重定向', 'SKIPPED', 'info', '未启用轻量主动探测', '按实际使用的 next / redirect 参数进行授权复核。');
    const probe = new URL(url); probe.searchParams.set('redirect', 'https://testpilot.invalid/'); probe.searchParams.set('next', 'https://testpilot.invalid/');
    const result = await inspectHttp(probe, ctx.signal), location = result.headers.location;
    let external = false;
    try { external = [301, 302, 303, 307, 308].includes(result.status) && new URL(location, probe).hostname === 'testpilot.invalid'; } catch { /* No valid redirect. */ }
    add('redirect', '外部重定向参数', external ? 'RISK' : 'PASS', 'medium', `HTTP ${result.status}；Location: ${location || '未设置'}；执行器没有访问外部重定向目标`, '跳转参数应使用站内相对路径或明确的允许列表。');
  });
  await run('fingerprint', () => {
    const values = ['server', 'x-powered-by'].filter(k => baseline.headers[k]).map(k => `${k}: ${baseline.headers[k]}`);
    add('fingerprint', '服务端技术指纹', values.length ? 'REVIEW' : 'PASS', 'info', values.join('\n') || '未返回 Server / X-Powered-By', '核对是否需要隐藏精确版本；公开技术名称本身不是可利用漏洞。');
  });
  const risk = findings.filter(f => f.status === 'RISK'), reviewed = findings.filter(f => f.status === 'REVIEW');
  const deduction = risk.reduce((sum, f) => sum + ({ high: 15, medium: 8, low: 3 }[f.severity] || 0), 0);
  return { engine: 'TestPilot HTTP / Spring 基线', url: url.href, durationMs: Math.round(performance.now() - started), findings,
    riskCount: risk.length, reviewCount: reviewed.length, passed: findings.filter(f => f.status === 'PASS').length,
    skipped: findings.filter(f => f.status === 'SKIPPED').length, errors: findings.filter(f => f.status === 'ERROR').length,
    score: baseline.status >= 200 && baseline.status < 400 ? Math.max(0, 100 - deduction) : null,
    scoreRule: '高风险扣 15 / 中风险扣 8 / 低风险扣 3；待确认项不计入扣分。得分仅代表本次配置基线，不代表系统无漏洞。' };
}
