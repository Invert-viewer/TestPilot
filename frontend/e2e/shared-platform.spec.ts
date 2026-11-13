import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';

test('independent group sessions share sites and reject stale writes',async({browser,baseURL,request})=>{
  const a=await browser.newContext({baseURL}),b=await browser.newContext({baseURL});
  try {
    const first=await a.newPage(),second=await b.newPage(),name='联调网站-'+Date.now();
    await first.goto('/#/sites');
    await first.getByRole('button',{name:'＋ 添加网站'}).click();
    const d=first.getByRole('dialog');await d.getByLabel('网站名称').fill(name);
    await d.getByLabel('网站地址').fill('http://127.0.0.1:4000');await d.getByRole('button',{name:'保存配置'}).click();
    await expect(d).toHaveCount(0);await second.goto('/#/sites');
    const card=second.locator('.site-card').filter({hasText:name});await card.getByText('编辑网站').click();
    const stale=(await (await request.get('/api/v1/workspace')).json()).data.sites.find((s:{name:string})=>s.name===name);
    const db=second.getByRole('dialog');await db.getByLabel('网站名称').fill(name+'-B');await db.getByText('保存配置').click();
    await expect(db).toHaveCount(0);await first.reload();await expect(first.locator('.site-card').filter({hasText:name+'-B'})).toHaveCount(1);
    const conflict=await request.post('/api/v1/workspace',{data:[{collection:'sites',id:stale.id,revision:stale.revision,value:stale}]});
    expect(conflict.status()).toBe(409);await card.getByText('删除网站').click();await second.getByText('确认删除',{exact:true}).click();
    await expect(card).toHaveCount(0);await first.reload();await expect(first.locator('.site-card').filter({hasText:name})).toHaveCount(0);
    const snapshot=(await (await request.get('/api/v1/workspace')).json()).data;
    expect(snapshot.environments.some((env:{siteId:string})=>env.siteId===stale.id)).toBeFalsy();
  }finally{await a.close();await b.close();}
});

test('actual request reaches loopback receiver with only target credentials',async({page})=>{
  let received:unknown;
  const server=createServer(async(req,res)=>{
    if(req.url?.split('?')[0]==='/slow')return;
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    received={method:req.method,url:req.url,header:req.headers['x-probe'],cookie:req.headers.cookie,platform:req.headers.authorization,body:Buffer.concat(chunks).toString()};
    res.writeHead(201,{'Content-Type':'application/json'});res.end('{"received":true}');
  });
  await new Promise<void>((resolve,reject)=>server.once('error',reject).listen(18441,'127.0.0.1',resolve));
  try {
    await page.goto('/#/debug');await page.getByText('整段 JSON 录入',{exact:true}).click();
    const editor=page.getByLabel('请求 JSON',{exact:true}),draft=JSON.parse(await editor.inputValue());
    const row=(key:string,value:string)=>({key,value,enabled:true});
    Object.assign(draft,{url:'http://127.0.0.1:18441/probe',method:'POST',siteId:'',environmentId:'',query:[row('repeat','1'),row('repeat','2')],headers:[row('X-Probe','group')],cookies:[row('probe','local')],body:{mode:'JSON',text:'{"test":1}'},assertions:[{id:'status',type:'STATUS_CODE',operator:'EQ',expected:'201',enabled:true,target:null}]});
    await editor.fill(JSON.stringify(draft));
    await page.route('**/api/v1/http-debug/executions',r=>r.continue({headers:{...r.request().headers(),Authorization:'platform-probe'}}));
    const send=page.getByText('发送真实请求',{exact:true});await send.click();await expect(page.getByText('HTTP 201',{exact:true})).toBeVisible();
    expect(received).toEqual({method:'POST',url:'/probe?repeat=1&repeat=2',header:'group',cookie:'probe=local',platform:undefined,body:'{"test":1}'});
    await page.getByRole('button',{name:'断言结果',exact:true}).click();await expect(page.locator('tbody').getByText('PASSED',{exact:true})).toBeVisible();
    draft.timeoutMs=200;draft.url='http://127.0.0.1:18441/slow';await editor.fill(JSON.stringify(draft));await send.click();await expect(page.getByText(/REQUEST_TIMEOUT ·/)).toBeVisible();
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    await send.click();await expect(page.getByText(/CONNECTION_ERROR ·/)).toBeVisible();
  }finally{server.closeAllConnections();server.close();}
});
