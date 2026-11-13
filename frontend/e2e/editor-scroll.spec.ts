import {test,expect} from '@playwright/test';

test('unfinished site JSON returns to fields, while invalid JSON remains recoverable',async({page})=>{
  await page.goto('/#/sites');await page.getByRole('button',{name:'＋ 新增配置',exact:true}).first().click();const dialog=page.getByRole('dialog');
  const form=dialog.getByRole('button',{name:'逐字段填写',exact:true}),json=dialog.getByRole('button',{name:'整段 JSON 录入',exact:true});
  for(let i=0;i<2;i++){await json.click();await form.click();await expect(dialog.getByLabel('网站名称',{exact:true})).toHaveValue('');}
  await dialog.getByRole('button',{name:'保存配置',exact:true}).click();await expect(dialog).toBeVisible();await expect(dialog).toContainText('请填写网站名称');
  await json.click();const editor=dialog.getByLabel('网站配置 JSON',{exact:true});const draft=JSON.parse(await editor.inputValue());draft.name='未完成网址的草稿';draft.baseUrl='https://';await editor.fill(JSON.stringify(draft));await form.click();await expect(dialog.getByLabel('网站名称',{exact:true})).toHaveValue(draft.name);await expect(dialog.getByLabel('网站地址',{exact:true})).toHaveValue('https://');
  await json.click();await editor.fill('{ broken draft');await form.click();await expect(dialog.getByLabel('网站名称',{exact:true})).toHaveValue(draft.name);await expect(dialog).toContainText('JSON 草稿仍保留');await json.click();await expect(editor).toHaveValue('{ broken draft');
});

test('wheel over tables scrolls each page, and horizontal table scrolling is preserved',async({page})=>{
  await page.setViewportSize({width:1440,height:600});
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const route of ['sites','assets','tasks','compare','regression','checks']){
    await page.goto('/#/'+route);await expect(page.locator('.table-scroll').first()).toBeVisible();await page.evaluate(()=>window.scrollTo(0,0));
    const table=page.locator('.table-scroll').first(),box=await table.boundingBox();expect(box).not.toBeNull();await page.mouse.move(box!.x+Math.min(box!.width/2,150),box!.y+Math.min(box!.height/2,40));await page.mouse.wheel(0,500);
    await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0);
  }
  await page.setViewportSize({width:390,height:700});await page.goto('/#/sites');const table=page.locator('.table-scroll').first();await table.scrollIntoViewIfNeeded();const box=await table.boundingBox();await page.mouse.move(box!.x+100,box!.y+30);await page.mouse.wheel(400,0);await expect.poll(()=>table.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);
});

test('unfinished task JSON can return to fields without submitting a task',async({page})=>{
  await page.goto('/#/tasks');await page.getByRole('button',{name:'新建任务',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'整段 JSON 录入',exact:true}).click();
  const editor=dialog.getByLabel('任务配置 JSON',{exact:true});const draft=JSON.parse(await editor.inputValue());draft.name='';draft.parameters.iterations=0;await editor.fill(JSON.stringify(draft));await dialog.getByRole('button',{name:'逐字段填写',exact:true}).click();
  await expect(dialog.getByLabel('任务名称',{exact:true})).toHaveValue('');await expect(dialog.getByLabel('循环次数 iterations',{exact:false})).toHaveValue('0');
});

test('long dialogs scroll their content and leave header and save actions visible',async({page})=>{
  await page.setViewportSize({width:1024,height:600});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#/sites');await page.getByRole('button',{name:'＋ 新增配置',exact:true}).first().click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'整段 JSON 录入',exact:true}).click();
  const body=dialog.locator('.el-dialog__body');await expect.poll(()=>body.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
  const editor=dialog.getByLabel('网站配置 JSON',{exact:true});await editor.hover();await page.mouse.wheel(0,500);await expect.poll(()=>body.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
  await expect(dialog.getByRole('button',{name:'保存配置',exact:true})).toBeInViewport();await expect(dialog.locator('.el-dialog__header')).toBeInViewport();
  await dialog.locator('.el-dialog__headerbtn').click();await expect(dialog).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.body).overflow)).not.toBe('hidden');
  const before=await page.evaluate(()=>scrollY);await page.locator('.table-scroll').first().hover();await page.mouse.wheel(0,500);await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(before);
});
