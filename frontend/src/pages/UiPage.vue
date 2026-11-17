<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import EnvironmentPicker from '../components/EnvironmentPicker.vue';
import { data, variables, toast, ask, busyTasks } from '../store';
import { preferences, revealReport } from '../preferences';
import { actions, actionLabel, clone, newUiCase, noSelector, step, uid, type UiCase, type UiResult, type Step } from '../model';
import { execute } from '../client';
import { api } from '../auth';

const draft = ref<UiCase>(newUiCase()), result = ref<UiResult>(), running = ref(false), error = ref('');
const modal = ref(''), composeText = ref(''), composing = ref(false), composed = ref<{ steps: Step[]; unmatched: string[]; engine: string }>();
const composeError = ref(''), inspectResult = ref<any>(), inspecting = ref(false), inspectError = ref(''), selectedImage = ref('');
const aiConfigured=ref(false);
let controller: AbortController | undefined, inspectController: AbortController | undefined;
const passed = computed(() => result.value?.steps.filter(s => s.status === 'PASSED').length || 0);
watch([running,inspecting,composing],()=>{busyTasks.ui=running.value||inspecting.value||composing.value;});
watch(result,value=>{if(value){if(preferences.notifyFailure&&!value.passed)toast('UI 流程存在失败，请查看步骤证据',true);revealReport('.ui-results');}});
onBeforeUnmount(()=>{delete busyTasks.ui;});
const actionPlaceholder = (action: string) => ({ goto: 'https://… 或 {{baseUrl}}/path', fill: '要输入的文本', wait: '等待毫秒，例如 1000', press: 'Enter / Tab / Control+A', assertText: '期望包含的文本', assertUrl: '期望包含的地址', assertTitle: '期望包含的标题', assertCount: '期望元素数量', select: 'option 的 value', scroll: '滚动像素，例如 600' }[action] || '此操作无需填写值');
function fresh() { controller?.abort(); draft.value = newUiCase(); result.value = undefined; error.value = ''; }
function load(value: UiCase) { controller?.abort(); draft.value = clone(value); result.value = undefined; error.value = ''; }
async function remove(id: string) { if (!await ask('删除这条 UI 用例？')) return; data.uiCases = data.uiCases.filter(c => c.id !== id); if (draft.value.id === id) fresh(); }
function save() {
  if (!draft.value.name.trim() || !draft.value.url.trim()) return toast('请填写用例名称和起始地址', true);
  if (!draft.value.steps.length) return toast('请至少添加一个步骤', true);
  const saved = clone(draft.value); saved.id ||= uid(); saved.name = saved.name.trim();
  const index = data.uiCases.findIndex(c => c.id === saved.id);
  if (index < 0) data.uiCases.push(saved); else data.uiCases[index] = saved;
  draft.value = clone(saved); toast('UI 用例已保存');
}
function move(index: number, offset: number) {
  const target = index + offset; if (target < 0 || target >= draft.value.steps.length) return;
  const value = draft.value.steps[index]!; draft.value.steps.splice(index, 1); draft.value.steps.splice(target, 0, value);
}
async function template(kind: string) {
  if (draft.value.steps.length > 1 && !await ask('用模板替换当前步骤？')) return;
  const next = newUiCase();
  if (kind === 'search') {
    next.name = '搜索流程'; next.url = '{{baseUrl}}/';
    next.steps = [step('goto', '', '{{baseUrl}}/'), step('fill', 'input[type="search"]', '关键词'), step('press', 'input[type="search"]', 'Enter'), step('assertVisible', '.search-results')];
  } else {
    next.name = kind === 'empty' ? '登录页 · 空密码校验' : '登录页 · 正常登录'; next.url = '{{baseUrl}}/#/login';
    next.steps = [step('goto', '', next.url), step('fill', '#username', '{{username}}'), step('fill', '#password', kind === 'empty' ? '' : '{{password}}'), step('click', '#login-submit'), ...(kind === 'empty' ? [step('assertVisible', '.form-error')] : [step('waitFor', '.user-chip'), step('assertText', '.user-chip', '{{username}}')])];
  }
  draft.value = next; result.value = undefined; error.value = '';
  toast('模板已载入，请按目标网站调整选择器与环境变量');
}
async function run() {
  if (running.value) return;
  running.value = true; error.value = ''; result.value = undefined; controller = new AbortController(); const currentController = controller;
  try { const request=clone(draft.value); const value = await execute<UiResult>('ui/run', { draft: request, variables: clone(variables.value) }, controller.signal); if (!currentController.signal.aborted) {
    result.value = value;
    data.uiHistory.unshift({id:uid(),name:request.name,time:new Date().toISOString(),passed:value.passed,durationMs:value.durationMs,url:value.url,steps:value.steps.map(({index,action,selector,status,error})=>({index,action,selector,status,error}))});
    data.uiHistory=data.uiHistory.slice(0,10);
  } }
  catch (e) { if (!currentController.signal.aborted) error.value = (e as Error).message; }
  finally { if (controller === currentController) running.value = false; }
}
function cancel() { controller?.abort(); running.value = false; error.value = '执行已取消'; }
async function inspect() {
  modal.value = 'inspect'; inspectResult.value = undefined; inspectError.value = ''; inspecting.value = true; inspectController = new AbortController();
  try { inspectResult.value = await execute('ui/inspect', { url: draft.value.url, variables: clone(variables.value) }, inspectController.signal); }
  catch (e) { inspectError.value = inspectController.signal.aborted ? '页面分析已取消' : (e as Error).message; }
  finally { inspecting.value = false; }
}
function addElement(element: { tag: string; type: string; selector: string; unique: boolean }) {
  const action = ['input', 'textarea'].includes(element.tag) ? ['checkbox', 'radio'].includes(element.type) ? 'check' : 'fill' : element.tag === 'select' ? 'select' : 'click';
  draft.value.steps.push(step(action, element.unique ? element.selector : element.selector + ' >> nth=0'));
  toast('已添加步骤，请核对选择器和输入值');
}
async function openCompose() {
  modal.value = 'compose'; composed.value = undefined; composeError.value = ''; aiConfigured.value=false;
  try { aiConfigured.value=(await api('platform/settings')).ai.configured; if(!aiConfigured.value)composeError.value='请先由测试负责人在平台设置中配置 OpenAI 或 Anthropic API 密钥。'; }
  catch(e){composeError.value=(e as Error).message;}
}
async function compose() {
  composing.value = true; composeError.value = ''; composed.value = undefined;
  try { composed.value = await execute('ui/compose', { text: composeText.value }); }
  catch (e) { composeError.value = (e as Error).message; } finally { composing.value = false; }
}
async function applyComposed() {
  if (!composed.value?.steps.length || composed.value.unmatched.length) return;
  if (draft.value.steps.length > 1 && !await ask('用生成结果替换当前步骤？')) return;
  draft.value.steps = composed.value.steps.map(s => ({ ...s, id: uid() })); result.value = undefined; modal.value = ''; toast('步骤已生成，请核对后运行');
}
function showImage(image: string) { selectedImage.value = image; modal.value = 'screenshot'; }
function closeModal() { if (inspecting.value) inspectController?.abort(); modal.value = ''; }
function cleanup() { controller?.abort(); inspectController?.abort(); running.value = false; }
onDeactivated(cleanup); onBeforeUnmount(cleanup);
</script>
<template>
  <div class="page">
    <div class="page-heading"><div><div class="eyebrow">BROWSER AUTOMATION</div><h1>UI 自动化</h1><p>用真实浏览器执行界面流程，让每一步操作与验证都清晰可见。</p></div><div class="page-actions"><EnvironmentPicker compact /><button class="button" :disabled="inspecting" @click="inspect"><Icon name="search" />分析页面</button><button class="button" @click="openCompose"><Icon name="sparkles" />AI 编排</button><button class="button" @click="save"><Icon name="save" />保存</button><button v-if="!running" class="button primary" @click="run"><Icon name="play" />运行</button><button v-else class="button primary" @click="cancel"><Icon name="close" />取消</button></div></div>
    <div class="workbench-grid ui-grid"><aside class="card collection-card ui-collection"><div class="section-title"><h2>UI 用例 <span class="count">{{ data.uiCases.length }}</span></h2><button class="icon-button" aria-label="新建 UI 用例" title="新建 UI 用例" @click="fresh"><Icon name="plus" /></button></div><div class="case-list"><div v-if="!data.uiCases.length" class="small-empty"><Icon name="ui" :size="26" /><span>还没有 UI 用例</span><span class="help muted">编写步骤，或从模板开始</span></div><div v-for="item in data.uiCases" :key="item.id" :class="['case-row', {selected: draft.id === item.id}]"><button class="case-main" @click="load(item)"><Icon name="ui" :size="16" /><span class="truncate">{{ item.name }}</span></button><button class="icon-button case-delete" :aria-label="`删除用例 ${item.name}`" @click="remove(item.id)"><Icon name="trash" :size="14" /></button></div></div><div class="panel-divider"></div><h3 class="mini-label">快速模板</h3><div class="template-list"><button class="button small" @click="template('login')">登录流程<Icon name="arrow" :size="14" /></button><button class="button small" @click="template('search')">搜索流程<Icon name="arrow" :size="14" /></button><button class="button small" @click="template('empty')">空密码校验<Icon name="arrow" :size="14" /></button></div><p class="muted help template-note">模板中的地址、选择器和变量需要与实际被测页面对应。</p></aside>
      <div class="workbench-main"><section class="card ui-editor"><div class="two-fields ui-name-fields"><label class="field">用例名称<input v-model="draft.name" aria-label="UI 用例名称" placeholder="给这条流程起个名字" /></label><label class="field">起始地址<input v-model="draft.url" aria-label="UI 起始地址" class="mono" spellcheck="false" placeholder="https://… 或 {{baseUrl}}/" /></label></div><div class="viewport-controls"><span class="muted">视口</span><input v-model.number="draft.width" type="number" min="320" max="3840" aria-label="视口宽度" /><span class="muted">×</span><input v-model.number="draft.height" type="number" min="240" max="2160" aria-label="视口高度" /><label class="checkbox-label stop-control"><input v-model="draft.stopOnFailure" type="checkbox" role="switch" />失败即停</label><span class="badge soft step-count">{{ draft.steps.length }} 个步骤</span></div><div class="compose-note"><Icon name="sparkles" :size="17" /><span>用简短的自然语言描述操作，快速编排步骤。</span><button class="text-button" @click="openCompose">自然语言生成<Icon name="arrow" :size="14" /></button></div>
        <div class="steps-scroll"><div class="step-list"><div v-for="(item, index) in draft.steps" :key="item.id" class="step-row"><span class="step-index">{{ String(index + 1).padStart(2, '0') }}</span><select v-model="item.action" :aria-label="`步骤 ${index + 1} 操作`"><option v-for="[value, label] in actions" :key="value" :value="value">{{ label }}</option></select><input v-model="item.selector" :disabled="noSelector(item.action)" :placeholder="noSelector(item.action) ? '无需选择器' : 'CSS 选择器，例如 #username'" :aria-label="`步骤 ${index + 1} 选择器`" spellcheck="false" /><input v-model="item.value" :placeholder="actionPlaceholder(item.action)" :aria-label="`步骤 ${index + 1} 值`" spellcheck="false" /><div class="step-tools"><button class="icon-button" :disabled="index === 0" :aria-label="`上移步骤 ${index + 1}`" @click="move(index, -1)"><Icon name="up" :size="14" /></button><button class="icon-button" :disabled="index === draft.steps.length - 1" :aria-label="`下移步骤 ${index + 1}`" @click="move(index, 1)"><Icon name="down" :size="14" /></button><button class="icon-button" :aria-label="`删除步骤 ${index + 1}`" @click="draft.steps.splice(index, 1)"><Icon name="trash" :size="14" /></button></div></div></div></div><div v-if="!draft.steps.length" class="small-empty">添加操作步骤，开始编写流程。</div><button class="text-button add-step" @click="draft.steps.push(step())"><Icon name="plus" :size="16" />添加步骤</button>
      </section>
      <section class="card ui-results" aria-live="polite"><div class="response-summary"><div><h2>执行结果</h2><p class="muted help">Playwright 真实浏览器 · 步骤耗时 · 失败截图</p></div><span v-if="result" :class="['badge', result.passed ? 'good' : 'bad']">{{ result.passed ? '全部通过' : '执行失败' }}</span></div><div v-if="running" class="ui-result-empty"><Icon name="loader" :size="25" class="spin" /><div><strong>浏览器正在执行流程</strong><p class="muted help">完成后展示逐步结果与截图，可随时取消。</p></div></div><div v-else-if="error" class="error-banner" role="alert">{{ error }}</div><div v-else-if="!result" class="ui-result-empty"><div class="empty-icon small"><Icon name="play" :size="22" /></div><div><strong>准备就绪，等待运行</strong><p class="muted help">配置目标地址和步骤，点击右上角「运行」。</p></div></div><template v-else><div class="ui-result-metrics"><span><strong>{{ passed }}</strong> / {{ result.steps.length }} 步通过</span><span><Icon name="clock" :size="15" />{{ result.durationMs }} ms</span><span class="truncate" :title="result.url">{{ result.title || result.url }}</span></div><div class="step-results"><div v-for="item in result.steps" :key="item.index" :class="['step-result', item.status.toLowerCase()]"><span class="step-result-index">{{ item.index }}</span><Icon :name="item.status === 'PASSED' ? 'success' : item.status === 'FAILED' ? 'alert' : 'clock'" :size="17" /><div class="step-result-detail"><strong>{{ actionLabel(item.action) }} <code>{{ item.selector }}</code></strong><p v-if="item.error" class="text-bad">{{ item.error }}</p><p v-else-if="item.value" class="muted help">{{ item.value }}</p></div><span class="muted help">{{ item.status === 'SKIPPED' ? '已跳过' : item.durationMs + ' ms' }}</span><button v-if="item.screenshot" class="text-button" @click="showImage(item.screenshot)">查看截图</button></div></div><div v-if="result.screenshot" class="final-screenshot"><div class="section-title"><h3>最终页面</h3><button class="text-button" @click="showImage(result!.screenshot!)">查看大图<Icon name="arrow" :size="14" /></button></div><button class="screenshot-button" aria-label="查看最终页面截图" @click="showImage(result!.screenshot!)"><img :src="result.screenshot" alt="UI 自动化执行后的真实页面截图" /></button></div></template></section>
    </div></div>
    <Modal v-if="modal === 'compose'" title="自然语言编排" wide @close="closeModal"><div class="inline-note"><Icon name="sparkles" :size="17" /><div><strong>远程 API 引擎</strong><p class="muted help">需要先在平台设置中配置 OpenAI 或 Anthropic API 密钥。明确写出选择器，生成后核对步骤再运行。</p></div></div><textarea v-model="composeText" class="code-editor compose-input" aria-label="流程描述" placeholder="打开 {{baseUrl}}/#/login&#10;#username 输入 {{username}}&#10;#password 输入 {{password}}&#10;点击 #login-submit&#10;等待元素 .user-chip&#10;断言 .user-chip 包含 {{username}}&#10;截图" @input="composed = undefined"></textarea><div v-if="composeError" class="error-banner">{{ composeError }}</div><div v-if="composed" class="compose-preview"><strong>识别到 {{ composed.steps.length }} 个步骤</strong><ol><li v-for="(item, index) in composed.steps" :key="index">{{ actionLabel(item.action) }} <code>{{ item.selector || item.value }}</code><span v-if="item.selector && item.value"> {{ item.value }}</span></li></ol><div v-if="composed.unmatched.length" class="inline-warning">以下描述尚不能识别，请按示例调整后重新生成：<ul><li v-for="line in composed.unmatched" :key="line">{{ line }}</li></ul></div><p v-if="!composed.steps.length" class="muted help">未生成步骤，请使用上方示例的表达方式。</p></div><template #footer><button class="button" @click="closeModal">取消</button><button v-if="!composed" class="button primary" :disabled="composing || !aiConfigured || !composeText.trim()" @click="compose"><Icon :name="composing ? 'loader' : 'sparkles'" :class="{spin: composing}" />生成步骤</button><template v-else><button class="button" @click="compose" :disabled="composing">重新生成</button><button class="button primary" :disabled="!composed.steps.length || Boolean(composed.unmatched.length)" @click="applyComposed">应用到当前流程</button></template></template></Modal>
    <Modal v-if="modal === 'inspect'" title="页面元素分析" wide @close="closeModal"><div v-if="inspecting" class="ui-result-empty"><Icon name="loader" class="spin" />正在使用浏览器分析目标页面…</div><div v-if="inspectError" class="error-banner">{{ inspectError }}</div><template v-if="inspectResult"><div class="inspection-heading"><h3>{{ inspectResult.title || '目标页面' }}</h3><p class="muted help">{{ inspectResult.url }}</p></div><p class="muted help">找到 {{ inspectResult.elements.length }} 个交互元素，点击添加为步骤。重复选择器默认选取第一个元素，请核对目标。</p><div class="inspection-elements"><div v-for="(element, index) in inspectResult.elements" :key="index" class="inspection-element"><span class="badge neutral">{{ element.tag }}</span><div><strong>{{ element.text || element.type || '未命名元素' }}</strong><code>{{ element.selector }}{{ element.unique ? '' : '（多匹配）' }}</code></div><button class="button small" @click="addElement(element)"><Icon name="plus" :size="14" />添加步骤</button></div><p v-if="!inspectResult.elements.length" class="muted help">当前页面未找到表单、按钮或链接。</p></div></template><template #footer><button class="button" @click="closeModal">完成</button></template></Modal>
    <Modal v-if="modal === 'screenshot'" title="执行截图" wide @close="closeModal"><img :src="selectedImage" alt="浏览器真实执行截图" class="screenshot-preview" /><template #footer><a :href="selectedImage" download="testpilot-screenshot.png" class="button">下载截图</a><button class="button primary" @click="closeModal">关闭</button></template></Modal>
  </div>
</template>
