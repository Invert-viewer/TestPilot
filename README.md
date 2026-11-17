# TestPilot

当前版本基于 Vue 3、TypeScript、Vite、Spring Boot 4、Java 21 和 MySQL。六类测试沿用真实执行器；新增项目与环境、真实工具链、平台设置，并通过后端会话鉴权管理团队。

## 在 IDEA 中运行

1. 在 IDEA 中打开本项目的 `pom.xml`，选择作为 Maven 项目导入，等待依赖同步完成。
2. Project SDK 使用 JDK 21 或以上（本机已有 ms-21 / ms-25）。
3. 运行顶部的 **TestPilot IDEA** 配置，或直接点击 `TestPilotApplication.main()` 左侧绿色三角。
4. 控制台出现 `TestPilot 已就绪` 后，打开 http://127.0.0.1:5174 。访问后端 http://127.0.0.1:8081 也会自动跳转到网页。

只运行一个 Java 主类即可。Spring Boot 在启动完成后直接创建 Node.js 子进程，自动启动 Vite 页面、API 代理和六类测试执行器；不经过 CMD、PowerShell 或 npm 启动命令，不需要 IDEA Node.js 插件。修改前端源码自动热更新，不需要手动构建 dist。IDEA 的 Stop 会关闭前端并取消运行中的测试，异常退出时前端也会检查父进程并自行退出。

运行配置位于 `.run/TestPilot IDEA.run.xml`，工作目录固定为项目根目录。若尚未显示共享配置，直接运行 `src/main/java/edu/xzit/testpilot/TestPilotApplication.java` 即可。旧批处理 / PowerShell 启动入口已移除。

本机 Node 路径与数据库连接保存在被 Git 忽略的 `local-application.yaml`，已经配置。首次迁移到其他电脑时，先通过 IDEA 的 `package.json` / npm 面板执行一次依赖安装，并在本地配置中设置 `testpilot.frontend.node-path`（或让 node 位于 PATH）。共享默认设置是前端 5174、后端 8081；需要调整时修改 `application.yaml` 的对应端口即可。

本机 MySQL 数据库仍是原 `testpilot`，现有业务表不删除、不重置。首次打开页面自行创建测试负责人账号，密码至少 10 个字符。数据库账号与平台账号相互独立；不提供通用演示密码。

## 功能与数据

- 项目与环境复用 `workspace_resource`，保留原 `sites`、`environments` 接口和事务版本检查。不同环境允许不同主机；每个环境需要启用 `baseUrl`。接口、UI 用例以及其余四类测试配置按项目保存到 `executionSpaces`，并与当前环境共同切换。原工作区资产不删除；首次创建项目可选择导入旧浏览器配置。
- 工具链实际检测 JMeter、Newman、Playwright、Java/JUnit、Vitest 和 HTTP 安全基线。性能测试选择 Apache JMeter 后实际生成 JMX，通过 Java 非 GUI 模式执行，再解析 JTL/CSV；网页显示 TPS、P95/P99、错误率、样本和原始产物下载。安装目录可在执行器设置填写，或使用 JMETER_HOME。
- 平台设置包含即时深色主题、失败提示、结果定位、浏览器/JDK/JMeter 路径、远程 AI、团队和数据库状态。路径与无头模式在下一次执行生效。数据与关于显示真实数据库产品、版本和资源数量，不包含清库/演示重置按钮。
- AI 中心提供按账号、项目保存的多轮对话、接口 / UI 用例生成、测试数据工厂与项目风险分析。未配置密钥时，进入 `/#/ai` 会自动跳到 `/#/settings?tab=ai`，直接显示 AI 引擎设置。生成结果和对话保存在 MySQL 的 `ai_record`，刷新页面可继续查看。
- AI 只支持 OpenAI Chat Completions 与 Anthropic Messages 协议，DeepSeek 使用 OpenAI 兼容协议与实际配置的模型名称。没有本地模型或失败回退；无密钥、上游失败、输出截断或结构错误均明确报错。调用模型可能产生提供方计费。官方协议参考：[OpenAI](https://developers.openai.com/api/reference/overview)、[Anthropic](https://platform.claude.com/docs/en/api/overview)、[DeepSeek](https://api-docs.deepseek.com/)。
- 用例先预览并标注假设，再逐条或批量保存到现有项目的接口 / UI 集合，重复保存去重。输入完整页面 URL 时先由 Playwright 分析真实交互元素，不采信模型凭空编造的选择器；保存不会自动运行测试。数据工厂由模型识别语义、Java 校验常见格式及身份证 / Luhn 校验位，支持有效、边界、非法样本与 CSV / JSON 导出。所有样本均为虚构，业务有效性仍需核对。
- 风险分析读取当前项目引用的真实执行产物和请求历史，只向模型提供筛选、限量、脱敏后的证据。未采样类别显示“暂无数据”，不生成假缺陷或假覆盖率。规则风险分只是明确阈值下的观察指标，模型建议与实测结果分开展示。对话选择“仅本次问题与对话”时不附加项目证据。
- AI 密钥以 AES-GCM 加密存入数据库，不返回前端、不存 localStorage。加密主密钥默认在被 Git 忽略的 `data/platform-secret.key`，也可用 Base64 编码的 32 字节 TESTPILOT_SECRET_KEY。迁移数据库时需同时备份主密钥；JSON 工作区导出不包含账号密码、会话或 AI 密钥，但包含环境变量原值。
- 登录使用 HttpOnly、SameSite=Strict Cookie，随机会话仅以 SHA-256 摘要存入数据库，12 小时过期，退出或删除账号立即撤销。密码通过带随机盐的 PBKDF2-HMAC-SHA256 保存。角色从数据库逐次读取，不能伪造前端角色提权。
- 团队所有角色都能查看；只有 LEAD（测试负责人）可新增、删除成员或修改角色。其他角色写入返回 403；最后一位负责人不能被删除或降级。共享 AI、执行器设置和数据导出也要求负责人权限。
- Node 执行入口和产物下载同样验证 Spring 会话。执行进程、文件产物与浏览器都位于运行平台的服务器；单独打开 dist 静态文件不具备执行能力。单元测试执行本机可信代码，不是操作系统级不可信代码沙箱。默认只监听本机地址。

## 接口与扩展点

统一前缀 `/api/v1`，响应沿用 `{code,message,data,traceId}`。

| 接口 | 行为 |
|---|---|
| GET /auth/status | 是否已经创建负责人（公开） |
| POST /auth/setup | 仅数据库没有用户时创建首位负责人 |
| POST /auth/login、POST /auth/logout、GET /auth/me | 登录、注销、读取当前身份 |
| GET/POST /team、PUT /team/{id}/role、DELETE /team/{id} | 团队查看与负责人管理 |
| GET/POST /workspace | 原工作区读取、版本化批量事务 |
| GET /platform/settings | 共享执行器与脱敏 AI 设置 |
| PUT /platform/settings/executor、PUT/DELETE /platform/settings/ai | 负责人修改配置 |
| POST /platform/ai/test、POST /platform/ai/compose | 真实远程调用 |
| GET /ai/state?projectId=... | 当前账号在项目中的 AI 记录与执行证据 |
| POST /ai/chat、DELETE /ai/chat?projectId=... | 多轮对话与清空自己的对话 |
| POST /ai/cases、POST /ai/data、POST /ai/risk | 结构化生成与证据分析 |
| POST /ai/records/{id}/import | 事务保存所选用例，仅能导入自己的生成记录 |
| GET /platform/about、GET /platform/export | 数据库状态、负责人导出 |

`PlatformInterceptor` 是登录与权限拦截扩展点，覆盖现有 `/api/v1/**` 控制器，只有登录/初始化状态接口公开。团队写操作还在事务服务层重新检查负责人角色。Vite 将 `/api` 代理给 Spring，`/__runner` 提供已鉴权执行入口。TESTPILOT_BACKEND_URL 可覆盖 Node/Vite 后端地址。

## 验证

```powershell
.\mvnw.cmd test
cd frontend
npm ci
npm test
npm run build
```

后端集成测试使用独立内存 H2；远程 AI 协议通过本机 HTTP 模拟服务验证鉴权头、请求体、密钥加密、未配置失败和非法步骤响应，不需要真实 API 密钥。执行器测试真实运行本机 JMeter、Java/JUnit、Vitest、Playwright。网页验收使用独立测试库与本地目标，不将验收账号写入实际 MySQL。
