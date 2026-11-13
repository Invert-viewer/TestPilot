import {uuid} from './services/uuid';
import { ref, watch, onBeforeUnmount } from "vue";
import { clone, simulateRequest } from "./config";

export const modules = [
  {
    page: "assets",
    name: "测试资产",
    description: "统一管理请求、环境变量与测试场景，复用每一次配置。",
    action: "管理测试资产",
  },
  {
    page: "compare",
    name: "实验对比",
    description: "对齐请求与参数，比较网站表现和不同工具的执行结果。",
    action: "查看实验对比",
  },
  {
    page: "regression",
    name: "断言回归",
    description: "核对预期与实际，定位失败原因，发起复测并追踪结果。",
    action: "查看断言结果",
  },
  {
    page: "checks",
    name: "检查验收",
    description: "记录页面与平台检查，保存实际现象、证据和复测结论。",
    action: "管理检查记录",
  },
];

export const requestSeed = {
  name: "官网首页返回 HTML",
  siteId: "site-xzit",
  environmentId: "env-public",
  method: "GET",
  url: "{{baseUrl}}/",
  charset: "UTF-8",
  query: [],
  headers: [],
  cookies: [],
  body: { mode: "NONE" },
  timeoutMs: 5000,
  followRedirects: true,
  assertions: [
    {
      id: "a1",
      type: "STATUS_CODE",
      target: null,
      operator: "EQ",
      expected: "200",
      enabled: true,
    },
  ],
};
export const cases = [
  {
    id: "CASE-01",
    name: "首页状态码",
    type: "正常",
    expected: "200",
    actual: "200",
    status: "PASSED",
    note: "响应状态符合预期。",
  },
  {
    id: "CASE-02",
    name: "响应类型",
    type: "正常",
    expected: "text/html",
    actual: "text/html; charset=utf-8",
    status: "PASSED",
    note: "Content-Type 包含预期类型。",
  },
  {
    id: "CASE-03",
    name: "正文关键内容",
    type: "回归",
    expected: "徐州工程学院",
    actual: "示例正文未包含预期内容",
    status: "FAILED",
    note: "对照响应正文检查内容与编码，调整后复测。",
  },
  {
    id: "CASE-04",
    name: "零循环次数",
    type: "边界",
    expected: "字段级校验错误",
    actual: "循环次数必须大于 0",
    status: "PASSED",
    note: "平台参数校验演示，未向官网发送请求。",
  },
];

const initial = () => ({
  sites: [
    {
      id: "site-xzit",
      name: "徐州工程学院官网",
      baseUrl: "https://www.xzit.edu.cn/",
      scope: "公开首页，低频只读",
      environment: "公开访问环境",
    },
  ],
  assets: [
    {
      id: "asset-home",
      name: "公开首页基础场景",
      tool: "APIFOX_CLI",
      version: 1,
      kind: "APIFOX_SCENARIO",
      description: "状态码、Content-Type 与正文关键内容",
      status: "待绑定真实场景",
      scenarioKey: "homepage",
      requestRefs: ["CASE-01", "CASE-02", "CASE-03"],
    },
    {
      id: "asset-jmeter",
      name: "首页 HTTP 对照计划",
      tool: "JMETER",
      version: 1,
      kind: "JMETER_FILE",
      description: "与基础场景保持一致的请求和断言",
      status: "待上传 JMX",
      scenarioKey: "homepage",
      requestRefs: ["CASE-01", "CASE-02", "CASE-03"],
    },
  ],
  tasks: [
    {
      id: "DEMO-003",
      name: "首页内容回归",
      tool: "APIFOX_CLI",
      status: "FINISHED",
      outcome: "FAILED",
      createdAt: "2026-11-11T14:32:00+08:00",
      parameters: {
        iterations: 3,
        delayRequestMs: 1000,
        timeoutRequestMs: 5000,
      },
      siteId: "site-xzit",
      environmentId: "env-public",
      assetId: "asset-home",
      assetVersion: 1,
      summary: {
        totalCases: 3,
        passedCases: 2,
        failedCases: 1,
        skippedCases: 0,
        notEvaluatedCases: 0,
      },
      sourceTaskId: null,
    },
    {
      id: "DEMO-002",
      name: "同场景 · JMeter 对照",
      tool: "JMETER",
      status: "FINISHED",
      outcome: "PASSED",
      createdAt: "2026-11-11T14:20:00+08:00",
      parameters: {
        threads: 1,
        rampUpSeconds: 0,
        loops: 3,
        delayRequestMs: 1000,
      },
      siteId: "site-xzit",
      environmentId: "env-public",
      assetId: "asset-jmeter",
      assetVersion: 1,
      summary: {
        totalCases: 3,
        passedCases: 3,
        failedCases: 0,
        skippedCases: 0,
        notEvaluatedCases: 0,
      },
      sourceTaskId: null,
    },
  ],
  checks: [
    {
      id: "CHECK-01",
      title: "官网导航与链接",
      kind: "WEBSITE_PAGE",
      method: "MANUAL",
      status: "PENDING",
      expected: "导航可访问，目标与文字一致",
      actual: "",
      evidence: "",
    },
    {
      id: "CHECK-02",
      title: "重复提交只创建一次任务",
      kind: "PLATFORM",
      method: "HTTP",
      status: "PENDING",
      expected: "同键同内容返回同一任务",
      actual: "",
      evidence: "",
    },
    {
      id: "CHECK-03",
      title: "报告导出与 JSON 场景还原",
      kind: "PLATFORM",
      method: "MANUAL",
      status: "PENDING",
      expected: "导入后保留资产、参数与预期结果",
      actual: "",
      evidence: "",
    },
    {
      id: "CHECK-04",
      title: "失败提示与历史记录",
      kind: "PLATFORM",
      method: "MANUAL",
      status: "PENDING",
      expected: "可查看错误原因并关联复测",
      actual: "",
      evidence: "",
    },
  ],
});

export const toolLabel = (tool) =>
  tool === "JMETER" ? "JMeter" : "Apifox CLI";
export const stateLabel = (task) =>
  ({
    QUEUED: "排队中",
    RUNNING: "运行中",
    CANCELLING: "取消中",
    CANCELLED: "已取消",
    ERROR: "执行故障",
  })[task.status] || (task.outcome === "FAILED" ? "断言失败" : "已完成");
export function usePreview(demo=false) {
  const state = ref({...initial(),tasks:demo?initial().tasks:[], environments:[], requests:[], httpHistory:[], parameterPlans:[], comparisons:[], comparisonExperiences:[], assertionCases:[]});
  if(demo){
    const site=state.value.sites[0];
    state.value.environments=[{id:"env-public",siteId:site.id,name:site.environment,baseUrl:site.baseUrl,variables:[],globalVariables:[]}];
    state.value.requests=[{id:"request-home",version:1,name:requestSeed.name,definition:clone(requestSeed)}];
    state.value.assertionCases=clone(cases);
  }
  const timers = new Set();
  const later = (fn, ms) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };
  for (const task of state.value.tasks) {
    if (["QUEUED", "RUNNING", "CANCELLING"].includes(task.status))
      task.status = "CANCELLED";
  }
  function run(config) {
    const task = {
      ...JSON.parse(JSON.stringify(config)),
      siteSnapshot: clone(
        config.siteSnapshot ||
          state.value.sites.find((s) => s.id === config.siteId) ||
          null,
      ),
      environmentSnapshot: clone(
        config.environmentSnapshot ||
          state.value.environments.find((e) => e.id === config.environmentId) ||
          null,
      ),
      assetSnapshot: clone(
        config.assetSnapshot ||
          state.value.assets.find((a) => a.id === config.assetId) ||
          null,
      ),
      id: "DEMO-" + uuid().slice(0, 8),
      createdAt: new Date().toISOString(),
      status: "QUEUED",
      outcome: "NOT_EVALUATED",
      summary: null,
    };
    state.value.tasks.unshift(task);
    const find = () => state.value.tasks.find((item) => item.id === task.id);
    later(() => {
      if (find().status === "QUEUED") find().status = "RUNNING";
    }, 500);
    later(() => {
      if (find().status !== "RUNNING") return;
      const requestSnapshots = find().requestSnapshots || [
        { definition: clone(requestSeed) },
      ];
      const repetitions =
        find().parameters.iterations || find().parameters.loops || 1;
      const caseResults = requestSnapshots.flatMap((item) =>
        simulateRequest(item.definition, "html").assertions.map((a) => ({
          id: a.id,
          name:
            a.type +
            (a.target ? " · " + a.target : "") +
            " × " +
            repetitions +
            " 轮",
          expected: a.expected,
          actual: a.actual,
          status: a.status,
        })),
      );
      const passedCases =
        repetitions * caseResults.filter((c) => c.status === "PASSED").length;
      const failedCases =
        repetitions * caseResults.filter((c) => c.status === "FAILED").length;
      const skippedCases =
        repetitions * caseResults.filter((c) => c.status === "SKIPPED").length;
      Object.assign(find(), {
        status: "FINISHED",
        outcome: failedCases
          ? "FAILED"
          : passedCases
            ? "PASSED"
            : "NOT_EVALUATED",
        caseResults,
        summary: {
          totalCases: caseResults.length * repetitions,
          passedCases,
          failedCases,
          skippedCases,
          notEvaluatedCases: 0,
        },
      });
    }, 2800);
    return task.id;
  }
  function cancel(task) {
    task.status = "CANCELLING";
    later(() => {
      task.status = "CANCELLED";
    }, 300);
  }
  onBeforeUnmount(() => timers.forEach(clearTimeout));
  return { state, run, cancel };
}

export function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
