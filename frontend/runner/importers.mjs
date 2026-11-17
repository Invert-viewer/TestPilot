import { randomUUID } from 'node:crypto';
import { parse as shellParse } from 'shell-quote';
const pair = (key, value = '', enabled = true) => ({ id: randomUUID(), key, value: String(value ?? ''), enabled });
const assertion = (status = '200') => ({ id: randomUUID(), type: 'status', target: '', operator: 'eq', expected: status, enabled: true });
function draft(name, method, url) {
  return { id: randomUUID(), name, method: method.toUpperCase(), url, query: [], headers: [],
    body: { mode: 'none', text: '', fields: [] }, auth: { type: 'none', token: '', username: '', password: '' },
    timeoutMs: 30000, followRedirects: true, assertions: [assertion()], extractions: [] };
}
function deref(spec, schema, depth = 0) {
  if (!schema?.$ref) return schema || {};
  if (depth > 12 || !schema.$ref.startsWith('#/')) return {};
  const value = schema.$ref.slice(2).split('/').reduce((v, k) => v?.[k.replaceAll('~1', '/').replaceAll('~0', '~')], spec);
  return deref(spec, value, depth + 1);
}
function sample(spec, raw, depth = 0) {
  const schema = deref(spec, raw);
  if (depth > 8) return '';
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.oneOf?.length || schema.anyOf?.length) return sample(spec, (schema.oneOf || schema.anyOf)[0], depth + 1);
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map(s => sample(spec, s, depth + 1)));
  if (schema.properties || schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties || {}).filter(([, s]) => !s.readOnly).map(([k, s]) => [k, sample(spec, s, depth + 1)]));
  if (schema.type === 'array') return [sample(spec, schema.items, depth + 1)];
  if (['integer', 'number'].includes(schema.type)) return 0;
  if (schema.type === 'boolean') return false;
  return '';
}
function openapi(spec) {
  const cases = [], warnings = [];
  let baseUrl = spec.servers?.[0]?.url;
  if (!baseUrl && spec.host) baseUrl = (spec.schemes?.[0] || 'https') + '://' + spec.host + (spec.basePath || '');
  for (const [path, raw] of Object.entries(spec.paths || {})) {
    const item = deref(spec, raw);
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const op = item[method]; if (!op) continue;
      const request = draft(op.summary || op.operationId || `${method.toUpperCase()} ${path}`, method, '{{baseUrl}}' + path);
      const params = [...(item.parameters || []), ...(op.parameters || [])].map(p => deref(spec, p));
      for (const p of params) {
        if (!p.name) continue;
        const example = p.example ?? sample(spec, p.schema || p);
        if (p.in === 'query') request.query.push(pair(p.name, example, p.required !== false));
        if (p.in === 'header') request.headers.push(pair(p.name, example, p.required !== false));
        if (p.in === 'path') request.url = request.url.replaceAll('{' + p.name + '}', encodeURIComponent(String(example === '' ? '1' : example)));
      }
      const content = deref(spec, op.requestBody).content;
      const selected = content && (Object.entries(content).find(([ct]) => ct.includes('json')) || Object.entries(content)[0]);
      const legacy = params.find(p => p.in === 'body');
      if (selected) {
        const [type, media] = selected;
        if (type.includes('multipart')) warnings.push(`${request.name}：文件上传需手工配置，未导入 multipart 请求体`);
        else if (type.includes('x-www-form-urlencoded')) {
          request.body.mode = 'form';
          request.body.fields = Object.entries(sample(spec, media.schema) || {}).map(([k, v]) => pair(k, v));
        } else {
          request.body.mode = type.includes('json') ? 'json' : 'text';
          const example = media.example ?? Object.values(media.examples || {})[0]?.value ?? sample(spec, media.schema);
          request.body.text = typeof example === 'string' && request.body.mode === 'text' ? example : JSON.stringify(example, null, 2);
          request.headers.push(pair('Content-Type', type));
        }
      } else if (legacy) { request.body.mode = 'json'; request.body.text = JSON.stringify(sample(spec, legacy.schema), null, 2); }
      const response = Object.keys(op.responses || {}).find(k => /^2\d\d$/.test(k));
      if (response) request.assertions = [assertion(response)];
      const schemes = spec.components?.securitySchemes || spec.securityDefinitions || {};
      for (const requirement of op.security || spec.security || []) for (const name of Object.keys(requirement)) {
        const scheme = schemes[name];
        if (scheme?.scheme === 'bearer' || scheme?.type === 'oauth2') request.auth = { type: 'bearer', token: '{{token}}', username: '', password: '' };
        if (scheme?.type === 'apiKey' && scheme.in === 'header' && !request.headers.some(h => h.key.toLowerCase() === scheme.name.toLowerCase())) request.headers.push(pair(scheme.name, '{{apiKey}}'));
      }
      cases.push(request);
    }
  }
  return { cases, variables: baseUrl ? { baseUrl } : {}, warnings, format: spec.openapi ? 'OpenAPI' : 'Swagger' };
}
function postman(spec) {
  const cases = [], warnings = [], variables = {};
  for (const v of spec.variable || []) if (v.key && !v.disabled) variables[v.key] = String(v.value ?? '');
  function visit(items, inheritedAuth) {
    for (const item of items || []) {
      if (item.item) { visit(item.item, item.auth || inheritedAuth); continue; }
      if (!item.request) continue;
      const req = typeof item.request === 'string' ? { url: item.request } : item.request;
      let url = typeof req.url === 'string' ? req.url : req.url?.raw;
      if (!url && req.url) url = (req.url.protocol ? req.url.protocol + '://' : '') + (Array.isArray(req.url.host) ? req.url.host.join('.') : req.url.host || '') + '/' + (req.url.path || []).join('/');
      const request = draft(item.name || '导入请求', req.method || 'GET', url || '{{baseUrl}}/');
      if (Array.isArray(req.url?.query)) {
        request.url = request.url.split('?')[0];
        request.query = req.url.query.map(p => pair(p.key, p.value, !p.disabled));
      }
      for (const variable of req.url?.variable || []) {
        request.url = request.url.replace(new RegExp(':' + variable.key + '(?=/|$)', 'g'), encodeURIComponent(String(variable.value ?? '')));
      }
      request.headers = (req.header || []).map(h => pair(h.key, h.value, !h.disabled));
      const auth = req.auth || inheritedAuth;
      const authValue = key => auth?.[auth.type]?.find(v => v.key === key)?.value || '';
      if (auth?.type === 'bearer') request.auth.token = authValue('token'), request.auth.type = 'bearer';
      if (auth?.type === 'basic') Object.assign(request.auth, { type: 'basic', username: authValue('username'), password: authValue('password') });
      if (req.body?.mode === 'raw') {
        request.body.text = req.body.raw || '';
        const json = req.body.options?.raw?.language === 'json' || request.headers.some(h => h.key.toLowerCase() === 'content-type' && h.value.includes('json'));
        request.body.mode = json ? 'json' : 'text';
      }
      if (req.body?.mode === 'urlencoded') { request.body.mode = 'form'; request.body.fields = req.body.urlencoded.map(p => pair(p.key, p.value, !p.disabled)); }
      if (req.body?.mode === 'formdata') warnings.push(`${request.name}：multipart 文件上传未导入`);
      if (item.event?.length || spec.event?.length) warnings.push(`${request.name}：脚本未执行，请在断言与变量提取中重新配置`);
      cases.push(request);
    }
  }
  visit(spec.item, spec.auth);
  return { cases, variables, warnings, format: 'Postman / Apifox Collection' };
}
export function parseImport(value) {
  let spec;
  try { spec = typeof value === 'string' ? JSON.parse(value) : value; } catch { throw new Error('文件不是有效的 JSON'); }
  if (!spec || typeof spec !== 'object') throw new Error('请选择接口定义 JSON 文件');
  let result;
  if (spec.openapi || spec.swagger || spec.paths) result = openapi(spec);
  else if (Array.isArray(spec.item)) result = postman(spec);
  else throw new Error('支持 OpenAPI / Swagger / Postman JSON；Apifox 请导出为 OpenAPI 或 Postman 格式');
  if (!result.cases.length) throw new Error('文件中没有可导入的 HTTP 请求');
  return result;
}
export function parseCurl(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('请粘贴 cURL 命令');
  const tokens = shellParse(text.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' '), key => '$' + key);
  if (!tokens.length || !/^curl(?:\.exe)?$/i.test(tokens[0])) throw new Error('命令须以 curl 或 curl.exe 开头');
  if (tokens.some(t => typeof t !== 'string')) throw new Error('仅支持单个 cURL 命令，请移除管道、重定向和命令连接符');
  const request = draft('导入的 cURL 请求', 'GET', '');
  let explicit = false, formData = [], rawData = [], get = false;
  const warnings = [];
  for (let i = 1; i < tokens.length; i++) {
    let token = tokens[i];
    if (/^-[XHdubAe].+/.test(token)) { tokens.splice(i + 1, 0, token.slice(2)); token = token.slice(0, 2); }
    if (/^--[^=]+=/.test(token)) { const index = token.indexOf('='); tokens.splice(i + 1, 0, token.slice(index + 1)); token = token.slice(0, index); }
    const value = () => { if (i + 1 >= tokens.length) throw new Error(`选项 ${token} 缺少值`); return tokens[++i]; };
    if (['-X', '--request'].includes(token)) { request.method = value().toUpperCase(); explicit = true; }
    else if (['-H', '--header'].includes(token)) { const header = value(), colon = header.indexOf(':'); if (colon < 1) throw new Error('请求头须使用 名称: 值 格式'); request.headers.push(pair(header.slice(0, colon), header.slice(colon + 1).trim())); }
    else if (['-d', '--data', '--data-raw', '--data-binary', '--json'].includes(token)) {
      const data = value(); if (data.startsWith('@')) throw new Error('不读取 cURL 中的本地文件，请粘贴实际请求体');
      rawData.push(data); if (token === '--json' && !request.headers.some(h => h.key.toLowerCase() === 'content-type')) request.headers.push(pair('Content-Type', 'application/json'));
    }
    else if (token === '--data-urlencode') { const item = value(); if (item.includes('@')) throw new Error('不支持通过 cURL 读取本地文件'); const equal = item.indexOf('='); formData.push(pair(equal < 0 ? item : item.slice(0, equal), equal < 0 ? '' : item.slice(equal + 1))); }
    else if (['-u', '--user'].includes(token)) { const auth = value(), colon = auth.indexOf(':'); Object.assign(request.auth, { type: 'basic', username: colon < 0 ? auth : auth.slice(0, colon), password: colon < 0 ? '' : auth.slice(colon + 1) }); }
    else if (['-b', '--cookie'].includes(token)) request.headers.push(pair('Cookie', value()));
    else if (['-A', '--user-agent'].includes(token)) request.headers.push(pair('User-Agent', value()));
    else if (['-e', '--referer'].includes(token)) request.headers.push(pair('Referer', value()));
    else if (['--max-time', '-m'].includes(token)) request.timeoutMs = Number(value()) * 1000;
    else if (['-L', '--location'].includes(token)) request.followRedirects = true;
    else if (['-I', '--head'].includes(token)) { request.method = 'HEAD'; explicit = true; }
    else if (['-G', '--get'].includes(token)) get = true;
    else if (token === '--url') request.url = value();
    else if (['--compressed', '--silent', '-s', '-S', '--show-error', '--globoff', '-g', '--fail', '-f'].includes(token)) { /* Transport/display flags do not change the request. */ }
    else if (['-k', '--insecure'].includes(token)) warnings.push('忽略 --insecure，执行器仍校验 TLS 证书');
    else if (token.startsWith('-')) throw new Error(`暂不支持 cURL 选项 ${token}，请移除后导入`);
    else if (!request.url) request.url = token;
    else throw new Error('一次只能导入一个请求地址');
  }
  if (!request.url) throw new Error('命令中没有请求地址');
  if (rawData.length) {
    const raw = rawData.join('&');
    if (get) { request.query = [...new URLSearchParams(raw)].map(([k, v]) => pair(k, v)); }
    else {
      request.body.text = raw;
      const contentType = request.headers.find(h => h.key.toLowerCase() === 'content-type')?.value;
      request.body.mode = contentType?.includes('json') ? 'json' : 'text';
      if (!contentType) request.headers.push(pair('Content-Type', 'application/x-www-form-urlencoded'));
    }
  }
  if (formData.length) { if (get) request.query.push(...formData); else request.body = { mode: 'form', text: '', fields: formData }; }
  if (get) request.method = 'GET'; else if (request.body.mode !== 'none' && !explicit) request.method = 'POST';
  return { request, warnings };
}
