import fs from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { ensureJunit, findJava, frontendRoot, numberIn, runProcess, junitVersion } from './runtime.mjs';

const asArray = value => value == null ? [] : Array.isArray(value) ? value : [value];
const content = value => typeof value === 'string' ? value : value?.['#text'] || value?.['@_message'] || '';
export function parseJunitReports(xmls) {
  const parser = new XMLParser({ ignoreAttributes: false, processEntities: false });
  const cases = [];
  for (const xml of xmls) {
    const report = parser.parse(xml);
    const suites = asArray(report.testsuite || report.testsuites?.testsuite);
    for (const suite of suites) for (const c of asArray(suite.testcase)) {
      const failure = c.failure ?? c.error;
      cases.push({ name: c['@_name'], group: c['@_classname'] || '', status: c.skipped !== undefined ? 'SKIPPED' : failure !== undefined ? 'FAILED' : 'PASSED',
        durationMs: Math.round(Number(c['@_time'] || 0) * 1000), error: failure === undefined ? '' : [failure?.['@_message'], content(failure)].filter(Boolean).join('\n').slice(0, 16000) });
    }
  }
  return cases;
}
function summary(engine, cases, durationMs, output, extra = {}) {
  return { engine, total: cases.length, passed: cases.filter(c => c.status === 'PASSED').length,
    failed: cases.filter(c => c.status === 'FAILED').length, skipped: cases.filter(c => c.status === 'SKIPPED').length,
    durationMs, cases, output, success: cases.length > 0 && cases.every(c => c.status === 'PASSED'), ...extra };
}
const javaString = value => '"' + String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t') + '"';
async function javaUnit(payload, variables, ctx) {
  ctx.update({ phase: '准备 JUnit 执行器', progress: 8 });
  const junit = await ensureJunit(ctx.signal), java = findJava();
  const classes = path.join(ctx.directory, 'classes'), reports = path.join(ctx.directory, 'junit-reports');
  await fs.mkdir(classes); await fs.mkdir(reports);
  const environment = `public final class TestEnvironment { private static final java.util.Map<String,String> VALUES = java.util.Map.ofEntries(${Object.entries(variables).map(([k, v]) => `java.util.Map.entry(${javaString(k)},${javaString(v)})`).join(',')}); public static String get(String key) { return VALUES.get(key); } }`;
  const files = ['Subject.java', 'SubjectTest.java', 'TestEnvironment.java'];
  await Promise.all(files.map((filename, i) => fs.writeFile(path.join(ctx.directory, filename), [payload.implementation, payload.tests, environment][i], 'utf8')));
  ctx.update({ phase: 'JDK 21 编译实现与测试', progress: 25 });
  const compilation = await runProcess(java.javac, ['--release', '21', '-encoding', 'UTF-8', '-cp', junit, '-d', classes, ...files], { cwd: ctx.directory, signal: ctx.signal, timeoutMs: 30000 });
  if (compilation.code !== 0) return summary(`JUnit ${junitVersion}`, [], 0, compilation.output, { success: false, compileError: true });
  ctx.update({ phase: 'JUnit 执行断言', progress: 55 });
  const started = performance.now();
  const execution = await runProcess(java.java, ['-Dfile.encoding=UTF-8', '-jar', junit, 'execute', '--class-path', classes, '--scan-class-path', '--reports-dir', reports, '--details', 'none', '--disable-banner', '--fail-if-no-tests', '--config', `junit.jupiter.execution.timeout.default=${payload.timeoutMs}ms`], { cwd: ctx.directory, signal: ctx.signal, timeoutMs: 45000 });
  const names = (await fs.readdir(reports)).filter(n => n.endsWith('.xml'));
  const cases = parseJunitReports(await Promise.all(names.map(name => fs.readFile(path.join(reports, name), 'utf8'))));
  for (const filename of ['Subject.java', 'SubjectTest.java']) ctx.artifact(filename, filename);
  const result = summary(`JUnit ${junitVersion} · Java 21`, cases, Math.round(performance.now() - started), compilation.output + execution.output);
  if (!cases.length) result.output = '没有发现测试方法。请使用 org.junit.jupiter.api.Test，并将类名设为 SubjectTest。\n' + result.output;
  return result;
}
async function vitestUnit(payload, variables, ctx) {
  ctx.update({ phase: '准备 TypeScript 测试进程', progress: 15 });
  const output = path.join(ctx.directory, 'vitest-result.json');
  const config = `export default { root: ${JSON.stringify(ctx.directory)}, test: { globals: true, include: ['subject.test.ts'], setupFiles: ['./setup.ts'], testTimeout: ${payload.timeoutMs}, hookTimeout: ${payload.timeoutMs}, pool: 'threads', maxWorkers: 1, fileParallelism: false, reporters: ['json'], outputFile: ${JSON.stringify(output)} } };`;
  await Promise.all([
    fs.writeFile(path.join(ctx.directory, 'subject.ts'), payload.implementation),
    fs.writeFile(path.join(ctx.directory, 'subject.test.ts'), payload.tests),
    fs.writeFile(path.join(ctx.directory, 'setup.ts'), `globalThis.env = Object.freeze(${JSON.stringify(variables)});`),
    fs.writeFile(path.join(ctx.directory, 'vitest.config.mjs'), config),
  ]);
  const started = performance.now(); ctx.update({ phase: 'Vitest 执行前端断言', progress: 45 });
  const result = await runProcess(process.execPath, [path.join(frontendRoot, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', path.join(ctx.directory, 'vitest.config.mjs')], { cwd: frontendRoot, signal: ctx.signal, timeoutMs: 45000 });
  let report;
  try { report = JSON.parse(await fs.readFile(output, 'utf8')); }
  catch { return summary('Vitest · TypeScript', [], Math.round(performance.now() - started), result.output, { success: false, compileError: true }); }
  const cases = (report.testResults || []).flatMap(file => (file.assertionResults || []).map(test => ({ name: test.title, group: test.ancestorTitles?.join(' › ') || '', status: test.status === 'passed' ? 'PASSED' : test.status === 'pending' || test.status === 'todo' || test.status === 'skipped' ? 'SKIPPED' : 'FAILED', durationMs: Math.round(test.duration || 0), error: (test.failureMessages || []).join('\n').slice(0, 16000) })));
  ctx.artifact('vitest-result.json', 'Vitest 原始 JSON'); ctx.artifact('subject.ts', '实现代码'); ctx.artifact('subject.test.ts', '测试代码');
  return summary('Vitest · TypeScript', cases, Math.round(performance.now() - started), result.output + (report.testResults || []).filter(r => r.message && !(r.assertionResults?.length)).map(r => r.message).join('\n'), { success: Boolean(report.success) && cases.length > 0 && cases.every(c => c.status === 'PASSED'), compileError: !cases.length });
}
export async function runUnit(payload, variables, ctx) {
  if (!payload || !['java', 'typescript'].includes(payload.language)) throw new Error('请选择 Java 或 TypeScript 执行器');
  if (typeof payload.implementation !== 'string' || typeof payload.tests !== 'string' || !payload.tests.trim()) throw new Error('请填写实现代码和测试代码');
  if (payload.implementation.length + payload.tests.length > 100000) throw new Error('代码总长度不能超过 100000 字符');
  const timeoutMs = numberIn(payload.timeoutMs, 100, 10000, '单个测试超时', true);
  return payload.language === 'java' ? javaUnit({ ...payload, timeoutMs }, variables, ctx) : vitestUnit({ ...payload, timeoutMs }, variables, ctx);
}
