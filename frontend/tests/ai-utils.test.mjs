import {test} from 'node:test';
import assert from 'node:assert/strict';
import {csvForRows,aiSettingsRoute} from '../src/ai-utils.mjs';
test('测试数据 CSV 保留中文、逗号、换行，并阻止公式执行',()=>{
  const csv=csvForRows(['姓名','备注'],[{姓名:'测试用户',备注:'=SUM(1,2)'},{姓名:'含"引号',备注:'多行\n内容'}]);
  assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=SUM(1,2)"'));assert.ok(csv.includes('"含""引号"'));assert.ok(csv.includes('"多行\n内容"'));
});
test('缺少密钥跳转目标直接定位 AI 引擎页签',()=>assert.equal(aiSettingsRoute(),'#/settings?tab=ai'));
