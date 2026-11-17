<script setup lang="ts">
import { pair, type Pair } from '../model';
import Icon from './Icon.vue';
const rows = defineModel<Pair[]>({ required: true });
withDefaults(defineProps<{ label?: string; keyPlaceholder?: string; valuePlaceholder?: string }>(), { label: '参数', keyPlaceholder: '键', valuePlaceholder: '值' });
</script>
<template>
  <div class="kv-editor"><div v-if="rows.length" class="kv-heading"><span></span><span>名称</span><span>值</span><span></span></div>
    <div v-for="(row, index) in rows" :key="row.id" class="kv-row">
      <input v-model="row.enabled" type="checkbox" :aria-label="`启用${label} ${index + 1}`" />
      <input v-model="row.key" :placeholder="keyPlaceholder" :aria-label="`${label}名称 ${index + 1}`" spellcheck="false" />
      <input v-model="row.value" :placeholder="valuePlaceholder" :aria-label="`${label}值 ${index + 1}`" spellcheck="false" />
      <button class="icon-button" :aria-label="`删除${label} ${index + 1}`" @click="rows.splice(index, 1)"><Icon name="trash" :size="15" /></button>
    </div>
    <button class="text-button" @click="rows.push(pair())"><Icon name="plus" :size="15" />添加{{ label }}</button>
  </div>
</template>
