<script setup>
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';
import {useWorkspace} from '../context';
import {resources} from '../resources';
import ResourcePanel from '../ResourcePanel.vue';
import ToolExperiencePanel from '../content/ToolExperiencePanel.vue';
import ErrorState from '../components/ErrorState.vue';
import {fetchTasks,fetchTask,fetchTaskReport,fetchToolAssets,isCancelled} from '../api';
import {formatMetric} from '../taskFlow';
const {state}=useWorkspace(),tasks=ref([]),assets=ref([]),error=ref(null),loading=ref(false),active=ref(''),rows=ref([]),issues=ref([]),controller=new AbortController();
state.value.comparisonExperiences ??= [];
const resourceState=computed(()=>({...state.value,tasks:tasks.value}));
const plan=computed(()=>state.value.comparisons.find(p=>p.id===active.value));
let generation=0;
async function load(){loading.value=true;error.value=null;try{let page=1,collected=[];for(;;){const data=await fetchTasks({page},controller.signal);collected.push(...data.items);if(collected.length>=data.total||!data.items.length)break;page++;}tasks.value=collected;assets.value=await fetchToolAssets('APIFOX_CLI',controller.signal);}catch(e){if(!isCancelled(e))error.value=e;}finally{loading.value=false;}}
async function inspect(){const g=++generation;rows.value=[];issues.value=[];const p=plan.value;if(!p)return;
  if(p.mode==='CROSS_SITE'&&(p.siteIds?.length??0)<2)issues.value.push('跨站对比需要至少两个同类网站及各自的真实任务。');
  if(!(p.taskIds?.length))issues.value.push('尚未关联真实来源任务；浏览器演示任务不能生成实验结论。');
  const next=[];
  for(const id of p.taskIds||[]){try{const task=await fetchTask(id,controller.signal);if(g!==generation)return;if(task.status!=='FINISHED'){issues.value.push(id+' 尚未完成');continue;}const report=await fetchTaskReport(id,controller.signal);if(g!==generation)return;
    const asset=assets.value.find(a=>a.id===task.asset.id);const tier=p.groups?.find(x=>x.iterations===task.parameters.iterations&&x.delayRequestMs===task.parameters.delayRequestMs);
    if(!tier)issues.value.push(id+' 未匹配参数档位');if(asset?.scenarioKey!==p.scenarioKey)issues.value.push(id+' 场景标识不匹配或无法核实');
    next.push({task,report,label:tier?.label??'未匹配',scenarioKey:asset?.scenarioKey??'未知'});
  }catch(e){if(g!==generation||isCancelled(e))return;issues.value.push(id+'：'+e.message);}}
  if(g!==generation)return;rows.value=next;
  if(p.mode==='CROSS_TOOL'&&new Set(next.map(r=>r.task.tool)).size<2)issues.value.push('缺少 JMeter 同网站、同环境、同场景的真实报告。');
  if(p.mode==='CROSS_SITE'&&new Set(next.map(r=>r.task.siteId)).size<2)issues.value.push('来源任务不足两个不同网站。');
  if(p.mode==='CROSS_TOOL'&&new Set(next.map(r=>r.task.siteId+'|'+r.task.environmentId)).size>1)issues.value.push('来源任务的网站或环境不一致。');
  if(p.mode==='CROSS_SITE'&&new Set(next.map(r=>r.task.tool)).size>1)issues.value.push('跨网站实验必须固定同一种工具。');
  for(const tier of p.groups||[]){const matches=next.filter(r=>r.label===tier.label);const counts=new Map();for(const r of matches){const key=p.mode==='CROSS_SITE'?r.task.siteId:r.task.tool;counts.set(key,(counts.get(key)||0)+1);}if(counts.size<2||[...counts.values()].some(n=>n<tier.repeats))issues.value.push(tier.label+' 缺少各组规定的重复样本。');}
}
onMounted(load);onBeforeUnmount(()=>{generation++;controller.abort();});
</script>
<template>
<div class="source-note">实验方案与工具体验：数据库共享。来源任务与指标：Spring Boot。缺少完整可比样本时不生成结论。</div>
<ErrorState :error="error"/>
<ResourcePanel :state="resourceState" v-bind="resources.comparisons"/>
<section class="surface"><div class="panel-heading"><div><h2>核对实验来源</h2><p class="muted">同工具跨网站参数变化 / 同网站跨工具体验与结果</p></div><button class="button outline" :disabled="loading" @click="load">刷新真实任务</button></div>
<div class="toolbar"><label>实验方案<select aria-label="实验方案" v-model="active" @change="inspect"><option value="">选择方案</option><option v-for="p in state.comparisons" :key="p.id" :value="p.id">{{p.name}}</option></select></label><button class="button outline" :disabled="!plan" @click="inspect">核对来源任务</button></div>
<template v-if="plan"><dl><dt>比较方式</dt><dd>{{plan.mode==='CROSS_SITE'?'同工具 · 两个同类网站':'同网站 · Apifox CLI 与 JMeter'}}</dd><dt>场景标识</dt><dd>{{plan.scenarioKey}}</dd><dt>参数档位</dt><dd>{{plan.groups?.map(g=>`${g.label}：${g.iterations} 轮 / ${g.delayRequestMs} ms / 重复 ${g.repeats} 次`).join('；')}}</dd></dl>
<ul v-if="issues.length" class="missing-list" aria-live="polite"><li v-for="issue in issues" :key="issue">{{issue}}</li></ul>
<p v-else-if="rows.length" class="helper">来源已核对。以下保留每次任务的独立指标；配置与采样条件仍需结合原始报告审阅。</p>
<div class="table-scroll" tabindex="0"><table><thead><tr><th>档位 / 场景</th><th>网站 / 环境</th><th>工具</th><th class="numeric">平均 / P95 ms</th><th>结果</th><th>来源任务</th></tr></thead><tbody><tr v-for="r in rows" :key="r.task.id"><td>{{r.label}}<small>{{r.scenarioKey}}</small></td><td>{{r.task.siteId}}<small>{{r.task.environmentId}}</small></td><td>{{r.task.tool}}</td><td class="numeric">{{formatMetric(r.report.metrics.avgResponseMs)}} / {{formatMetric(r.report.metrics.p95ResponseMs)}}</td><td>{{r.task.outcome}}</td><td><RouterLink class="link" :to="{path:'/tasks',query:{taskId:r.task.id}}">{{r.task.id}}</RouterLink></td></tr><tr v-if="!rows.length"><td colspan="6" class="empty">尚无可用真实样本</td></tr></tbody></table></div>
<h3 class="section-space">工具体验记录</h3><dl><dt>配置步骤</dt><dd>{{plan.setupSteps?.join(' → ')||'待记录'}}</dd><dt>配置耗时</dt><dd>{{plan.prepMs==null?'—':plan.prepMs+' ms'}}</dd><dt>执行用时</dt><dd>{{plan.runMs==null?'—':plan.runMs+' ms'}}</dd><dt>断言能力</dt><dd>{{plan.assertionNotes||'待记录'}}</dd><dt>报告体验</dt><dd>{{plan.reportNotes||'待记录'}}</dd><dt>集成记录</dt><dd>{{plan.integrationNotes||'待记录'}}</dd></dl>
<ToolExperiencePanel :key="plan.id" v-model="state.comparisonExperiences" :comparison-id="plan.id" :tasks="tasks" :task-ids="plan.taskIds||[]"/>
</template><p v-else class="empty">先新增实验方案，选择网站、场景、参数档位和来源任务。</p></section>
</template>

