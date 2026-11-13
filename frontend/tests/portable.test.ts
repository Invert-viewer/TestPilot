import {describe,it,expect,afterEach} from 'vitest';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
const require=createRequire(import.meta.url);
const {readConfiguration,createRuntime,listenAvailable}=require('../portable/server.cjs');
const servers:http.Server[]=[];
function fixture(backendUrl='http://127.0.0.1:1'){
  const root=mkdtempSync(path.join(tmpdir(),'TestPilot 中文 空格 & '));mkdirSync(path.join(root,'dist'));writeFileSync(path.join(root,'dist/index.html'),'<h1>TestPilot</h1>');writeFileSync(path.join(root,'dist/app.js'),'window.testpilot=true');
  writeFileSync(path.join(root,'config.json'),JSON.stringify({port:0,backendUrl,openBrowser:false,startPage:'/#/sites'}));return root;
}
async function start(config:unknown){const server=createRuntime(config);servers.push(server);const port=await listenAvailable(server,(config as {port:number}).port);return {server,url:'http://127.0.0.1:'+port,port};}
async function backend(handler:http.RequestListener){const server=http.createServer(handler);servers.push(server);const port=await listenAvailable(server,0);return 'http://127.0.0.1:'+port;}
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>new Promise<void>(resolve=>{s.closeAllConnections();s.close(()=>resolve());})));});
describe('portable frontend runtime',()=>{
  it('serves the prebuilt app from a Chinese path and keeps package internals private',async()=>{
    const {url,server}=await start(readConfiguration(fixture()));expect(server.address()).toMatchObject({address:'127.0.0.1'});
    expect(await (await fetch(url+'/')).text()).toContain('TestPilot');expect((await fetch(url+'/app.js')).headers.get('content-type')).toContain('javascript');
    expect((await fetch(url+'/config.json')).status).toBe(404);expect((await fetch(url+'/server.cjs')).status).toBe(404);expect((await fetch(url+'/%2e%2e/config.json')).status).toBe(404);
  });
  it('preserves platform POST content, idempotency key, response status and trace id',async()=>{
    let seen:unknown;
    const target=await backend((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{seen={url:req.url,key:req.headers['idempotency-key'],body:JSON.parse(body)};res.writeHead(202,{'content-type':'application/json'});res.end(JSON.stringify({code:'OK',message:'',data:{id:'task-portable'},traceId:'trace-portable'}));});});
    const {url}=await start(readConfiguration(fixture(target)));const body={name:'便携验收',assetId:'asset-a',parameters:{iterations:1,delayRequestMs:100,timeoutRequestMs:5000}};
    const response=await fetch(url+'/api/v1/tasks',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'same-key'},body:JSON.stringify(body)});
    expect(response.status).toBe(202);expect(await response.json()).toMatchObject({traceId:'trace-portable'});expect(seen).toEqual({url:'/api/v1/tasks',key:'same-key',body});
  });
  it('preserves report-not-ready JSON errors instead of substituting demo data',async()=>{
    const target=await backend((_req,res)=>{res.writeHead(409,{'content-type':'application/json'});res.end(JSON.stringify({code:'REPORT_NOT_READY',message:'报告尚未生成',data:null,traceId:'trace-wait'}));});
    const {url}=await start(readConfiguration(fixture(target)));const response=await fetch(url+'/api/v1/tasks/task-1/report');expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'REPORT_NOT_READY',traceId:'trace-wait'});
  });
  it('streams report bytes and preserves file headers',async()=>{
    const file=new Uint8Array([0,1,2,255,10]);const target=await backend((_req,res)=>{res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="report.bin"'});res.end(file);});
    const {url}=await start(readConfiguration(fixture(target)));const response=await fetch(url+'/api/v1/tasks/task-1/report/files/report.bin');expect(new Uint8Array(await response.arrayBuffer())).toEqual(file);expect(response.headers.get('content-disposition')).toContain('report.bin');
  });
  it('keeps the frontend usable while returning a real backend-unavailable error',async()=>{
    const target=await backend((_req,res)=>res.end());const last=servers.pop()!;await new Promise<void>(resolve=>last.close(()=>resolve()));
    const {url}=await start(readConfiguration(fixture(target)));expect((await fetch(url+'/')).status).toBe(200);const response=await fetch(url+'/api/v1/tool-assets');expect(response.status).toBe(502);expect(await response.json()).toMatchObject({code:'BACKEND_UNAVAILABLE',traceId:expect.any(String)});
  });
  it('selects another port when occupied',async()=>{const config=readConfiguration(fixture());const first=await start(config);const second=await start({...config,port:first.port});expect(second.port).toBeGreaterThan(first.port);});
  it('rejects credential-bearing backend URLs and invalid ports',()=>{const root=fixture();expect(()=>readConfiguration(root,['--backend-url=http://user:password@localhost:8080'])).toThrow('凭据');expect(()=>readConfiguration(root,['--port=-1'])).toThrow('port');});
});
