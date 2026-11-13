import { ref, onBeforeUnmount } from 'vue';
import * as api from '../api/index';
import type { ToolAsset, TaskRecord, TaskDetail, TaskLog, CaseResult, CaseDetail, TaskReport, TaskStatus } from '../types/api';
import { createTaskRequest, InputError, object } from '../types/validation';
import {readTaskIntent,saveTaskIntent,clearTaskIntent} from '../services/taskIntent';
export const POLL_INTERVAL_MS=1500, LOG_INTERVAL_MS=1000, LOG_LIMIT=200;
export function taskStatusLabel(task?:Pick<TaskRecord,'status'|'outcome'>|null):string {
  if(!task) return '未知';
  if(task.status==='FINISHED') return task.outcome==='FAILED'?'测试未通过':task.outcome==='PASSED'?'测试通过':'已完成 · 未评估';
  return {QUEUED:'排队中',RUNNING:'运行中',CANCELLING:'取消中',CANCELLED:'已取消',ERROR:'执行故障'}[task.status]??task.status;
}
export function statusTone(task?:Pick<TaskRecord,'status'|'outcome'>|null) { return task?.status==='ERROR'||task?.outcome==='FAILED'?'amber':task?.status==='FINISHED'&&task.outcome==='PASSED'?'green':'neutral'; }
export function formatMetric(value:unknown,digits=1):string { return typeof value!=='number'||!Number.isFinite(value)?'—':Number.isInteger(value)?String(value):value.toFixed(digits); }
export function formatBytes(value:unknown):string { return typeof value!=='number'?'—':value<1024?value+' B':value<1048576?(value/1024).toFixed(1)+' KB':(value/1048576).toFixed(1)+' MB'; }
export const caseStatusLabel=(status:string)=>({PASSED:'通过',FAILED:'失败',SKIPPED:'跳过',NOT_EVALUATED:'未评估'}[status]??status);
export const failureKindLabel=(kind:string|null)=>kind==='REQUEST'?'请求失败':kind==='ASSERTION'?'断言失败':'—';
function submission(config:unknown) {
  const o=object(config),p=object(o.parameters,'parameters');
  return createTaskRequest({name:typeof o.name==='string'?o.name.trim():o.name,assetId:o.assetId,parameters:{iterations:p.iterations,delayRequestMs:p.delayRequestMs,timeoutRequestMs:p.timeoutRequestMs}});
}
export const pickTaskParameters=(config:unknown)=>submission(config).parameters;
export function useTaskFlow(options:{onActiveChange?:(id:string|null)=>void}={}) {
  const toolAssets=ref<ToolAsset[]>([]),assetsLoading=ref(false),assetsError=ref<api.ApiError|null>(null);
  const tasks=ref<TaskRecord[]>([]),tasksTotal=ref(0),tasksPage=ref(1),tasksLoading=ref(false),tasksError=ref<api.ApiError|null>(null);
  const activeId=ref<string|null>(null),task=ref<TaskDetail|null>(null),detailLoading=ref(false),detailError=ref<api.ApiError|null>(null);
  const submitting=ref(false),submitError=ref<api.ApiError|null>(null),cancelling=ref(false),cancelError=ref<api.ApiError|null>(null);
  const logs=ref<TaskLog[]>([]),logCursor=ref<number|null>(null),logsComplete=ref(false),logsLoading=ref(false),logsError=ref<api.ApiError|null>(null);
  const results=ref<CaseResult[]>([]),resultsTotal=ref(0),resultsLoading=ref(false),resultsError=ref<api.ApiError|null>(null);
  const report=ref<TaskReport|null>(null),reportError=ref<api.ApiError|null>(null),reportLoading=ref(false);
  const caseDetails=ref<Record<string,CaseDetail>>({}),caseDetailLoading=ref(''),caseDetailError=ref<api.ApiError|null>(null);
  const alerts=ref<{id:string;scope:string;at:string;code:string;message:string;errors:api.ApiError['errors'];traceId:string|null}[]>([]);
  let generation=0,disposed=false,controller=new AbortController(),assetsController=new AbortController(),listController=new AbortController(),submitController=new AbortController();
  let statusTimer:ReturnType<typeof setTimeout>|undefined,logTimer:ReturnType<typeof setTimeout>|undefined,reportTimer:ReturnType<typeof setTimeout>|undefined,reportAttempt=0;
  let statusBusy=false,resultsBusy=false,reportBusy=false,pollFailures=0,logFailures=0;
  const pending=readTaskIntent();
  let retrySignature=pending?JSON.stringify(pending.body):'',retryKey=pending?.key??'',submitPromise:Promise<{id:string;status:number;task:TaskRecord}>|null=null;
  const current=(g:number)=>g===generation&&!disposed;
  const fail=(error:unknown)=>error instanceof InputError?new api.ApiError({code:'VALIDATION_ERROR',message:error.message,errors:[{field:error.field,message:error.message}]}):api.toApiError(error);
  function clearTimers(){ clearTimeout(statusTimer); clearTimeout(logTimer);clearTimeout(reportTimer); statusTimer=logTimer=reportTimer=undefined; }
  async function loadAssets() {
    assetsController.abort(); assetsController=new AbortController(); const local=assetsController;
    assetsLoading.value=true; assetsError.value=null;
    try {const data=await api.fetchToolAssets('APIFOX_CLI',local.signal); if(local===assetsController&&!disposed) toolAssets.value=data;}
    catch(error){if(!api.isCancelled(error)&&local===assetsController) assetsError.value=fail(error);}
    finally{if(local===assetsController)assetsLoading.value=false;}
  }
  async function loadTasks(status:TaskStatus|'ALL'='ALL',page=1) {
    if(disposed)return;
    listController.abort(); listController=new AbortController(); const local=listController;
    tasksLoading.value=true; tasksError.value=null;
    try {const data=await api.fetchTasks({status,page},local.signal); if(local!==listController||disposed)return; tasks.value=data.items.map(item=>item.id===task.value?.id&&task.value.terminal?{...item,...task.value}:item);tasksTotal.value=data.total;tasksPage.value=data.page;}
    catch(error){if(!api.isCancelled(error)&&local===listController)tasksError.value=fail(error);}
    finally{if(local===listController)tasksLoading.value=false;}
  }
  async function loadResults() {
    if(!activeId.value||resultsBusy)return; const id=activeId.value,g=generation,signal=controller.signal;
    resultsBusy=resultsLoading.value=true;
    try {const collected:CaseResult[]=[];let page=1,total=0;
      do{const data=await api.fetchTaskResults(id,{page,pageSize:100},signal);if(!current(g))return;total=data.total;collected.push(...data.items);if(!data.items.length)break;page++;}while(collected.length<total);
      results.value=collected;resultsTotal.value=total;resultsError.value=null;
    }catch(error){if(current(g)&&!api.isCancelled(error))resultsError.value=fail(error);}
    finally{if(current(g))resultsBusy=resultsLoading.value=false;}
  }
  async function loadReport() {
    if(!activeId.value||reportBusy)return; const id=activeId.value,g=generation;
    clearTimeout(reportTimer);
    reportBusy=reportLoading.value=true;
    try{const data=await api.fetchTaskReport(id,controller.signal);if(current(g)){report.value=data;reportError.value=null;reportAttempt=0;}}
    catch(error){if(current(g)&&!api.isCancelled(error)){reportError.value=fail(error);if(reportError.value.code==='REPORT_NOT_READY'&&task.value?.status==='FINISHED'&&reportAttempt++<10)reportTimer=setTimeout(loadReport,POLL_INTERVAL_MS);}}
    finally{if(current(g))reportBusy=reportLoading.value=false;}
  }
  async function refreshStatus() {
    if(!activeId.value||statusBusy)return; clearTimeout(statusTimer); const id=activeId.value,g=generation;
    statusBusy=true;
    try {const data=await api.fetchTask(id,controller.signal);if(!current(g))return;task.value=data;tasks.value=tasks.value.map(item=>item.id===data.id?{...item,...data}:item);detailError.value=null;pollFailures=0;
      if(data.terminal) await Promise.all([loadResults(),loadReport()]);
      else statusTimer=setTimeout(refreshStatus,POLL_INTERVAL_MS);
    }catch(error){if(!current(g)||api.isCancelled(error))return; const e=fail(error);detailError.value=e;pollFailures++;
      if(e.status!==404&&pollFailures<3)statusTimer=setTimeout(refreshStatus,POLL_INTERVAL_MS*2);
    }finally{if(current(g))statusBusy=false;}
  }
  async function pullLogs() {
    if(!activeId.value||logsLoading.value||logsComplete.value)return;clearTimeout(logTimer);
    const id=activeId.value,g=generation,cursor=logCursor.value; logsLoading.value=true;
    try {const data=await api.fetchTaskLogs(id,{cursor,limit:LOG_LIMIT},controller.signal);if(!current(g))return;
      // One in-flight pull per generation; backend cursor is a task-local sequence.
      if(data.items.length && data.nextCursor!==null && data.nextCursor<=(cursor??0)) throw new api.ApiError({code:'INVALID_RESPONSE',message:'日志游标未前进，已停止追加以避免重复'});
      logs.value.push(...data.items);logCursor.value=data.nextCursor;logsComplete.value=data.complete&&!data.hasMore;logsError.value=null;logFailures=0;
      if(!logsComplete.value)logTimer=setTimeout(pullLogs,data.hasMore?0:LOG_INTERVAL_MS);
    }catch(error){if(!current(g)||api.isCancelled(error))return;const e=fail(error);logsError.value=e;logFailures++;
      if(e.status!==404&&e.code!=='INVALID_RESPONSE'&&logFailures<3)logTimer=setTimeout(pullLogs,LOG_INTERVAL_MS*2);
    }finally{if(current(g))logsLoading.value=false;}
  }
  function reset() {
    generation++;controller.abort();controller=new AbortController();clearTimers();statusBusy=resultsBusy=reportBusy=false;
    task.value=null;detailError.value=null;detailLoading.value=false;logs.value=[];logCursor.value=null;logsComplete.value=false;logsLoading.value=false;logsError.value=null;
    results.value=[];resultsTotal.value=0;resultsLoading.value=false;resultsError.value=null;report.value=null;reportError.value=null;reportLoading.value=false;
    caseDetails.value={};caseDetailLoading.value='';caseDetailError.value=null;cancelError.value=null;cancelling.value=false;alerts.value=[];pollFailures=logFailures=reportAttempt=0;
  }
  async function open(id:string,{navigate=true}={}) {
    const target=id.trim();if(!target||disposed)return; reset();activeId.value=target;const g=generation;
    if(navigate)options.onActiveChange?.(target);detailLoading.value=true;
    await refreshStatus(); if(!current(g))return; detailLoading.value=false;if(task.value)void pullLogs();
  }
  async function refreshActive(){await refreshStatus();if(task.value){await pullLogs();if(!task.value.terminal)await Promise.all([loadResults(),loadReport()]);}}
  function submit(config:unknown) {
    if(submitPromise)return submitPromise;
    submitting.value=true;submitError.value=null;
    submitPromise=(async()=>{
      await Promise.resolve();
      try{const body=submission(config),signature=JSON.stringify(body);
        if(signature!==retrySignature){retrySignature=signature;retryKey=api.newIdempotencyKey();}
        saveTaskIntent({key:retryKey,body});
        const response=await api.createTask(body,retryKey,submitController.signal);
        clearTaskIntent(retryKey);
        retryKey=retrySignature='';await open(response.data.id);await loadTasks();return{id:response.data.id,status:response.status,task:response.data};
      }catch(error){const e=fail(error);submitError.value=e;throw e;}
      finally{submitting.value=false;submitPromise=null;}
    })();return submitPromise;
  }
  async function toggleCase(item:CaseResult) {
    if(!activeId.value||caseDetailLoading.value)return; const key=item.caseId,id=activeId.value,g=generation;
    if(caseDetails.value[key]){delete caseDetails.value[key];return;}caseDetailLoading.value=key;caseDetailError.value=null;
    try{const data=await api.fetchTaskResultDetail(id,key,controller.signal);if(current(g))caseDetails.value[key]=data;}
    catch(error){if(current(g)&&!api.isCancelled(error))caseDetailError.value=fail(error);}
    finally{if(current(g))caseDetailLoading.value='';}
  }
  async function cancel(){if(!activeId.value||cancelling.value)return;const id=activeId.value,g=generation;cancelling.value=true;
    try{await api.cancelTask(id,controller.signal);if(current(g)){await refreshStatus();await loadTasks();}}
    catch(error){if(current(g)&&!api.isCancelled(error))cancelError.value=fail(error);}
    finally{if(current(g))cancelling.value=false;}
  }
  function clearActive(){reset();activeId.value=null;options.onActiveChange?.(null);}
  onBeforeUnmount(()=>{disposed=true;reset();assetsController.abort();listController.abort();submitController.abort();});
  return {toolAssets,assetsLoading,assetsError,tasks,tasksTotal,tasksPage,tasksLoading,tasksError,activeId,task,detailLoading,detailError,submitting,submitError,
    logs,logCursor,logsComplete,logsLoading,logsError,results,resultsTotal,resultsLoading,resultsError,report,reportError,reportLoading,
    alerts,cancelling,cancelError,caseDetails,caseDetailLoading,caseDetailError,loadAssets,loadTasks,open,submit,refreshActive,refreshStatus,pullLogs,loadResults,loadReport,toggleCase,cancel,clearActive,
    dismissAlert:(id:string)=>{alerts.value=alerts.value.filter(a=>a.id!==id);}};
}
export type TaskFlow=ReturnType<typeof useTaskFlow>;
