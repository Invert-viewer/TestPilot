<script setup lang="ts">
import { ref } from 'vue';
import { data, environment, toast, ask } from '../store';
import { clone, pair, uid, type Environment } from '../model';
import Icon from './Icon.vue';
import Modal from './Modal.vue';
import KeyValueEditor from './KeyValueEditor.vue';
defineProps<{ compact?: boolean }>();
const editing = ref<Environment>();
function edit(add = false) { editing.value = add ? { id: uid(), name: '', variables: [pair('baseUrl')] } : clone(environment.value); }
function save() {
  const value = editing.value!;
  if (!value.name.trim()) return toast('请填写环境名称', true);
  const keys = value.variables.filter(v => v.enabled && v.key.trim()).map(v => v.key.trim());
  if (new Set(keys).size !== keys.length) return toast('环境变量名称不能重复', true);
  const base=value.variables.find(v=>v.enabled&&v.key.trim()==='baseUrl')?.value?.trim();
  try {const u=new URL(base||'');if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.hash||u.search)throw new Error();}
  catch{return toast('请启用 baseUrl，并填写不含凭据、查询串或片段的 HTTP(S) 地址',true);}
  value.name = value.name.trim();
  const index = data.environments.findIndex(e => e.id === value.id);
  if (index < 0) data.environments.push(value); else data.environments[index] = value;
  data.environmentId = value.id; editing.value = undefined; toast('环境已保存');
}
async function remove() {
  if (data.environments.length === 1) return toast('请至少保留一个环境', true);
  if (!await ask(`删除环境“${environment.value.name}”？`)) return;
  data.environments = data.environments.filter(e => e.id !== environment.value.id); data.environmentId = data.environments[0]!.id;
}
</script>
<template>
  <div class="environment-control"><select v-model="data.environmentId" aria-label="执行环境"><option v-for="e in data.environments" :key="e.id" :value="e.id">{{ e.name }}</option></select>
    <template v-if="!compact"><button class="icon-button" title="添加环境" aria-label="添加环境" @click="edit(true)"><Icon name="plus" :size="16" /></button><button class="icon-button" title="编辑环境" aria-label="编辑环境" @click="edit()"><Icon name="edit" :size="16" /></button><button class="icon-button" title="删除环境" aria-label="删除环境" @click="remove"><Icon name="trash" :size="16" /></button></template>
    <button v-else class="icon-button" aria-label="编辑环境" @click="edit()"><Icon name="edit" :size="16" /></button>
  </div>
  <Modal v-if="editing" title="环境配置" @close="editing = undefined"><label class="field">环境名称<input v-model="editing.name" placeholder="例如：本地环境" /></label><h3 class="small-heading">环境变量</h3><KeyValueEditor v-model="editing.variables" label="变量" /><p class="muted help">用 <code v-pre>{{变量名}}</code> 引用变量。配置保存到当前项目的数据库环境中，团队成员可共享使用。</p><template #footer><button class="button" @click="editing = undefined">取消</button><button class="button primary" @click="save">保存环境</button></template></Modal>
</template>
