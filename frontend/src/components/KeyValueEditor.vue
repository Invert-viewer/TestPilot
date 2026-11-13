<script setup lang="ts">
import { ref } from "vue";
import type { KeyValueRow } from "../types/api";
const pair = ():KeyValueRow => ({key:"",value:"",enabled:true});
const model = defineModel<KeyValueRow[]>({default:()=>[]});
const props = withDefaults(defineProps<{label?:string;separator?:string}>(),{label:'参数',separator:'='});
const error=ref('');
const bulk = ref(false),
  text = ref("");
function openBulk() {
  error.value="";
  text.value = model.value
    .map(
      (row) =>
        (row.enabled === false ? "# " : "") +
        row.key +
        props.separator +
        row.value,
    )
    .join("\n");
  bulk.value = true;
}
function applyBulk() {
  const rows:KeyValueRow[] = [];
  for (const [i, line] of text.value.split("\n").entries()) {
    if (!line.trim()) continue;
    const enabled = !line.startsWith("# "),
      raw = enabled ? line : line.slice(2),
      index = raw.indexOf(props.separator);
    if (index < 1)
      return void (error.value="第 " + (i + 1) + " 行请使用 名称" + props.separator + "值");
    rows.push({
      key: raw.slice(0, index).trim(),
      value: raw.slice(index + props.separator.length).trim(),
      enabled,
    });
  }
  model.value = rows;
  error.value="";
  bulk.value = false;
}
</script>
<template>
  <div class="kv-editor">
    <div class="editor-toolbar">
      <strong>{{ label }}</strong
      ><button v-if="!bulk" type="button" class="link" @click="openBulk">
        批量录入
      </button>
    </div>
    <template v-if="bulk">
      <textarea
        v-model="text"
        :aria-label="label + '批量内容'"
        class="bulk-text"
        :placeholder="'名称' + separator + '值，每行一项'"
      ></textarea>
      <p v-if="error" class="field-error" role="alert">{{error}}</p>
      <div class="inline-actions">
        <button type="button" class="button small" @click="applyBulk">
          应用批量内容</button
        ><button type="button" class="link" @click="bulk = false">取消</button>
      </div></template
    ><template v-else
      ><div v-for="(row, index) in model" :key="index" class="kv-row">
        <input
          type="checkbox"
          v-model="row.enabled"
          :aria-label="label + '启用' + (index + 1)"
        /><input
          v-model="row.key"
          :aria-label="label + '名称' + (index + 1)"
          placeholder="名称"
        /><input
          v-model="row.value"
          :aria-label="label + '值' + (index + 1)"
          placeholder="值"
        /><button
          class="remove-row"
          type="button"
          :aria-label="'删除' + label + (index + 1)"
          @click="model.splice(index, 1)"
        >
          ×
        </button>
      </div>
      <button type="button" class="link" @click="model.push(pair())">
        ＋ 添加{{ label }}
      </button></template
    >
  </div>
</template>
