import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { startFixture } from './fixture.mjs';
import { runsRoot, junitPath, jmeterPath } from '../runner/runtime.mjs';
import { runPerformance, summarizeSamples, buildJmx, parseJtl } from '../runner/performance.mjs';
import { runUnit } from '../runner/unit.mjs';
import { runSecurity } from '../runner/security.mjs';
import { runCompatibility } from '../runner/compatibility.mjs';
import { availableBrowsers } from '../runner/browser.mjs';
import { startJob, getJob, readArtifact } from '../runner/jobs.mjs';

let fixture, templates;
const directories = [];
before(async () => {
  fixture = await startFixture(); await fs.mkdir(runsRoot, { recursive: true });
  const source = await fs.readFile(new URL('../src/unitTemplates.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  templates = (await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))).unitTemplates;
});
after(async () => {
  await fixture.close();
  for (const directory of directories) {
    assert.ok(path.resolve(directory).startsWith(path.resolve(runsRoot) + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
async function context(signal = new AbortController().signal) {
  const directory = await fs.mkdtemp(path.join(runsRoot, 'test-')); directories.push(directory);
  const state = { artifacts: [], logs: [] };
  return { directory, signal, state, update: value => Object.assign(state, value), log: value => state.logs.push(value), artifact: (filename, label) => { state.artifacts.push({ filename, label }); return '/fixture/' + filename; } };
}
function perf(status = 200) {
  return { name: '并发验收', engine: 'http', users: 3, duration: 1, rampUp: 0, thinkTime: 10, expectedStatus: status,
    request: { method: 'GET', url: '{{baseUrl}}/load', query: [], headers: [], body: { mode: 'none' }, auth: { type: 'none' }, timeoutMs: 2000, followRedirects: true } };
}
test('性能指标按请求样本计数，正确区分无样本、P95 与错误率', () => {
  assert.equal(summarizeSamples([], 1000).p95Ms, null);
  assert.equal(summarizeSamples([], 1000).tps, null);
  const result = summarizeSamples([{ elapsedMs: 10, offsetMs: 10, success: true }, { elapsedMs: 20, offsetMs: 200, success: false }, { elapsedMs: 90, offsetMs: 1500, success: false }], 2000);
  assert.equal(result.p95Ms, 90); assert.equal(result.errorRate, 66.67); assert.equal(result.failed, 2); assert.equal(result.tps, 1.5); assert.equal(result.timeline.length, 2);
});
test('真实性能执行产生并发、逐请求 CSV 和可解释的失败样本', async () => {
  const ctx = await context();
  const result = await runPerformance(perf(), { baseUrl: fixture.url }, ctx);
  assert.ok(result.total > 10); assert.ok(fixture.observed.maxConcurrent >= 2); assert.equal(result.failed, 0); assert.ok(result.tps > 0);
  assert.match(await fs.readFile(path.join(ctx.directory, 'samples.csv'), 'utf8'), /elapsedMs/);
  const wrong = perf(201); wrong.users = 1;
  const failed = await runPerformance(wrong, { baseUrl: fixture.url }, await context());
  assert.equal(failed.failed, failed.total); assert.equal(failed.errorRate, 100); assert.match(failed.samples[0].error, /实际 200/);
});
test('取消性能任务保留已完成的真实样本，不把取消误记为请求失败', async () => {
  const abort = new AbortController(), ctx = await context(abort.signal), config = perf(); config.duration = 10;
  const timer = setTimeout(() => abort.abort(), 200);
  try { const result = await runPerformance(config, { baseUrl: fixture.url }, ctx); assert.ok(result.total > 0); assert.equal(result.failed, 0); assert.ok(result.durationMs < 3000); }
  finally { clearTimeout(timer); }
});
test('无效负载配置会在执行前拒绝，不静默调整用户参数', async () => {
  await assert.rejects(runPerformance({ ...perf(), rampUp: 30 }, { baseUrl: fixture.url }, await context()), /爬坡时间/);
  await assert.rejects(runPerformance({ ...perf(), users: 0 }, { baseUrl: fixture.url }, await context()), /虚拟用户/);
});
test('JMeter 计划转义 URL / 请求体，JTL 解析保留带引号的逗号', () => {
  const config = perf(); config.request.url = 'http://localhost/a?q=one&x=two'; config.request.headers = [{ key: 'X-Probe', value: '<tag>', enabled: true }];
  const xml = buildJmx(config, {}); assert.match(xml, /q=one&amp;x=two/); assert.match(xml, /&lt;tag&gt;/); assert.match(xml, /Assertion.response_code/);
  const rows = parseJtl('timeStamp,elapsed,responseCode,success,responseMessage,failureMessage\n1000,20,200,true,"OK, fine",\n1100,30,500,false,Server Error,"expected 200, got 500"\n');
  assert.equal(rows.length, 2); assert.equal(rows[1].error, 'expected 200, got 500'); assert.equal(rows[1].offsetMs, 130);
});
test('本机 JMeter 真实运行以预期状态码判定，500 预期与实际失败不会混淆', { skip: !jmeterPath() }, async () => {
  const config = { ...perf(500), engine: 'jmeter', users: 1, duration: 2 };
  config.request.url = fixture.url + '/load?status=500';
  const matching = await runPerformance(config, {}, await context());
  assert.ok(matching.total > 0); assert.equal(matching.failed, 0); assert.equal(matching.engine, 'Apache JMeter');
  const mismatch = await runPerformance({ ...config, expectedStatus: 200 }, {}, await context());
  assert.ok(mismatch.total > 0); assert.equal(mismatch.failed, mismatch.total); assert.equal(mismatch.errorRate, 100);
});
test('JUnit 实际编译项目相关 Java 示例，失败断言和编译错误分别报告', async () => {
  assert.ok(await fs.stat(junitPath));
  const config = templates.java[0].config;
  const result = await runUnit(config, {}, await context());
  assert.equal(result.success, true); assert.equal(result.total, 2); assert.equal(result.passed, 2); assert.match(result.engine, /JUnit/);
  const failure = await runUnit({ ...config, tests: config.tests.replace('assertTrue(Subject.validTimeout(1))', 'assertFalse(Subject.validTimeout(1))') }, {}, await context());
  assert.equal(failure.failed, 1); assert.equal(failure.success, false); assert.match(failure.cases.find(c => c.status === 'FAILED').error, /expected|期望/i);
  const invalid = await runUnit({ ...config, implementation: 'public class Subject { invalid java }' }, {}, await context());
  assert.equal(invalid.compileError, true); assert.equal(invalid.success, false); assert.ok(invalid.output.length);
});
test('Vitest 实际执行前端 TypeScript 示例和异步断言', async () => {
  for (const template of templates.typescript) {
    const result = await runUnit(template.config, {}, await context());
    assert.equal(result.success, true, result.output); assert.equal(result.passed, 2); assert.equal(result.failed, 0);
  }
});
test('跳过的单测不能显示为全部通过', async () => {
  const result = await runUnit({ ...templates.typescript[0].config, tests: "test.skip('尚未实现的测试', () => {});" }, {}, await context());
  assert.equal(result.skipped, 1); assert.equal(result.passed, 0); assert.equal(result.success, false);
});
test('安全被动检查不会访问敏感路径，不适用项不计为安全通过', async () => {
  const offset = fixture.observed.paths.length;
  const result = await runSecurity({ url: fixture.url + '/secure', checks: ['headers', 'cookies', 'exposure', 'reflection', 'sql', 'cors', 'redirect', 'fingerprint'], active: false }, {}, await context());
  assert.equal(result.riskCount, 0); assert.ok(result.skipped >= 4); assert.equal(result.score, 100);
  assert.ok(!fixture.observed.paths.slice(offset).includes('/.env')); assert.ok(result.findings.some(f => f.title === 'HTTPS 严格传输' && f.status === 'SKIPPED'));
});
test('安全主动检查输出实际证据，反射线索与 CORS 不冒充已确认漏洞', async () => {
  const result = await runSecurity({ url: fixture.url + '/insecure', checks: ['headers', 'cookies', 'exposure', 'reflection', 'sql', 'cors', 'redirect', 'fingerprint'], active: true, authorized: true, parameter: 'q' }, {}, await context());
  assert.ok(result.riskCount >= 3); assert.ok(result.reviewCount >= 3); assert.ok(result.findings.some(f => f.title === '/actuator/env' && f.status === 'RISK'));
  assert.equal(result.findings.find(f => f.group === 'reflection').status, 'REVIEW'); assert.equal(result.findings.find(f => f.group === 'redirect').status, 'RISK');
  assert.ok(!JSON.stringify(result).includes('fixture-secret-only')); assert.ok(!JSON.stringify(result).includes('session=fixture-value'));
  await assert.rejects(runSecurity({ url: fixture.url, checks: ['sql'], active: true, authorized: false }, {}, await context()), /授权/);
});
test('兼容性矩阵使用真实视口和截图，区分响应式页面与移动端溢出', async () => {
  const options = { url: fixture.url + '/responsive', devices: ['desktop', 'phone'], engines: ['chromium'], settleMs: 20, requiredSelector: '#ready' };
  const good = await runCompatibility(options, {}, await context());
  assert.equal(good.total, 2); assert.equal(good.passed, 2); assert.ok(good.results.every(r => r.screenshot));
  const bad = await runCompatibility({ ...options, url: fixture.url + '/overflow' }, {}, await context());
  assert.equal(bad.passed, 1); assert.ok(bad.results.find(r => r.device === 'phone').issues.some(i => i.type === 'overflow'));
  assert.ok(bad.results.find(r => r.device === 'phone').overflowElements.length);
});
test('未安装的浏览器内核明确失败，不生成虚构截图', async () => {
  if (!availableBrowsers().firefox) await assert.rejects(runCompatibility({ url: fixture.url + '/responsive', devices: ['desktop'], engines: ['firefox'] }, {}, await context()), /未找到 firefox/);
});
test('后台任务写入终态与产物索引，服务新实例可恢复且不能越界读取', async () => {
  const job = await startJob('unit', { name: '持久化验收' }, {}, async (_payload, _variables, ctx) => {
    directories.push(ctx.directory); await delay(40); await fs.writeFile(path.join(ctx.directory, 'evidence.txt'), 'actual-output'); ctx.artifact('evidence.txt', '验收产物'); return { passed: 1, total: 1 };
  });
  assert.equal(job.status, 'RUNNING');
  for (let i = 0; i < 100; i++) { if ((await getJob(job.id)).status !== 'RUNNING') break; await delay(20); }
  await delay(30);
  const fresh = await import('../runner/jobs.mjs?test=' + randomUUID()); const restored = await fresh.getJob(job.id);
  assert.equal(restored.status, 'COMPLETED'); assert.equal(restored.result.passed, 1);
  assert.equal((await readArtifact(job.id, 'evidence.txt')).toString(), 'actual-output');
  await assert.rejects(readArtifact(job.id, '../result.json'), /不存在/); await assert.rejects(getJob('../outside'), /无效/);
});
