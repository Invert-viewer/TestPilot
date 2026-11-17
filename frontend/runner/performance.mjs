import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parse } from 'csv-parse/sync';
import { prepareRequest } from './http.mjs';
import { findJava, jmeterPath, numberIn, runProcess } from './runtime.mjs';

const round = n => Math.round(n * 100) / 100;
export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
export function summarizeSamples(samples, durationMs) {
  const values = samples.map(s => s.elapsedMs), failed = samples.filter(s => !s.success).length;
  const buckets = new Map();
  for (const s of samples) {
    const second = Math.floor(s.offsetMs / 1000);
    const b = buckets.get(second) || { second, requests: 0, failures: 0, sumMs: 0, values: [] };
    b.requests++; if (!s.success) b.failures++; b.sumMs += s.elapsedMs; b.values.push(s.elapsedMs); buckets.set(second, b);
  }
  const timeline = [...buckets.values()].sort((a, b) => a.second - b.second).map(b => ({ second: b.second,
    tps: b.requests, avgMs: round(b.sumMs / b.requests), p95Ms: percentile(b.values, .95), errorRate: round(b.failures / b.requests * 100) }));
  return { total: samples.length, passed: samples.length - failed, failed, durationMs: Math.round(durationMs),
    tps: samples.length && durationMs > 0 ? round(samples.length / (durationMs / 1000)) : null,
    avgMs: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null,
    minMs: values.length ? values.reduce((a, b) => Math.min(a, b), Infinity) : null, maxMs: values.length ? values.reduce((a, b) => Math.max(a, b), 0) : null,
    p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99),
    errorRate: samples.length ? round(failed / samples.length * 100) : null, timeline };
}
function validate(config, variables) {
  const req = prepareRequest(config.request, variables);
  const value = { req, users: numberIn(config.users, 1, 200, '虚拟用户', true),
    duration: numberIn(config.duration, 1, 180, '持续时间', true), rampUp: numberIn(config.rampUp, 0, 60, '爬坡时间'),
    thinkTime: numberIn(config.thinkTime, 0, 10000, '思考时间', true), expectedStatus: numberIn(config.expectedStatus, 100, 599, '预期状态码', true) };
  if (value.rampUp > value.duration) throw new Error('爬坡时间不能大于持续时间');
  return value;
}
function csv(samples) {
  const cell = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  return 'offsetMs,elapsedMs,status,success,error\n' + samples.map(s => [s.offsetMs, s.elapsedMs, s.status, s.success, s.error].map(cell).join(',')).join('\n');
}
async function finish(engine, config, samples, durationMs, ctx, extra = {}) {
  await fs.writeFile(path.join(ctx.directory, 'samples.csv'), csv(samples)); ctx.artifact('samples.csv', '请求样本 CSV');
  return { engine, ...summarizeSamples(samples, durationMs), samples: samples.slice(-100),
    config: { users: config.users, duration: config.duration, rampUp: config.rampUp, thinkTime: config.thinkTime,
      url: config.req.url, method: config.req.method, expectedStatus: config.expectedStatus }, ...extra };
}
export async function runHttpLoad(payload, variables, ctx) {
  const cfg = validate(payload, variables), samples = [], started = performance.now(), deadline = started + cfg.duration * 1000;
  let cancelledRequests = 0, capped = false;
  ctx.update({ phase: '启动并发用户', progress: 1 });
  ctx.log(`${cfg.users} 个并发用户，${cfg.duration} 秒，预期 HTTP ${cfg.expectedStatus}`);
  const snapshot = () => { const elapsed = performance.now() - started; ctx.update({ phase: '采集真实请求样本', progress: Math.min(97, Math.round(elapsed / (cfg.duration * 1000) * 100)), result: { engine: 'Node HTTP', ...summarizeSamples(samples, elapsed), samples: samples.slice(-20), config: { users: cfg.users, duration: cfg.duration } } }); };
  const interval = setInterval(snapshot, 500);
  const worker = async index => {
    const startDelay = cfg.users === 1 ? 0 : cfg.rampUp * 1000 * index / (cfg.users - 1);
    if (startDelay) try { await delay(startDelay, undefined, { signal: ctx.signal }); } catch { return; }
    while (!ctx.signal.aborted && performance.now() < deadline && !capped) {
      const began = performance.now();
      try {
        const response = await fetch(cfg.req.url, { method: cfg.req.method, headers: cfg.req.headers, body: cfg.req.body,
          redirect: cfg.req.followRedirects ? 'follow' : 'manual', signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(cfg.req.timeoutMs)]) });
        const reader = response.body?.getReader();
        if (reader) { try { for (;;) { const { done } = await reader.read(); if (done) break; } } finally { reader.releaseLock(); } }
        samples.push({ offsetMs: Math.round(performance.now() - started), elapsedMs: Math.round(performance.now() - began), status: response.status, success: response.status === cfg.expectedStatus, error: response.status === cfg.expectedStatus ? '' : `预期 ${cfg.expectedStatus}，实际 ${response.status}` });
      } catch (error) {
        if (ctx.signal.aborted) { cancelledRequests++; break; }
        samples.push({ offsetMs: Math.round(performance.now() - started), elapsedMs: Math.round(performance.now() - began), status: 0, success: false, error: error.name === 'TimeoutError' ? '请求超时' : (error.cause?.message || error.message) });
      }
      if (samples.length >= 100000) { capped = true; ctx.log('达到 100000 个样本上限，停止本次采样'); }
      if (cfg.thinkTime) try { await delay(cfg.thinkTime, undefined, { signal: ctx.signal }); } catch { break; }
    }
  };
  try { await Promise.all(Array.from({ length: cfg.users }, (_, i) => worker(i))); }
  finally { clearInterval(interval); }
  const elapsed = performance.now() - started;
  return finish('Node HTTP', cfg, samples, elapsed, ctx, { cancelledRequests, capped });
}
const xml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export function buildJmx(payload, variables) {
  const cfg = validate(payload, variables), url = new URL(cfg.req.url);
  const headers = Object.entries(cfg.req.headers).map(([name, value]) => `<elementProp name="${xml(name)}" elementType="Header"><stringProp name="Header.name">${xml(name)}</stringProp><stringProp name="Header.value">${xml(value)}</stringProp></elementProp>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3"><hashTree><TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="TestPilot Load" enabled="true"><boolProp name="TestPlan.functional_mode">false</boolProp><elementProp name="TestPlan.user_defined_variables" elementType="Arguments"><collectionProp name="Arguments.arguments"/></elementProp></TestPlan><hashTree><ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="TestPilot Users" enabled="true"><stringProp name="ThreadGroup.on_sample_error">continue</stringProp><elementProp name="ThreadGroup.main_controller" elementType="LoopController"><boolProp name="LoopController.continue_forever">false</boolProp><stringProp name="LoopController.loops">-1</stringProp></elementProp><stringProp name="ThreadGroup.num_threads">${cfg.users}</stringProp><stringProp name="ThreadGroup.ramp_time">${cfg.rampUp}</stringProp><boolProp name="ThreadGroup.scheduler">true</boolProp><stringProp name="ThreadGroup.duration">${cfg.duration}</stringProp><stringProp name="ThreadGroup.delay">0</stringProp></ThreadGroup><hashTree><HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="TestPilot Request" enabled="true"><elementProp name="HTTPsampler.Arguments" elementType="Arguments"><collectionProp name="Arguments.arguments">${cfg.req.body === undefined ? '' : `<elementProp name="" elementType="HTTPArgument"><boolProp name="HTTPArgument.always_encode">false</boolProp><stringProp name="Argument.value">${xml(cfg.req.body)}</stringProp><stringProp name="Argument.metadata">=</stringProp></elementProp>`}</collectionProp></elementProp><stringProp name="HTTPSampler.domain">${xml(url.hostname)}</stringProp><stringProp name="HTTPSampler.port">${xml(url.port)}</stringProp><stringProp name="HTTPSampler.protocol">${xml(url.protocol.slice(0, -1))}</stringProp><stringProp name="HTTPSampler.path">${xml(url.pathname + url.search)}</stringProp><stringProp name="HTTPSampler.method">${cfg.req.method}</stringProp><stringProp name="HTTPSampler.contentEncoding">UTF-8</stringProp><boolProp name="HTTPSampler.postBodyRaw">${cfg.req.body !== undefined}</boolProp><boolProp name="HTTPSampler.follow_redirects">${cfg.req.followRedirects}</boolProp><boolProp name="HTTPSampler.auto_redirects">false</boolProp><boolProp name="HTTPSampler.use_keepalive">true</boolProp><stringProp name="HTTPSampler.connect_timeout">${cfg.req.timeoutMs}</stringProp><stringProp name="HTTPSampler.response_timeout">${cfg.req.timeoutMs}</stringProp></HTTPSamplerProxy><hashTree><HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="Request Headers" enabled="true"><collectionProp name="HeaderManager.headers">${headers}</collectionProp></HeaderManager><hashTree/><ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="Expected HTTP status" enabled="true"><collectionProp name="Asserion.test_strings"><stringProp name="status">${cfg.expectedStatus}</stringProp></collectionProp><stringProp name="Assertion.test_field">Assertion.response_code</stringProp><boolProp name="Assertion.assume_success">true</boolProp><intProp name="Assertion.test_type">8</intProp></ResponseAssertion><hashTree/>${cfg.thinkTime ? `<ConstantTimer guiclass="ConstantTimerGui" testclass="ConstantTimer" testname="Think Time" enabled="true"><stringProp name="ConstantTimer.delay">${cfg.thinkTime}</stringProp></ConstantTimer><hashTree/>` : ''}</hashTree></hashTree></hashTree></hashTree></jmeterTestPlan>`;
}
export function parseJtl(text) {
  const safe = text.slice(0, text.lastIndexOf('\n') + 1);
  if (!safe.trim()) return [];
  const records = parse(safe, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true });
  const first = Number(records[0]?.timeStamp || 0);
  return records.filter(r => Number.isFinite(Number(r.elapsed))).map(r => ({ offsetMs: Math.max(0, Number(r.timeStamp) - first + Number(r.elapsed)), elapsedMs: Number(r.elapsed), status: Number(r.responseCode) || 0, success: r.success === 'true', error: r.success === 'true' ? '' : r.failureMessage || r.responseMessage || r.responseCode }));
}
export async function runJmeter(payload, variables, ctx) {
  const jar = jmeterPath(); if (!jar) throw new Error('未检测到 JMeter，请设置 JMETER_HOME 后重启执行服务，或选择 Node HTTP 引擎');
  const cfg = validate(payload, variables), jmx = path.join(ctx.directory, 'plan.jmx'), jtl = path.join(ctx.directory, 'jmeter.csv');
  await fs.writeFile(jmx, buildJmx(payload, variables)); ctx.artifact('plan.jmx', 'JMeter 计划 JMX');
  ctx.update({ phase: '启动 JMeter', progress: 1 }); let latest = [];
  const tick = async () => {
    try { latest = parseJtl(await fs.readFile(jtl, 'utf8')); const elapsed = latest.reduce((max, s) => Math.max(max, s.offsetMs), 1); ctx.update({ phase: 'JMeter 正在采样', progress: Math.min(97, Math.round(elapsed / (cfg.duration * 1000) * 100)), result: { engine: 'Apache JMeter', ...summarizeSamples(latest, elapsed), samples: latest.slice(-20) } }); } catch { /* File appears after JMeter initializes. */ }
  };
  const interval = setInterval(tick, 700); let outcome;
  try { outcome = await runProcess(findJava().java, ['-Djava.awt.headless=true', '-jar', jar, '-n', '-t', jmx, '-l', jtl, '-j', path.join(ctx.directory, 'jmeter.log'), '-Jjmeter.save.saveservice.output_format=csv', '-Jjmeter.save.saveservice.timestamp_format=ms', '-Jjmeter.save.saveservice.print_field_names=true', '-Jjmeter.save.saveservice.autoflush=true'], { cwd: path.dirname(jar), signal: ctx.signal, timeoutMs: (cfg.duration + 45) * 1000, onOutput: text => ctx.log(text.trim()) }); }
  catch (error) { if (!ctx.signal.aborted) throw error; }
  finally { clearInterval(interval); await tick(); }
  if (!ctx.signal.aborted && outcome?.code !== 0) throw new Error('JMeter 执行失败：' + outcome?.output.slice(-1800));
  if (!latest.length && !ctx.signal.aborted) throw new Error('JMeter 没有产生请求样本，请查看执行日志');
  ctx.artifact('jmeter.csv', '原始 JTL / CSV');
  return finish('Apache JMeter', cfg, latest, latest.reduce((max, s) => Math.max(max, s.offsetMs), 0), ctx);
}
export async function runPerformance(payload, variables, ctx) {
  return payload.engine === 'jmeter' ? runJmeter(payload, variables, ctx) : runHttpLoad(payload, variables, ctx);
}
