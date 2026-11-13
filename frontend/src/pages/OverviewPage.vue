<script setup lang="ts">
import {ref,computed,onMounted,onBeforeUnmount} from 'vue';
import {useRouter} from 'vue-router';
import {fetchTasks,isCancelled,ApiError,toApiError} from '../api/index';
import type {TaskRecord} from '../types/api';
import StatusTag from '../components/StatusTag.vue';
import ErrorState from '../components/ErrorState.vue';
import MetricChart from '../components/MetricChart.vue';
const router=useRouter(),tasks=ref<TaskRecord[]>([]),total=ref<number|null>(null),loading=ref(false),error=ref<ApiError|null>(null);
let controller=new AbortController();
const latest=computed(()=>tasks.value.find(t=>t.status==='FINISHED'));
const recent=computed(()=>tasks.value.filter(t=>t.summary.totalCases!==null).slice(0,8).reverse());
const cards=computed(()=>[
  {label:'任务总数',value:total.value??'—'},
  {label:'当前页执行中',value:total.value===null?'—':tasks.value.filter(t=>!t.terminal).length},
  {label:'最近完成 · 通过用例',value:latest.value?.summary.passedCases??'—'},
  {label:'最近完成 · 失败用例',value:latest.value?.summary.failedCases??'—'},
]);
async function load(){controller.abort();controller=new AbortController();loading.value=true;error.value=null;try{const data=await fetchTasks({},controller.signal);tasks.value=data.items;total.value=data.total;}catch(e){if(!isCancelled(e))error.value=toApiError(e);}finally{loading.value=false;}}
onMounted(load);onBeforeUnmount(()=>controller.abort());
</script>
<template>
<div class="page-actions"><span class="muted">来源：Spring Boot 实际任务 · 当前页最多 50 条</span><button class="button outline" :disabled="loading" @click="load">{{loading?'刷新中…':'刷新概览'}}</button></div>
<ErrorState :error="error"/>
<div class="kpi-grid"><article v-for="card in cards" :key="card.label" class="kpi-card"><span>{{card.label}}</span><strong>{{card.value}}</strong></article></div>
<div class="dashboard-grid section-space"><section class="surface chart-panel"><div class="panel-heading"><div><h2>近期用例结果</h2><p class="muted">按创建顺序 · 最近 8 次有统计的任务</p></div><span class="source-chip">真实记录</span></div>
<MetricChart v-if="recent.length" kind="bar" unit="用例" :labels="recent.map(t=>t.id.slice(-6))" :series="[{name:'通过',values:recent.map(t=>t.summary.passedCases)},{name:'失败',values:recent.map(t=>t.summary.failedCases)}]" description="近期任务通过与失败用例数；具体数值见下方任务表"/>
<div v-else class="chart empty">{{loading?'正在读取任务…':error?'任务统计暂不可用':'暂无可统计的真实任务'}}</div></section>
<section class="surface"><h2>执行与数据来源</h2><div class="activity-item"><span class="status green">已接入</span><div><strong>Apifox CLI</strong><p class="muted">登记场景 → 创建任务 → 日志与报告</p></div></div><div class="activity-item"><span class="status neutral">共享</span><div><strong>请求与共享配置</strong><p class="muted">网站、环境、请求资产与验收记录由 Spring Boot 写入数据库。</p></div></div><div class="activity-item"><span class="status neutral">待补齐</span><div><strong>对照实验</strong><p class="muted">JMeter 执行、跨站数据及可比真实样本。</p></div></div><button class="link" @click="router.push('/compare')">查看实验方案 →</button></section></div>
<section class="surface section-space"><div class="panel-heading"><h2>最近任务</h2><RouterLink class="link" to="/tasks">全部任务 →</RouterLink></div><div class="table-scroll" tabindex="0" aria-label="最近任务表"><table><thead><tr><th>任务</th><th>状态</th><th class="numeric">通过</th><th class="numeric">失败</th><th class="numeric">总用例</th><th>操作</th></tr></thead><tbody><tr v-for="task in tasks.slice(0,8)" :key="task.id"><td>{{task.name}}<small>{{task.id}}</small></td><td><StatusTag :status="task.status" :outcome="task.outcome"/></td><td class="numeric">{{task.summary.passedCases??'—'}}</td><td class="numeric">{{task.summary.failedCases??'—'}}</td><td class="numeric">{{task.summary.totalCases??'—'}}</td><td><RouterLink class="link" :to="{path:'/tasks',query:{taskId:task.id}}">查看详情</RouterLink></td></tr><tr v-if="!tasks.length"><td colspan="6" class="empty">{{loading?'读取中…':error?'任务列表加载失败，可重试':'还没有任务，从登记场景开始创建。'}}</td></tr></tbody></table></div></section>
</template>
