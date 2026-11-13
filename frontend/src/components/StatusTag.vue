<script setup lang="ts">
import {taskStatusLabel,statusTone} from '../composables/useTaskFlow';
import type {TaskStatus,Outcome} from '../types/api';
defineProps<{status:TaskStatus;outcome:Outcome}>();
</script>
<template><span :class="['status',statusTone({status,outcome})]">{{taskStatusLabel({status,outcome})}}</span></template>
