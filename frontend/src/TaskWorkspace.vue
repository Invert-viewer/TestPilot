<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import type {TaskFlow} from './composables/useTaskFlow';
import type {TaskStatus} from './types/api';
import {formatMetric} from './composables/useTaskFlow';
import StatusTag from './components/StatusTag.vue';
import ErrorState from './components/ErrorState.vue';
import TaskLogPanel from './content/TaskLogPanel.vue';
import TaskResultsPanel from './content/TaskResultsPanel.vue';
import TaskReportPanel from './content/TaskReportPanel.vue';
const {flow}=defineProps<{flow:TaskFlow;state?:unknown}>();
const {tasks,tasksTotal,tasksPage,tasksLoading,tasksError,activeId,task,detailLoading,detailError,cancelling,cancelError}=flow;
const search=ref(''),filter=ref<TaskStatus|'ALL'>('ALL'),idInput=ref(''),tab=ref('overview');
const statusOptions=[['ALL','全部状态'],['QUEUED','排队中'],['RUNNING','运行中'],['CANCELLING','取消中'],['FINISHED','已完成'],['CANCELLED','已取消'],['ERROR','执行故障']];
const visible=computed(()=>tasks.value.filter(t=>(filter.value==='ALL'||t.status===filter.value)&&[t.id,t.name,t.tool,t.status,t.outcome].join(' ').toLowerCase().includes(search.value.trim().toLowerCase())));
const canCancel=computed(()=>task.value&&['QUEUED','RUNNING'].includes(task.value.status));
const facts=computed(()=>task.value?[
['场景',task.value.asset.name??task.value.asset.id],['资产版本',task.value.asset.version],['网站',task.value.siteId],['环境',task.value.environmentId],['工具',task.value.tool],['工具版本',task.value.toolVersion??'—'],['退出码',task.value.exitCode??'—'],['创建时间',date(task.value.createdAt)],['开始时间',date(task.value.startedAt)],['结束时间',date(task.value.finishedAt)],['复测来源',task.value.sourceTaskId??'—']]:[]);
function date(value:string|null){return value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';}
function openId(){if(idInput.value.trim()){void flow.open(idInput.value.trim());idInput.value='';}}
watch(filter,()=>flow.loadTasks(filter.value));watch(activeId,()=>tab.value='overview');void flow.loadTasks();
</script>
<template>
<section v-if="activeId" id="task-detail" class="surface task-detail">
<div class="panel-heading"><div><h2>{{task?.name||'任务详情'}}</h2><p class="muted task-id">{{activeId}}</p></div><div class="detail-actions"><button class="button outline" :disabled="detailLoading" @click="flow.refreshActive">刷新详情</button><button v-if="canCancel" class="button outline" :disabled="cancelling" @click="flow.cancel">{{cancelling?'取消中…':'取消任务'}}</button><button class="link" @click="flow.clearActive">关闭详情</button></div></div>
<p v-if="detailLoading" role="status">正在读取任务详情…</p><ErrorState :error="detailError"/><p v-if="detailError?.status===404" class="helper">任务不存在，请核对任务 ID 是否来自当前后端。</p><ErrorState :error="cancelError"/>
<div v-if="task?.errorCode" class="error-banner" role="alert"><strong>执行故障 · {{task.errorCode}}</strong><p>{{task.errorMessage}}</p></div>
<template v-if="task"><div class="task-status-line"><StatusTag :status="task.status" :outcome="task.outcome"/><span class="muted">{{task.terminal?'已到终态，状态轮询已停止':'状态自动更新中'}}</span><span v-if="task.status==='FINISHED'&&task.outcome==='FAILED'" class="muted">测试未通过；完整用例、断言与报告仍可查看。</span></div>
<div class="tab-strip" role="group" aria-label="任务详情区块"><button v-for="[key,label] in [['overview','概览'],['logs','执行日志'],['results','用例结果'],['report','报告']]" :key="key" :aria-pressed="tab===key" :class="{active:tab===key}" @click="tab=key">{{label}}<small v-if="key==='logs'">{{flow.logs.value.length}}</small><small v-if="key==='results'">{{flow.resultsTotal.value}}</small></button></div>
<template v-if="tab==='overview'"><div class="report-stats task-stats"><div v-for="[key,label] in [['totalCases','全部用例'],['passedCases','通过'],['failedCases','失败'],['skippedCases','跳过'],['notEvaluatedCases','未评估']] as const" :key="key"><strong>{{formatMetric(task.summary[key])}}</strong><span>{{label}}</span></div></div><dl class="task-facts"><template v-for="[label,value] in facts" :key="label"><dt>{{label}}</dt><dd>{{value}}</dd></template></dl><h3>有效执行参数</h3><pre class="parameter-code">{{JSON.stringify(task.parameters,null,2)}}</pre></template>
<TaskLogPanel v-else-if="tab==='logs'" :flow="flow"/><TaskResultsPanel v-else-if="tab==='results'" :flow="flow"/><TaskReportPanel v-else :flow="flow"/>
</template></section>
<section :class="['surface',{'section-space':activeId}]"><div class="panel-heading"><div><h2>测试记录</h2><p class="muted">真实任务 · 按任务 ID 定位详情、日志和报告</p></div><button class="button outline" :disabled="tasksLoading" @click="flow.loadTasks(filter,tasksPage)">{{tasksLoading?'刷新中…':'刷新列表'}}</button></div>
<div class="open-task-bar"><input v-model="idInput" class="search-input" placeholder="粘贴任务 ID" aria-label="粘贴任务 ID" @keyup.enter="openId"/><button class="button outline" :disabled="!idInput.trim()" @click="openId">打开任务</button><span class="muted">共 {{tasksTotal}} 个任务</span></div><ErrorState :error="tasksError"/>
<div class="toolbar"><input v-model="search" class="search-input" placeholder="搜索当前页任务名称或编号" aria-label="搜索任务"/><select v-model="filter" aria-label="任务状态"><option v-for="[value,label] in statusOptions" :key="value" :value="value">{{label}}</option></select></div>
<div class="table-scroll" tabindex="0" aria-label="任务列表"><table><thead><tr><th>任务</th><th>工具</th><th>状态</th><th class="numeric">通过 / 总数</th><th>创建时间</th><th>操作</th></tr></thead><tbody><tr v-for="item in visible" :key="item.id" :class="{selected:item.id===activeId}"><td><strong>{{item.name}}</strong><small>{{item.id}}</small></td><td>{{item.tool==='JMETER'?'JMeter':'Apifox CLI'}}</td><td><StatusTag :status="item.status" :outcome="item.outcome"/></td><td class="numeric">{{formatMetric(item.summary.passedCases)}} / {{formatMetric(item.summary.totalCases)}}</td><td>{{date(item.createdAt)}}</td><td><button class="link" @click="flow.open(item.id)">查看详情</button></td></tr><tr v-if="!visible.length"><td colspan="6" class="empty">{{tasksLoading?'正在读取任务列表…':tasksError?'任务列表读取失败，请重试':'没有匹配的任务'}}</td></tr></tbody></table></div>
<div class="toolbar"><span class="muted">第 {{tasksPage}} 页 · 每页 50 条</span><div class="inline-actions"><button class="button outline small" :disabled="tasksLoading||tasksPage<=1" @click="flow.loadTasks(filter,tasksPage-1)">上一页</button><button class="button outline small" :disabled="tasksLoading||tasksPage*50>=tasksTotal" @click="flow.loadTasks(filter,tasksPage+1)">下一页</button></div></div>
</section>
</template>
<style scoped>.open-task-bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.task-status-line{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.task-id{font-family:var(--font-mono);overflow-wrap:anywhere}.task-facts{grid-template-columns:110px 1fr}.selected>td{background:#6366f10d}.task-detail{scroll-margin-top:20px}</style>
