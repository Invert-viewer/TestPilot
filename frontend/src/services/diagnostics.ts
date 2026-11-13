type Level = 'info' | 'warn' | 'error';
export interface Diagnostic { module: string; operation: string; durationMs?: number; taskId?: string | null; traceId?: string | null; status?: number; code?: string }
const seen = new WeakSet<object>();
// Deliberately do not accept messages, URLs, headers, bodies or arbitrary context.
export function diagnostic(level: Level, entry: Diagnostic) {
  const safe: Record<string,string|number> = { level, module: entry.module.replace(/[^\w.-]/g,''), operation: entry.operation.replace(/[^\w.-]/g,'') };
  for(const key of ['durationMs','status'] as const) if(typeof entry[key]==='number' && Number.isFinite(entry[key])) safe[key]=Math.round(entry[key]!);
  for(const key of ['taskId','traceId','code'] as const) {
    const value=entry[key]; if(typeof value==='string' && /^[\w.-]{1,120}$/.test(value)) safe[key]=value;
  }
  console[level]('[TestPilot]', safe);
}
export function recordUnexpected(error: unknown, operation: string) {
  if(error && typeof error==='object') { if(seen.has(error)) return; seen.add(error); }
  diagnostic('error',{module:'runtime',operation,code:'UNEXPECTED_ERROR'});
}
