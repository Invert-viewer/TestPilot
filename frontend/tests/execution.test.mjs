import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { startFixture } from './fixture.mjs';
import { sendRequest, runCollection, prepareRequest } from '../runner/http.mjs';
import { parseImport, parseCurl } from '../runner/importers.mjs';
import { runUi, inspectPage } from '../runner/browser.mjs';
import { runnerMiddleware } from '../runner/plugin.mjs';
import http from 'node:http';

let fixture;
before(async () => { fixture = await startFixture(); });
after(async () => fixture.close());
const signal = () => new AbortController().signal;
const check = (type, expected, target = '', operator = 'eq') => ({ id: crypto.randomUUID(), type, expected, target, operator, enabled: true });
const pair = (key, value) => ({ key, value, enabled: true });
function request(url = '{{baseUrl}}/echo') {
  return { id: crypto.randomUUID(), name: '验收请求', method: 'GET', url, query: [], headers: [],
    body: { mode: 'none', text: '', fields: [] }, auth: { type: 'none' },
    timeoutMs: 10000, followRedirects: true, assertions: [], extractions: [] };
}
test('cURL JSON、Basic Auth、重复 Query 可以导入，且不会执行 Shell', () => {
  const { request: parsed } = parseCurl(`curl 'http://localhost/echo' -u 'user:pass:tail' --json '{"hello":"世界"}' -H 'X-Test: yes'`);
  assert.equal(parsed.method, 'POST'); assert.equal(parsed.body.mode, 'json');
  assert.equal(parsed.auth.password, 'pass:tail'); assert.equal(parsed.headers.find(h => h.key === 'X-Test').value, 'yes');
  assert.throws(() => parseCurl('curl http://localhost | whoami'), /单个/);
  assert.throws(() => parseCurl('curl http://localhost -d @secret.txt'), /本地文件/);
});
test('OpenAPI 解析引用、参数、请求示例、服务器和成功状态', () => {
  const parsed = parseImport({ openapi: '3.0.0', servers: [{ url: 'http://localhost:9000' }], components: { schemas: { Input: { type: 'object', properties: { name: { type: 'string', example: '示例' } } } } }, paths: { '/users/{id}': { post: { summary: '更新用户', parameters: [{ name: 'id', in: 'path', example: 7 }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Input' } } } }, responses: { '201': {} } } } } });
  assert.equal(parsed.cases[0].url, '{{baseUrl}}/users/7'); assert.equal(parsed.cases[0].assertions[0].expected, '201');
  assert.equal(JSON.parse(parsed.cases[0].body.text).name, '示例'); assert.equal(parsed.variables.baseUrl, 'http://localhost:9000');
});
test('Postman 文件夹、继承鉴权和脚本限制被明确保留', () => {
  const parsed = parseImport({ info: {}, auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] }, item: [{ name: '目录', item: [{ name: '商品列表', request: { method: 'GET', url: '{{baseUrl}}/products' }, event: [{ listen: 'test' }] }] }] });
  assert.equal(parsed.cases[0].auth.type, 'bearer'); assert.equal(parsed.cases[0].auth.token, '{{token}}'); assert.equal(parsed.warnings.length, 1);
  assert.throws(() => parseImport('{}'), /支持/);
});
test('导入保留原始正文，并排除 Postman 中禁用的 Query', () => {
  const curled = parseCurl("curl -XPOST http://localhost/echo --data-raw 'raw text without rewriting'").request;
  assert.equal(curled.method, 'POST'); assert.equal(curled.body.mode, 'text'); assert.equal(curled.body.text, 'raw text without rewriting');
  const imported = parseImport({ item: [{ name: '筛选请求', request: { method: 'GET', url: { raw: 'http://localhost/echo?enabled=yes&ignored=no', query: [{ key: 'enabled', value: 'yes' }, { key: 'ignored', value: 'no', disabled: true }] } } }] }).cases[0];
  const prepared = prepareRequest(imported, {}); assert.equal(prepared.url, 'http://localhost/echo?enabled=yes');
});
test('真实请求发送重复参数、JSON、鉴权，并执行 JSONPath 断言和变量提取', async () => {
  const draft = request(); draft.method = 'POST'; draft.query = [pair('q', '中文'), pair('q', '第二项')];
  draft.headers = [pair('X-Probe', '{{probe}}')]; draft.body = { mode: 'json', text: '{"message":"你好"}', fields: [] };
  draft.auth = { type: 'bearer', token: '{{token}}' };
  draft.assertions = [check('status', '201'), check('jsonpath', 'POST', '$.method'), check('jsonpath', '', '$.items', 'isArray'), check('header', 'testpilot', 'X-Fixture')];
  draft.extractions = [{ name: 'savedToken', path: '$.token', enabled: true }];
  const result = await sendRequest(draft, { baseUrl: fixture.url, probe: 'probe-value', token: 'local-test' }, signal());
  assert.ok(result.assertions.every(a => a.passed)); const body = JSON.parse(result.body);
  assert.deepEqual(body.query, [['q', '中文'], ['q', '第二项']]); assert.equal(body.headers['x-probe'], 'probe-value');
  assert.equal(body.headers.authorization, 'Bearer local-test'); assert.equal(result.request.headers.authorization, '[已隐藏]');
  assert.equal(result.extracted.savedToken, 'fixture-token');
});
test('失败断言和未匹配的提取路径不伪装为成功', async () => {
  const draft = request(); draft.assertions = [check('status', '200'), check('jsonpath', 'anything', '$.missing')];
  draft.extractions = [{ name: 'missing', path: '$.missing', enabled: true }];
  const result = await sendRequest(draft, { baseUrl: fixture.url }, signal());
  assert.equal(result.assertions.filter(a => a.passed).length, 0); assert.ok(result.extractionResults[0].error); assert.deepEqual(result.extracted, {});
});
test('表单编码、Basic Auth 和手动重定向使用真实响应', async () => {
  const draft = request(); draft.method = 'POST'; draft.auth = { type: 'basic', username: '测试', password: '密码' };
  draft.body = { mode: 'form', fields: [pair('x', 'a b'), pair('x', '中文')], text: '' };
  const result = await sendRequest(draft, { baseUrl: fixture.url }, signal());
  assert.equal(JSON.parse(result.body).body, 'x=a+b&x=%E4%B8%AD%E6%96%87');
  const redirect = request('{{baseUrl}}/redirect'); redirect.followRedirects = false;
  assert.equal((await sendRequest(redirect, { baseUrl: fixture.url }, signal())).status, 302);
});
test('未定义变量、非法 JSON、超时和取消均给出失败结果', async () => {
  assert.throws(() => prepareRequest(request(), {}), /尚未定义/);
  const invalid = request(); invalid.method = 'POST'; invalid.body = { mode: 'json', text: '{invalid', fields: [] };
  await assert.rejects(sendRequest(invalid, { baseUrl: fixture.url }, signal()), /有效的 JSON/);
  const slow = request('{{baseUrl}}/slow'); slow.timeoutMs = 50;
  await assert.rejects(sendRequest(slow, { baseUrl: fixture.url }, signal()), /超时/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(sendRequest(request(), { baseUrl: fixture.url }, abort.signal), /取消/);
});
test('Newman 真正执行顺序回归，并将提取变量传递给下一条请求', async () => {
  const first = request('{{baseUrl}}/token'); first.name = '获取令牌'; first.extractions = [{ name: 'token', path: '$.token', enabled: true }]; first.assertions = [check('status', '200')];
  const second = request('{{baseUrl}}/protected'); second.name = '使用令牌'; second.auth = { type: 'bearer', token: '{{token}}' }; second.assertions = [check('jsonpath', 'true', '$.authorized')];
  const third = request(); third.name = '故意失败的断言'; third.assertions = [check('status', '500')];
  const result = await runCollection([first, second, third], { baseUrl: fixture.url }, signal());
  assert.equal(result.engine, 'Postman Newman'); assert.equal(result.total, 3); assert.equal(result.passed, 2);
  assert.equal(result.results[1].status, 200); assert.equal(result.results[2].assertions[0].passed, false);
  assert.equal(result.extracted.token, 'fixture-token');
});
test('Playwright 实际执行输入、点击、等待和断言，并生成真实截图', async () => {
  const draft = { url: '{{baseUrl}}/ui', width: 1000, height: 700, stopOnFailure: true, steps: [
    { action: 'fill', selector: '#username', value: '验收用户' }, { action: 'fill', selector: '#password', value: 'fixture-password' },
    { action: 'click', selector: '#login-submit', value: '' }, { action: 'waitFor', selector: '.user-chip', value: '' },
    { action: 'assertText', selector: '.user-chip', value: '验收用户' }, { action: 'screenshot', selector: '', value: '' },
  ] };
  const result = await runUi(draft, { baseUrl: fixture.url }, signal());
  assert.equal(result.passed, true); assert.equal(result.steps.length, 6); assert.ok(result.steps.every(s => s.status === 'PASSED'));
  assert.match(result.screenshot, /^data:image\/png;base64,/); assert.ok(result.steps[5].screenshot);
});
test('UI 断言失败留下截图，失败即停的后续步骤标记为跳过', async () => {
  const result = await runUi({ url: fixture.url + '/ui', width: 900, height: 600, stopOnFailure: true, steps: [
    { action: 'assertTitle', selector: '', value: '不存在的标题' }, { action: 'click', selector: '#login-submit', value: '' },
  ] }, {}, signal());
  assert.equal(result.passed, false); assert.equal(result.steps[0].status, 'FAILED'); assert.ok(result.steps[0].screenshot);
  assert.equal(result.steps[1].status, 'SKIPPED');
});
test('页面分析通过真实 DOM 提取可用选择器', async () => {
  const result = await inspectPage(fixture.url + '/ui', {}, signal());
  assert.equal(result.title, 'TestPilot 本地验收页'); assert.ok(result.elements.some(e => e.selector === '#username' && e.unique));
  assert.ok(result.elements.some(e => e.selector === '#login-submit'));
});
test('取消 UI 执行会关闭浏览器并结束正在等待的步骤', async () => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 1000);
  try { await assert.rejects(runUi({ url: fixture.url + '/ui', width: 900, height: 600, stopOnFailure: true, steps: [{ action: 'wait', selector: '', value: '30000' }] }, {}, abort.signal), /取消|closed|关闭/i); }
  finally { clearTimeout(timer); }
});
test('执行中间件拒绝跨源请求，并为非法配置返回 JSON 错误', async () => {
  const server = http.createServer((req, res) => runnerMiddleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/__runner/request`;
  try {
    const denied = await fetch(url, { method: 'POST', headers: { Origin: 'http://other.example', 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(denied.status, 403);
    const invalid = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }); assert.ok([401,503].includes(invalid.status)); assert.match((await invalid.json()).message, /登录|后端|接口|会话/);
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
});
