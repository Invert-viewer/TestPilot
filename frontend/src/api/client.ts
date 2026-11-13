import axios, { type AxiosRequestConfig } from 'axios';
import type { FieldError } from '../types/api';
import { InputError, object } from '../types/validation';
import { diagnostic } from '../services/diagnostics';
export const API_PREFIX='/api/v1';
/** Platform only. Never use the target URL or credentials from RequestDefinition. */
export const api=axios.create({baseURL:API_PREFIX,timeout:20000,withCredentials:false});
export class ApiError extends Error {
  status: number; code: string; errors: FieldError[]; traceId: string|null; raw?: unknown;
  constructor(detail: {message?:string; status?:number; code?:string; errors?:FieldError[]; traceId?:string|null; raw?:unknown}={}) {
    super(detail.message || '请求失败'); this.name='ApiError'; this.status=detail.status??0;
    this.code=detail.code??'UNKNOWN_ERROR'; this.errors=detail.errors??[]; this.traceId=detail.traceId??null; this.raw=detail.raw;
  }
}
export const isCancelled=(error:unknown)=>axios.isCancel(error) || error instanceof ApiError && error.code==='CANCELLED';
function bodyError(data:unknown,status:number,traceId:string|null=null): ApiError {
  const b=data && typeof data==='object' ? data as Record<string,unknown>:{};
  const d=b.data && typeof b.data==='object'?b.data as Record<string,unknown>:{};
  const errors=Array.isArray(d.errors)?d.errors.filter((x):x is FieldError=>!!x && typeof x.field==='string' && typeof x.message==='string'):[];
  return new ApiError({status,code:typeof b.code==='string'?b.code:`HTTP_${status}`,message:typeof b.message==='string'&&b.message?b.message:`平台请求失败（HTTP ${status}）`,traceId:typeof b.traceId==='string'?b.traceId:traceId,errors});
}
export function toApiError(error:unknown):ApiError {
  if(error instanceof ApiError) return error;
  if(isCancelled(error)) return new ApiError({code:'CANCELLED',message:'请求已取消'});
  if(error instanceof InputError) return new ApiError({code:'INVALID_RESPONSE',message:`响应格式错误：${error.message}`,errors:[{field:error.field,message:error.message}],raw:error.raw});
  if(axios.isAxiosError(error)) {
    if(error.response) return bodyError(error.response.data,error.response.status,error.response.headers['x-trace-id']??null);
    if(['ECONNABORTED','ETIMEDOUT'].includes(error.code??'')) return new ApiError({code:'TIMEOUT',message:'平台请求超时；提交结果可能未知，请按原内容重试'});
  }
  return new ApiError({code:'NETWORK_ERROR',message:'无法连接后端服务，请确认 Spring Boot 已在 8080 端口启动'});
}
export async function call<T>(operation:string,config:AxiosRequestConfig,parse:(v:unknown)=>T) {
  const start=performance.now(); let httpStatus=0; let traceId:string|null=null;let raw:unknown;
  const taskId=config.url?.match(/^\/tasks\/(task-[\w-]+)(?:\/|$)/)?.[1];
  try {
    const response=await api.request<unknown>(config); httpStatus=response.status;raw=response.data;
    const body=object(response.data); traceId=typeof body.traceId==='string'?body.traceId:null;
    if(typeof body.code!=='string'||typeof body.message!=='string'||!('data' in body)||!traceId) throw new InputError('$','缺少 code/message/data/traceId 信封',response.data);
    if(body.code!=='OK') throw bodyError(body,response.status,traceId);
    const data=parse(body.data);
    diagnostic('info',{module:'api',operation,durationMs:performance.now()-start,status:httpStatus,traceId,taskId});
    return {data,status:httpStatus,traceId};
  } catch(error) {
    const normalized=toApiError(error); if(!normalized.status) normalized.status=httpStatus; normalized.traceId??=traceId;
    if(error instanceof InputError)normalized.raw=raw;
    if(!isCancelled(normalized)) diagnostic('warn',{module:'api',operation,durationMs:performance.now()-start,status:normalized.status,code:normalized.code,traceId:normalized.traceId,taskId});
    throw normalized;
  }
}
/** JSON report files are valid artifacts; JSON error envelopes are failures. */
export async function binary(operation:string,config:AxiosRequestConfig,html=false):Promise<Blob> {
  const start=performance.now();
  try {
    const response=await api.request<Blob>({...config,responseType:'blob',validateStatus:()=>true});
    const blob=response.data, type=String(response.headers['content-type']??'');
    if(type.includes('json') || response.status>=400) {
      let data:unknown; try{data=JSON.parse(await blob.text());}catch{data=null;}
      const obj=data && typeof data==='object'? data as Record<string,unknown>:null;
      if(response.status>=400 || obj && typeof obj.code==='string' && obj.code!=='OK' && 'message' in obj && 'data' in obj) throw bodyError(data,response.status);
    }
    if(html && !type.includes('text/html')) throw new ApiError({code:'INVALID_RESPONSE',status:response.status,message:'报告预览未返回 HTML'});
    diagnostic('info',{module:'api',operation,durationMs:performance.now()-start,status:response.status}); return blob;
  } catch(error) {
    const normalized=toApiError(error);
    if(!isCancelled(normalized)) diagnostic('warn',{module:'api',operation,durationMs:performance.now()-start,status:normalized.status,code:normalized.code,traceId:normalized.traceId});
    throw normalized;
  }
}
