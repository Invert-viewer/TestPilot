<script setup lang="ts">
import type { ApiError } from '../api/index';
defineProps<{error?: Pick<ApiError,'message'|'code'|'traceId'|'status'> | null}>();
</script>
<template><div v-if="error" class="error-banner" role="alert"><strong>{{error.code}}</strong><p>{{error.message}}</p><small v-if="error.traceId">追踪编号 {{error.traceId}}</small></div></template>
