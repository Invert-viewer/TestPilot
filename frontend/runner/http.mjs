import { JSONPath } from 'jsonpath-plus';
import newman from 'newman';

export function substitute(value, variables = {}) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key) => {
    if (!Object.hasOwn(variables, key)) throw new Error(`环境变量 ${key} 尚未定义`);
    return String(variables[key]);
  });
}
export function httpUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请填写完整的 HTTP(S) 地址，或配置 baseUrl 环境变量'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('地址须使用 HTTP(S)，账号密码请填写在鉴权中');
  return url;
}
function boundedNumber(value, fallback, min, max, label) {
  const n = value == null ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label}须在 ${min} 至 ${max} 之间`);
  return n;
}
export function prepareRequest(draft, variables) {
  if (!draft || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(draft.method)) throw new Error('请选择有效的 HTTP 方法');
  const s = value => substitute(String(value ?? ''), variables);
  const url = httpUrl(s(draft.url));
  for (const p of draft.query || []) if (p.enabled && p.key.trim()) url.searchParams.append(s(p.key), s(p.value));
  const headers = {};
  for (const p of draft.headers || []) if (p.enabled && p.key.trim()) {
    const name = s(p.key).trim();
    if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(name) || /[\r\n]/.test(s(p.value))) throw new Error('请求头名称或值包含非法字符');
    const lower = name.toLowerCase();
    if (['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'proxy-authorization'].includes(lower)) throw new Error(`请求头 ${name} 由执行器管理`);
    if (Object.hasOwn(headers, lower)) throw new Error(`请求头 ${name} 重复`);
    headers[lower] = s(p.value);
  }
  if (draft.auth?.type === 'bearer') headers.authorization = 'Bearer ' + s(draft.auth.token);
  else if (draft.auth?.type === 'basic') headers.authorization = 'Basic ' + Buffer.from(s(draft.auth.username) + ':' + s(draft.auth.password)).toString('base64');
  let body;
  if (draft.body?.mode !== 'none') {
    if (['GET', 'HEAD'].includes(draft.method)) throw new Error(`${draft.method} 请求不支持请求体，请选择“无”`);
    if (draft.body?.mode === 'json') {
      body = s(draft.body.text);
      try { JSON.parse(body); } catch { throw new Error('请求体不是有效的 JSON'); }
      headers['content-type'] ||= 'application/json';
    } else if (draft.body?.mode === 'form') {
      body = new URLSearchParams((draft.body.fields || []).filter(p => p.enabled && p.key.trim()).map(p => [s(p.key), s(p.value)])).toString();
      headers['content-type'] ||= 'application/x-www-form-urlencoded';
    } else if (draft.body?.mode === 'text') body = s(draft.body.text);
    else throw new Error('不支持的请求体格式');
  }
  return { method: draft.method, url: url.href, headers, body,
    timeoutMs: boundedNumber(draft.timeoutMs, 30000, 1, 60000, '超时时间'), followRedirects: draft.followRedirects !== false };
}
export function jsonValue(body, path) {
  const matches = JSONPath({ path, json: typeof body === 'string' ? JSON.parse(body) : body, eval: false });
  if (!matches.length) throw new Error(`JSONPath ${path} 没有匹配结果`);
  return matches.length === 1 ? matches[0] : matches;
}
const display = value => value === undefined ? '未找到' : typeof value === 'string' ? value : JSON.stringify(value);
export function evaluateResponse(draft, result, variables) {
  const assertions = (draft.assertions || []).filter(a => a.enabled).map(a => {
    let actual;
    try {
      if (a.type === 'status') actual = result.status;
      else if (a.type === 'time') actual = result.durationMs;
      else if (a.type === 'header') actual = result.headers[substitute(a.target, variables).toLowerCase()];
      else if (a.type === 'body') actual = result.body;
      else if (a.type === 'jsonpath') actual = jsonValue(result.body, substitute(a.target, variables));
      else throw new Error('不支持的断言类型');
      const expected = substitute(a.expected, variables);
      let passed = false;
      switch (a.operator) {
        case 'eq': passed = display(actual) === expected; break;
        case 'neq': passed = actual !== undefined && display(actual) !== expected; break;
        case 'contains': passed = actual !== undefined && display(actual).includes(expected); break;
        case 'exists': passed = actual !== undefined && actual !== null; break;
        case 'isArray': passed = Array.isArray(actual); break;
        case 'lt': passed = Number(actual) < Number(expected); break;
        case 'lte': passed = Number(actual) <= Number(expected); break;
        case 'gt': passed = Number(actual) > Number(expected); break;
        case 'gte': passed = Number(actual) >= Number(expected); break;
        default: throw new Error('不支持的断言运算符');
      }
      return { ...a, actual: display(actual), passed };
    } catch (e) { return { ...a, actual: display(actual), passed: false, error: e.message }; }
  });
  const extracted = {};
  const extractionResults = (draft.extractions || []).filter(e => e.enabled).map(e => {
    try {
      if (!e.name.trim()) throw new Error('请填写变量名');
      const value = display(jsonValue(result.body, substitute(e.path, variables)));
      extracted[e.name.trim()] = value;
      return { name: e.name.trim(), path: e.path, value };
    } catch (error) { return { name: e.name, path: e.path, error: error.message }; }
  });
  return { ...result, assertions, extracted, extractionResults };
}
function publicRequest(req) {
  const headers = { ...req.headers };
  for (const key of Object.keys(headers)) if (/authorization|cookie|api[-_]?key|token/i.test(key)) headers[key] = '[已隐藏]';
  return { method: req.method, url: req.url, headers, body: req.body };
}
export async function sendRequest(draft, variables, signal) {
  const req = prepareRequest(draft, variables);
  const started = performance.now();
  const timeout = AbortSignal.timeout(req.timeoutMs);
  try {
    const response = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body,
      redirect: req.followRedirects ? 'follow' : 'manual', signal: AbortSignal.any([signal, timeout]) });
    let sizeBytes = 0;
    const chunks = [];
    const reader = response.body?.getReader();
    let truncated = false;
    if (reader) {
      try { for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        const remaining = 2 * 1024 * 1024 - sizeBytes;
        chunks.push(value.subarray(0, remaining)); sizeBytes += Math.min(remaining, value.length);
        if (value.length > remaining) { truncated = true; await reader.cancel(); break; }
      } } finally { reader.releaseLock(); }
    }
    const buffer = Buffer.concat(chunks);
    const contentType = response.headers.get('content-type') || '';
    const charset = /charset=([^;\s]+)/i.exec(contentType)?.[1]?.replaceAll('"', '') || 'utf-8';
    let body;
    try { body = new TextDecoder(charset).decode(buffer); } catch { body = buffer.toString('utf8'); }
    return evaluateResponse(draft, { status: response.status, statusText: response.statusText,
      durationMs: Math.round(performance.now() - started), sizeBytes, body, contentType, truncated,
      headers: Object.fromEntries(response.headers), request: publicRequest(req) }, variables);
  } catch (error) {
    if (signal.aborted) throw new Error('执行已取消');
    if (timeout.aborted) throw new Error(`请求超时（${req.timeoutMs} ms）`);
    throw new Error('请求失败：' + (error.cause?.message || error.message));
  }
}
function newmanRequest(req, name, signal) {
  return new Promise((resolve, reject) => {
    const run = newman.run({
      collection: { info: { name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [{ name, request: {
        method: req.method, url: req.url, header: Object.entries(req.headers).map(([key, value]) => ({ key, value })),
        ...(req.body !== undefined ? { body: { mode: 'raw', raw: req.body } } : {}),
      } }] }, reporters: [], timeoutRequest: req.timeoutMs, timeout: req.timeoutMs + 5000,
      ignoreRedirects: !req.followRedirects, insecure: false,
    }, (error, summary) => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) return reject(new Error('执行已取消'));
      if (error) return reject(error);
      const execution = summary.run.executions[0];
      if (!execution?.response) return reject(new Error(execution?.requestError?.message || 'Newman 未收到响应'));
      resolve(execution.response);
    });
    function cancel() { run.abort?.(); }
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}
export async function runCollection(cases, variables, signal) {
  if (!Array.isArray(cases) || !cases.length || cases.length > 100) throw new Error('请选择 1 至 100 条接口用例');
  const started = performance.now(), results = [], current = { ...variables };
  for (const draft of cases) {
    if (signal.aborted) throw new Error('执行已取消');
    try {
      const req = prepareRequest(draft, current);
      const response = await newmanRequest(req, draft.name, signal);
      const result = evaluateResponse(draft, { status: response.code, statusText: response.status,
        durationMs: response.responseTime, sizeBytes: response.stream?.length || 0,
        body: response.stream?.subarray(0, 2 * 1024 * 1024).toString('utf8') || '',
        headers: Object.fromEntries(response.headers.all().map(h => [h.key.toLowerCase(), h.value])),
        contentType: response.headers.get('content-type') || '', truncated: response.stream?.length > 2 * 1024 * 1024,
        request: publicRequest(req) }, current);
      Object.assign(current, result.extracted);
      const passed = result.assertions.every(a => a.passed) && result.extractionResults.every(e => !e.error);
      results.push({ id: draft.id, name: draft.name, passed, ...result });
    } catch (e) { if (signal.aborted) throw e; results.push({ id: draft.id, name: draft.name, passed: false, error: e.message }); }
  }
  return { engine: 'Postman Newman', durationMs: Math.round(performance.now() - started),
    total: results.length, passed: results.filter(r => r.passed).length, results,
    extracted: Object.fromEntries(Object.entries(current).filter(([key, value]) => variables[key] !== value)) };
}
