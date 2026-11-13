<script setup lang="ts" generic="T">
import {ref,watch} from 'vue';
const model=defineModel<T>({required:true});
const props=withDefaults(defineProps<{label?:string;validate?:(value:unknown)=>T;parseDraft?:(value:unknown)=>T}>(),{label:'配置 JSON'});
const mode=ref<'form'|'json'>('form'),raw=ref(''),error=ref(''),unapplied=ref(false);
const copy=(value:T):T=>JSON.parse(JSON.stringify(value));
function resolve():T {
  try {
    const input=mode.value==='json'?JSON.parse(raw.value):JSON.parse(JSON.stringify(model.value));
    const value=props.validate?props.validate(input):input as T;
    model.value=value;error.value='';unapplied.value=false;return value;
  }catch(e){error.value=e instanceof Error?e.message:'配置无效';if(mode.value==='json')unapplied.value=true;throw e;}
}
function switchMode(next:'form'|'json') {
  if(next===mode.value)return;
  if(next==='json'){
    if(!unapplied.value){raw.value=JSON.stringify(model.value,null,2);error.value='';}
    mode.value=next;
  }else{
    try{
      const input:unknown=JSON.parse(raw.value);
      const value=props.parseDraft?props.parseDraft(input):props.validate?props.validate(input):input as T;
      model.value=copy(value);unapplied.value=false;error.value='';
    }catch(e){
      unapplied.value=true;
      error.value=(e instanceof Error?e.message:'配置无效')+'。已返回表单，未应用的 JSON 草稿仍保留。';
    }
    mode.value=next;
  }
}
function apply(){try{resolve();}catch{/* Inline error only. */}}
function regenerate(){raw.value=JSON.stringify(model.value,null,2);error.value='';unapplied.value=false;}
watch(model,()=>{if(mode.value==='form'&&!unapplied.value)error.value='';});
defineExpose({resolve});
</script>
<template><div class="dual-editor">
<div class="segmented input-modes" role="group" :aria-label="label+'录入方式'">
<button type="button" :aria-pressed="mode==='form'" :class="{active:mode==='form'}" @click="switchMode('form')">逐字段填写</button>
<button type="button" :aria-pressed="mode==='json'" :class="{active:mode==='json'}" @click="switchMode('json')">整段 JSON 录入</button></div>
<div v-if="mode==='form'" class="field-content"><slot/></div>
<div v-else><textarea v-model="raw" :aria-label="label" :aria-invalid="!!error" class="code-editor" spellcheck="false"></textarea><div class="inline-actions"><button type="button" class="link" @click="apply">校验并应用 JSON</button><button v-if="unapplied" type="button" class="link" @click="regenerate">使用当前表单重新生成 JSON</button></div></div>
<p v-if="error" class="field-error" role="alert">{{error}}</p></div></template>
