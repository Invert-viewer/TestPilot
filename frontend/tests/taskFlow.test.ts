import {describe,it,expect,vi,afterEach} from 'vitest';
import {mount} from '@vue/test-utils';
import {defineComponent,h} from 'vue';
import * as api from '../src/api/index';
import {useTaskFlow,type TaskFlow} from '../src/composables/useTaskFlow';
import type {TaskDetail} from '../src/types/api';
const detail=(id:string,status='RUNNING')=>({id,name:id,siteId:'http://127.0.0.1:4000',environmentId:'env',tool:'APIFOX_CLI',status,terminal:status==='FINISHED',outcome:'NOT_EVALUATED',createdAt:'2026-11-12T20:00:00+08:00',startedAt:null,finishedAt:null,sourceTaskId:null,summary:{totalCases:null,passedCases:null,failedCases:null,skippedCases:null,notEvaluatedCases:null},asset:{id:'a',version:1,name:'场景',tool:'APIFOX_CLI'},parameters:{iterations:1,delayRequestMs:100,timeoutRequestMs:5000},exitCode:null,errorCode:null,errorMessage:null}) as TaskDetail;
const config={name:'test',assetId:'a',parameters:{iterations:1,delayRequestMs:100,timeoutRequestMs:5000,uploadReport:true},headers:{Authorization:'target-only'}};
const wrappers:ReturnType<typeof mount>[]=[];
function setup(){let flow:TaskFlow;const wrapper=mount(defineComponent({setup(){flow=useTaskFlow();return()=>h('div');}}));wrappers.push(wrapper);return flow!;}
function defaults(){vi.spyOn(api,'fetchTask').mockImplementation(async id=>detail(id));vi.spyOn(api,'fetchTasks').mockResolvedValue({items:[],total:0,page:1,pageSize:50});vi.spyOn(api,'fetchTaskLogs').mockResolvedValue({items:[],nextCursor:0,hasMore:false,complete:true});vi.spyOn(api,'fetchTaskResults').mockResolvedValue({items:[],total:0,page:1,pageSize:100});vi.spyOn(api,'fetchTaskReport').mockRejectedValue(new api.ApiError({status:409,code:'REPORT_NOT_READY'}));}
afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());vi.useRealTimers();vi.restoreAllMocks();});
describe('task lifecycle',()=>{
  it('deduplicates clicks, retries ambiguous results with the original key and strips unsupported fields',async()=>{
    defaults();const create=vi.spyOn(api,'createTask').mockRejectedValueOnce(new api.ApiError({code:'TIMEOUT'})).mockResolvedValue({data:detail('task-1'),status:202,traceId:'t'});
    const flow=setup();const first=flow.submit(config),duplicate=flow.submit(config);expect(first).toBe(duplicate);await expect(first).rejects.toMatchObject({code:'TIMEOUT'});await flow.submit(config);
    expect(create.mock.calls[0][1]).toBe(create.mock.calls[1][1]);expect(create.mock.calls[0][0]).toEqual({name:'test',assetId:'a',parameters:{iterations:1,delayRequestMs:100,timeoutRequestMs:5000}});
  });
  it('uses a new key after content changes and recovers from local validation errors',async()=>{
    defaults();const create=vi.spyOn(api,'createTask').mockRejectedValue(new api.ApiError({code:'TIMEOUT'}));const flow=setup();
    await expect(flow.submit({...config,parameters:{...config.parameters,iterations:0}})).rejects.toMatchObject({code:'VALIDATION_ERROR'});
    await expect(flow.submit(config)).rejects.toBeDefined();await expect(flow.submit({...config,name:'changed'})).rejects.toBeDefined();expect(create.mock.calls[0][1]).not.toBe(create.mock.calls[1][1]);
  });
  it('aborts a switched task, ignores its late response, resets loading and cleans up on unmount',async()=>{
    defaults();let resolveOld:(v:TaskDetail)=>void=()=>{};let signal:AbortSignal|undefined;
    vi.mocked(api.fetchTask).mockImplementation((id,s)=>{if(id==='old'){signal=s;return new Promise(resolve=>{resolveOld=resolve;});}return Promise.resolve(detail(id));});
    const flow=setup(),old=flow.open('old');await flow.open('new');expect(signal?.aborted).toBe(true);resolveOld(detail('old'));await old;expect(flow.task.value?.id).toBe('new');expect(flow.detailLoading.value).toBe(false);
    wrappers[0].unmount();expect(flow.activeId.value).toBe('new');
  });
  it('stops status polling at terminal and drains all cursor log pages once',async()=>{
    vi.useFakeTimers();defaults();vi.mocked(api.fetchTask).mockResolvedValue(detail('done','FINISHED'));
    vi.mocked(api.fetchTaskLogs).mockResolvedValueOnce({items:[{time:'now',stream:'PLATFORM',text:'first'}],nextCursor:1,hasMore:true,complete:false}).mockResolvedValueOnce({items:[{time:'now',stream:'STDOUT',text:'second'}],nextCursor:2,hasMore:false,complete:true});
    const flow=setup();await flow.open('done');await vi.advanceTimersByTimeAsync(100);expect(flow.logs.value.map(l=>l.text)).toEqual(['first','second']);await vi.advanceTimersByTimeAsync(6000);expect(api.fetchTask).toHaveBeenCalledTimes(1);expect(api.fetchTaskLogs).toHaveBeenCalledTimes(2);
  });
  it('keeps a local report error without clearing available task or results',async()=>{defaults();vi.mocked(api.fetchTask).mockResolvedValue(detail('done','FINISHED'));const flow=setup();await flow.open('done');expect(flow.task.value?.status).toBe('FINISHED');expect(flow.reportError.value?.code).toBe('REPORT_NOT_READY');expect(flow.detailError.value).toBeNull();});
  it('stops pending polls and cursor pulls when the page is left',async()=>{vi.useFakeTimers();defaults();vi.mocked(api.fetchTaskLogs).mockResolvedValue({items:[],nextCursor:0,hasMore:false,complete:false});const flow=setup();await flow.open('running');const statusCount=vi.mocked(api.fetchTask).mock.calls.length;wrappers[0].unmount();await vi.advanceTimersByTimeAsync(20000);expect(api.fetchTask).toHaveBeenCalledTimes(statusCount);expect(api.fetchTaskLogs).toHaveBeenCalledTimes(1);});
  it('retains the same unknown-result intent across page lifetimes',async()=>{defaults();const create=vi.spyOn(api,'createTask').mockRejectedValue(new api.ApiError({code:'TIMEOUT'}));const first=setup();await expect(first.submit(config)).rejects.toBeDefined();wrappers[0].unmount();const second=setup();await expect(second.submit(config)).rejects.toBeDefined();expect(create.mock.calls[0][1]).toBe(create.mock.calls[1][1]);expect(sessionStorage.getItem('testpilot-task-intent-v1')).not.toContain('target-only');});
});
