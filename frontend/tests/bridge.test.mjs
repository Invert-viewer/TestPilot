import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { withRuntimeSettings, runtimeSettings } from '../runner/runtime.mjs';
let upstream, gateway, base, aiEnabled=false, lastPrompt;
const cookie='TP_SESSION=bridge-test-session';
before(async()=>{
  upstream=http.createServer(async(req,res)=>{
    const reply=(status,data,message='')=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({code:status===200?'OK':'DENIED',data,message}));};
    if(req.headers.cookie!==cookie)return reply(401,null,'请先登录');
    if(req.url==='/api/v1/auth/me')return reply(200,{id:'test-user',role:'TESTER'});
    if(req.url==='/api/v1/platform/settings')return reply(200,{executor:{browserPath:'F:/not-installed/browser.exe',javaHome:'F:/not-installed/java',jmeterHome:'F:/not-installed/jmeter',headless:true},ai:{configured:aiEnabled}});
    if(req.url==='/api/v1/platform/ai/compose'){
      let raw='';for await(const part of req)raw+=part;lastPrompt=JSON.parse(raw);
      return aiEnabled?reply(200,{steps:[{action:'click',selector:'#submit',value:''}],unmatched:[],engine:'remote-test'}):reply(409,null,'AI 尚未配置 API 密钥');
    }
    reply(404,null,'接口不存在');
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  process.env.TESTPILOT_BACKEND_URL=`http://127.0.0.1:${upstream.address().port}`;
  const {runnerMiddleware}=await import('../runner/plugin.mjs');
  gateway=http.createServer((req,res)=>runnerMiddleware(req,res,()=>{res.statusCode=404;res.end();}));
  await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${gateway.address().port}/__runner/`;
});
after(async()=>{for(const server of [gateway,upstream])if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});});
test('执行入口与产物下载都必须通过后端会话认证',async()=>{
  for(const route of ['capabilities','artifact/00000000-0000-4000-8000-000000000000/report.csv']){const response=await fetch(base+route);assert.equal(response.status,401);assert.match((await response.json()).message,/登录/);}
  const forged=await fetch(base+'capabilities',{headers:{Cookie:'TP_SESSION=forged', 'X-Role':'LEAD'}});assert.equal(forged.status,401);
});
test('网页探测使用数据库执行器配置，显式错误路径不能悄悄回退到其他工具',async()=>{
  const response=await fetch(base+'capabilities',{headers:{Cookie:cookie}});assert.equal(response.status,200);const value=(await response.json()).data;
  assert.equal(value.java,false);assert.equal(value.jmeter,false);assert.equal(value.browsers.chromium,false);
});
test('AI 编排只转发到已鉴权后端，无密钥失败且不会使用本地规则生成',async()=>{
  const options={method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({text:'点击 #submit',variables:{token:'must-not-send-to-ai'}})};
  const denied=await fetch(base+'ui/compose',options);assert.equal(denied.status,409);assert.match((await denied.json()).message,/密钥/);
  aiEnabled=true;const generated=await fetch(base+'ui/compose',options);assert.equal(generated.status,200);assert.equal((await generated.json()).data.engine,'remote-test');assert.deepEqual(lastPrompt,{text:'点击 #submit'});
});
test('并发执行上下文独立，异步任务不会使用另一项任务的执行器配置',async()=>{
  const observed=await Promise.all(['project-a','project-b'].map(name=>withRuntimeSettings({browserPath:name},async()=>{await new Promise(resolve=>setTimeout(resolve,5));return runtimeSettings().browserPath;})));
  assert.deepEqual(observed,['project-a','project-b']);assert.deepEqual(runtimeSettings(),{});
});
