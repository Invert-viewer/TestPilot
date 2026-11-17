import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runsRoot } from './runtime.mjs';

const jobs = new Map();
export async function cancelAllJobs() {
  const running=[...jobs.values()].filter(j=>j.status==='RUNNING');
  for(const job of running)job.controller.abort();
  await Promise.allSettled(running.map(j=>j.promise));
}
const validId = id => typeof id === 'string' && /^[a-f\d-]{36}$/.test(id);
export function publicJob(job) {
  const { controller, directory, promise, ...view } = job;
  return view;
}
export async function getJob(id) {
  if (!validId(id)) throw new Error('无效的执行编号');
  if (jobs.has(id)) return jobs.get(id);
  try {
    const saved = JSON.parse(await fs.readFile(path.join(runsRoot, id, 'result.json'), 'utf8'));
    return { ...saved, directory: path.join(runsRoot, id) };
  } catch { throw new Error('执行记录不存在或服务已重启，请重新运行'); }
}
export async function startJob(kind, payload, variables, runner) {
  if ([...jobs.values()].filter(j => j.status === 'RUNNING').length >= 2) throw new Error('已有两项任务正在执行，请等待完成或取消后重试');
  const id = randomUUID(), directory = path.join(runsRoot, id);
  await fs.mkdir(directory, { recursive: true });
  const job = { id, kind, name: String(payload.name || payload.url || '测试执行').slice(0, 120), status: 'RUNNING',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), progress: 0, phase: '准备执行',
    result: null, error: '', logs: [], artifacts: [], controller: new AbortController(), directory };
  jobs.set(id, job);
  const update = values => { Object.assign(job, values, { updatedAt: new Date().toISOString() }); };
  const log = text => { job.logs.push(String(text).slice(0, 800)); if (job.logs.length > 50) job.logs.shift(); };
  const artifact = (filename, label) => {
    if (!/^[\w.-]+$/.test(filename)) throw new Error('无效的产物文件名');
    const value = { filename, label, url: `/__runner/artifact/${id}/${filename}` };
    job.artifacts.push(value); return value.url;
  };
  const timer = setTimeout(() => { job.error = '执行超过 240 秒，已停止'; job.controller.abort(); }, 240000);
  job.promise = (async () => {
    try {
      const result = await runner(payload, variables, { signal: job.controller.signal, directory, update, log, artifact, id });
      update({ result, status: job.controller.signal.aborted ? 'CANCELLED' : 'COMPLETED', progress: 100, phase: job.controller.signal.aborted ? '已取消' : '执行完成' });
    } catch (error) {
      update({ status: job.controller.signal.aborted ? 'CANCELLED' : 'FAILED', error: job.error || error.message, phase: job.controller.signal.aborted ? '已取消' : '执行失败' });
      log(error.message);
    } finally {
      clearTimeout(timer); job.finishedAt = new Date().toISOString();
      await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(publicJob(job), null, 2));
    }
  })();
  job.promise.catch(error => { job.error = '执行记录写入失败：' + error.message; });
  return publicJob(job);
}
export async function cancelJob(id) {
  const job = await getJob(id);
  if (job.status === 'RUNNING' && job.controller) { job.phase = '正在停止'; job.controller.abort(); }
  return publicJob(job);
}
export async function readArtifact(id, filename) {
  const job = await getJob(id);
  if (!job.artifacts.some(a => a.filename === filename) || !/^[\w.-]+$/.test(filename)) throw new Error('执行产物不存在');
  return fs.readFile(path.join(job.directory, filename));
}
