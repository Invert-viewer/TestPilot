<script setup>
import {uuid} from './services/uuid';
import { ref, computed, watch } from "vue";
import { ElMessage } from "element-plus";
import { createTaskRequest } from './types/validation';
import DualEditor from "./components/DualEditor.vue";
import KeyValueEditor from "./components/KeyValueEditor.vue";
import {
  clone,
  taskSeed,
  taskModel,
  cliArguments,
  variableRows,
} from "./config";
import {useWorkspace} from './context';
const {commit,upsert}=useWorkspace();
const props = defineProps({
  state: { type: Object, required: true },
  // 真实后端 GET /api/v1/tool-assets?tool=APIFOX_CLI 返回的场景资产
  toolAssets: { type: Array, default: null },
  assetsLoading: { type: Boolean, default: false },
  assetsError: { type: Object, default: null },
  submitError: { type: Object, default: null },
  submitting: { type: Boolean, default: false },
  draft: { type: Object, default: null },
});
const emit = defineEmits(["submit", "refresh-assets"]);
const model = ref(taskSeed()),
  editor = ref(null),
  section = ref("run"),
  planName = ref("");
const categories = [
  ["run", "运行控制"],
  ["data", "循环数据与变量"],
  ["report", "报告输出"],
  ["network", "网络与证书"],
  ["integration", "集成与通知"],
  ["output", "终端输出"],
];
const fields = {
  run: [
    ["iterations", "循环次数", "number"],
    ["delayRequestMs", "请求间隔 / ms", "number"],
    ["timeoutRequestMs", "请求超时 / ms", "number"],
    ["timeoutScriptMs", "脚本超时 / ms", "number"],
    ["onError", "遇到错误时", "select", ["ignore", "continue", "end"]],
  ],
  data: [
    ["iterationData", "循环数据文件路径或数据集 ID", "text"],
    ["variablesFile", "变量配置文件路径", "text"],
    ["carryRuntimeVariables", "跨场景传递运行时变量", "checkbox"],
  ],
  report: [
    ["outDir", "报告输出目录", "text"],
    ["outFile", "报告文件名（不含后缀）", "text"],
    ["failuresSeparated", "单独输出失败详情 JSON", "checkbox"],
    ["uploadReport", "运行后上传报告至 Apifox", "checkbox"],
  ],
  network: [
    ["ignoreRedirects", "禁止自动重定向", "checkbox"],
    ["insecure", "跳过 SSL 校验", "checkbox"],
    ["clientCertList", "客户端证书配置 JSON 路径", "text"],
    ["clientCert", "客户端证书 PEM 路径", "text"],
    ["clientKey", "客户端私钥路径", "text"],
    ["extraCaCerts", "额外受信 CA 证书路径", "text"],
  ],
  integration: [
    ["externalProgramPath", "外部程序目录", "text"],
    ["databaseConnection", "数据库配置文件路径", "text"],
    ["notification", "完成通知对象 ID（逗号分隔）", "text"],
    ["notificationFailed", "仅失败时通知对象 ID", "text"],
  ],
  output: [
    ["silent", "静默输出", "checkbox"],
    ["color", "控制台颜色", "select", ["auto", "on", "off"]],
    ["bigint", "兼容 bigint", "checkbox"],
    ["lang", "CLI 语言", "select", ["zh", "en"]],
  ],
};
// 只用真实后端资产，不用本地演示数据兜底。
const assets = computed(() =>
  (props.toolAssets ?? []).filter((a) => a.tool === model.value.tool),
);
const assetVersionLabel = (asset) => "v" + (asset.version ?? 1);
const activeAsset = computed(() => assets.value.find(a => a.id === model.value.assetId));
const localError = ref(null);
const fieldError = (field) => (localError.value?.errors || props.submitError?.errors || []).find(e => e.field === field)?.message;
const command = computed(() =>
  JSON.stringify(cliArguments(model.value), null, 2),
);
function changeTool() {
  const tool = model.value.tool;
  model.value.assetId =
    (props.toolAssets ?? []).find((a) => a.tool === tool)?.id || "";
  model.value.parameters =
    tool === "JMETER"
      ? {
          threads: 1,
          rampUpSeconds: 0,
          loops: 3,
          delayRequestMs: 1000,
          durationSeconds: 60,
          collection: "",
        }
      : taskSeed().parameters;
  chooseAsset();
  chooseEnvironment();
}
function chooseEnvironment() {
  const env = props.state.environments.find(
    (e) => e.id === model.value.environmentId,
  );
  if (env && model.value.tool === "APIFOX_CLI") {
    model.value.parameters.envVars = variableRows(env.variables);
    model.value.parameters.globalVars = variableRows(env.globalVariables);
    model.value.parameters.apifoxEnvironmentId = env.apifoxEnvironmentId || "";
  }
}
function changeSite() {
  model.value.environmentId =
    props.state.environments.find((env) => env.siteId === model.value.siteId)
      ?.id || "";
  chooseEnvironment();
}
function chooseAsset() {
  const asset = assets.value.find((a) => a.id === model.value.assetId);
  if (!asset) return;
  model.value.assetVersion = asset.version ?? 1;
  if (model.value.tool === "APIFOX_CLI" && asset.source) {
    // 真实资产 source 形如 {projectId, scenarioId, environmentId}
    model.value.parameters.targetKind = "scenario";
    if (asset.source.scenarioId != null)
      model.value.parameters.targetId = String(asset.source.scenarioId);
    if (asset.source.projectId != null)
      model.value.parameters.projectId = String(asset.source.projectId);
    if (asset.source.apifoxEnvironmentId != null)
      model.value.parameters.apifoxEnvironmentId = String(
        asset.source.apifoxEnvironmentId,
      );
  }
  if (model.value.tool === "JMETER" && asset.fileName)
    model.value.parameters.collection = asset.fileName;
}
function resolve() {
  const value = taskModel(editor.value.resolve());
  createTaskRequest({name:value.name,assetId:value.assetId,parameters:value.parameters});
  const asset = assets.value.find((a) => a.id === value.assetId);
  if (!asset || asset.tool !== value.tool)
    throw new Error("请选择真实场景资产（GET /api/v1/tool-assets）");
  return value;
}
function submit() {
  if (props.submitting) return;
  localError.value = null;
  try {
    emit("submit", resolve());
  } catch (e) {
    localError.value = {message:e.message, errors:e.field?[{field:e.field,message:e.message}]:[]};
  }
}
async function savePlan() {
  try {
    const value = resolve();
    if (!planName.value.trim()) throw new Error("填写参数方案名称");
    await commit([upsert("parameterPlans",{
      id: uuid(),
      name: planName.value,
      tool: value.tool,
      parameters: clone(value.parameters),
    })]);
    ElMessage.success("参数方案已保存");
  } catch (e) {
    ElMessage.error(e.message);
  }
}
function loadPlan(id) {
  const p = props.state.parameterPlans.find((p) => p.id === id);
  if (p) model.value.parameters = clone(p.parameters);
}
async function readData(event) {
  try {
    const file = event.target.files[0];
    if (!file) return;
    const text = await file.text();
    if (file.name.endsWith(".json")) JSON.parse(text);
    model.value.parameters.iterationData = file.name;
    model.value.dataFile = {
      name: file.name,
      content: text,
      type: file.name.endsWith(".json") ? "json" : "csv",
    };
    ElMessage.success("循环数据已载入本地配置");
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    event.target.value = "";
  }
}
function syncDefaultAsset() {
  if (!assets.value.length) return;
  if (assets.value.some((a) => a.id === model.value.assetId)) return;
  model.value.assetId = assets.value[0].id;
  chooseAsset();
}
watch(() => props.toolAssets, syncDefaultAsset, { immediate: true });
watch(() => model.value.tool, syncDefaultAsset);
changeSite();
chooseAsset();
model.value.parameters.iterations = 1;
model.value.parameters.delayRequestMs = 100;
if (props.draft) {
  model.value.name = props.draft.name;
  model.value.assetId = props.draft.assetId;
  Object.assign(model.value.parameters, props.draft.parameters);
}
</script>
<template>
  <p class="dialog-intro">
    选择已登记场景即可执行。网站和环境由场景提供。
  </p>
  <p v-if="draft" class="source-note">已恢复上次结果未确认的提交内容。同内容重试会复用原幂等键；修改内容后将创建新的提交。</p>
  <div v-if="localError" class="error-banner" role="alert">{{localError.message}}</div>
  <div v-if="submitError" class="error-banner">
    <strong>{{ submitError.code }}</strong>
    <p>{{ submitError.message }}</p>
    <ul v-if="submitError.errors?.length" class="field-errors">
      <li v-for="(item, index) in submitError.errors" :key="index">
        {{ item.field }} · {{ item.message }}
      </li>
    </ul>
    <p v-if="submitError.traceId" class="helper">
      traceId {{ submitError.traceId }}
    </p>
  </div>
  <DualEditor
    ref="editor"
    v-model="model"
    label="任务配置 JSON"
    :validate="taskModel"
    :parse-draft="value => taskModel(value, { draft: true })"
      ><div class="field-grid">
      <label class="full-field">任务名称<input v-model="model.name" :aria-invalid="!!fieldError('name')" /><small class="field-error">{{fieldError('name')}}</small></label
      ><label
        >执行工具<select v-model="model.tool" @change="changeTool">
          <option value="APIFOX_CLI">Apifox CLI</option>
          <option value="JMETER">JMeter</option>
        </select></label
      ><label
        >测试资产<select aria-label="测试资产" v-model="model.assetId" @change="chooseAsset">
          <option v-if="!assets.length" value="">暂无真实场景资产</option>
          <option v-for="asset in assets" :key="asset.id" :value="asset.id">
            {{ asset.name }} · {{ assetVersionLabel(asset) }}
          </option>
        </select><small class="field-error">{{fieldError('assetId')}}</small></label
      >
    </div>
    <div class="asset-status">
      <span v-if="assetsLoading" class="helper">正在读取真实场景资产…</span>
      <span v-else-if="assetsError" class="helper">
        场景资产读取失败：{{ assetsError.code }} · {{ assetsError.message }}
      </span>
      <span v-else-if="!assets.length" class="helper">
        后端没有该工具的资产，请先登记场景后刷新。
      </span>
      <RouterLink v-if="assetsError" class="link" to="/debug">打开本地请求调试</RouterLink>
      <button class="link" @click="$emit('refresh-assets')">
        刷新场景列表
      </button>
    </div>
    <div class="config-section">
      <h3>真实执行参数</h3>
      <dl v-if="activeAsset"><dt>执行目标</dt><dd>{{activeAsset.source.siteUrl || '由登记场景确定'}}</dd><dt>执行环境</dt><dd>{{activeAsset.source.environmentName || '—'}} · {{activeAsset.source.apifoxEnvironmentId || '—'}}</dd><dt>场景</dt><dd>{{activeAsset.source.scenarioId || '—'}}</dd></dl>
      <div class="field-grid">
        <label
          >循环次数 iterations<input
            type="number"
            min="1"
            step="1"
            v-model.number="model.parameters.iterations" :aria-invalid="!!fieldError('parameters.iterations')" /><small class="field-error">{{fieldError('parameters.iterations')}}</small></label
        ><label
          >请求间隔 delayRequestMs / ms<input
            type="number"
            min="0"
            step="1"
            v-model.number="model.parameters.delayRequestMs" :aria-invalid="!!fieldError('parameters.delayRequestMs')" /><small class="field-error">{{fieldError('parameters.delayRequestMs')}}</small></label
        ><label
          >请求超时 timeoutRequestMs / ms<input
            type="number"
            min="1"
            step="1"
            v-model.number="model.parameters.timeoutRequestMs" :aria-invalid="!!fieldError('parameters.timeoutRequestMs')" /><small class="field-error">{{fieldError('parameters.timeoutRequestMs')}}</small></label
        >
      </div>
      <p class="helper">
        提交 POST /api/v1/tasks 时只发送 name、assetId 与这三个 parameters；
        siteId / environmentId 由后端从资产（含站点与环境）推导。
      </p>
    </div>
    <details class="section-space"><summary>高级 CLI 草稿（仅本地保存，当前执行不应用）</summary>
    <div class="field-grid"><label
        >草稿网站（可选）<select v-model="model.siteId" @change="changeSite">
          <option value="">使用场景配置</option>
          <option v-for="site in state.sites" :key="site.id" :value="site.id">
            {{ site.name }}
          </option>
        </select></label
      ><label
        >草稿环境（本地配置）<select
          v-model="model.environmentId"
          @change="chooseEnvironment"
        >
          <option
            v-for="env in state.environments.filter(
              (e) => e.siteId === model.siteId,
            )"
            :key="env.id"
            :value="env.id"
          >
            {{ env.name }}
          </option>
        </select></label
></div>
    <template v-if="model.tool === 'APIFOX_CLI'"
      ><div class="config-section">
        <h3>项目与运行目标</h3>
        <div class="field-grid">
          <label
            >运行目标<select v-model="model.parameters.targetKind">
              <option value="scenario">场景</option>
              <option value="folder">场景目录</option>
              <option value="suite">测试套件</option>
              <option value="case">测试用例</option>
              <option value="file">本地测试文件</option>
              <option value="url">测试文件 URL</option>
            </select></label
          ><label v-if="['file', 'url'].includes(model.parameters.targetKind)"
            >测试文件路径 / URL<input
              v-model="model.parameters.collection" /></label
          ><label v-else
            >目标 ID<input
              v-model="model.parameters.targetId"
              placeholder="场景、目录、套件或用例 ID" /></label
          ><label
            >Apifox 项目 ID<input v-model="model.parameters.projectId" /></label
          ><label
            >分支名称<input
              v-model="model.parameters.branch"
              placeholder="留空使用工具默认分支" /></label
          ><label
            >Apifox 环境 ID<input
              v-model="model.parameters.apifoxEnvironmentId" /></label
          ><label
            >执行凭据引用<input
              v-model="model.credentialRef"
              placeholder="执行环境中保存的凭据名称"
          /></label>
        </div>
      </div>
      <div class="tab-strip">
        <button
          v-for="[id, label] in categories"
          :key="id"
          :class="{ active: section === id }"
          @click="section = id"
        >
          {{ label }}
        </button>
      </div>
      <div class="field-grid">
        <label
          v-for="[key, label, type, options] in fields[section]"
          :key="key"
          :class="{ 'toggle-field': type === 'checkbox' }"
          ><template v-if="type === 'checkbox'"
            ><input type="checkbox" v-model="model.parameters[key]" />{{
              label
            }}</template
          ><template v-else
            >{{ label
            }}<select v-if="type === 'select'" v-model="model.parameters[key]">
              <option v-for="option in options" :key="option">
                {{ option }}
              </option></select
            ><input
              v-else
              :type="type"
              v-model="model.parameters[key]"
              @change="
                type === 'number' &&
                (model.parameters[key] = Number(model.parameters[key]))
              " /></template
        ></label>
      </div>
      <template v-if="section === 'data'"
        ><label class="file-button"
          >载入 JSON / CSV 循环数据<input
            type="file"
            accept=".json,.csv"
            @change="readData"
        /></label>
        <p v-if="model.dataFile" class="helper">
          {{ model.dataFile.name }} · 内容已纳入任务快照
        </p>
        <KeyValueEditor
          v-model="model.parameters.envVars"
          label="环境变量" /><KeyValueEditor
          v-model="model.parameters.globalVars"
          label="全局变量"
      /></template>
      <div v-if="section === 'report'" class="checkbox-row">
        <label
          v-for="reporter in ['cli', 'html', 'json', 'junit']"
          :key="reporter"
          ><input
            type="checkbox"
            v-model="model.parameters.reporters"
            :value="reporter"
          />{{ reporter }}</label
        >
      </div>
      <p v-if="section === 'network'" class="helper">
        证书与私钥使用执行环境路径。证书密码由执行凭据引用注入。
      </p>
      <p
        v-if="section === 'integration' || section === 'report'"
        class="helper"
      >
        上传、通知、外部程序与数据库字段仅用于配置预览，运行本地演示时记录为待接入能力。
      </p></template
    >
    <div v-else class="config-section">
      <h3>JMeter 负载参数</h3>
      <div class="field-grid">
        <label
          v-for="[key, label] in [
            ['threads', '线程数'],
            ['rampUpSeconds', '升压时间 / 秒'],
            ['loops', '循环次数'],
            ['durationSeconds', '最长运行时间 / 秒'],
            ['delayRequestMs', '请求间隔 / ms'],
          ]"
          :key="key"
          >{{ label
          }}<input
            type="number"
            v-model.number="model.parameters[key]" /></label
        ><label
          >JMX 文件路径<input v-model="model.parameters.collection"
        /></label>
      </div>
      <p class="helper">
        JMX 计划需要读取 threads、loops、rampUpSeconds、durationSeconds 和
        delayRequestMs 属性，才能应用这些负载参数。
      </p>
    </div>
    </details>
    <div class="config-section field-grid">
      <label
        >已保存参数方案<select @change="loadPlan($event.target.value)">
          <option value="">选择方案</option>
          <option
            v-for="plan in state.parameterPlans.filter(
              (p) => p.tool === model.tool,
            )"
            :key="plan.id"
            :value="plan.id"
          >
            {{ plan.name }}
          </option>
        </select></label
      ><label>新方案名称<input v-model="planName" /></label>
    </div>
    <button class="link" @click="savePlan">保存当前参数方案</button></DualEditor
  >
  <details class="command-preview">
    <summary>查看 CLI 参数数组</summary>
    <pre class="parameter-code">{{ command }}</pre>
    <p class="helper">
      参数按独立数组传递。显示的路径和目标 ID 在真实执行前仍需绑定。
    </p>
  </details>
  <div class="workbench-actions">
    <button
      class="button"
      :disabled="submitting || !assets.length"
      @click="submit"
    >
      {{ submitting ? "提交中…" : "提交真实任务" }}
    </button>
    <span class="helper">提交后自动轮询状态、增量日志、用例与报告。</span>
  </div>
</template>
<style scoped>
.error-banner {
  border: 1px solid #d9704c;
  border-radius: 10px;
  padding: 12px 14px;
  margin: 12px 0;
  background: #fdeee7;
}
.error-banner strong {
  display: inline-block;
  margin-bottom: 4px;
}
.error-banner p {
  margin: 4px 0;
}
.field-errors {
  margin: 4px 0;
  padding-left: 18px;
  font-size: 0.9em;
}
.asset-status {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin: 4px 0 8px;
}
</style>
