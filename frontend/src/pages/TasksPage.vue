<script setup lang="ts">
import {ref,watch,onMounted} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import {useWorkspace} from '../context';
import {useTaskFlow} from '../composables/useTaskFlow';
import TaskWorkspace from '../TaskWorkspace.vue';
import TaskComposer from '../TaskComposer.vue';
import PreviewArchive from '../content/PreviewArchive.vue';
import {readTaskIntent} from '../services/taskIntent';
const route=useRoute(),router=useRouter(),{state}=useWorkspace(),dialog=ref(false);
const pendingDraft=ref(readTaskIntent()?.body);
const flow=useTaskFlow({onActiveChange(id){void router.replace({path:'/tasks',query:id?{taskId:id}:{}});}});
function syncRoute(){const id=route.query.taskId;if(typeof id==='string'&&id!==flow.activeId.value)void flow.open(id,{navigate:false});else if(!id&&flow.activeId.value)flow.clearActive();if(route.query.compose==='1')dialog.value=true;}
watch(()=>[route.query.taskId,route.query.compose],syncRoute);
watch(dialog,open=>{if(open){pendingDraft.value=readTaskIntent()?.body;void flow.loadAssets();}else if(route.query.compose)void router.replace({path:'/tasks',query:flow.activeId.value?{taskId:flow.activeId.value}:{}});});
async function submit(config:unknown){try{await flow.submit(config);dialog.value=false;}catch{/* Submit error is rendered once, beside the form. */}}
onMounted(()=>{syncRoute();void flow.loadAssets();});
</script>
<template>
  <div class="page-actions"><span class="source-chip">Spring Boot · Apifox CLI</span><button class="button" @click="dialog=true">新建任务</button></div>
  <TaskWorkspace :flow="flow" :state="state"/>
  <PreviewArchive/>
  <el-dialog v-model="dialog" title="新建测试任务" width="960px" destroy-on-close :close-on-click-modal="!flow.submitting.value" :close-on-press-escape="!flow.submitting.value" :show-close="!flow.submitting.value">
    <TaskComposer v-if="dialog" :state="state" :draft="pendingDraft" :tool-assets="flow.toolAssets.value" :assets-loading="flow.assetsLoading.value" :assets-error="flow.assetsError.value??undefined" :submit-error="flow.submitError.value??undefined" :submitting="flow.submitting.value" @submit="submit" @refresh-assets="flow.loadAssets()"/>
  </el-dialog>
</template>
