<script setup lang="ts">
import {ref,computed} from 'vue';
import type {TaskFlow} from '../composables/useTaskFlow';
import {formatMetric,caseStatusLabel,failureKindLabel} from '../composables/useTaskFlow';
import ErrorState from '../components/ErrorState.vue';
const {flow}=defineProps<{flow:TaskFlow}>();const filter=ref('ALL');
const visible=computed(()=>flow.results.value.filter(r=>filter.value==='ALL'||r.status===filter.value));
</script>
<template>
<div class="toolbar"><label>结果筛选 <select v-model="filter"><option value="ALL">全部 {{flow.resultsTotal.value}} 条</option><option value="FAILED">失败</option><option value="PASSED">通过</option><option value="SKIPPED">跳过</option><option value="NOT_EVALUATED">未评估</option></select></label><button class="button outline" :disabled="flow.resultsLoading.value" @click="flow.loadResults">{{flow.resultsLoading.value?'读取中…':'刷新用例'}}</button></div>
<ErrorState :error="flow.resultsError.value"/><ErrorState :error="flow.caseDetailError.value"/>
<div class="table-scroll" tabindex="0" aria-label="用例结果表"><table><thead><tr><th>用例</th><th>状态</th><th class="numeric">状态码</th><th class="numeric">耗时 / ms</th><th>失败类型</th><th>断言</th></tr></thead><tbody>
<template v-for="item in visible" :key="item.caseId"><tr><td><strong>{{item.name}}</strong><small>{{item.caseId}}</small><small v-if="item.failureMessage" class="failure-message">{{item.failureMessage}}</small></td><td><span :class="['status',item.status==='FAILED'?'amber':item.status==='PASSED'?'green':'neutral']">{{caseStatusLabel(item.status)}}</span></td><td class="numeric">{{item.statusCode??'—'}}</td><td class="numeric">{{formatMetric(item.durationMs)}}</td><td>{{failureKindLabel(item.failureKind)}}</td><td><button class="link" :aria-expanded="!!flow.caseDetails.value[item.caseId]" :disabled="!!flow.caseDetailLoading.value" @click="flow.toggleCase(item)">{{flow.caseDetailLoading.value===item.caseId?'读取中…':flow.caseDetails.value[item.caseId]?'收起':'查看'}}</button></td></tr>
<tr v-if="flow.caseDetails.value[item.caseId]" class="case-detail-row"><td colspan="6"><table class="assertion-table"><thead><tr><th>断言 / 目标</th><th>操作符</th><th>预期</th><th>实际</th><th>状态</th><th>说明</th></tr></thead><tbody><tr v-for="a in flow.caseDetails.value[item.caseId].assertions" :key="a.id"><td>{{a.id}}<small>{{a.target??'—'}}</small></td><td>{{a.operator}}</td><td>{{a.expected??'—'}}</td><td>{{a.actual??'—'}}</td><td>{{caseStatusLabel(a.status)}}</td><td>{{a.message??'—'}}</td></tr><tr v-if="!flow.caseDetails.value[item.caseId].assertions.length"><td colspan="6" class="empty">该用例没有断言明细</td></tr></tbody></table></td></tr></template>
<tr v-if="!visible.length"><td colspan="6" class="empty">{{flow.resultsLoading.value?'正在读取用例…':'暂无匹配的用例结果'}}</td></tr></tbody></table></div>
</template>
<style scoped>.failure-message{color:var(--color-negative-ink);white-space:pre-wrap}.case-detail-row>td{background:var(--color-mist);padding:16px}.assertion-table td{vertical-align:top;overflow-wrap:anywhere;max-width:360px}</style>
