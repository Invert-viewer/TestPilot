import {uuid} from '../services/uuid';
import { call, binary } from './client';
import { pageOf, toolAsset, taskRecord, taskDetail, cursorLogs, caseResult, caseDetail, taskReport, createTaskRequest, object, InputError } from '../types/validation';
import type { CreateTaskRequest, TaskStatus } from '../types/api';
export * from './client';
export {executeRequest} from './workspace';
export const newIdempotencyKey=()=>uuid();
const path=(id:string)=>'/tasks/'+encodeURIComponent(id);
export async function fetchToolAssets(tool='APIFOX_CLI',signal?:AbortSignal) {
  const collected=[]; let page=1;
  for(;;) {
    const {data}=await call('assets.list',{url:'/tool-assets',params:{tool,page,pageSize:100},signal},v=>pageOf(v,toolAsset));
    collected.push(...data.items); if(collected.length>=data.total || !data.items.length) return collected; page++;
  }
}
export async function fetchTasks({status='ALL',page=1,pageSize=50}:{status?:TaskStatus|'ALL';page?:number;pageSize?:number}={},signal?:AbortSignal) {
  return (await call('tasks.list',{url:'/tasks',params:{page,pageSize,status:status==='ALL'?undefined:status},signal},v=>pageOf(v,taskRecord))).data;
}
export const createTask=(body:CreateTaskRequest,key:string,signal?:AbortSignal)=>call('tasks.create',{method:'post',url:'/tasks',data:createTaskRequest(body),headers:{'Idempotency-Key':key},signal},taskRecord);
export const fetchTask=async(id:string,signal?:AbortSignal)=>(await call('tasks.detail',{url:path(id),signal},taskDetail)).data;
export const fetchTaskLogs=async(id:string,{cursor=null,limit=200}:{cursor?:number|null;limit?:number}={},signal?:AbortSignal)=>(await call('tasks.logs',{url:path(id)+'/logs',params:{cursor:cursor??0,limit},signal},cursorLogs)).data;
export const fetchTaskResults=async(id:string,{page=1,pageSize=100,status}:{page?:number;pageSize?:number;status?:string}={},signal?:AbortSignal)=>(await call('tasks.results',{url:path(id)+'/results',params:{page,pageSize,status},signal},v=>pageOf(v,caseResult))).data;
export const fetchTaskResultDetail=async(id:string,caseId:string,signal?:AbortSignal)=>(await call('tasks.assertions',{url:path(id)+'/results/'+encodeURIComponent(caseId),signal},caseDetail)).data;
export const fetchTaskReport=async(id:string,signal?:AbortSignal)=>(await call('tasks.report',{url:path(id)+'/report',signal},taskReport)).data;
export const cancelTask=(id:string,signal?:AbortSignal)=>call('tasks.cancel',{method:'post',url:path(id)+'/cancel',signal},taskRecord);
export const fetchReportPreview=(id:string,signal?:AbortSignal)=>binary('report.preview',{url:path(id)+'/report/view',signal},true);
export const fetchReportFile=(id:string,name:string,signal?:AbortSignal)=>binary('report.file',{url:path(id)+'/report/files/'+encodeURIComponent(name),signal});
const deleted=(v:unknown):{id:string;deleted:true}=>{const o=object(v); if(o.deleted!==true) throw new InputError('deleted','删除响应缺少 deleted 标记',v); return {id:String(o.id??''),deleted:true};};
export const deleteTask=async(id:string,signal?:AbortSignal)=>(await call('tasks.delete',{method:'delete',url:path(id),signal},deleted)).data;
export const deleteToolAsset=async(id:string,signal?:AbortSignal)=>(await call('assets.delete',{method:'delete',url:'/tool-assets/'+encodeURIComponent(id),signal},deleted)).data;
