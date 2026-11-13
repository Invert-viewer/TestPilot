import {describe,it,expect,vi,afterEach} from 'vitest';
import {api,ApiError,call,binary,isCancelled,toApiError} from '../src/api/client';
import {pageOf,taskRecord,requestDefinition} from '../src/types/validation';
import {diagnostic,recordUnexpected} from '../src/services/diagnostics';
import {requestSeed} from '../src/preview';
import {formatMetric} from '../src/composables/useTaskFlow';
afterEach(()=>{vi.restoreAllMocks();});
describe('runtime boundaries',()=>{
  it('rejects a malformed success instead of returning an empty list',async()=>{
    vi.spyOn(api,'request').mockResolvedValue({status:200,data:{code:'OK',message:'',traceId:'trace-1',data:{items:'wrong',page:1,pageSize:20,total:0}}});
    await expect(call('tasks.list',{},v=>pageOf(v,taskRecord))).rejects.toMatchObject({code:'INVALID_RESPONSE',status:200,traceId:'trace-1',errors:[{field:'$.items'}]});
  });
  it('keeps zero and unknown distinct',()=>{expect(formatMetric(0)).toBe('0');expect(formatMetric(null)).toBe('—');});
  it('reports a nested imported JSON position and leaves input intact',()=>{const draft=structuredClone(requestSeed);draft.query=[{key:'page',value:2,enabled:true}];const raw=JSON.stringify(draft);expect(()=>requestDefinition(draft)).toThrow('query[0].value');expect(JSON.stringify(draft)).toBe(raw);});
  it('identifies a JSON error returned to a download',async()=>{
    vi.spyOn(api,'request').mockResolvedValue({status:409,headers:{'content-type':'application/json'},data:new Blob([JSON.stringify({code:'REPORT_NOT_READY',message:'报告未就绪',data:null,traceId:'trace-r'})])});
    await expect(binary('report.file',{})).rejects.toMatchObject({status:409,code:'REPORT_NOT_READY',traceId:'trace-r'});
  });
  it('accepts a real JSON report artifact',async()=>{
    const blob=new Blob(['{"result":{},"options":{}}'],{type:'application/json'});vi.spyOn(api,'request').mockResolvedValue({status:200,headers:{'content-type':'application/json'},data:blob});expect(await binary('report.file',{})).toBe(blob);
  });
  it('keeps aborts silent and distinct from network failures',()=>{expect(isCancelled(toApiError({__CANCEL__:true}))).toBe(true);expect(toApiError(new Error()).code).toBe('NETWORK_ERROR');});
  it('logs only allowlisted fields and deduplicates unexpected errors',()=>{
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{}),err=vi.spyOn(console,'error').mockImplementation(()=>{});
    diagnostic('warn',{module:'api',operation:'create',status:400,code:'VALIDATION_ERROR',headers:{Authorization:'secret'},body:'private',url:'https://x?token=secret'} as never);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret|private|Authorization|https:/);
    const error=new Error('secret');recordUnexpected(error,'vue');recordUnexpected(error,'promise');expect(err).toHaveBeenCalledTimes(1);expect(JSON.stringify(err.mock.calls)).not.toContain('secret');
  });
});
