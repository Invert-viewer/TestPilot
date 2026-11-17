<script setup lang="ts">
import { ref } from 'vue';
import { workspaces, type ExecutionKind } from '../execution';
import { ask } from '../store';
import Icon from './Icon.vue';
const props = defineProps<{ kind: ExecutionKind }>();
const emit = defineEmits<{ load: [payload: any, id: string] }>();
const selected = ref('');
function load() { const p = workspaces.presets[props.kind].find(v => v.id === selected.value); if (p) emit('load', p.payload, p.id); }
async function remove() { if (!selected.value || !await ask('删除所选的本地配置？')) return; workspaces.presets[props.kind] = workspaces.presets[props.kind].filter(p => p.id !== selected.value); selected.value = ''; }
</script>
<template><div class="preset-bar"><Icon name="layers" :size="16" /><select v-model="selected" aria-label="载入已保存配置" @change="load"><option value="">已保存配置（{{ workspaces.presets[kind].length }}）</option><option v-for="p in workspaces.presets[kind]" :key="p.id" :value="p.id">{{ p.name }}</option></select><button v-if="selected" class="icon-button" aria-label="删除所选配置" @click="remove"><Icon name="trash" :size="14" /></button><slot /></div></template>
