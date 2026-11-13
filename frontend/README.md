# TestPilot 前端

Vue3、Vue Router、Element Plus、Axios、ECharts。仅本地开发与验收，未部署、未推送。

## 本地预览

在项目根目录启动现有 Spring Boot（Java 21、本机 MySQL），在 `frontend` 中执行：

```powershell
npm.cmd ci
npm.cmd run dev
# http://127.0.0.1:5173
```

后端启动与静态博客前置条件见根目录 README 和 `docs/验收/验收记录-第一条真实流程.md`。被测站点须指向 `F:\SoftwareTest\期末大作业\静态博客网站测试\public`，端口 4000；它与已登记场景 8863397 匹配。前端 dev 和 preview 均将 `/api` 代理到 `http://127.0.0.1:8080`。

```powershell
npm.cmd run typecheck  # vue-tsc，独立于构建
npm.cmd test           # API 边界、幂等提交、生命周期、编辑器
npm.cmd run build
npm.cmd run preview   # http://127.0.0.1:4173，保留后端代理
npm.cmd run test:e2e   # 本机 Edge；需 4000/5173/8080 服务，真实提交一个只读任务
```

当前 Windows 工具环境如遇 esbuild 系统临时文件访问受限，可将当前终端的 TEMP、TMP 指到有写权限的项目内临时目录后重试；不需要更改系统设置。

## 页面与数据来源

| 入口 | 数据来源与可用操作 |
|---|---|
| 概览 | Spring Boot 真实任务总数、最近任务、用例图表；错误保持可见，无演示兜底 |
| 网站与环境 | 浏览器本地演示配置，新增、编辑、JSON 与变量批量录入 |
| 测试资产 | 已登记场景来自后端；下方资产草稿与请求清单为本地演示 |
| 请求调试 | 本地响应模拟、请求资产与历史，实际按填写的断言计算；不向被测 URL 发请求 |
| 任务与报告 | 后端实际场景、提交、取消、状态轮询、游标日志、用例/断言、脱敏报告预览与文件下载 |
| 实验对比 | 方案本地保存；从真实任务核对网站、环境、工具、场景、档位、重复次数。缺少第二网站、JMeter 或可比样本时列出缺项，不生成结论；按工具和来源任务记录耗时与体验 |
| 断言回归 | 本地演示用例配置与结果；真实断言位于任务详情中 |
| 检查验收 | 浏览器本地检查记录，明确区分待检查、通过与待修复 |

任务页底部保留折叠的「本地演示归档与复测」，支持演示 HTML/Markdown/JSON 导出与 JSON 导入模拟复测。与真实后端任务分开展示。真实后端尚未实现 rerun、三格式归档导出与导入接口，不能把原始 CLI JSON 当作可恢复归档。

任务配置仅发送 `name,assetId,parameters{iterations,delayRequestMs,timeoutRequestMs}`。真实目标、场景和环境从登记资产读取；其他高级 CLI 字段是可保存的本地草稿，当前执行不应用。

## 结构与边界

- `App.vue`：外壳、响应式导航、共享本地工作空间、运行时异常横幅。
- `pages/`：八个路由入口；TasksPage 读取 taskId、组织工作台和提交弹窗，离开即销毁业务生命周期。
- `content/`：TaskLogPanel、TaskResultsPanel、TaskReportPanel、ToolExperiencePanel、PreviewArchive。
- `components/`：泛型 DualEditor、KeyValueEditor、StatusTag、ErrorState、MetricChart。通过 props、emits 或 v-model 交互，不读路由或请求接口。
- `composables/useTaskFlow.ts`：真实任务的提交、取消、轮询、游标、旧响应隔离与清理。`taskFlow.js` 保留兼容导出。
- `api/client.ts`：单个 Axios 平台客户端，前缀、超时、AbortSignal、信封与下载错误归一化；`api/index.ts`：命名业务方法。`api.js` 保留兼容导出。
- `types/`：手工集中维护 DTO、枚举和运行时校验，来源为 Java 模型、TaskService 实际输出与已确认 Markdown 契约。仓库没有平台 OpenAPI，因此没有虚构 DTO 生成步骤。
- `services/diagnostics.ts`：仅允许级别、模块、操作、耗时、taskId、traceId、HTTP 状态、错误码。禁止 URL、凭据、正文、原始报告和任意异常消息进入诊断日志。
- `styles/tokens.css`：共享颜色、间距、字体、圆角、数值样式；`dashboard.css`：仪表盘布局与窄屏规则。

## 行为约定

同一提交在结果未知时重试复用原幂等键；仅将支持的任务字段与键保存在 sessionStorage 中，跨页面或刷新后可恢复；内容变化或成功后的新提交使用新键。重复点击共享同一个提交 Promise。提交草稿仍保留在弹窗中，字段错误就地显示。切换任务中止旧请求并重置加载状态；离开任务页中止请求、清理定时器。终态停止状态轮询，日志仍按游标读完末页；报告 409 最多补读 10 次，亦可手动刷新。404、网络故障、工具故障和测试未通过使用不同反馈。

JSON 与表单切换只检查语法及可编辑结构，允许必填项尚未填完；保存、提交或“校验并应用”时才执行完整业务校验。JSON 语法或结构无效时仍可返回表单，使用最近一次可编辑配置，并保留未应用的 JSON 原文；再次切回 JSON 可继续修改，也可显式用当前表单重新生成。API 对信封、分页、游标和嵌套结果进行运行时校验，格式异常不会转换为空列表。`ApiError` 保留状态、错误码、字段错误和追踪编号；格式错误保留原始输入供检查，但不会自动记录到控制台。主动取消不弹失败提示。

平台通信始终走 `/api/v1`；请求调试中的 URL、Header、Cookie 和 Body 只是被测请求定义，不会修改平台 Axios 客户端的目的地址、凭据或重试行为。

## 设计依据与限制

已执行 `codex mcp add stylekit --url https://www.stylekit.top/mcp`，并实际调用 `stylekit_get_style`，参数为 `{"slug":"dashboard-layout","include":["brief"]}`。实现同时核对在线中文 `https://www.stylekit.top/api/design/dashboard-layout/design.md?locale=zh` 与项目 `docs/parts/前端/design.md`，遵循 Implementation Contract。

当前后端指标使用 0～1 的比率，报告文件大小字段为 `size`，断言结果可能使用 CLI 原始类型与 `EQUALS` 操作符；DTO 按实际模型适配。后端未提供 toolVersion 时显示“—”。当前 TaskService 的 errorRate 使用失败用例数计算，尚不能保证所有场景都严格区分纯断言失败和请求失败；前端展示后端值，不据此生成实验结论。吞吐量当前为 null。

验收步骤、实际任务和未验证项目见 `docs/验收/前端改造本地验收.md`。

## 滚轮与编辑模式修复（2026-11-12）

表格只限制横向滚动链，纵向滚轮继续传到页面；日志滚到边界后也允许继续滚动页面。长弹窗在可视高度内滚动内容区，标题、关闭和底部保存操作保持可见。已用实际鼠标滚轮验证桌面页面、窄屏宽表、弹窗和关闭后的页面滚动；网站新建、任务新建及无效 JSON 的返回/恢复均已复验。


## 便携交付包

`npm.cmd run package:portable` 在先完成 build 后生成 Windows x64 便携 ZIP。构建脚本需要 Python，按明确清单打包，不包含数据库、后端凭据、node_modules 或报告。可通过 `-- --runtime "node.exe 的完整路径"` 指定现有 Node 运行时；本版本匹配 Windows x64 Node v26.12.1 的官方许可。

成品包含 dist、Node 运行时、启动前端.bat / START.bat、config.json、server.cjs、源码和整体/六人使用说明。使用者完整解压后双击即可运行前端，不需要安装开发依赖。便携服务只监听本机，平台 /api 请求代理到 config.json 的 backendUrl；它不会替代 Spring Boot 或执行请求编辑器中的目标 URL。真任务必须连接另行运行的后端。
