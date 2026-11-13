<script setup>
import {uuid} from './services/uuid';
import { ref } from "vue";
import { ElMessage } from "element-plus";
import DualEditor from "./components/DualEditor.vue";
import KeyValueEditor from "./components/KeyValueEditor.vue";
import { clone, variableRows, validatePairs } from "./config";
import { download } from "./preview";
import {useWorkspace} from './context';
const {commit,upsert}=useWorkspace();
const saving=ref(false),originalRevision=ref(0);
const props = defineProps({
  state: { type: Object, required: true },
  collection: { type: String, required: true },
  title: String,
  fields: Array,
  defaults: { type: Object, default: () => ({}) },
});
const dialog = ref(false),
  draft = ref({}),
  editor = ref(null),
  editId = ref(null);
function openCreate() {
  editId.value = null;
  draft.value = clone(props.defaults);
  if (props.collection === "environments") {
    const site = props.state.sites[0];
    draft.value.siteId = site?.id || "";
    draft.value.baseUrl = site?.baseUrl || "";
  }
  draft.value.name ??= "";
  dialog.value = true;
}
function edit(item) {
  editId.value = item.id;
  originalRevision.value=item.revision;
  draft.value = { ...clone(props.defaults), ...clone(item) };
  for (const field of props.fields)
    if (field.type === "pairs")
      draft.value[field.key] = variableRows(draft.value[field.key]);
  dialog.value = true;
}
function options(field) {
  return field.source
    ? props.state[field.source].map((item) => ({
        value: item.id,
        label: item.name || item.title || item.id,
      }))
    : field.options.map((item) =>
        typeof item === "string" ? { value: item, label: item } : item,
      );
}
function validate(value, { draft = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("配置必须是 JSON 对象");
  for (const f of props.fields) {
    const item = value[f.key];
    if (['text','textarea'].includes(f.type) && item !== undefined && item !== null && typeof item !== 'string')
      throw new Error(f.key + ': 应为字符串');
    if (f.type === 'lines' && (!Array.isArray(item) || item.some(x => typeof x !== 'string')))
      throw new Error(f.key + ': 应为字符串数组');
    if (f.type === 'multiselect' && (!Array.isArray(item) || item.some(x => typeof x !== 'string')))
      throw new Error(f.key + ': 应为资源 ID 数组');
    if (f.type === 'select' && item !== undefined && item !== null && item !== '' && !options(f).some(o => o.value === item))
      throw new Error(f.key + ': 取值不在可选范围');
    if (f.type === "pairs") {
      value[f.key] = variableRows(value[f.key]);
      validatePairs(value[f.key], f.label);
    }
    if (
      f.type === "groups" &&
      (!Array.isArray(value[f.key]) ||
        value[f.key].some(
          (group) =>
            !group || typeof group !== 'object' ||
            typeof group.label !== 'string' ||
            (!draft && !group.label.trim()) ||
            !Number.isInteger(group.iterations) ||
            (!draft && group.iterations < 1) ||
            !Number.isInteger(group.repeats) ||
            (!draft && group.repeats < 1) ||
            !Number.isInteger(group.delayRequestMs) ||
            (!draft && group.delayRequestMs < 0),
        ))
    )
      throw new Error(f.key + ": 档位需要名称、正整数循环与重复次数，以及非负整数间隔");
    if (
      !draft && f.required &&
      (value[f.key] === undefined ||
        value[f.key] === null ||
        String(value[f.key]).trim() === "")
    )
      throw new Error("请填写" + f.label);
    if (
      f.type === "number" &&
      (!Number.isFinite(value[f.key]) || (!draft && value[f.key] < 0))
    )
      throw new Error(f.label + "须为非负数");
  }
  if (!draft && ["sites", "environments"].includes(props.collection)) {
    const url = new URL(value.baseUrl);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("填写有效 HTTP(S) 地址，移除凭据、查询和片段");
    if (props.collection === "environments") {
      const site = props.state.sites.find((s) => s.id === value.siteId);
      if (!site || new URL(site.baseUrl).origin !== url.origin)
        throw new Error("环境地址须与所属网站同源");
    }
  }
  if (!draft && props.collection === "assets") {
    if (value.kind === "JMETER_FILE" && value.tool !== "JMETER")
      throw new Error("JMX 资产请选择 JMeter");
    if (value.tool === "JMETER" && value.kind !== "JMETER_FILE")
      throw new Error("JMeter 请选择 JMX 资产类型");
    value.source = {
      projectId: value.projectId || "",
      targetId: value.targetId || "",
      targetKind: value.targetKind || "scenario",
      apifoxEnvironmentId: value.apifoxEnvironmentId || "",
      collection: value.fileName || value.collection || "",
    };
  }
  return clone(value);
}
async function save() {
  if(saving.value)return;
  saving.value=true;
  try {
    const value = validate(editor.value.resolve());
    value.id = editId.value || uuid();
    const index = props.state[props.collection].findIndex(
      (item) => item.id === value.id,
    );
    value.version =
      index >= 0 ? (props.state[props.collection][index].version || 1) + 1 : 1;
    if (props.collection === "sites") {
      const sites = props.state.sites;
      let hue = sites[index]?.cardHue;
      if (hue == null) {
        const used = new Set(sites.map(site => site.cardHue));
        let sequence = sites.length;
        do { hue = (220 + sequence++ * 137.507764) % 360; } while (used.has(hue));
      }
      value.cardHue = hue;
    }
    value.updatedAt = new Date().toISOString();
    value.revision = editId.value ? originalRevision.value : 0;
    const changes = [upsert(props.collection,value)];
    if(props.collection==="sites"){
      const previous=props.state.sites[index];
      if(!previous) changes.push(upsert("environments",{id:"env-"+value.id,name:value.environment||"公开环境",siteId:value.id,baseUrl:value.baseUrl,variables:[],globalVariables:[]}));
      else for(const env of props.state.environments.filter(e=>e.siteId===value.id)){
        const url=new URL(env.baseUrl);
        if(env.baseUrl===previous.baseUrl || url.origin!==new URL(value.baseUrl).origin){
          const baseUrl=env.baseUrl===previous.baseUrl?value.baseUrl:new URL(url.pathname,new URL(value.baseUrl).origin).href;
          changes.push(upsert("environments",{...env,baseUrl}));
        }
      }
    }
    await commit(changes);
    dialog.value = false;
    ElMessage.success("配置已保存");
  } catch (e) {
    ElMessage.error(e.message);
  } finally {saving.value=false;}
}
async function readFile(event, field) {
  try {
    const file = event.target.files[0];
    if (!file) return;
    const content = await file.text();
    if (file.name.endsWith(".json")) JSON.parse(content);
    draft.value[field.key] = file.name;
    draft.value.fileContent = content;
    ElMessage.success("文件已载入配置");
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    event.target.value = "";
  }
}
defineExpose({ openCreate, edit });
</script>
<template>
  <section class="surface section-space resource-panel">
    <div class="panel-heading">
      <div>
        <h2>{{ title }}</h2>
        <p class="muted">{{ state[collection].length }} 条已保存配置</p>
      </div>
      <button class="button small" @click="openCreate">＋ 新增配置</button>
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>配置概要</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in state[collection]" :key="item.id">
            <td>
              {{ item.name || item.title || item.id
              }}<small>{{ item.id }}</small>
            </td>
            <td>
              {{
                item.baseUrl ||
                item.description ||
                item.mode ||
                item.type ||
                item.expected ||
                item.tool ||
                "—"
              }}
            </td>
            <td class="inline-actions">
              <button class="link" @click="edit(item)">编辑配置</button
              ><button
                class="link"
                @click="
                  download(
                    (item.name || item.title || 'config') + '.json',
                    JSON.stringify(item, null, 2),
                    'application/json',
                  )
                "
              >
                导出 JSON
              </button>
            </td>
          </tr>
          <tr v-if="!state[collection].length">
            <td colspan="3">暂无配置，点击新增开始。</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <el-dialog
    v-model="dialog"
    :title="title + ' · ' + (editId ? '编辑' : '新增')"
    width="820px"
    destroy-on-close
    ><DualEditor
      v-if="dialog"
      ref="editor"
      v-model="draft"
      :label="title + ' JSON'"
      :validate="validate"
      :parse-draft="value => validate(value, { draft: true })"
      ><div class="field-grid">
        <label
          v-for="field in fields.filter(
            (f) => !['pairs', 'groups', 'file'].includes(f.type),
          )"
          :key="field.key"
          :class="{
            'full-field': ['textarea', 'lines', 'multiselect'].includes(
              field.type,
            ),
          }"
          >{{ field.label
          }}<select
            v-if="field.type === 'select' || field.type === 'multiselect'"
            v-model="draft[field.key]"
            :multiple="field.type === 'multiselect'"
          >
            <option
              v-for="option in options(field)"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option></select
          ><textarea
            v-else-if="field.type === 'lines'"
            :value="
              Array.isArray(draft[field.key])
                ? draft[field.key].join('\n')
                : draft[field.key]
            "
            @input="draft[field.key] = $event.target.value.split('\n')"
            rows="3"
          ></textarea
          ><textarea
            v-else-if="field.type === 'textarea'"
            v-model="draft[field.key]"
            rows="3"
          ></textarea
          ><input
            v-else-if="field.type === 'number'"
            type="number"
            v-model.number="draft[field.key]" /><input
            v-else
            v-model="draft[field.key]"
            :placeholder="field.placeholder || ''"
        /></label>
      </div>
      <template v-for="field in fields" :key="field.key"
        ><KeyValueEditor
          v-if="field.type === 'pairs'"
          v-model="draft[field.key]"
          :label="field.label"
        />
        <div v-if="field.type === 'file'" class="config-section">
          <label class="field-label"
            >{{ field.label
            }}<input
              v-model="draft[field.key]"
              placeholder="文件名或执行环境路径" /></label
          ><label class="file-button"
            >载入文件<input
              type="file"
              accept=".json,.jmx,.csv"
              @change="readFile($event, field)"
          /></label>
        </div>
        <div v-if="field.type === 'groups'" class="config-section">
          <h3>{{ field.label }}</h3>
          <div
            v-for="(group, index) in draft[field.key]"
            :key="index"
            class="group-row"
          >
            <label>档位<input v-model="group.label" /></label
            ><label
              >循环次数<input
                type="number"
                min="1"
                v-model.number="group.iterations" /></label
            ><label
              >间隔 / ms<input
                type="number"
                min="0"
                v-model.number="group.delayRequestMs" /></label
            ><label
              >重复次数<input
                type="number"
                min="1"
                v-model.number="group.repeats" /></label
            ><button
              class="remove-row"
              @click="draft[field.key].splice(index, 1)"
              aria-label="删除实验档位"
            >
              ×
            </button>
          </div>
          <button
            class="link"
            @click="
              draft[field.key].push({
                label: '新档位',
                iterations: 3,
                delayRequestMs: 1000,
                repeats: 3,
              })
            "
          >
            ＋ 添加实验档位
          </button>
        </div></template
      ></DualEditor
    ><template #footer
      ><button class="button" :disabled="saving" @click="save">保存配置</button></template
    ></el-dialog
  >
</template>

