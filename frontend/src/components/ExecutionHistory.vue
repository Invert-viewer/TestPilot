<script setup lang="ts">
import { workspaces, statusLabels, type ExecutionKind } from '../execution';
import Icon from './Icon.vue';
defineProps<{ kind: ExecutionKind }>();
defineEmits<{ select: [id: string] }>();
</script>
<template><section class="card history-section"><div class="section-title"><h2>本机执行记录</h2><span class="muted help">最近 10 次 · 原始产物保存在执行服务本机</span></div><p v-if="!workspaces.history[kind].length" class="muted history-empty">还没有执行记录，运行后会自动归档。</p><div v-for="entry in workspaces.history[kind]" :key="entry.id" class="execution-history-row"><Icon :name="kind" :size="17" /><button class="text-button truncate" @click="$emit('select', entry.id)">{{ entry.name }}</button><span class="history-summary truncate">{{ entry.summary }}</span><span class="badge neutral">{{ statusLabels[entry.status] }}</span><time>{{ new Date(entry.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</time></div></section></template>
