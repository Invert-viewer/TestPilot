<script setup lang="ts">
import {ref,computed,watch,nextTick} from 'vue';
import type {TaskFlow} from '../composables/useTaskFlow';
import ErrorState from '../components/ErrorState.vue';
const {flow}=defineProps<{flow:TaskFlow}>();
const filter=ref('ALL'),autoScroll=ref(true),body=ref<HTMLDivElement|null>(null);
const lines=computed(()=>flow.logs.value.filter(l=>filter.value==='ALL'||l.stream===filter.value));
watch(()=>flow.logs.value.length,async()=>{if(autoScroll.value){await nextTick();if(body.value)body.value.scrollTop=body.value.scrollHeight;}});
function time(value:string){return new Date(value).toLocaleTimeString('zh-CN',{hour12:false});}
</script>
<template>
<div class="stream-filter"><button v-for="s in ['ALL','STDOUT','STDERR','PLATFORM']" :key="s" :aria-pressed="filter===s" :class="{active:filter===s}" @click="filter=s">{{s==='ALL'?'全部':s}}</button><label><input v-model="autoScroll" type="checkbox"/> 自动滚动</label></div>
<p class="helper" role="status">已读取 {{flow.logs.value.length}} 条 · 游标 {{flow.logCursor.value??'—'}} · {{flow.logsComplete.value?'日志已封存':'按游标增量读取'}}</p>
<div ref="body" class="log-panel" tabindex="0" aria-label="任务执行日志，支持横向和纵向滚动"><p v-for="(line,i) in lines" :key="i" class="log-line"><time class="log-time">{{time(line.time)}}</time><span :class="['log-stream',line.stream.toLowerCase()]">{{line.stream}}</span><span class="log-text">{{line.text}}</span></p><p v-if="!lines.length" class="empty">{{flow.logsLoading.value?'正在读取日志…':flow.logsComplete.value?'没有匹配的日志':'等待执行日志'}}</p></div>
<ErrorState :error="flow.logsError.value"/>
<button class="button outline section-space" :disabled="flow.logsLoading.value||flow.logsComplete.value" @click="flow.pullLogs">{{flow.logsLoading.value?'读取中…':'继续读取日志'}}</button>
</template>
<style scoped>
.stream-filter{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.stream-filter button{border:1px solid var(--color-border);padding:6px 10px;border-radius:8px;font-size:11px}.stream-filter button.active{color:var(--color-indigo);background:#6366f11a}.stream-filter label{margin-left:auto;font-size:12px}.log-panel{height:360px;background:var(--color-near-black);color:#e5e7eb;border-radius:8px;padding:16px;overflow:auto;font:12px/1.7 var(--font-mono);overscroll-behavior-x:contain;overscroll-behavior-y:auto}.log-line{display:flex;gap:12px;min-width:max-content;margin:0}.log-time{color:#9ca3af}.log-stream{font-size:11px;color:#a5b4fc;min-width:60px}.log-stream.stderr{color:#fca5a5}.log-stream.stdout{color:#6ee7b7}.log-text{white-space:pre}
</style>
