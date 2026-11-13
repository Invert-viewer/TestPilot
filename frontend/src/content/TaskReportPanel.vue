<script setup lang="ts">
import {ref,computed,watch,onBeforeUnmount} from 'vue';
import {fetchReportPreview,fetchReportFile,isCancelled,toApiError,type ApiError} from '../api/index';
import type {TaskFlow} from '../composables/useTaskFlow';
import {formatMetric,formatBytes} from '../composables/useTaskFlow';
import type {ReportFile} from '../types/api';
import ErrorState from '../components/ErrorState.vue';
const {flow}=defineProps<{flow:TaskFlow}>();
const html=ref(''),previewLoading=ref(false),previewError=ref<ApiError|null>(null),fileError=ref<ApiError|null>(null),fileLoading=ref(''),fileText=ref<string|null>(null),fileName=ref('');
let controller=new AbortController(),generation=0,previewSequence=0;
const cards=computed(()=>{const m=flow.report.value?.metrics;return [
  ['HTTP 样本',m?.sampleCount,'次'],['计时样本',m?.timedSampleCount,'次'],['平均响应',m?.avgResponseMs,'ms'],['P95 响应',m?.p95ResponseMs,'ms'],['吞吐量',m?.throughputRps,'请求/秒'],['请求错误率 · 后端口径',m?.errorRate,'%'],['整体通过率',m?.passRate,'%'],['已评估通过率',m?.evaluatedPassRate,'%'],['断言通过率',m?.assertionPassRate,'%'],['通过断言',m?.passedAssertions,'条'],['失败断言',m?.failedAssertions,'条'],['跳过断言',m?.skippedAssertions,'条']
].map(([label,value,unit])=>({label,value:typeof value==='number'?formatMetric(unit==='%'?value*100:value)+(unit==='%'?'%':''):'—',unit:typeof value==='number'&&unit!=='%'?unit:''}));});
async function preview(){const id=flow.activeId.value;if(!id)return;const g=generation,sequence=++previewSequence;previewLoading.value=true;previewError.value=null;try{const blob=await fetchReportPreview(id,controller.signal);const text=await blob.text();if(g===generation&&sequence===previewSequence)html.value=text;}catch(e){if(g===generation&&sequence===previewSequence&&!isCancelled(e))previewError.value=toApiError(e);}finally{if(g===generation&&sequence===previewSequence)previewLoading.value=false;}}
async function file(file:ReportFile,view=false){const id=flow.activeId.value;if(!id||fileLoading.value)return;const g=generation;fileLoading.value=file.name;fileError.value=null;try{const blob=await fetchReportFile(id,file.name,controller.signal);if(g!==generation)return;
  if(view){fileText.value=await blob.text();fileName.value=file.name;}else{const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}catch(e){if(g===generation&&!isCancelled(e))fileError.value=toApiError(e);}finally{if(g===generation)fileLoading.value='';}}
watch(()=>flow.activeId.value,()=>{generation++;controller.abort();controller=new AbortController();html.value='';fileText.value=null;fileLoading.value='';});
watch(()=>flow.report.value,report=>{if(report)void preview();},{immediate:true});
onBeforeUnmount(()=>{generation++;controller.abort();});
</script>
<template>
<div class="toolbar"><span class="muted">来源：后端脱敏报告</span><button class="button outline" :disabled="flow.reportLoading.value" @click="flow.loadReport">{{flow.reportLoading.value?'读取中…':'刷新报告'}}</button></div>
<p v-if="flow.reportError.value?.code==='REPORT_NOT_READY'" class="source-note" role="status">报告尚未生成（409）。任务运行结束后会读取报告；也可以手动刷新。</p><ErrorState v-else :error="flow.reportError.value"/>
<template v-if="flow.report.value"><div class="metric-grid"><div v-for="card in cards" :key="String(card.label)" class="metric-card"><span>{{card.label}}</span><strong>{{card.value}}</strong><small>{{card.unit}}</small></div></div>
<p class="helper">未知值显示“—”。当前后端的请求错误率按失败用例统计，暂不能排除纯断言失败；用于实验结论前需核对原始请求分类。</p>
<h3 class="section-space">报告文件</h3><ErrorState :error="fileError"/><div class="file-list"><div v-for="f in flow.report.value.files" :key="f.name" class="file-line"><div><strong>{{f.name}}</strong><small>{{formatBytes(f.size)}} · 后端脱敏产物</small></div><div class="file-actions"><button class="link" :disabled="!!fileLoading" @click="file(f,true)">查看</button><button class="link" :disabled="!!fileLoading" @click="file(f)">{{fileLoading===f.name?'读取中…':'下载'}}</button></div></div><p v-if="!flow.report.value.files.length" class="empty">没有报告文件</p></div>
<div class="panel-heading section-space"><h3>报告预览</h3><button class="link" :disabled="previewLoading" @click="preview">刷新预览</button></div><ErrorState :error="previewError"/><p v-if="previewLoading" role="status">正在读取报告预览…</p><iframe v-if="html" :srcdoc="html" class="report-frame" sandbox="" referrerpolicy="no-referrer" title="任务报告预览"></iframe>
</template><p v-else-if="!flow.reportError.value" class="empty">{{flow.reportLoading.value?'正在读取报告…':'暂无报告。可刷新报告检查生成状态。'}}</p>
<el-dialog :model-value="fileText!==null" :title="fileName" width="1000px" @close="fileText=null"><pre class="parameter-code report-file-text">{{fileText}}</pre></el-dialog>
</template>
<style scoped>.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}.metric-card{border:1px solid var(--color-line);background:var(--color-mist);border-radius:8px;padding:16px}.metric-card span{display:block;color:var(--color-muted);font-size:11px}.metric-card strong{font-size:22px;display:inline-block;margin-top:8px}.metric-card small{margin-left:4px;color:var(--color-muted)}.file-list{display:grid;gap:8px}.file-line{display:flex;justify-content:space-between;align-items:center;padding:12px;border:1px solid var(--color-border);border-radius:8px}.file-line small{display:block;color:var(--color-muted)}.report-frame{width:100%;height:460px;border:1px solid var(--color-border);background:#fff;border-radius:8px}.report-file-text{max-height:65vh}</style>
