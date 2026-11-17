<script setup lang="ts">
import { computed } from 'vue';
import { statusLabels, type Job } from '../execution';
import Icon from './Icon.vue';
const props = defineProps<{ job?: Job; busy: boolean; error?: string }>();
defineEmits<{ cancel: [] }>();
const state = computed(() => props.job?.status || (props.busy ? 'RUNNING' : ''));
</script>
<template>
  <div v-if="job || busy || error" class="execution-status"><div class="execution-status-line"><span :class="['execution-state', state.toLowerCase()]"><Icon :name="state === 'RUNNING' ? 'loader' : state === 'FAILED' ? 'alert' : state === 'CANCELLED' ? 'close' : 'success'" :size="15" :class="{ spin: state === 'RUNNING' }" />{{ statusLabels[state] || '准备执行' }}</span><span class="muted help">{{ job?.phase || '提交任务' }}</span><button v-if="busy" class="text-button" @click="$emit('cancel')">停止执行</button><code v-else-if="job" class="execution-id">{{ job.id.slice(0, 8) }}</code></div><div v-if="busy" class="execution-progress"><span :style="{ width: Math.max(2, job?.progress || 2) + '%' }"></span></div><p v-if="error || job?.error" class="error-banner" role="alert">{{ error || job?.error }}</p></div>
</template>
