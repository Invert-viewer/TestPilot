import {uuid} from './services/uuid';
import { requestDefinition, object, InputError } from './types/validation';
export const clone = (value) => JSON.parse(JSON.stringify(value));
export const pair = () => ({ key: "", value: "", enabled: true });
export function variableRows(value) {
  return Array.isArray(value)
    ? clone(value)
    : Object.entries(value || {}).map(([key, item]) => ({
        key,
        value: String(item),
        enabled: true,
      }));
}
export function resolvedRequestUrl(request, environment) {
  if (environment && environment.siteId !== request.siteId)
    throw new Error("选择所属网站的环境");
  const variables = Object.fromEntries(
    variableRows(environment?.variables)
      .filter((row) => row.enabled !== false)
      .map((row) => [row.key, row.value]),
  );
  if (environment) variables.baseUrl = environment.baseUrl.replace(/\/$/, "");
  const url = request.url.replace(/\{\{([^{}]+)\}\}/g, (_, key) => {
    if (!(key in variables)) throw new Error("未定义环境变量 " + key);
    return variables[key];
  });
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("请求地址须使用 HTTP 或 HTTPS");
  for (const row of request.query)
    if (row.enabled !== false && row.key)
      parsed.searchParams.append(row.key, row.value);
  return parsed.href;
}
export function validatePairs(rows, label) {
  if (!Array.isArray(rows)) throw new Error(label + "必须是数组");
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object") throw new Error(`${label}[${index}]: 应为键值对象`);
    if (row.enabled !== undefined && typeof row.enabled !== "boolean")
      throw new Error(label + "的启用状态须为布尔值");
    if (typeof row.key !== "string" || typeof row.value !== "string")
      throw new Error(label + "的名称和值必须是字符串");
  });
}
export function requestModel(input, { draft = false } = {}) {
  const value = clone(input);
  requestDefinition(value, { draft });
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.name !== "string" ||
    (!draft && !value.name.trim())
  )
    throw new Error("填写请求名称");
  if (
    !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(
      value.method,
    )
  )
    throw new Error("请求方法无效");
  if (typeof value.url !== "string" || (!draft && !value.url.trim()))
    throw new Error("填写请求地址");
  for (const key of ["query", "headers", "cookies"]) {
    value[key] ??= [];
    validatePairs(value[key], key);
  }
  if (
    !draft && value.headers.some(
      (row) =>
        row.enabled !== false &&
        [
          "cookie",
          "host",
          "connection",
          "transfer-encoding",
          "content-length",
        ].includes(row.key.toLowerCase()),
    )
  )
    throw new Error("Cookie 请使用独立列表，Host 等保留头由执行器生成");
  value.body ??= { mode: "NONE" };
  if (!["NONE", "FORM_URLENCODED", "JSON", "RAW"].includes(value.body.mode))
    throw new Error("正文类型无效");
  if (!draft && ["GET", "HEAD"].includes(value.method) && value.body.mode !== "NONE")
    throw new Error("GET / HEAD 使用无正文模式");
  if (value.body.mode === "JSON") JSON.parse(value.body.text || "");
  if (value.body.mode === "FORM_URLENCODED")
    validatePairs(value.body.fields || [], "表单");
  if (!Number.isInteger(value.timeoutMs) || (!draft && value.timeoutMs <= 0))
    throw new Error("超时必须为正整数");
  if (
    value.followRedirects !== undefined &&
    typeof value.followRedirects !== "boolean"
  )
    throw new Error("重定向开关须为布尔值");
  if (value.charset && !["UTF-8", "GB18030"].includes(value.charset))
    throw new Error("字符集无效");
  value.assertions ??= [];
  if (!Array.isArray(value.assertions)) throw new Error("断言必须是数组");
  for (const item of value.assertions) {
    if (
      ![
        "STATUS_CODE",
        "HEADER",
        "BODY",
        "JSON_FIELD",
        "RESPONSE_TIME_MS",
      ].includes(item.type)
    )
      throw new Error("断言类型无效");
    const ops = ["STATUS_CODE"].includes(item.type)
      ? ["EQ"]
      : item.type === "RESPONSE_TIME_MS"
        ? ["LTE"]
        : ["EQ", "CONTAINS"];
    if (!ops.includes(item.operator))
      throw new Error("断言运算符不适用于当前类型");
    if (typeof item.expected !== "string")
      throw new Error("断言预期值须为字符串");
    if (item.enabled !== undefined && typeof item.enabled !== "boolean")
      throw new Error("断言启用状态须为布尔值");
    if (
      !draft && item.type === "RESPONSE_TIME_MS" &&
      (!item.expected.trim() ||
        !Number.isFinite(Number(item.expected)) ||
        Number(item.expected) < 0)
    )
      throw new Error("耗时断言需要非负数字");
    if (!draft && ["HEADER", "JSON_FIELD"].includes(item.type) && !item.target)
      throw new Error("响应头和 JSON 字段断言需要目标字段");
  }
  return value;
}
export function taskSeed(siteId = "") {
  return {
    name: "场景验证",
    siteId,
    environmentId: "",
    tool: "APIFOX_CLI",
    assetId: "",
    assetVersion: 1,
    parameters: {
      targetKind: "scenario",
      targetId: "",
      projectId: "",
      branch: "",
      apifoxEnvironmentId: "",
      collection: "",
      iterations: 3,
      delayRequestMs: 1000,
      timeoutRequestMs: 5000,
      timeoutScriptMs: 5000,
      iterationData: "",
      onError: "continue",
      envVars: [],
      globalVars: [],
      variablesFile: "",
      carryRuntimeVariables: false,
      reporters: ["cli", "html", "json"],
      outDir: "apifox-reports",
      outFile: "",
      failuresSeparated: false,
      uploadReport: false,
      ignoreRedirects: false,
      insecure: false,
      clientCertList: "",
      clientCert: "",
      clientKey: "",
      extraCaCerts: "",
      externalProgramPath: "",
      databaseConnection: "",
      notification: "",
      notificationFailed: "",
      silent: false,
      color: "auto",
      bigint: false,
      lang: "zh",
    },
  };
}
export function taskModel(input, { draft = false } = {}) {
  const value = clone(input);
  object(value);
  for (const field of ['name','siteId','environmentId','assetId','tool'])
    if (typeof value[field] !== 'string') throw new InputError(field,'应为字符串',value[field]);
  object(value.parameters,'parameters');
  if (!draft && (!value.name?.trim() || !value.assetId))
    throw new Error("填写任务名称，选择测试资产");
  if (!["APIFOX_CLI", "JMETER"].includes(value.tool))
    throw new Error("工具无效");
  const p = value.parameters;
  if (!p || typeof p !== "object") throw new Error("缺少执行参数");
  const positive =
    value.tool === "JMETER"
      ? ["threads", "loops"]
      : ["iterations", "timeoutRequestMs", "timeoutScriptMs"];
  for (const key of positive)
    if (!Number.isInteger(p[key]) || (!draft && p[key] <= 0))
      throw new InputError('parameters.'+key, "必须为正整数", p[key]);
  for (const key of [
    "delayRequestMs",
    ...(value.tool === "JMETER" ? ["rampUpSeconds"] : []),
  ])
    if (!Number.isInteger(p[key]) || (!draft && p[key] < 0))
      throw new InputError('parameters.'+key, "必须为非负整数", p[key]);
  if (value.tool === "APIFOX_CLI") {
    for (const key of [
      "carryRuntimeVariables",
      "failuresSeparated",
      "uploadReport",
      "ignoreRedirects",
      "insecure",
      "silent",
      "bigint",
    ])
      if (p[key] !== undefined && typeof p[key] !== "boolean")
        throw new Error(key + " 必须为布尔值");
    if (
      !["auto", "on", "off"].includes(p.color) ||
      !["zh", "en"].includes(p.lang)
    )
      throw new Error("控制台颜色或语言选项无效");
    if (
      !["scenario", "folder", "suite", "case", "file", "url"].includes(
        p.targetKind,
      )
    )
      throw new Error("运行目标类型无效");
    if (!["ignore", "continue", "end"].includes(p.onError))
      throw new Error("错误处理方式无效");
    if (
      !Array.isArray(p.reporters) ||
      (!draft && !p.reporters.length) ||
      p.reporters.some((r) => !["cli", "html", "json", "junit"].includes(r))
    )
      throw new Error("至少选择一种有效报告格式");
    validatePairs(p.envVars || [], "环境变量");
    validatePairs(p.globalVars || [], "全局变量");
  }
  if (
    !draft && value.tool === "JMETER" &&
    p.durationSeconds != null &&
    (!Number.isInteger(p.durationSeconds) || p.durationSeconds <= 0)
  )
    throw new Error("运行时长须为正整数");
  return value;
}
export function cliArguments(task) {
  const p = task.parameters;
  if (task.tool === "JMETER")
    return [
      "jmeter",
      "-n",
      "-t",
      p.collection || "<已登记 JMX>",
      "-Jthreads=" + p.threads,
      "-Jloops=" + p.loops,
      "-JrampUpSeconds=" + p.rampUpSeconds,
      "-JdurationSeconds=" + p.durationSeconds,
      "-JdelayRequestMs=" + p.delayRequestMs,
    ];
  const args = ["apifox", "run"];
  const targetFlags = {
    scenario: "--test-scenario",
    folder: "--test-scenario-folder",
    suite: "--test-suite",
    case: "--test-case",
  };
  if (targetFlags[p.targetKind])
    args.push(targetFlags[p.targetKind], p.targetId || "<待绑定目标 ID>");
  else args.push(p.collection || "<测试文件或 URL>");
  const flags = {
    projectId: "--project",
    branch: "--branch",
    apifoxEnvironmentId: "--environment",
    iterations: "--iteration-count",
    delayRequestMs: "--delay-request",
    timeoutRequestMs: "--timeout-request",
    timeoutScriptMs: "--timeout-script",
    iterationData: "--iteration-data",
    onError: "--on-error",
    variablesFile: "--variables",
    outDir: "--out-dir",
    outFile: "--out-file",
    clientCertList: "--ssl-client-cert-list",
    clientCert: "--ssl-client-cert",
    clientKey: "--ssl-client-key",
    extraCaCerts: "--ssl-extra-ca-certs",
    externalProgramPath: "--external-program-path",
    databaseConnection: "--database-connection",
    notification: "--notification",
    notificationFailed: "--notification-failed-event",
    color: "--color",
    lang: "--lang",
  };
  Object.entries(flags).forEach(([key, flag]) => {
    if (p[key] !== "" && p[key] != null) args.push(flag, String(p[key]));
  });
  args.push("--reporters", (p.reporters || []).join(","));
  const toggles = {
    carryRuntimeVariables: "--carry-runtime-variables",
    ignoreRedirects: "--ignore-redirects",
    insecure: "--insecure",
    silent: "--silent",
    bigint: "--bigint",
  };
  Object.entries(toggles).forEach(([key, flag]) => {
    if (p[key]) args.push(flag);
  });
  if (p.uploadReport) args.push("--upload-report", "true");
  if (p.failuresSeparated) args.push("--out-json-failures-separated", "true");
  for (const [key, flag] of [
    ["envVars", "--env-var"],
    ["globalVars", "--global-var"],
  ])
    for (const row of p[key] || [])
      if (row.enabled !== false && row.key)
        args.push(flag, row.key + "=" + row.value);
  return args;
}
export function simulateRequest(request, fixture) {
  const statusCode = fixture === "not-found" ? 404 : 200;
  const bodyText =
    fixture === "json"
      ? JSON.stringify({ title: "徐州工程学院", available: true })
      : fixture === "not-found"
        ? "Not Found"
        : "<!doctype html>\n<title>徐州工程学院</title>";
  const headers = [
    {
      key: "Content-Type",
      value:
        fixture === "json" ? "application/json" : "text/html; charset=utf-8",
    },
  ];
  const failed = fixture === "timeout";
  const assertions = request.assertions.map((a) => {
    let actual = null;
    if (!failed && a.enabled !== false) {
      if (a.type === "STATUS_CODE") actual = String(statusCode);
      if (a.type === "BODY") actual = bodyText;
      if (a.type === "HEADER")
        actual =
          headers.find((h) => h.key.toLowerCase() === a.target.toLowerCase())
            ?.value ?? null;
      if (a.type === "RESPONSE_TIME_MS") actual = "286";
      if (a.type === "JSON_FIELD") {
        try {
          actual = a.target
            .split("/")
            .slice(1)
            .map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"))
            .reduce((v, k) => v?.[k], JSON.parse(bodyText));
          actual =
            actual == null
              ? null
              : typeof actual === "object"
                ? JSON.stringify(actual)
                : String(actual);
        } catch {
          actual = null;
        }
      }
    }
    const passed =
      actual !== null &&
      (a.operator === "CONTAINS"
        ? actual.includes(a.expected)
        : a.operator === "LTE"
          ? Number(actual) <= Number(a.expected)
          : actual === a.expected);
    return {
      ...a,
      actual,
      status:
        failed || a.enabled === false
          ? "SKIPPED"
          : passed
            ? "PASSED"
            : "FAILED",
      message: failed
        ? "请求超时，未评估"
        : passed
          ? null
          : "请核对预期与实际值",
    };
  });
  return {
    id: "HTTP-" + uuid().slice(0, 8),
    createdAt: new Date().toISOString(),
    definition: clone(request),
    durationMs: failed ? request.timeoutMs : 286,
    transportStatus: failed ? "FAILED" : "COMPLETED",
    outcome: failed
      ? "NOT_EVALUATED"
      : assertions.some((a) => a.status === "FAILED")
        ? "FAILED"
        : assertions.some((a) => a.status === "PASSED")
          ? "PASSED"
          : "NOT_EVALUATED",
    response: failed ? null : { statusCode, headers, bodyText },
    assertions,
    error: failed
      ? { code: "REQUEST_TIMEOUT", message: "本地超时情形演示" }
      : null,
  };
}
