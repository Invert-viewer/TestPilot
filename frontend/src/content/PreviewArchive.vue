<script setup>
import {ref,computed} from 'vue';
import {useRouter} from 'vue-router';
import {ElMessage} from 'element-plus';
import {usePreview,toolLabel,stateLabel,download} from '../preview';
import {requestModel} from '../config';
const {state,run}=usePreview(true),router=useRouter();
const go=id=>router.push('/'+id),selected=ref(null),cases=computed(()=>state.value.assertionCases);
function rerun(task) {
  run({
    ...JSON.parse(JSON.stringify(task)),
    name: task.name + " · 复测",
    tool: task.tool,
    siteId: task.siteId,
    environmentId: task.environmentId,
    assetId: task.assetId,
    assetVersion: task.assetVersion,
    parameters: JSON.parse(JSON.stringify(task.parameters)),
    sourceTaskId: task.id,
    requestSnapshots: task.requestSnapshots,
  });
  selected.value = null;
  go("tasks");
}
const caseDetail = ref(null);
const imported = ref(null);
const importInput = ref(null);
const reportCases = computed(() =>
  selected.value?.caseResults
    ? selected.value.caseResults
    : selected.value?.outcome === "FAILED"
      ? cases.value.slice(0, 3)
      : cases.value.slice(0, 3).map((item) => ({
          ...item,
          status: "PASSED",
          actual: item.expected,
        })),
);
function exportReport(format) {
  const task = selected.value;
  const site =
    task.siteSnapshot ||
    state.value.sites.find((item) => item.id === task.siteId);
  const archive = {
    schemaVersion: 1,
    sourceTaskId: task.id,
    exportedAt: new Date().toISOString(),
    previewOnly: true,
    snapshot: {
      site,
      environment: task.environmentSnapshot ||
        state.value.environments.find(
          (env) => env.id === task.environmentId,
        ) || { id: task.environmentId, baseUrl: site.baseUrl },
      tool: task.tool,
      toolVersion: null,
      asset:
        task.assetSnapshot ||
        state.value.assets.find((item) => item.id === task.assetId),
      requests: task.requestSnapshots || state.value.requests,
      parameters: task.parameters,
      dataFile: task.dataFile || null,
      credentialRef: task.credentialRef || null,
    },
    summary: task.summary,
    metrics: null,
    files: [],
  };
  const lines = [
    "# TestPilot 本地演示报告",
    task.name,
    "此文件包含本地示例数据。",
    "任务 " + task.id,
    "工具 " + toolLabel(task.tool),
    "结果 " + stateLabel(task),
    "参数 " + JSON.stringify(task.parameters),
  ];
  if (format === "json")
    download(
      task.id + ".json",
      JSON.stringify(archive, null, 2),
      "application/json",
    );
  else if (format === "md")
    download(task.id + ".md", lines.join("\n\n"), "text/markdown");
  else {
    const escape = (text) =>
      text.replace(
        /[&<>"']/g,
        (char) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[char],
      );
    download(
      task.id + ".html",
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>TestPilot 演示报告</title><style>body{font:18px system-ui;max-width:800px;margin:80px auto;padding:20px;line-height:1.8}h1{font-size:40px}</style><body>' +
        lines
          .map((line, index) =>
            index
              ? "<p>" + escape(line) + "</p>"
              : "<h1>" + escape(line.slice(2)) + "</h1>",
          )
          .join("") +
        "</body></html>",
      "text/html",
    );
  }
}
async function importReport(event) {
  try {
    const file = event.target.files[0];
    if (!file) return;
    const data = JSON.parse(await file.text());
    if (
      data.schemaVersion !== 1 ||
      data.previewOnly !== true ||
      !data.snapshot?.asset ||
      !data.snapshot?.site ||
      !data.snapshot?.parameters
    )
      throw new Error("请选择本预览导出的 JSON 归档");
    if (!["APIFOX_CLI", "JMETER"].includes(data.snapshot.tool))
      throw new Error("无法识别工具");
    if (
      !data.snapshot.environment?.id ||
      !Array.isArray(data.snapshot.requests) ||
      !data.snapshot.requests.length
    )
      throw new Error("归档缺少环境或请求快照");
    data.snapshot.requests.forEach((item) => requestModel(item.definition));
    imported.value = data;
  } catch (error) {
    ElMessage.error(error.message);
  } finally {
    event.target.value = "";
  }
}
function restorePreview() {
  const data = imported.value;
  const snapshot = data.snapshot;
  run({
    name: "导入场景 · 本地复测",
    tool: snapshot.tool,
    siteId: snapshot.site.id,
    environmentId: snapshot.environment.id,
    assetId: snapshot.asset.id,
    assetVersion: snapshot.asset.version,
    parameters: snapshot.parameters,
    sourceTaskId: data.sourceTaskId,
    requestSnapshots: snapshot.requests,
    dataFile: snapshot.dataFile,
    credentialRef: snapshot.credentialRef,
    siteSnapshot: snapshot.site,
    environmentSnapshot: snapshot.environment,
    assetSnapshot: snapshot.asset,
  });
  imported.value = null;
  go("tasks");
}

</script><template>
<details class="surface section-space"><summary>本地演示归档与复测</summary><p class="helper">来源：浏览器演示数据。这里的导出、导入和模拟复测不执行真实工具。</p>
<label class="file-button">导入演示归档 JSON<input type="file" accept=".json" @change="importReport"/></label>
<div v-for="item in state.tasks" :key="item.id" class="check-line"><div>{{item.name}}<small>{{item.id}} · 本地演示 · {{stateLabel(item)}}</small></div><button class="link" @click="selected=item">查看演示报告</button></div></details><el-dialog :model-value="!!selected"
      title="测试报告。"
      width="760px"
      @close="selected = null"
      ><template v-if="selected"
        ><div class="report-heading">
          <h2>{{ selected.name }}</h2>
          <span class="status neutral">{{ stateLabel(selected) }}</span>
        </div>
        <p class="muted">
          {{ selected.id }} · {{ toolLabel(selected.tool) }} · 本地示例
        </p>
        <div class="report-stats">
          <div>
            <strong>{{ selected.summary?.totalCases ?? "—" }}</strong><span
              >全部用例</span
            >
          </div>
          <div>
            <strong>{{ selected.summary?.passedCases ?? "—" }}</strong><span
              >通过</span
            >
          </div>
          <div>
            <strong>{{ selected.summary?.failedCases ?? "—" }}</strong><span
              >失败</span
            >
          </div>
        </div>
        <h3>有效参数</h3>
        <pre class="parameter-code">{{
          JSON.stringify(selected.parameters, null, 2)
        }}</pre>
        <template v-if="selected.status === 'FINISHED'"
          ><h3>结果指标 · 示例口径</h3>
          <dl class="report-metrics">
            <dt>平均 / P95</dt>
            <dd>286 / 312 ms</dd>
            <dt>吞吐量</dt>
            <dd>1 请求/秒 · 串行示例</dd>
            <dt>请求错误率</dt>
            <dd>0% · HTTP 错误与传输失败</dd>
            <dt>整体通过率</dt>
            <dd>
              {{
                Math.round(
                  (selected.summary.passedCases / selected.summary.totalCases) *
                    1000,
                ) / 10
              }}%
            </dd>
            <dt>已评估通过率</dt>
            <dd>
              {{
                Math.round(
                  (selected.summary.passedCases /
                    (selected.summary.passedCases +
                      selected.summary.failedCases)) *
                    1000,
                ) / 10
              }}%
            </dd>
          </dl>
          <h3>断言结果</h3>
          <div
            v-for="item in reportCases"
            :key="item.id"
            class="assertion-line"
          >
            <span>{{ item.name }}</span><span
              >{{ item.expected }} → {{ item.actual }}</span
            ><span
              :class="item.status === 'FAILED' ? 'text-amber' : 'text-green'"
              >{{ item.status === "FAILED" ? "失败" : "通过" }}</span
            >
          </div>
          <div class="export-actions">
            <button
              v-for="format in ['html', 'md', 'json']"
              :key="format"
              class="button outline"
              @click="exportReport(format)"
            >
              导出 .{{ format }}</button
            ><button class="button" @click="rerun(selected)">复测此场景</button>
          </div></template
        >
        <p v-else class="helper">
          任务终态后可查看完成报告。当前显示本地模拟状态。
        </p>
        <h3>状态与日志 · 本地模拟</h3>
        <pre class="parameter-code">
[{{ selected.id }}] 读取本地场景配置
状态 {{ selected.status }}
结论 {{ selected.outcome }}
{{
            selected.status === "FINISHED"
              ? "已生成演示结果，可导出与复测。"
              : "示例状态随任务运行或取消更新。"
          }}</pre>
      </template></el-dialog
    >

<el-dialog :model-value="!!imported"
      title="还原上一次场景。"
      width="560px"
      @close="imported = null"
      ><template v-if="imported"
        ><p>来源 · {{ imported.sourceTaskId }}</p>
        <dl>
          <dt>网站</dt>
          <dd>{{ imported.snapshot.site.name }}</dd>
          <dt>工具</dt>
          <dd>{{ toolLabel(imported.snapshot.tool) }}</dd>
          <dt>资产</dt>
          <dd>{{ imported.snapshot.asset.name }}</dd>
        </dl>
        <pre class="parameter-code">{{
          JSON.stringify(imported.snapshot.parameters, null, 2)
        }}</pre>
        <p class="helper">
          本预览支持导入自身的演示归档。真实资产绑定与执行将在后端接入后验证。
        </p>
        <button class="button" @click="restorePreview">
          还原并模拟复测
        </button></template
      ></el-dialog
    >
</template>