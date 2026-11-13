import {test,expect} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const evidence=path.resolve('../.acceptance/frontend-browser-evidence');
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});
test('real scene submission, duplicate click, results, report, refresh and legacy deep link',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let creates=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/v1/tasks'))creates++;});
  await page.goto('/#/tasks');await page.getByRole('button',{name:'新建任务',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('测试资产',{exact:true})).toHaveValue('asset-apifox-8863397');
  await dialog.getByLabel('任务名称',{exact:true}).fill('前端改造验收-登记场景-低频只读');
  await dialog.getByLabel('循环次数 iterations',{exact:false}).fill('1');await dialog.getByLabel('请求间隔 delayRequestMs / ms',{exact:false}).fill('100');await dialog.getByLabel('请求超时 timeoutRequestMs / ms',{exact:false}).fill('5000');
  const submit=dialog.getByRole('button',{name:'提交真实任务'});await submit.evaluate(el=>{el.dispatchEvent(new MouseEvent('click',{bubbles:true}));el.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
  await expect(dialog).toHaveCount(0);await expect(page.locator('#task-detail')).toBeVisible();
  const id=new URLSearchParams(page.url().split('?').pop()).get('taskId')!;expect(id).toMatch(/^task-/);expect(creates).toBe(1);
  const pending=await request.get('http://127.0.0.1:8080/api/v1/tasks/'+id+'/report');
  if(pending.status()===409)expect((await pending.json()).code).toBe('REPORT_NOT_READY');
  else expect(pending.status()).toBe(200);
  await expect.poll(async()=>{const r=await request.get('http://127.0.0.1:8080/api/v1/tasks/'+id);return (await r.json()).data.terminal;},{timeout:50000,intervals:[1500]}).toBe(true);
  await page.getByRole('button',{name:'刷新详情',exact:true}).click();
  const detail=(await (await request.get('http://127.0.0.1:8080/api/v1/tasks/'+id)).json()).data;
  expect(detail.status).toBe('FINISHED');const stats=page.locator('.task-stats');await expect(stats).toContainText(String(detail.summary.totalCases));await expect(stats).toContainText(String(detail.summary.passedCases));await expect(stats).toContainText(String(detail.summary.failedCases));
  await page.locator('#task-detail').getByRole('button',{name:/执行日志/}).click();await expect(page.getByText('日志已封存',{exact:false})).toBeVisible();
  const logData=(await (await request.get('http://127.0.0.1:8080/api/v1/tasks/'+id+'/logs?limit=1000')).json()).data;
  await expect(page.locator('.log-line')).toHaveCount(logData.items.length);await page.screenshot({path:path.join(evidence,'desktop-task-logs.png'),fullPage:true});
  await page.locator('#task-detail').getByRole('button',{name:/用例结果/}).click();const resultData=(await (await request.get('http://127.0.0.1:8080/api/v1/tasks/'+id+'/results?pageSize=100')).json()).data;expect(resultData.total).toBe(detail.summary.totalCases);
  await page.getByLabel('结果筛选').selectOption('FAILED');await page.locator('#task-detail').getByRole('button',{name:'查看',exact:true}).first().click();await expect(page.locator('.assertion-table')).toBeVisible();await expect(page.locator('.assertion-table')).toContainText('预期');await expect(page.locator('.assertion-table')).toContainText('实际');
  await page.locator('#task-detail').getByRole('button',{name:'报告',exact:true}).click();await expect(page.frameLocator('iframe[title="任务报告预览"]').getByRole('heading',{name:'TestPilot 测试报告',exact:true})).toBeVisible();const download=page.waitForEvent('download');await page.locator('.file-line').filter({hasText:'run.json'}).getByRole('button',{name:'下载',exact:true}).click();const file=await download;await file.saveAs(path.join(evidence,id+'-run.json'));
  await page.screenshot({path:path.join(evidence,'desktop-task-report.png'),fullPage:true});await page.reload();await expect(page.locator('#task-detail')).toContainText(id);await expect(page.locator('.task-stats')).toContainText(String(detail.summary.totalCases));
  await page.goto('/?taskId='+id);await expect(page.locator('#task-detail')).toContainText(id);
  const report=(await (await request.get('http://127.0.0.1:8080/api/v1/tasks/'+id+'/report')).json()).data;
  await writeFile(path.join(evidence,'real-task-summary.json'),JSON.stringify({taskId:id,status:detail.status,outcome:detail.outcome,summary:detail.summary,reportSummary:report.summary,resultCount:resultData.total,logCount:logData.items.length,duplicateCreates:creates,initialReportHttpStatus:pending.status(),errors},null,2));expect(report.summary).toEqual(detail.summary);expect(errors).toEqual([]);
});
test('request rows, JSON edits, invalid JSON retention, and Header/Cookie bulk input',async({page})=>{
  await page.goto('/#/debug');await page.getByRole('button',{name:'＋ 添加查询参数'}).click();await page.getByLabel('查询参数名称1',{exact:true}).fill('page');await page.getByLabel('查询参数值1',{exact:true}).fill('1');
  await page.getByRole('button',{name:'整段 JSON 录入',exact:true}).click();const editor=page.getByLabel('请求 JSON',{exact:true});const input=JSON.parse(await editor.inputValue());input.query[0].value='2';await editor.fill(JSON.stringify(input,null,2));await page.getByRole('button',{name:'逐字段填写',exact:true}).click();await expect(page.getByLabel('查询参数值1',{exact:true})).toHaveValue('2');
  await page.getByRole('button',{name:'整段 JSON 录入',exact:true}).click();await editor.fill('{ invalid JSON');await page.getByRole('button',{name:'逐字段填写',exact:true}).click();await expect(editor).toHaveCount(0);await expect(page.locator('.dual-editor [role="alert"]')).toBeVisible();await page.getByRole('button',{name:'整段 JSON 录入',exact:true}).click();await expect(editor).toHaveValue('{ invalid JSON');await editor.fill(JSON.stringify(input));await page.getByRole('button',{name:'逐字段填写',exact:true}).click();
  await page.getByRole('tab',{name:/^Headers/}).click();await page.getByRole('button',{name:'批量录入',exact:true}).click();await page.getByLabel('请求头批量内容',{exact:true}).fill('Accept:application/json\nX-Trace:test');await page.getByRole('button',{name:'应用批量内容',exact:true}).click();await expect(page.getByLabel('请求头值2',{exact:true})).toHaveValue('test');
  await page.getByRole('tab',{name:/^Cookies/}).click();await page.getByRole('button',{name:'批量录入',exact:true}).click();await page.getByLabel('Cookie批量内容',{exact:true}).fill('theme=light\nlayout=compact');await page.getByRole('button',{name:'应用批量内容',exact:true}).click();await expect(page.getByLabel('Cookie值2',{exact:true})).toHaveValue('compact');await page.screenshot({path:path.join(evidence,'request-editor.png'),fullPage:true});
});
test('404, report-not-ready, unavailable backend and switching tasks use distinct feedback',async({page,request})=>{
  await page.goto('/#/tasks?taskId=task-does-not-exist');await expect(page.locator('#task-detail')).toContainText('NOT_FOUND');await expect(page.locator('#task-detail')).toContainText('任务不存在');
  const list=(await (await request.get('http://127.0.0.1:8080/api/v1/tasks')).json()).data.items;const id=list.find((t:{status:string})=>t.status==='FINISHED').id;
  await page.route('**/api/v1/tasks/'+id+'/report',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'REPORT_NOT_READY',message:'报告尚未生成',data:null,traceId:'test-not-ready'})}));
  await page.goto('/#/tasks?taskId='+id);await expect(page.locator('#task-detail')).toContainText(id);await page.locator('#task-detail').getByRole('button',{name:'报告',exact:true}).click();await expect(page.locator('#task-detail')).toContainText('报告尚未生成（409）');
  await page.route('**/api/v1/tasks?*',r=>r.abort('connectionrefused'));await page.getByRole('button',{name:'刷新列表',exact:true}).click();await expect(page.getByText('NETWORK_ERROR',{exact:true})).toBeVisible();await expect(page.locator('#task-detail')).toContainText(id);
});
test('eight entries, narrow layout, keyboard focus and reduced motion',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  for(const [route,title] of [['overview','概览'],['sites','网站与环境'],['assets','测试资产'],['debug','请求调试'],['tasks','任务与报告'],['compare','实验对比'],['regression','断言回归'],['checks','检查验收']]){await page.goto('/#/'+route);await expect(page.locator('h1')).toHaveText(title);}
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#/overview');await page.getByRole('button',{name:'切换导航'}).click();await expect(page.locator('.sidebar')).toHaveClass(/open/);await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'请求调试'}).click();await expect(page.locator('h1')).toHaveText('请求调试');await expect(page.locator('.sidebar')).not.toHaveClass(/open/);
  const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);await page.screenshot({path:path.join(evidence,'mobile-request.png'),fullPage:true});
  await page.getByRole('button',{name:'切换导航'}).focus();await page.keyboard.press('Enter');await expect(page.locator('.sidebar')).toHaveClass(/open/);await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'切换导航'})).toBeFocused();expect(errors).toEqual([]);
  await page.goto('/#/overview');await expect(page.locator('.chart canvas')).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:path.join(evidence,'mobile-overview.png'),fullPage:true});
  const list=(await (await request.get('http://127.0.0.1:8080/api/v1/tasks')).json()).data.items;const id=list.find((t:{status:string})=>t.status==='FINISHED').id;
  await page.goto('/#/tasks?taskId='+id);await page.locator('#task-detail').getByRole('button',{name:/执行日志/}).click();await expect(page.getByText('日志已封存',{exact:false})).toBeVisible();await expect(page.locator('.log-panel')).toHaveCSS('overflow','auto');await page.screenshot({path:path.join(evidence,'mobile-task-logs.png'),fullPage:true});
  await page.locator('#task-detail').getByRole('button',{name:/用例结果/}).click();await expect(page.locator('#task-detail .table-scroll')).toBeVisible();expect(await page.locator('#task-detail .table-scroll').evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);
  await page.locator('#task-detail').getByRole('button',{name:'报告',exact:true}).click();await expect(page.frameLocator('.report-frame').getByRole('heading',{name:'TestPilot 测试报告',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:path.join(evidence,'mobile-task-report.png'),fullPage:true});expect(errors).toEqual([]);
});
test('comparison keeps missing samples explicit and saves a shared plan',async({page})=>{
  const name='跨网站缺样本验收-'+Date.now();
  await page.goto('/#/compare');await page.getByRole('button',{name:'＋ 新增配置',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('实验名称',{exact:true}).fill(name);await dialog.getByLabel('比较方式').selectOption('CROSS_SITE');await dialog.getByRole('button',{name:'保存配置',exact:true}).click();await expect(dialog).toHaveCount(0);
  const select=page.getByLabel('实验方案',{exact:true});await select.selectOption({label:name});await expect(page.locator('.missing-list')).toContainText('跨站对比需要至少两个同类网站');await expect(page.locator('.missing-list')).toContainText('尚未关联真实来源任务');await expect(page.locator('canvas')).toHaveCount(0);await page.reload();await expect(page.getByRole('cell').filter({hasText:name})).toBeVisible();
});



