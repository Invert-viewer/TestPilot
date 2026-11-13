<script setup lang="ts">
import {uuid} from '../services/uuid';
import {ref,computed} from 'vue';
import type {TaskRecord,Tool} from '../types/api';
interface Experience {id:string;comparisonId:string;tool:Tool;taskId:string;prepMs:number|null;runMs:number|null;setupSteps:string[];assertionNotes:string;reportNotes:string;integrationNotes:string}
import {useWorkspace} from '../context';
const {commit,upsert}=useWorkspace();
const entries=defineModel<Experience[]>({required:true});
const props=defineProps<{comparisonId:string;tasks:TaskRecord[];taskIds:string[]}>();
const taskId=ref(''),prep=ref(''),run=ref(''),steps=ref(''),assertionNotes=ref(''),reportNotes=ref(''),integrationNotes=ref(''),error=ref('');
const options=computed(()=>props.tasks.filter(t=>props.taskIds.includes(t.id)));
const visible=computed(()=>entries.value.filter(e=>e.comparisonId===props.comparisonId));
function duration(input:string,field:string){if(input==='')return null;const n=Number(input);if(!Number.isFinite(n)||n<0)throw new Error(field+' 应为非负数或留空');return n;}
async function save(){try{const task=options.value.find(t=>t.id===taskId.value);if(!task)throw new Error('选择此实验关联的来源任务');await commit([upsert("comparisonExperiences",{id:uuid(),comparisonId:props.comparisonId,taskId:task.id,tool:task.tool,prepMs:duration(prep.value,'配置耗时'),runMs:duration(run.value,'执行用时'),setupSteps:steps.value.split('\n').filter(Boolean),assertionNotes:assertionNotes.value,reportNotes:reportNotes.value,integrationNotes:integrationNotes.value})]);error.value='';}catch(e){error.value=e instanceof Error?e.message:'记录无效';}}
</script>
<template><section class="section-space"><h3>按来源任务记录工具体验</h3><p class="helper">平台共享。工具从来源任务确定；耗时未知时留空。每条记录关联当前实验和任务。</p><div class="field-grid"><label class="full-field">来源任务<select v-model="taskId"><option value="">选择任务</option><option v-for="task in options" :key="task.id" :value="task.id">{{task.tool}} · {{task.name}} · {{task.id}}</option></select></label><label>配置耗时 / ms<input v-model="prep" type="number" min="0" placeholder="未知"/></label><label>执行用时 / ms<input v-model="run" type="number" min="0" placeholder="未知"/></label><label class="full-field">配置步骤（每行一步）<textarea v-model="steps" rows="3"></textarea></label><label>断言能力<textarea v-model="assertionNotes" rows="3"></textarea></label><label>报告体验<textarea v-model="reportNotes" rows="3"></textarea></label><label class="full-field">集成记录与证据<textarea v-model="integrationNotes" rows="2"></textarea></label></div><p v-if="error" class="field-error" role="alert">{{error}}</p><button class="button outline" :disabled="!taskId" @click="save">保存工具体验</button>
<div v-for="entry in visible" :key="entry.id" class="surface section-space"><strong>{{entry.tool}}</strong><RouterLink class="link" :to="{path:'/tasks',query:{taskId:entry.taskId}}"> · {{entry.taskId}}</RouterLink><dl><dt>配置耗时</dt><dd>{{entry.prepMs??'—'}}{{entry.prepMs===null?'':' ms'}}</dd><dt>执行用时</dt><dd>{{entry.runMs??'—'}}{{entry.runMs===null?'':' ms'}}</dd><dt>配置步骤</dt><dd>{{entry.setupSteps.join(' → ')||'—'}}</dd><dt>断言能力</dt><dd>{{entry.assertionNotes||'—'}}</dd><dt>报告体验</dt><dd>{{entry.reportNotes||'—'}}</dd><dt>集成记录</dt><dd>{{entry.integrationNotes||'—'}}</dd></dl></div><p v-if="!visible.length" class="empty">暂无按工具关联的体验记录</p></section></template>
