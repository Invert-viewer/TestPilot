import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { execute } from './client';
import { clone, uid } from './model';
import { variables, toast, busyTasks } from './store';
import { preferences, revealReport } from './preferences';
import { user } from './auth';

export type ExecutionKind = 'perf' | 'unit' | 'security' | 'compat';
export type Artifact = { filename: string; label: string; url: string };
export type Job<T = any> = { id: string; kind: ExecutionKind; name: string; status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'; createdAt: string; finishedAt?: string; progress: number; phase: string; error: string; logs: string[]; artifacts: Artifact[]; result: T | null };
export type Preset = { id: string; name: string; payload: any };
type History = { id: string; name: string; status: string; createdAt: string; summary: string };
type WorkspaceData = { presets: Record<ExecutionKind, Preset[]>; history: Record<ExecutionKind, History[]>; lastJobIds: Partial<Record<ExecutionKind, string>> };
const key = 'testpilot.workspaces.v1';
function load(): WorkspaceData {
  let saved: any;
  try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* New workspace. */ }
  const fresh: WorkspaceData = { presets: { perf: [], unit: [], security: [], compat: [] }, history: { perf: [], unit: [], security: [], compat: [] }, lastJobIds: saved?.lastJobIds || {} };
  for (const kind of ['perf', 'unit', 'security', 'compat'] as const) {
    if (Array.isArray(saved?.presets?.[kind])) fresh.presets[kind] = saved.presets[kind];
    if (Array.isArray(saved?.history?.[kind])) fresh.history[kind] = saved.history[kind].slice(0, 10);
  }
  return fresh;
}
export const workspaces = reactive(load());
watch(workspaces, () => { try { localStorage.setItem(key, JSON.stringify(workspaces)); } catch { toast('浏览器存储空间不足，本次配置尚未保存', true); } }, { deep: true });
export function savePreset(kind: ExecutionKind, name: string, payload: unknown, id?: string) {
  if (!name.trim()) return toast('请先填写名称', true);
  const value = { id: id || uid(), name: name.trim(), payload: clone(payload) };
  const index = workspaces.presets[kind].findIndex(p => p.id === value.id);
  if (index < 0) workspaces.presets[kind].push(value); else workspaces.presets[kind][index] = value;
  toast('配置已保存，正在同步到项目'); return value.id;
}
export function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const statusLabels: Record<string, string> = { RUNNING: '执行中', COMPLETED: '已完成', FAILED: '执行失败', CANCELLED: '已取消' };
function historySummary(job: Job) {
  if (job.status === 'FAILED') return job.error;
  if (!job.result) return statusLabels[job.status];
  const r = job.result;
  if (job.kind === 'unit' && r.compileError) return '编译 / 加载失败';
  if (job.kind === 'perf') return `${r.total ?? 0} 个请求 · 错误率 ${r.errorRate ?? '—'}%`;
  if (job.kind === 'security') return `${r.riskCount ?? '—'} 项风险 · ${r.reviewCount ?? '—'} 项待确认`;
  return `${r.passed ?? 0} / ${r.total ?? 0} 通过`;
}
export function useExecution<T>(kind: ExecutionKind) {
  const job = shallowRef<Job<T>>(), error = ref(''), starting = ref(false);
  const busy = computed(() => starting.value || job.value?.status === 'RUNNING');
  watch(busy, value => { busyTasks[kind] = value; });
  const result = computed(() => job.value?.result || undefined);
  let timer: ReturnType<typeof setTimeout>, generation = 0, disposed = false;
  function accept(value: Job<T>) {
    job.value = value;
    if (value.status !== 'RUNNING') {
      const entries = workspaces.history[kind];
      if (!entries.some(e => e.id === value.id)) {
        entries.unshift({ id: value.id, name: value.name, status: value.status, createdAt: value.createdAt, summary: historySummary(value) });
        entries.splice(10);
        if(preferences.notifyFailure && (value.status==='FAILED' || (value.result as any)?.failed>0 || (value.result as any)?.success===false)) toast(`${value.name} 执行存在失败，请查看结果`,true);
        revealReport('.result-panel');
      }
    }
  }
  async function poll(id: string, token: number, attempt = 0) {
    if (disposed || token !== generation) return;
    try {
      const value = await execute<Job<T>>('jobs/get', { id });
      if (disposed || token !== generation) return;
      accept(value); error.value = '';
      if (value.status === 'RUNNING') timer = setTimeout(() => poll(id, token), 600);
    } catch (e) {
      if (token !== generation) return;
      error.value = (e as Error).message;
      if (attempt < 3) timer = setTimeout(() => poll(id, token, attempt + 1), 1200);
    }
  }
  async function run(payload: unknown) {
    if (busy.value) return;
    clearTimeout(timer); const token = ++generation; starting.value = true; error.value = ''; job.value = undefined;
    try {
      const value = await execute<Job<T>>('jobs/start', { kind, payload: clone(payload), variables: clone(variables.value) });
      if (token !== generation) return;
      accept(value); workspaces.lastJobIds[kind] = value.id; timer = setTimeout(() => poll(value.id, token), 300);
    } catch (e) { error.value = (e as Error).message; } finally { starting.value = false; }
  }
  async function cancel() {
    if (!job.value) return;
    try { accept(await execute<Job<T>>('jobs/cancel', { id: job.value.id })); }
    catch (e) { error.value = (e as Error).message; }
  }
  async function loadHistory(id: string) {
    if (busy.value) return toast('请等待当前任务完成后再查看历史', true);
    clearTimeout(timer); const token = ++generation; error.value = ''; await poll(id, token);
  }
  onMounted(() => { const id = workspaces.lastJobIds[kind]; if (id) loadHistory(id); });
  onBeforeUnmount(() => { disposed = true; generation++; clearTimeout(timer); delete busyTasks[kind]; });
  return { job, result, busy, error, run, cancel, loadHistory };
}
export type Capabilities = { java: boolean; javaVersion: string; junitReady: boolean; junitVersion: string; jmeter: boolean; browsers: Record<string, boolean> };
export const capabilities = shallowRef<Capabilities>();
let capabilityRequest: Promise<void> | undefined;
export function invalidateCapabilities() { capabilityRequest=undefined;capabilities.value=undefined; }
export function loadCapabilities() {
  return capabilityRequest ||= fetch('/__runner/capabilities').then(async response => {
    if (response.ok) capabilities.value = (await response.json()).data;
    else {capabilityRequest=undefined;if(response.status===401)user.value=undefined;}
  }).catch(() => { capabilityRequest = undefined; });
}
export type PerfResult = { engine: string; total: number; passed: number; failed: number; durationMs: number; tps: number | null; avgMs: number | null; minMs: number | null; maxMs: number | null; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null; errorRate: number | null; timeline: { second: number; tps: number; p95Ms: number; avgMs: number }[]; samples: { offsetMs: number; elapsedMs: number; status: number; success: boolean; error: string }[]; capped?: boolean; config?: { url?: string } };
export type UnitResult = { engine: string; total: number; passed: number; failed: number; skipped: number; durationMs: number; success: boolean; compileError?: boolean; output: string; cases: { name: string; group: string; status: string; durationMs: number; error: string }[] };
export type Finding = { id: string; group: string; title: string; status: string; severity: string; evidence: string; recommendation: string };
export type SecurityResult = { engine: string; url: string; durationMs: number; findings: Finding[]; riskCount?: number; reviewCount?: number; passed?: number; skipped?: number; errors?: number; score?: number | null; scoreRule?: string };
export type DeviceResult = { id: string; engine: string; device: string; label: string; width: number; height: number; status: number; title: string; screenshot?: string; passed: boolean; durationMs: number; dimensions?: { viewport: number; clientWidth: number; scrollWidth: number; pageHeight: number }; overflowElements: { selector: string; right: number; width: number }[]; issues: { type: string; severity: string; message: string }[]; networkErrors: { url: string; error: string }[]; consoleErrors: string[] };
export type CompatResult = { engine: string; url: string; results: DeviceResult[]; total: number; passed?: number; issueCount?: number; durationMs?: number };
