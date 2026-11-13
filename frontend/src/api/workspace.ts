import {call} from './client';
import {object,InputError,requestDefinition} from '../types/validation';

export const collections=['sites','environments','requests','assets','parameterPlans','comparisons','comparisonExperiences','assertionCases','checks'] as const;
export type Collection=typeof collections[number];
export interface Resource {id:string;revision?:number;[key:string]:unknown}
export interface Change {collection:Collection;id:string;revision:number;value:Resource|null}
export type Snapshot=Record<Collection,Resource[]>;
function snapshot(input:unknown):Snapshot {
  const data=object(input);
  for(const kind of collections){
    const rows=data[kind];
    if(!Array.isArray(rows))throw new InputError(kind,'需要数组',rows);
    rows.forEach((entry,i)=>{
      const r=object(entry,kind+'['+i+']');
      if(typeof r.id!=='string'||!Number.isInteger(r.revision))throw new InputError(kind+'['+i+']','需要 ID 和整数版本',entry);
      if(kind==='requests')requestDefinition(r.definition);
      if(kind==='sites'||kind==='environments')for(const key of ['name','baseUrl'])if(typeof r[key]!=='string')throw new InputError(kind+'.'+key,'需要文本',r[key]);
    });
  }
  return data as Snapshot;
}
export async function readWorkspace(){return (await call('workspace.read',{url:'/workspace'},snapshot)).data;}
export async function commitWorkspace(changes:Change[]){return (await call('workspace.commit',{method:'post',url:'/workspace',data:changes},snapshot)).data;}
export async function executeRequest(definition:ReturnType<typeof requestDefinition>,url:string,signal:AbortSignal){
  return (await call('debug.execute',{method:'post',url:'/http-debug/executions',data:{...definition,url},timeout:definition.timeoutMs+5000,signal},input=>{
    const row=object(input);
    if(typeof row.id!=='string'||!['FAILED','COMPLETED'].includes(String(row.transportStatus))||typeof row.durationMs!=='number'||!Array.isArray(row.assertions))throw new InputError('execution','无效的执行结果',input);
    if(row.transportStatus==='COMPLETED'){const r=object(row.response);if(typeof r.statusCode!=='number'||typeof r.bodyText!=='string'||!Array.isArray(r.headers))throw new InputError('response','无效的目标响应',r);}
    if(!['PASSED','FAILED','NOT_EVALUATED'].includes(String(row.outcome)))throw new InputError('outcome','无效的调试结论',row.outcome);
    row.assertions.forEach((entry,i)=>{const a=object(entry);if(typeof a.expected!=='string'||!['PASSED','FAILED','SKIPPED'].includes(String(a.status)))throw new InputError('assertions['+i+']','无效的断言结果',entry);});
    if(row.transportStatus==='FAILED'){const error=object(row.error);if(typeof error.code!=='string'||typeof error.message!=='string'||row.response!==null)throw new InputError('error','无效的传输错误',error);}
    return row;
  })).data;
}
