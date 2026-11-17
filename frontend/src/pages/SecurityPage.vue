<script setup lang="ts">
import { computed, ref } from 'vue';
import { clone } from '../model';
import { useExecution, savePreset, downloadJson, type SecurityResult } from '../execution';
import Icon from '../components/Icon.vue';
import EnvironmentPicker from '../components/EnvironmentPicker.vue';
import PresetBar from '../components/PresetBar.vue';
import ExecutionStatus from '../components/ExecutionStatus.vue';
import ExecutionHistory from '../components/ExecutionHistory.vue';
const groups = [
  { id: 'headers', title: '响应头策略', detail: 'CSP、页面嵌入、nosniff、HSTS' },
  { id: 'cookies', title: 'Cookie 属性', detail: '会话标识与 Secure / HttpOnly / SameSite' },
  { id: 'exposure', title: 'Spring / 配置暴露', detail: 'Actuator env、环境文件、OpenAPI 文档' },
  { id: 'reflection', title: '输入反射线索', detail: '无脚本 HTML 标签的反射，结果需复核' },
  { id: 'sql', title: '异常信息泄露', detail: '数据库异常与 Java / Spring 堆栈特征' },
  { id: 'cors', title: '跨源访问策略', detail: 'Origin、允许来源与凭据组合' },
  { id: 'redirect', title: '外部重定向', detail: '检查 next / redirect，不跟随外部跳转' },
  { id: 'fingerprint', title: '服务端指纹', detail: 'Server 与 X-Powered-By 信息' },
];
const draft = ref({ name: 'HTTP / Spring 安全基线', url: '{{baseUrl}}/', checks: groups.map(g => g.id), active: false, authorized: false, parameter: 'q' });
const presetId = ref(''), filter = ref('ALL');
const { job, result, busy, error, run, cancel, loadHistory } = useExecution<SecurityResult>('security');
const labels: Record<string, string> = { PASS: '通过', RISK: '发现风险', REVIEW: '待人工确认', SKIPPED: '未检查 / 不适用', ERROR: '检查失败' };
const severity: Record<string, string> = { high: '高', medium: '中', low: '低', info: '信息' };
const findings = computed(() => result.value?.findings || []);
const filtered = computed(() => findings.value.filter(f => filter.value === 'ALL' || f.status === filter.value));
const count = (status: string) => findings.value.filter(f => f.status === status).length;
function save() { presetId.value = savePreset('security', draft.value.name, draft.value, presetId.value) || ''; }
function load(payload: typeof draft.value, id: string) { draft.value = clone(payload); draft.value.authorized = false; presetId.value = id; }
</script>
<template><div class="page lab-page"><div class="page-heading"><div><div class="eyebrow">HTTP + SPRING BOOT BASELINE</div><h1>安全测试</h1><p>从配置基线到证据复核，区分实际风险、观察线索与尚未覆盖的检查。</p></div><div class="page-actions"><EnvironmentPicker compact /><button class="button" @click="save"><Icon name="save" />保存检查方案</button><button class="button primary" :disabled="busy || !draft.checks.length" @click="run(draft)"><Icon :name="busy ? 'loader' : 'security'" :class="{spin: busy}" />{{ busy ? '正在检查' : '开始检查' }}</button></div></div><PresetBar kind="security" @load="load" />
  <section class="card security-target"><div class="security-target-icon"><Icon name="security" :size="24" /></div><label class="field">检查方案<input v-model="draft.name" aria-label="安全检查方案名称" /></label><label class="field security-url">目标地址<input v-model="draft.url" aria-label="安全目标地址" class="mono" placeholder="{{baseUrl}}/" /></label><span class="baseline-label">基线检查<br /><small>不生成“系统无漏洞”的结论</small></span></section>
  <div class="security-workspace"><section class="card lab-panel security-checks"><div class="section-title"><h2>检查范围</h2><span class="count">{{ draft.checks.length }}/8 组</span></div><label v-for="group in groups" :key="group.id" class="security-check-item"><input v-model="draft.checks" type="checkbox" :value="group.id" /><span><strong>{{ group.title }}</strong><small>{{ group.detail }}</small></span></label><div class="active-probe-control"><label class="checkbox-label"><input v-model="draft.active" type="checkbox" aria-label="启用轻量主动探测" />启用轻量主动探测</label><p>额外发送少量 GET 请求；不执行脚本、不爬取全站、不进行破坏性测试。</p><template v-if="draft.active"><label class="field">目标使用的 Query 参数<input v-model="draft.parameter" aria-label="安全探测参数名称" placeholder="q" /></label><label class="checkbox-label"><input v-model="draft.authorized" type="checkbox" />我已获得此目标的测试授权</label></template></div><p class="lab-footnote">未启用主动探测时，配置路径、输入反射和外部跳转会标记为未检查，不会计为通过。</p></section>
  <section class="card lab-panel security-report"><div class="section-title"><div><h2>证据与修复建议</h2><p v-if="result" class="executed-target">执行目标：{{ result.url }}</p></div><button v-if="job && !busy" class="button small" @click="downloadJson(job, `security-${job.id}.json`)">导出检查报告</button></div><ExecutionStatus :job="job" :busy="busy" :error="error" @cancel="cancel" /><div class="security-summary"><div><strong class="text-bad">{{ result ? count('RISK') : '—' }}</strong><span>已观察风险</span></div><div><strong class="text-review">{{ result ? count('REVIEW') : '—' }}</strong><span>待人工确认</span></div><div><strong>{{ result ? count('PASS') : '—' }}</strong><span>本次通过</span></div><div><strong>{{ result?.score ?? '—' }}<small v-if="result?.score != null">/100</small></strong><span>配置基线分</span></div></div><p v-if="result?.scoreRule" class="score-explanation">{{ result.scoreRule }}</p><div v-if="!result" class="security-empty"><div class="security-evidence-mark"><Icon name="security" :size="28" /></div><h3>每一项结论都要有证据</h3><p>运行后展示实际响应、适用条件与修复建议。未执行的检查不会预先显示为安全。</p><div class="evidence-flow"><span>选择范围</span><Icon name="arrow" :size="14" /><span>观察响应</span><Icon name="arrow" :size="14" /><span>人工复核</span></div></div><template v-else><div class="finding-filters"><button v-for="[value, label] in [['ALL','全部'],['RISK','风险'],['REVIEW','待确认'],['PASS','通过'],['SKIPPED','未检查'],['ERROR','失败']]" :key="value" :class="{active: filter === value}" @click="filter = value">{{ label }}<span>{{ value === 'ALL' ? findings.length : count(value) }}</span></button></div><div class="findings-list"><details v-for="item in filtered" :key="item.id" :class="['finding', item.status.toLowerCase()]" :open="['RISK','REVIEW','ERROR'].includes(item.status)"><summary><Icon :name="item.status === 'PASS' ? 'success' : item.status === 'SKIPPED' ? 'clock' : 'alert'" :size="16" /><span>{{ item.title }}</span><span :class="['severity', item.severity]">{{ severity[item.severity] }}</span><span class="finding-status">{{ labels[item.status] }}</span><Icon name="down" :size="13" /></summary><div class="finding-details"><h4>观察证据</h4><pre>{{ item.evidence }}</pre><h4>建议与边界</h4><p>{{ item.recommendation }}</p></div></details><p v-if="!filtered.length" class="muted help">当前筛选下没有检查项。</p></div></template></section></div><ExecutionHistory kind="security" @select="loadHistory" />
</div></template>
