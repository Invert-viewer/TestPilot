import { taskStatuses, outcomes, caseStatuses, metricKeys } from './api';
import type { TaskRecord, TaskDetail, ToolAsset, TaskReport, CaseResult, CaseDetail, CursorLogs, PageResult, TaskSummary, CreateTaskRequest, RequestDefinition } from './api';
type Obj = Record<string, unknown>;
export class InputError extends Error {
  constructor(public field: string, message: string, public raw: unknown) {
    super(`${field}: ${message}`); this.name = 'InputError';
  }
}
function fail(p: string, m: string, raw: unknown): never { throw new InputError(p, m, raw); }
export function object(v: unknown, p = '$'): Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : fail(p, '应为对象', v);
}
function str(v: unknown, p: string) { if (typeof v !== 'string') fail(p, '应为字符串', v); }
function id(v: unknown,p:string) {str(v,p);if(!(v as string).trim())fail(p,'标识不能为空',v);}
function num(v: unknown, p: string, integer = false) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (integer && !Number.isInteger(v))) fail(p, '应为非负' + (integer ? '整数' : '数值'), v);
}
function bool(v: unknown, p: string) { if (typeof v !== 'boolean') fail(p, '应为布尔值', v); }
function nullable(v: unknown, p: string, parse: (v: unknown, p: string) => void) { if (v !== null) parse(v,p); }
function enumeration(v: unknown, p: string, values: readonly string[]) { if (!values.includes(v as string)) fail(p, `应为 ${values.join(' / ')}`,v); }
function array(v: unknown,p: string,parse:(v: unknown,p:string)=>unknown) {
  if (!Array.isArray(v)) fail(p,'应为数组',v); v.forEach((x,i)=>parse(x,`${p}[${i}]`));
}
const integer = (v:unknown,p:string)=>num(v,p,true);
function strings(o:Obj, keys:string[],p:string) { keys.forEach(k=>str(o[k],`${p}.${k}`)); }
function date(v:unknown,p:string) { str(v,p); if (!Number.isFinite(Date.parse(v as string))) fail(p,'应为 ISO 时间',v); }
export function summary(v:unknown,p='$'): TaskSummary {
  const o=object(v,p), keys=['totalCases','passedCases','failedCases','skippedCases','notEvaluatedCases'];
  keys.forEach(k=>nullable(o[k],`${p}.${k}`,integer));
  const values=keys.map(k=>o[k]);
  if (!values.every(x=>x===null) && (values.some(x=>x===null) || values[0]!== (values.slice(1) as number[]).reduce((a,b)=>a+b,0))) fail(p,'计数必须全部未知或合计一致',v);
  return o as unknown as TaskSummary;
}
export function taskRecord(v:unknown,p='$'): TaskRecord {
  const o=object(v,p); strings(o,['id','name','siteId','environmentId'],p);
  id(o.id,`${p}.id`);
  enumeration(o.tool,`${p}.tool`,['APIFOX_CLI','JMETER']); enumeration(o.status,`${p}.status`,taskStatuses);
  enumeration(o.outcome,`${p}.outcome`,outcomes); bool(o.terminal,`${p}.terminal`); date(o.createdAt,`${p}.createdAt`);
  ['startedAt','finishedAt'].forEach(k=>nullable(o[k],`${p}.${k}`,date)); nullable(o.sourceTaskId,`${p}.sourceTaskId`,str);
  if (o.terminal !== ['FINISHED','CANCELLED','ERROR'].includes(o.status as string)) fail(`${p}.terminal`,'与状态不一致',v);
  summary(o.summary,`${p}.summary`); return o as unknown as TaskRecord;
}
export function taskDetail(v:unknown,p='$'): TaskDetail {
  taskRecord(v,p); const o=object(v,p), a=object(o.asset,`${p}.asset`), params=object(o.parameters,`${p}.parameters`);
  strings(a,['id'],`${p}.asset`); nullable(a.name,`${p}.asset.name`,str); integer(a.version,`${p}.asset.version`);
  enumeration(a.tool,`${p}.asset.tool`,['APIFOX_CLI','JMETER']);
  ['iterations','delayRequestMs','timeoutRequestMs'].forEach(k=>integer(params[k],`${p}.parameters.${k}`));
  nullable(o.exitCode,`${p}.exitCode`,integer); ['errorCode','errorMessage'].forEach(k=>nullable(o[k],`${p}.${k}`,str));
  return o as unknown as TaskDetail;
}
export function toolAsset(v:unknown,p='$'): ToolAsset {
  const o=object(v,p); strings(o,['id','name','scenarioKey'],p); integer(o.version,`${p}.version`);
  id(o.id,`${p}.id`);
  enumeration(o.tool,`${p}.tool`,['APIFOX_CLI','JMETER']); enumeration(o.kind,`${p}.kind`,['APIFOX_SCENARIO','APIFOX_FILE','JMETER_FILE']);
  const s=object(o.source,`${p}.source`);
  ['projectId','scenarioId','apifoxEnvironmentId','environmentName','siteUrl','fileId'].forEach(k=>{if(s[k]!==undefined) str(s[k],`${p}.source.${k}`);});
  array(o.requestRefs,`${p}.requestRefs`,(v,p)=>{const r=object(v,p); str(r.id,`${p}.id`); integer(r.version,`${p}.version`);});
  return o as unknown as ToolAsset;
}
export function pageOf<T>(v:unknown,parse:(v:unknown,p:string)=>T,p='$'): PageResult<T> {
  const o=object(v,p); array(o.items,`${p}.items`,parse); ['page','pageSize','total'].forEach(k=>integer(o[k],`${p}.${k}`));
  if (Number(o.page)<1 || Number(o.pageSize)<1) fail(p,'页码与页大小须大于零',v);
  return o as unknown as PageResult<T>;
}
export function cursorLogs(v:unknown,p='$'): CursorLogs {
  const o=object(v,p); array(o.items,`${p}.items`,(v,p)=>{const l=object(v,p); date(l.time,`${p}.time`); str(l.text,`${p}.text`); enumeration(l.stream,`${p}.stream`,['STDOUT','STDERR','PLATFORM']);});
  nullable(o.nextCursor,`${p}.nextCursor`,integer); bool(o.hasMore,`${p}.hasMore`); bool(o.complete,`${p}.complete`);
  if ((o.items as unknown[]).length && o.nextCursor===null) fail(`${p}.nextCursor`,'有日志时必须提供读取位置',v);
  return o as unknown as CursorLogs;
}
export function caseResult(v:unknown,p='$'): CaseResult {
  const o=object(v,p); strings(o,['caseId','name'],p); enumeration(o.status,`${p}.status`,caseStatuses);
  id(o.caseId,`${p}.caseId`);
  ['durationMs','statusCode'].forEach(k=>nullable(o[k],`${p}.${k}`,integer)); nullable(o.failureKind,`${p}.failureKind`,(v,p)=>enumeration(v,p,['REQUEST','ASSERTION'])); nullable(o.failureMessage,`${p}.failureMessage`,str);
  return o as unknown as CaseResult;
}
export function caseDetail(v:unknown,p='$'): CaseDetail {
  caseResult(v,p); const o=object(v,p);
  array(o.assertions,`${p}.assertions`,(v,p)=>{const a=object(v,p); strings(a,['id','type','operator'],p); ['target','expected','actual','message'].forEach(k=>nullable(a[k],`${p}.${k}`,str)); enumeration(a.status,`${p}.status`,['PASSED','FAILED','SKIPPED']);});
  return o as unknown as CaseDetail;
}
export function taskReport(v:unknown,p='$'): TaskReport {
  const o=object(v,p); str(o.taskId,`${p}.taskId`); summary(o.summary,`${p}.summary`);
  id(o.taskId,`${p}.taskId`);
  const m=object(o.metrics,`${p}.metrics`); metricKeys.forEach(k=>nullable(m[k],`${p}.metrics.${k}`,num));
  for(const k of ['errorRate','passRate','evaluatedPassRate','assertionPassRate']) if(typeof m[k]==='number' && m[k]>1) fail(`${p}.metrics.${k}`,'当前后端比率应在 0~1',m[k]);
  array(o.files,`${p}.files`,(v,p)=>{const f=object(v,p); str(f.name,`${p}.name`); integer(f.size,`${p}.size`); if(f.contentType!==undefined) str(f.contentType,`${p}.contentType`);});
  return o as unknown as TaskReport;
}
export function createTaskRequest(v:unknown): CreateTaskRequest {
  const o=object(v), params=object(o.parameters,'parameters'); str(o.name,'name'); str(o.assetId,'assetId');
  if (!o.assetId) fail('assetId','请选择已登记场景',o.assetId);
  for(const [k,min,max] of [['iterations',1,100],['delayRequestMs',0,60000],['timeoutRequestMs',1,600000]] as const) {
    integer(params[k],`parameters.${k}`); if(Number(params[k])<min || Number(params[k])>max) fail(`parameters.${k}`,`取值范围 ${min}~${max}`,params[k]);
  }
  return {name:o.name as string,assetId:o.assetId as string,parameters:{iterations:params.iterations as number,delayRequestMs:params.delayRequestMs as number,timeoutRequestMs:params.timeoutRequestMs as number}};
}
export function requestDefinition(v:unknown,{draft=false}:{draft?:boolean}={}): RequestDefinition {
  const o=object(v); strings(o,['name','siteId','environmentId','url'],'$');
  if (!draft && !(o.name as string).trim()) fail('name','填写请求名称',o.name);
  enumeration(o.method,'method',['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']); enumeration(o.charset,'charset',['UTF-8','GB18030']);
  const pairs=(v:unknown,p:string)=>array(v,p,(v,p)=>{const r=object(v,p); strings(r,['key','value'],p); bool(r.enabled,`${p}.enabled`);});
  ['query','headers','cookies'].forEach(k=>pairs(o[k],k));
  const body=object(o.body,'body'); enumeration(body.mode,'body.mode',['NONE','JSON','RAW','FORM_URLENCODED']);
  if(['JSON','RAW'].includes(body.mode as string)) str(body.text,'body.text');
  if(body.mode==='JSON') {try{JSON.parse(body.text as string);}catch{fail('body.text','不是有效 JSON',body.text);}}
  if(body.mode==='FORM_URLENCODED') pairs(body.fields,'body.fields');
  if(!draft && ['GET','HEAD'].includes(o.method as string) && body.mode!=='NONE') fail('body.mode','GET / HEAD 使用 NONE',body.mode);
  if(draft){if(typeof o.timeoutMs!=='number'||!Number.isFinite(o.timeoutMs)||!Number.isInteger(o.timeoutMs))fail('timeoutMs','应为整数',o.timeoutMs);}else{integer(o.timeoutMs,'timeoutMs');if(Number(o.timeoutMs)<1)fail('timeoutMs','须大于零',o.timeoutMs);} bool(o.followRedirects,'followRedirects');
  array(o.assertions,'assertions',(v,p)=>{const a=object(v,p); strings(a,['id','expected'],p); bool(a.enabled,`${p}.enabled`);
    enumeration(a.type,`${p}.type`,['STATUS_CODE','HEADER','BODY','JSON_FIELD','RESPONSE_TIME_MS']); nullable(a.target,`${p}.target`,str);
    enumeration(a.operator,`${p}.operator`,a.type==='STATUS_CODE'?['EQ']:a.type==='RESPONSE_TIME_MS'?['LTE']:['EQ','CONTAINS']);
    if(!draft && ['HEADER','JSON_FIELD'].includes(a.type as string) && !a.target) fail(`${p}.target`,'填写断言目标',a.target);
  });
  return o as unknown as RequestDefinition;
}
