<script setup>
import {uuid} from './services/uuid';
const model = defineModel({ type: Array, default: () => [] });
const types = [
  ["STATUS_CODE", "状态码"],
  ["HEADER", "响应头"],
  ["BODY", "正文"],
  ["JSON_FIELD", "JSON 字段"],
  ["RESPONSE_TIME_MS", "响应耗时"],
];
function change(row) {
  row.operator = row.type === "RESPONSE_TIME_MS" ? "LTE" : "EQ";
  row.target = ["HEADER", "JSON_FIELD"].includes(row.type) ? "" : null;
}
function addAssertion() {
  model.value.push({
    id: uuid(),
    type: "STATUS_CODE",
    target: null,
    operator: "EQ",
    expected: "200",
    enabled: true,
  });
}
</script>
<template>
  <div class="assertion-editor">
    <div v-for="(row, index) in model" :key="row.id" class="assertion-edit-row">
      <input
        type="checkbox"
        v-model="row.enabled"
        :aria-label="'启用断言' + (index + 1)"
      /><select
        v-model="row.type"
        @change="change(row)"
        :aria-label="'断言类型' + (index + 1)"
      >
        <option v-for="[value, label] in types" :key="value" :value="value">
          {{ label }}
        </option></select
      ><input
        v-if="['HEADER', 'JSON_FIELD'].includes(row.type)"
        v-model="row.target"
        :aria-label="'断言目标' + (index + 1)"
        placeholder="Content-Type 或 /title"
      /><select v-model="row.operator" :aria-label="'断言运算符' + (index + 1)">
        <option :value="row.type === 'RESPONSE_TIME_MS' ? 'LTE' : 'EQ'">
          {{ row.type === "RESPONSE_TIME_MS" ? "小于等于" : "等于" }}
        </option>
        <option
          v-if="['HEADER', 'BODY', 'JSON_FIELD'].includes(row.type)"
          value="CONTAINS"
        >
          包含
        </option></select
      ><input
        v-model="row.expected"
        :aria-label="'断言预期' + (index + 1)"
        placeholder="预期值"
      /><button
        type="button"
        class="remove-row"
        @click="model.splice(index, 1)"
        :aria-label="'删除断言' + (index + 1)"
      >
        ×
      </button>
    </div>
    <button type="button" class="link" @click="addAssertion">
      ＋ 添加断言
    </button>
  </div>
</template>
