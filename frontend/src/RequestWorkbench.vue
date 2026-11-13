<script setup>
import {uuid} from './services/uuid';
import { ref, watch, onBeforeUnmount } from "vue";
import { ElMessage } from "element-plus";
import DualEditor from "./components/DualEditor.vue";
import KeyValueEditor from "./components/KeyValueEditor.vue";
import AssertionEditor from "./AssertionEditor.vue";
import {
  clone,
  requestModel,
  simulateRequest,
  resolvedRequestUrl,
} from "./config";
import { requestSeed } from "./preview";
const props = defineProps({ state: { type: Object, required: true } });
import { useRoute } from "vue-router";
import {useWorkspace} from './context';
import {executeRequest,isCancelled} from './api';
const {commit,upsert}=useWorkspace();
const saving=ref(false),sending=ref(false),sendError=ref(''),source=ref(''),loaded=ref(null);
const controller=new AbortController();
onBeforeUnmount(()=>controller.abort());
const route = useRoute();
function initialRequest() {
  const site = props.state.sites.find(item => item.id === route.query.siteId);
  const env = site && props.state.environments.find(item => item.siteId === site.id);
  return { ...clone(requestSeed), siteId: site?.id || "", environmentId: env?.id || "",
    url: env ? "{{baseUrl}}/" : site?.baseUrl || "http://127.0.0.1:4000/" };
}
const model = ref(initialRequest()),
  editor = ref(null),
  result = ref(null),
  fixture = ref("html"),
  tab = ref("query"),
  responseTab = ref("body");
function resolve() {
  const value = editor.value.resolve();
  return value;
}
async function sendReal(){
  if(sending.value)return;
  sending.value=true;sendError.value='';result.value=null;source.value='真实请求';
  try{
    const definition=resolve();
    const url=resolvedRequestUrl({...definition,query:[]},props.state.environments.find(e=>e.id===definition.environmentId));
    result.value={...await executeRequest(definition,url,controller.signal),definition};
    props.state.httpHistory.unshift({...clone(result.value),source:"真实请求"});
  }catch(e){if(!isCancelled(e))sendError.value=[e.code,e.message,e.traceId].filter(Boolean).join(' · ');}
  finally{sending.value=false;}
}
function send() {
  source.value='本地模拟';sendError.value='';
  try {
    const request = resolve();
    const environment = props.state.environments.find(
      (env) => env.id === request.environmentId,
    );
    const url = resolvedRequestUrl(request, environment);
    result.value = {
      ...simulateRequest(request, fixture.value),
      resolvedUrl: url,
    };
    props.state.httpHistory.unshift({...clone(result.value),source:"本地模拟"});
    ElMessage.success("本地响应与断言已生成");
  } catch (e) {
    ElMessage.error(e.message);
  }
}
async function save() {
  if(saving.value)return; saving.value=true;
  try {
    const definition = resolve();
    const row={id:loaded.value?.id||"REQ-"+uuid(),revision:loaded.value?.revision??0,version:(loaded.value?.version??0)+1,name:definition.name,definition:clone(definition)};
    await commit([upsert("requests",row)]);
    loaded.value=props.state.requests.find(r=>r.id===row.id);
    ElMessage.success("已保存为请求资产");
  } catch (e) {
    ElMessage.error(e.message);
  }finally{saving.value=false;}
}
function load(definition, asset=null) {
  loaded.value=asset;
  model.value = clone(definition);
  result.value = null;
}
watch(() => [route.query.siteId, props.state.sites.find(s=>s.id===route.query.siteId)?.id], () => { if(route.query.siteId)load(initialRequest()); });
defineExpose({ load });
</script>
<template>
  <section class="surface request-workbench">
    <div class="panel-heading">
      <h2>HTTP 请求工作台</h2>
      <button class="link" @click="load(initialRequest())">重置配置</button>
    </div>
    <DualEditor
      ref="editor"
      v-model="model"
      label="请求 JSON"
      :validate="requestModel"
      :parse-draft="value => requestModel(value, { draft: true })"
      ><div class="field-grid">
        <label>请求名称<input v-model="model.name" /></label
        ><label
          >网站<select
            v-model="model.siteId"
            @change="
              model.environmentId =
                state.environments.find((e) => e.siteId === model.siteId)?.id ||
                ''
            "
          >
            <option value="">直接填写 URL</option>
            <option v-for="site in state.sites" :key="site.id" :value="site.id">
              {{ site.name }}
            </option>
          </select></label
        ><label
          >环境<select v-model="model.environmentId" :disabled="!model.siteId">
            <option value="">无环境变量</option>
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
        ><label
          >请求方法<select
            v-model="model.method"
            @change="
              ['GET', 'HEAD'].includes(model.method) &&
              (model.body = { mode: 'NONE' })
            "
          >
            <option
              v-for="method in [
                'GET',
                'POST',
                'PUT',
                'PATCH',
                'DELETE',
                'HEAD',
                'OPTIONS',
              ]"
              :key="method"
            >
              {{ method }}
            </option>
          </select></label
        ><label class="full-field"
          >请求地址<input
            v-model="model.url"
            placeholder="https://… 或环境变量地址"
        /></label>
      </div>
      <div class="tab-strip" role="tablist">
        <button
          v-for="[key, label] in [
            ['query', 'Query 参数'],
            ['headers', 'Headers'],
            ['cookies', 'Cookies'],
            ['body', '请求正文'],
            ['assertions', '断言'],
            ['settings', '执行设置'],
          ]"
          :key="key"
          role="tab"
          :aria-selected="tab === key"
          :class="{ active: tab === key }"
          @click="tab = key"
        >
          {{ label }}
          <small v-if="Array.isArray(model[key])">{{
            model[key].length
          }}</small>
        </button>
      </div>
      <KeyValueEditor
        v-if="tab === 'query'"
        v-model="model.query"
        label="查询参数"
      /><KeyValueEditor
        v-if="tab === 'headers'"
        v-model="model.headers"
        label="请求头"
        separator=":"
      /><KeyValueEditor
        v-if="tab === 'cookies'"
        v-model="model.cookies"
        label="Cookie"
      />
      <div v-if="tab === 'body'">
        <label class="field-label"
          >正文格式<select
            v-model="model.body.mode"
            @change="
              model.body.mode === 'FORM_URLENCODED' &&
              (model.body.fields ??= [])
            "
          >
            <option value="NONE">无正文</option>
            <option value="JSON">JSON</option>
            <option value="FORM_URLENCODED">表单 urlencoded</option>
            <option value="RAW">原始文本</option>
          </select></label
        ><KeyValueEditor
          v-if="model.body.mode === 'FORM_URLENCODED'"
          v-model="model.body.fields"
          label="表单字段"
        /><textarea
          v-if="['JSON', 'RAW'].includes(model.body.mode)"
          v-model="model.body.text"
          class="bulk-text"
          aria-label="请求正文"
          placeholder="输入正文"
        ></textarea>
        <p v-if="['GET', 'HEAD'].includes(model.method)" class="helper">
          GET / HEAD 使用无正文模式。
        </p>
      </div>
      <AssertionEditor v-if="tab === 'assertions'" v-model="model.assertions" />
      <div v-if="tab === 'settings'" class="field-grid">
        <label
          >字符集<select v-model="model.charset">
            <option>UTF-8</option>
            <option>GB18030</option>
          </select></label
        ><label
          >请求超时 / ms<input
            type="number"
            min="1"
            v-model.number="model.timeoutMs" /></label
        ><label class="toggle-field"
          ><input
            type="checkbox"
            v-model="model.followRedirects"
          />跟随重定向</label
        >
      </div></DualEditor
    >
    <div class="workbench-actions">
      <label
        >本地响应情形<select v-model="fixture">
          <option value="html">正常 HTML</option>
          <option value="json">正常 JSON</option>
          <option value="not-found">404 响应</option>
          <option value="timeout">请求超时</option>
        </select></label
      ><button class="button outline" :disabled="saving" @click="save">保存请求</button
      ><button class="button outline" :disabled="sending" @click="send">运行本地调试</button>
      <button class="button" :disabled="sending" @click="sendReal">{{sending?"发送中…":"发送真实请求"}}</button>
    </div>
  </section>
  <section class="surface section-space">
    <div class="panel-heading">
      <h2>响应与断言 <small>{{source}}</small></h2>
      <span v-if="result" class="status neutral"
        >{{ result.transportStatus }} · {{ result.durationMs }} ms</span
      >
    </div>
    <p v-if="sendError" role="alert" class="error-banner">{{sendError}}</p>
    <p v-if="result?.response">HTTP {{result.response.statusCode}}</p>
    <template v-if="result"
      ><div class="tab-strip">
        <button
          v-for="[key, label] in [
            ['body', '响应正文'],
            ['headers', '响应头'],
            ['assertions', '断言结果'],
            ['request', '实际请求'],
          ]"
          :key="key"
          :class="{ active: responseTab === key }"
          @click="responseTab = key"
        >
          {{ label }}
        </button>
      </div>
      <p v-if="result.error" class="text-amber">
        {{ result.error.code }} · {{ result.error.message }}
      </p>
      <pre v-if="responseTab === 'body'" class="parameter-code">{{
        result.response?.bodyText ?? "未收到响应"
      }}</pre>
      <pre v-if="responseTab === 'headers'" class="parameter-code">{{
        JSON.stringify(result.response?.headers ?? [], null, 2)
      }}</pre>
      <pre v-if="responseTab === 'request'" class="parameter-code">{{
        JSON.stringify(
          { resolvedUrl: result.resolvedUrl, ...result.definition },
          null,
          2,
        )
      }}</pre>
      <div v-if="responseTab === 'assertions'" class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>类型 / 目标</th>
              <th>预期</th>
              <th>实际</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in result.assertions" :key="a.id">
              <td>{{ a.type }} {{ a.target }}</td>
              <td>{{ a.expected }}</td>
              <td>{{ a.actual ?? "—" }}</td>
              <td>{{ a.status }}</td>
            </tr>
          </tbody>
        </table>
      </div></template
    >
    <p v-else class="muted">
      填写完整 URL 后点击「发送真实请求」，或选择本地响应情形进行模拟。
    </p>
  </section>
  <section class="surface section-space">
    <div class="panel-heading"><h2>调试历史与请求资产</h2></div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>请求</th>
            <th>方法</th>
            <th>来源</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in [
              ...state.requests,
              ...state.httpHistory.map((h) => ({
                id: h.id,
                name: h.definition.name,
                definition: h.definition,
                outcome: h.source+' · '+h.outcome,
              })),
            ]"
            :key="item.id"
          >
            <td>
              {{ item.name }}<small>{{ item.id }}</small>
            </td>
            <td>{{ item.definition.method }}</td>
            <td>{{ item.outcome ?? "已保存请求" }}</td>
            <td>
              <button class="link" @click="load(item.definition,item.revision?item:null)">
                载入编辑
              </button>
            </td>
          </tr>
          <tr v-if="!state.requests.length && !state.httpHistory.length">
            <td colspan="4">暂无记录</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
