<script setup lang="ts">
import { computed, onDeactivated, onBeforeUnmount, ref, watch } from 'vue';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import KeyValueEditor from '../components/KeyValueEditor.vue';
import EnvironmentPicker from '../components/EnvironmentPicker.vue';
import { data, environment, variables, applyExtractions, toast, ask, busyTasks } from '../store';
import { preferences, revealReport } from '../preferences';
import { assertion, clone, newRequest, uid, type RequestDraft, type RequestResult } from '../model';
import { execute } from '../client';

const draft = ref<RequestDraft>(newRequest()), tab = ref('query'), responseTab = ref('body');
const response = ref<RequestResult>(), error = ref(''), sending = ref(false);
const modal = ref(''), saveName = ref(''), importText = ref(''), importBusy = ref(false), importError = ref('');
type Imported = { cases: RequestDraft[]; variables: Record<string, string>; warnings: string[]; format: string };
const imported = ref<Imported>(), importVariables = ref(false);
const selected = ref<string[]>([]), collectionBusy = ref(false), collectionResult = ref<any>(), collectionError = ref('');
const expandedResult = ref('');
watch([sending, collectionBusy],()=>{busyTasks.api=sending.value||collectionBusy.value;});
onBeforeUnmount(()=>{delete busyTasks.api;});
let controller: AbortController | undefined, collectionController: AbortController | undefined;
const tabs = [['query', '参数'], ['headers', '请求头'], ['body', '请求体'], ['auth', '鉴权'], ['assertions', '断言'], ['extractions', '变量提取']];
const assertionTypes = [['status', '状态码'], ['jsonpath', 'JSONPath'], ['header', '响应头'], ['body', '响应正文'], ['time', '响应时间 ms']];
const operators = [['eq', '等于'], ['neq', '不等于'], ['contains', '包含'], ['exists', '存在'], ['isArray', '是数组'], ['lt', '小于'], ['lte', '小于等于'], ['gt', '大于'], ['gte', '大于等于']];
const prettyBody = computed(() => { if (!response.value) return ''; try { return JSON.stringify(JSON.parse(response.value.body), null, 2); } catch { return response.value.body; } });
const failed = computed(() => response.value?.assertions.filter(a => !a.passed).length || 0);
const selectedAll = computed({ get: () => selected.value.length === data.requests.length && Boolean(data.requests.length), set: checked => { selected.value = checked ? data.requests.map(r => r.id) : []; } });
const sizeLabel = (bytes: number) => bytes > 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B';
function load(value: RequestDraft) { controller?.abort(); draft.value = clone(value); response.value = undefined; error.value = ''; }
function fresh() { load(newRequest()); }
async function remove(id: string) { if (!await ask('删除这条接口用例？')) return; data.requests = data.requests.filter(r => r.id !== id); if (draft.value.id === id) fresh(); }
function startSave() { saveName.value = draft.value.name; modal.value = 'save'; }
function save() {
  if (!saveName.value.trim() || !draft.value.url.trim()) return toast('请填写用例名称和请求地址', true);
  const saved = clone(draft.value); saved.name = saveName.value.trim(); saved.id ||= uid();
  const index = data.requests.findIndex(r => r.id === saved.id);
  if (index < 0) data.requests.push(saved); else data.requests[index] = saved;
  draft.value = clone(saved); modal.value = ''; toast('接口用例已保存');
}
async function send() {
  if (sending.value) return;
  const request = clone(draft.value), envId = environment.value.id, env = clone(variables.value);
  controller = new AbortController(); const currentController = controller;
  sending.value = true; error.value = ''; response.value = undefined;
  try {
    const result = await execute<RequestResult>('request', { draft: request, variables: env }, controller.signal);
    if (currentController.signal.aborted) return;
    response.value = result; responseTab.value = 'body'; applyExtractions(result.extracted, envId);
    if(preferences.notifyFailure&&result.assertions.some(a=>!a.passed))toast('接口断言未全部通过，请查看响应结果',true);
    revealReport('.response-card');
    data.history.unshift({ id: uid(), name: request.name || request.url, time: new Date().toISOString(), status: result.status, draft: request, durationMs:result.durationMs,
      assertions:result.assertions.map(({type,target,operator,expected,actual,passed,error})=>({type,target,operator,expected,actual,passed,error})) });
    data.history = data.history.slice(0, 15);
  } catch (e) { if (!currentController.signal.aborted) error.value = (e as Error).message; }
  finally { if (controller === currentController) sending.value = false; }
}
function cancel() { controller?.abort(); sending.value = false; error.value = '请求已取消'; }
function openImport(kind: string) { modal.value = kind; importText.value = ''; imported.value = undefined; importError.value = ''; importVariables.value = false; }
async function readFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
  if (file.size > 2 * 1024 * 1024) { importError.value = '请选择小于 2 MB 的 JSON 文件'; return; }
  importText.value = await file.text(); imported.value = undefined;
}
async function parse() {
  importBusy.value = true; importError.value = ''; imported.value = undefined;
  try {
    if (modal.value === 'curl') {
      const value = await execute<{ request: RequestDraft; warnings: string[] }>('import/curl', { text: importText.value });
      imported.value = { cases: [value.request], variables: {}, warnings: value.warnings, format: 'cURL' };
    } else imported.value = await execute<Imported>('import/spec', { spec: importText.value });
  } catch (e) { importError.value = (e as Error).message; } finally { importBusy.value = false; }
}
function confirmImport() {
  if (!imported.value) return;
  if (modal.value === 'curl') { const first = clone(imported.value.cases[0]!); first.id = ''; load(first); }
  else { data.requests.push(...imported.value.cases); load(imported.value.cases[0]!); }
  if (importVariables.value) applyExtractions(imported.value.variables);
  toast(modal.value === 'curl' ? 'cURL 请求已载入，可编辑后发送或保存' : `已导入 ${imported.value.cases.length} 条接口用例`); modal.value = '';
}
function openCollection() { selected.value = data.requests.map(r => r.id); collectionResult.value = undefined; collectionError.value = ''; modal.value = 'collection'; }
async function runCollection() {
  if (!selected.value.length) return toast('请至少选择一条用例', true);
  collectionBusy.value = true; collectionResult.value = undefined; collectionError.value = ''; collectionController = new AbortController();
  const currentController = collectionController;
  const envId = environment.value.id;
  try { const value: any = await execute('collection', { cases: clone(data.requests.filter(r => selected.value.includes(r.id))), variables: clone(variables.value) }, currentController.signal); if (!currentController.signal.aborted) { collectionResult.value = value; applyExtractions(value.extracted, envId); } }
  catch (e) { if (collectionController === currentController) collectionError.value = currentController.signal.aborted ? '回归已取消' : (e as Error).message; }
  finally { if (collectionController === currentController) collectionBusy.value = false; }
}
function closeModal() { if (collectionBusy.value) collectionController?.abort(); modal.value = ''; }
async function copy(value: string) { try { await navigator.clipboard.writeText(value); toast('已复制'); } catch { toast('浏览器未允许复制，请手动选择文本', true); } }
function cleanup() { controller?.abort(); collectionController?.abort(); sending.value = false; }
onDeactivated(cleanup); onBeforeUnmount(cleanup);
</script>
<template>
  <div class="page">
    <div class="page-heading"><div><div class="eyebrow">API TESTING</div><h1>接口测试</h1><p>构造请求、验证响应，将每一次调试沉淀为可回归的接口用例。</p></div><div class="page-actions"><button class="button" @click="openImport('spec')"><Icon name="upload" />导入接口</button><button class="button" @click="openCollection"><Icon name="terminal" />Newman 回归</button><button class="button" @click="openImport('curl')"><Icon name="terminal" />导入 cURL</button><button class="button icon-only" title="重置请求" aria-label="重置请求" @click="fresh"><Icon name="reset" /></button></div></div>
    <div class="workbench-grid"><aside class="card collection-card"><div class="section-title"><h2>接口集合 <span class="count">{{ data.requests.length }}</span></h2><button class="icon-button" aria-label="新建接口请求" title="新建接口请求" @click="fresh"><Icon name="plus" /></button></div>
      <div class="case-list"><div v-if="!data.requests.length" class="small-empty"><Icon name="api" :size="26" /><span>还没有接口用例</span><button class="text-button" @click="fresh">从一个请求开始</button></div><div v-for="item in data.requests" :key="item.id" class="case-row" :class="{ selected: draft.id === item.id }"><button class="case-main" @click="load(item)"><span :class="['method-mini', item.method.toLowerCase()]">{{ item.method }}</span><span class="truncate">{{ item.name }}</span></button><button class="icon-button case-delete" :aria-label="`删除用例 ${item.name}`" @click="remove(item.id)"><Icon name="trash" :size="14" /></button></div></div>
      <div class="panel-divider"></div><h3 class="mini-label">环境</h3><EnvironmentPicker /><h3 class="mini-label">环境变量</h3><div class="variable-list"><div v-for="(value, key) in variables" :key="key" class="variable-row"><code>{{ key }}</code><span class="truncate" :title="String(value)">{{ /token|password|secret|key/i.test(String(key)) ? '••••••••' : value || '（空）' }}</span></div><p v-if="!Object.keys(variables).length" class="muted help">当前环境尚无变量</p></div>
      <div class="section-title history-title"><h3 class="mini-label">最近请求</h3><button v-if="data.history.length" class="icon-button" aria-label="清空最近请求" @click="data.history = []"><Icon name="trash" :size="14" /></button></div><div class="history-list"><p v-if="!data.history.length" class="muted help">发送后的请求会出现在这里</p><button v-for="item in data.history.slice(0, 6)" :key="item.id" class="history-row" @click="load(item.draft)"><span :class="['history-status', { bad: item.status >= 400 }]">{{ item.status }}</span><span class="truncate">{{ item.draft.url }}</span></button></div>
    </aside>
    <div class="workbench-main"><section class="card request-bar"><select v-model="draft.method" aria-label="HTTP 方法" class="method-select"><option v-for="method in ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']" :key="method">{{ method }}</option></select><input v-model="draft.url" aria-label="请求地址" class="url-input" spellcheck="false" placeholder="https://api.example.com 或 {{baseUrl}}/path" @keydown.enter="send" /><button v-if="!sending" class="button primary send-button" @click="send"><Icon name="send" />发送</button><button v-else class="button primary send-button" @click="cancel"><Icon name="close" />取消</button><button class="button icon-only" title="保存为接口用例" aria-label="保存为接口用例" @click="startSave"><Icon name="save" /></button></section>
      <section class="card request-editor"><div class="tabs" role="tablist" aria-label="请求配置"><button v-for="[key, label] in tabs" :id="`tab-${key}`" :key="key" role="tab" :aria-selected="tab === key" :class="{ active: tab === key }" @click="tab = key">{{ label }}<span v-if="key === 'assertions' && draft.assertions.length" class="tab-dot"></span></button></div><div class="editor-body" role="tabpanel" :aria-labelledby="`tab-${tab}`">
        <KeyValueEditor v-if="tab === 'query'" v-model="draft.query" label="参数" /><KeyValueEditor v-if="tab === 'headers'" v-model="draft.headers" label="请求头" />
        <template v-if="tab === 'body'"><div class="segmented"><button v-for="[key, label] in [['none', '无'], ['json', 'JSON'], ['form', '表单'], ['text', '文本']]" :key="key" :class="{ active: draft.body.mode === key }" @click="draft.body.mode = key">{{ label }}</button></div><p v-if="draft.body.mode === 'none'" class="muted empty-editor">此请求不发送正文。</p><KeyValueEditor v-else-if="draft.body.mode === 'form'" v-model="draft.body.fields" label="字段" /><textarea v-else v-model="draft.body.text" class="code-editor" aria-label="请求体内容" :placeholder="draft.body.mode === 'json' ? '{\n  &quot;name&quot;: &quot;value&quot;\n}' : '输入请求正文'" spellcheck="false"></textarea></template>
        <template v-if="tab === 'auth'"><label class="field short-field">鉴权类型<select v-model="draft.auth.type"><option value="none">无需鉴权</option><option value="bearer">Bearer Token</option><option value="basic">Basic Auth</option></select></label><label v-if="draft.auth.type === 'bearer'" class="field">Token<input v-model="draft.auth.token" type="password" placeholder="支持 {{token}} 环境变量" /></label><div v-if="draft.auth.type === 'basic'" class="two-fields"><label class="field">用户名<input v-model="draft.auth.username" autocomplete="off" /></label><label class="field">密码<input v-model="draft.auth.password" type="password" autocomplete="off" /></label></div></template>
        <template v-if="tab === 'assertions'"><p class="editor-hint">请求完成后验证响应，失败会保留预期值和实际值。</p><div class="assertion-scroll"><div v-for="(item, index) in draft.assertions" :key="item.id" class="assertion-row"><input v-model="item.enabled" type="checkbox" :aria-label="`启用断言 ${index + 1}`" /><select v-model="item.type" :aria-label="`断言类型 ${index + 1}`"><option v-for="[value, label] in assertionTypes" :key="value" :value="value">{{ label }}</option></select><input v-model="item.target" :disabled="!['jsonpath', 'header'].includes(item.type)" :placeholder="item.type === 'jsonpath' ? '$.data.id' : item.type === 'header' ? 'Content-Type' : '无需目标'" :aria-label="`断言目标 ${index + 1}`" /><select v-model="item.operator" :aria-label="`断言运算符 ${index + 1}`"><option v-for="[value, label] in operators" :key="value" :value="value">{{ label }}</option></select><input v-model="item.expected" :disabled="['exists', 'isArray'].includes(item.operator)" placeholder="预期值" :aria-label="`断言预期值 ${index + 1}`" /><button class="icon-button" :aria-label="`删除断言 ${index + 1}`" @click="draft.assertions.splice(index, 1)"><Icon name="trash" :size="15" /></button></div></div><button class="text-button" @click="draft.assertions.push(assertion())"><Icon name="plus" :size="15" />添加断言</button></template>
        <template v-if="tab === 'extractions'"><p class="editor-hint">从响应 JSON 提取值，写入当前环境，供后续请求使用。</p><div v-for="(item, index) in draft.extractions" :key="item.id" class="extraction-row"><input v-model="item.enabled" type="checkbox" :aria-label="`启用变量提取 ${index + 1}`" /><input v-model="item.name" placeholder="变量名，例如 token" :aria-label="`提取变量名 ${index + 1}`" /><input v-model="item.path" placeholder="JSONPath，例如 $.data.token" :aria-label="`提取 JSONPath ${index + 1}`" /><button class="icon-button" :aria-label="`删除变量提取 ${index + 1}`" @click="draft.extractions.splice(index, 1)"><Icon name="trash" :size="15" /></button></div><button class="text-button" @click="draft.extractions.push({ id: uid(), name: '', path: '$.', enabled: true })"><Icon name="plus" :size="15" />添加提取规则</button></template>
        <div class="editor-note"><Icon name="globe" :size="15" /><span>支持 <code v-pre>{{baseUrl}}</code>、<code v-pre>{{token}}</code> 等环境变量，发送前自动替换。</span></div>
      </div><div class="request-options"><label>超时 <input v-model.number="draft.timeoutMs" type="number" min="1" max="60000" aria-label="请求超时时间" /> ms</label><label><input v-model="draft.followRedirects" type="checkbox" />跟随重定向</label></div></section>
      <section class="card response-card" aria-live="polite"><div v-if="sending" class="response-empty"><div class="empty-icon"><Icon name="loader" :size="27" class="spin" /></div><h3>正在发送请求</h3><p>等待目标服务响应…</p></div><div v-else-if="error" class="response-empty error-state"><div class="empty-icon"><Icon name="alert" :size="27" /></div><h3>请求未完成</h3><p>{{ error }}</p><button class="button" @click="send">重试请求</button></div><div v-else-if="!response" class="response-empty"><div class="empty-icon"><Icon name="send" :size="29" /></div><h3>发送请求，查看响应</h3><p>真实请求 · JSONPath 断言 · 环境变量提取</p><span class="keyboard-hint">填写地址后按 Enter 即可发送</span></div>
        <template v-else><div class="response-summary"><h2>响应结果</h2><div class="response-metrics"><span :class="['badge', response.status < 400 ? 'good' : 'bad']">{{ response.status }} {{ response.statusText }}</span><span><Icon name="clock" :size="14" />{{ response.durationMs }} ms</span><span>{{ sizeLabel(response.sizeBytes) }}</span></div></div><div class="tabs response-tabs"><button v-for="[key, label] in [['body', '响应体'], ['headers', '响应头'], ['assertions', '断言结果'], ['request', '实际请求'], ['variables', '提取变量']]" :key="key" :class="{ active: responseTab === key }" @click="responseTab = key">{{ label }}<span v-if="key === 'assertions' && response.assertions.length" :class="['tiny-count', { danger: failed }]">{{ response.assertions.length - failed }}/{{ response.assertions.length }}</span></button><button class="icon-button copy-response" aria-label="复制响应内容" @click="copy(prettyBody)"><Icon name="copy" :size="15" /></button></div><div class="response-content"><template v-if="responseTab === 'body'"><div v-if="response.truncated" class="inline-warning">响应超过 2 MB，仅展示前 2 MB 内容。</div><pre class="code-output">{{ prettyBody || '（空响应体）' }}</pre></template><div v-if="responseTab === 'headers'" class="response-pairs"><div v-for="(value, key) in response.headers" :key="key"><code>{{ key }}</code><span>{{ value }}</span></div></div><template v-if="responseTab === 'assertions'"><p v-if="!response.assertions.length" class="muted">此请求未配置启用的断言。</p><div v-for="item in response.assertions" :key="item.id" class="assertion-result"><Icon :name="item.passed ? 'success' : 'alert'" :class="item.passed ? 'text-good' : 'text-bad'" :size="17" /><div><strong>{{ assertionTypes.find(t => t[0] === item.type)?.[1] }} {{ item.target }}</strong><p>预期：{{ operators.find(o => o[0] === item.operator)?.[1] }} {{ item.expected }} · 实际：{{ item.actual }}</p><p v-if="item.error" class="text-bad">{{ item.error }}</p></div><span :class="['badge', item.passed ? 'good' : 'bad']">{{ item.passed ? '通过' : '失败' }}</span></div></template><pre v-if="responseTab === 'request'" class="code-output">{{ JSON.stringify(response.request, null, 2) }}</pre><template v-if="responseTab === 'variables'"><p v-if="!response.extractionResults.length" class="muted">此请求未配置变量提取规则。</p><div v-for="item in response.extractionResults" :key="item.name" class="assertion-result"><Icon :name="item.error ? 'alert' : 'success'" :class="item.error ? 'text-bad' : 'text-good'" :size="17" /><div><strong>{{ item.name }} <code>{{ item.path }}</code></strong><p>{{ item.error || '已写入当前环境：' + item.value }}</p></div></div></template></div></template>
      </section>
    </div></div>
    <Modal v-if="modal === 'save'" title="保存接口用例" @close="closeModal"><label class="field">用例名称<input v-model="saveName" placeholder="例如：用户列表 · 默认分页" @keydown.enter="save" /></label><p class="muted help">请求、断言和提取规则将保存在当前浏览器。</p><template #footer><button class="button" @click="closeModal">取消</button><button class="button primary" @click="save">保存用例</button></template></Modal>
    <Modal v-if="['spec', 'curl'].includes(modal)" :title="modal === 'curl' ? '导入 cURL 请求' : '导入接口定义'" wide @close="closeModal"><p class="muted help">{{ modal === 'curl' ? '粘贴单个 cURL 命令，解析后可继续编辑。不会执行 Shell 命令。' : '支持 OpenAPI / Swagger / Postman JSON。Apifox 请导出为 OpenAPI 或 Postman 格式。' }}</p><label v-if="modal === 'spec'" class="file-picker"><Icon name="upload" :size="17" />选择 JSON 文件<input type="file" accept=".json,application/json" aria-label="选择接口定义文件" @change="readFile" /></label><textarea v-model="importText" class="code-editor import-editor" :aria-label="modal === 'curl' ? 'cURL 命令' : '接口定义 JSON'" :placeholder="modal === 'curl' ? `curl 'https://example.com/api' -H 'Accept: application/json'` : '在此粘贴 JSON 内容，或选择文件'" @input="imported = undefined"></textarea><div v-if="importError" class="error-banner" role="alert">{{ importError }}</div><div v-if="imported" class="import-preview"><strong>{{ imported.format }} · 已解析 {{ imported.cases.length }} 条接口</strong><ul><li v-for="item in imported.cases.slice(0, 8)" :key="item.id"><code>{{ item.method }}</code>{{ item.name }}</li></ul><p v-for="warning in imported.warnings" :key="warning" class="inline-warning">{{ warning }}</p><label v-if="Object.keys(imported.variables).length" class="checkbox-label"><input v-model="importVariables" type="checkbox" />将文件内环境变量合并到当前环境（同名变量会覆盖）</label></div><template #footer><button class="button" @click="closeModal">取消</button><button v-if="!imported" class="button primary" :disabled="importBusy || !importText.trim()" @click="parse"><Icon v-if="importBusy" name="loader" class="spin" />解析{{ modal === 'curl' ? '命令' : '文件' }}</button><button v-else class="button primary" @click="confirmImport">{{ modal === 'curl' ? '载入请求' : '确认导入' }}</button></template></Modal>
    <Modal v-if="modal === 'collection'" title="Newman 集合回归" wide @close="closeModal"><div class="regression-environment"><EnvironmentPicker compact /><span class="muted help">按列表顺序执行，提取的变量可用于后续请求。</span></div><div v-if="!data.requests.length" class="small-empty">请先保存或导入接口用例。</div><template v-else><label class="checkbox-label select-all"><input v-model="selectedAll" type="checkbox" :disabled="collectionBusy" />全选 {{ data.requests.length }} 条用例</label><div class="regression-cases"><label v-for="item in data.requests" :key="item.id" class="checkbox-label"><input v-model="selected" type="checkbox" :value="item.id" :disabled="collectionBusy" /><span :class="['method-mini', item.method.toLowerCase()]">{{ item.method }}</span>{{ item.name }}</label></div></template><div v-if="collectionError" class="error-banner">{{ collectionError }}</div><div v-if="collectionResult" class="regression-results"><div class="result-heading"><h3>回归结果</h3><span :class="['badge', collectionResult.passed === collectionResult.total ? 'good' : 'bad']">{{ collectionResult.passed }}/{{ collectionResult.total }} 通过</span><span class="muted help">{{ collectionResult.durationMs }} ms · {{ collectionResult.engine }}</span></div><div v-for="item in collectionResult.results" :key="item.id" class="regression-result"><button class="result-toggle" @click="expandedResult = expandedResult === item.id ? '' : item.id"><Icon :name="item.passed ? 'success' : 'alert'" :class="item.passed ? 'text-good' : 'text-bad'" :size="17" /><strong>{{ item.name }}</strong><span class="muted">{{ item.status || '执行失败' }}</span><Icon name="down" :size="15" /></button><div v-if="expandedResult === item.id" class="regression-detail"><p v-if="item.error" class="text-bad">{{ item.error }}</p><p v-for="a in item.assertions" :key="a.id" :class="a.passed ? 'text-good' : 'text-bad'">{{ a.passed ? '通过' : '失败' }} · {{ a.type }} {{ a.target }} · 预期 {{ a.expected }} / 实际 {{ a.actual }} {{ a.error }}</p><p v-for="e in item.extractionResults" :key="e.name" :class="e.error ? 'text-bad' : ''">变量 {{ e.name }}：{{ e.error || e.value }}</p><pre v-if="item.body" class="code-output">{{ item.body }}</pre></div></div></div><template #footer><button class="button" @click="closeModal">关闭</button><button v-if="collectionBusy" class="button" @click="collectionController?.abort()">取消执行</button><button class="button primary" :disabled="collectionBusy || !selected.length" @click="runCollection"><Icon :name="collectionBusy ? 'loader' : 'play'" :class="{spin: collectionBusy}" />{{ collectionBusy ? '正在回归…' : '运行所选用例' }}</button></template></Modal>
  </div>
</template>
