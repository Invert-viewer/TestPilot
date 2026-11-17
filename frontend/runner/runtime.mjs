import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

const runtimeContext = new AsyncLocalStorage();
export const runtimeSettings = () => runtimeContext.getStore() || {};
export const withRuntimeSettings = (settings, callback) => runtimeContext.run(Object.freeze({...settings}), callback);

export const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
export const runsRoot = path.join(frontendRoot, '.runs');
export const junitVersion = '6.0.1';
export const junitPath = path.join(runsRoot, 'tools', `junit-platform-console-standalone-${junitVersion}.jar`);
export function findJava() {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const configured = runtimeSettings().javaHome;
  if (configured) {
    const java = path.join(configured,'bin','java'+suffix), javac = path.join(configured,'bin','javac'+suffix);
    if (!fs.existsSync(java) || !fs.existsSync(javac)) throw new Error('配置的 Java 目录中未找到 java / javac');
    return {java,javac};
  }
  const homes = [process.env.TESTPILOT_JAVA_HOME, process.env.JAVA_HOME];
  const jdks = path.join(os.homedir(), '.jdks');
  if (fs.existsSync(jdks)) homes.push(...fs.readdirSync(jdks).filter(n => /21/.test(n)).map(n => path.join(jdks, n)));
  for (const home of homes.filter(Boolean)) if (fs.existsSync(path.join(home, 'bin', 'java' + suffix)) && fs.existsSync(path.join(home, 'bin', 'javac' + suffix))) return { java: path.join(home, 'bin', 'java' + suffix), javac: path.join(home, 'bin', 'javac' + suffix) };
  return { java: 'java' + suffix, javac: 'javac' + suffix };
}
export function jmeterPath() {
  const configured = runtimeSettings().jmeterHome;
  if (configured) {
    const jar = path.join(configured,'bin','ApacheJMeter.jar');
    return fs.existsSync(jar) ? jar : undefined;
  }
  const homes = [process.env.JMETER_HOME, process.env.TESTPILOT_JMETER_HOME];
  for (const root of [frontendRoot, path.dirname(frontendRoot), 'D:/', 'F:/', process.env.ProgramFiles].filter(Boolean)) {
    try { for (const entry of fs.readdirSync(root, { withFileTypes: true })) if (entry.isDirectory() && /jmeter/i.test(entry.name)) {
      homes.push(path.join(root, entry.name));
      const child = path.join(root, entry.name);
      for (const name of fs.readdirSync(child)) if (/jmeter/i.test(name)) homes.push(path.join(child, name));
    } } catch { /* Optional tool locations. */ }
  }
  return homes.filter(Boolean).map(home => path.join(home, 'bin', 'ApacheJMeter.jar')).find(p => fs.existsSync(p));
}
export function numberIn(value, min, max, label, integer = false) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`${label}范围为 ${min}–${max}${integer ? '，且须为整数' : ''}`);
  return n;
}
export async function runProcess(executable, args, { cwd, signal, timeoutMs = 60000, onOutput } = {}) {
  if (signal?.aborted) throw new Error('执行已取消');
  return new Promise((resolve, reject) => {
    let output = '', expired = false, spawnError;
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const cancel = () => child.kill();
    const timer = setTimeout(() => { expired = true; child.kill(); }, timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    function append(chunk) { const text = chunk.toString('utf8'); output = (output + text).slice(-64000); onOutput?.(text); }
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.on('error', error => { spawnError = error; });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (signal?.aborted) reject(new Error('执行已取消'));
      else if (expired) reject(new Error(`执行超时（${timeoutMs / 1000} 秒），进程已结束`));
      else if (spawnError) reject(new Error(`无法启动 ${path.basename(executable)}：${spawnError.message}`));
      else resolve({ code, output });
    });
  });
}
let downloading;
export async function ensureJunit(signal) {
  if (fs.existsSync(junitPath)) return junitPath;
  if (downloading) { await downloading; return junitPath; }
  downloading = (async () => {
    const base = `https://repo.maven.apache.org/maven2/org/junit/platform/junit-platform-console-standalone/${junitVersion}/junit-platform-console-standalone-${junitVersion}.jar`;
    const timeout = AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(60000)]);
    const [jar, checksum] = await Promise.all([fetch(base, { signal: timeout }), fetch(base + '.sha256', { signal: timeout })]);
    if (!jar.ok || !checksum.ok) throw new Error('JUnit 下载失败，请检查网络后重试，或先运行 npm run setup:java');
    const bytes = Buffer.from(await jar.arrayBuffer());
    const expected = (await checksum.text()).trim().split(/\s/)[0].toLowerCase();
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('JUnit 文件校验失败，未执行下载的文件');
    await fsp.mkdir(path.dirname(junitPath), { recursive: true });
    await fsp.writeFile(junitPath, bytes);
  })();
  try { await downloading; return junitPath; } finally { downloading = undefined; }
}
export async function runtimeCapabilities() {
  let java = false, javaVersion = '';
  try { const result = await runProcess(findJava().java, ['-version'], { timeoutMs: 5000 }); java = result.code === 0; javaVersion = result.output.split('\n')[0]; } catch { /* A Java installation is optional for the other workspaces. */ }
  return { java, javaVersion, junitReady: fs.existsSync(junitPath), junitVersion, jmeter: Boolean(jmeterPath()) };
}
