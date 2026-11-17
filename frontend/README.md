# TestPilot 测试执行前端

六个入口均已实现。Vue 3 / TypeScript 负责交互，前端执行适配复用接口与环境配置；新增 ECharts 性能观测、Java / JUnit 与 TypeScript / Vitest 单元测试、HTTP / Spring 配置基线和 Playwright 浏览器兼容性矩阵。Spring Boot + MySQL 提供共享配置与鉴权，Java 主类统一管理前端和执行器生命周期。

## 在 IDEA 中启动

运行根项目 TestPilotApplication.main() 或共享配置 TestPilot IDEA。Java 会直接启动 Node/Vite 前端与测试执行器，访问 http://127.0.0.1:5174 。无需运行批处理、PowerShell 或手动启动 npm。详细配置见根目录 README.md。

## 接口测试

- 保存、载入、删除接口用例；配置 Query、Header、JSON / 文本 / URL 编码表单、Bearer / Basic 鉴权、超时和重定向。
- 环境增删改与 `{{变量名}}` 替换；变量未定义时明确报错。请求由本机 Node 执行，不受浏览器目标站 CORS 限制。
- 断言支持状态码、JSONPath、响应头、正文、响应时间；变量提取写回执行时选定的环境。JSONPath 禁用表达式执行。
- 展示响应正文、响应头、请求摘要、耗时、大小、断言和变量提取结果；可取消请求，最近 15 次请求按项目同步到数据库，并保留浏览器恢复缓存。
- 导入 cURL、OpenAPI / Swagger JSON、Postman Collection JSON；Apifox 请导出为 OpenAPI / Postman。导入文件中的脚本和 multipart 文件不自动执行，界面会提示未支持部分。cURL 只解析，不执行 Shell，不读取本地文件。
- Newman 按保存的列表顺序运行所选请求，使用统一的断言与提取规则；前序提取变量传给后续请求，展示逐请求结果。并非仅显示模拟进度。

## UI 自动化

- 用例保存、载入、删除；步骤新增、删除、排序；视口配置与失败即停。
- 支持打开页面、输入、点击、按键、等待、等待元素、文本 / 地址 / 标题 / 数量 / 可见性断言、选择、悬停、勾选、滚动、截图。
- Playwright 启动独立无头浏览器上下文，展示真实步骤结果、耗时、失败截图和最终页面；取消时关闭执行浏览器。
- 页面分析通过真实浏览器提取表单、按钮、链接的选择器，可添加为步骤。
- 「AI 编排」仅调用已配置的 OpenAI / Anthropic 兼容远程 API。没有密钥时禁用生成，不提供本地规则回退；生成步骤经过格式与操作白名单验证。
- 登录、搜索、空密码模板均需按实际被测页面修改选择器及环境变量，不附带业务系统或伪造测试数据。

默认检测 Edge、Chrome 和 Playwright Chromium。可通过 `TESTPILOT_BROWSER_PATH` 指定浏览器可执行文件；没有本机浏览器时执行 `npx playwright install chromium`。

## 性能测试

可载入已保存的接口请求，沿用参数、请求头、正文和鉴权，配置 1–200 个并发用户、1–180 秒持续时间、爬坡、思考时间与预期状态码。默认 Node HTTP 真实并发执行，完整读取响应，传输失败与不符合预期的状态码各按一个失败请求计数；每秒聚合 TPS / P95，支持取消、保存实验、查看历史、下载 CSV 和 JSON。

安装 Apache JMeter 并设置 `JMETER_HOME` 后，可选择通过 Java 执行的 JMeter 引擎；未检测到时选项不可用，不静默冒充。JMeter 运行产生可下载的 JMX 和原始 CSV/JTL。P95 使用最近秩法，吞吐量为完成请求数除以实际采样时间；缺少样本时显示空值，不显示虚构的零。

## 单元测试

Java 使用 JDK 21 + JUnit 6.0.1，TypeScript / JavaScript 使用项目依赖 Vitest。两个编辑标签分别提供实现与测试；支持保存、加载、边界示例、Ctrl/Command+Enter 执行、失败明细和原始输出。

JUnit 首次使用时从 Maven Central 官方仓库下载并校验 SHA-256，也可预先执行 `npm run setup:java`。JDK 默认查找 `JAVA_HOME` 和用户 `.jdks` 中的 21 版本，可设置 `TESTPILOT_JAVA_HOME`。Java 实现类名为 `Subject`，测试类名为 `SubjectTest`，不声明 package；通过 `TestEnvironment.get("名称")` 读取环境。前端测试通过 `./subject` 导入实现，通过 `env` 读取环境。

单元测试在独立本机进程运行，有总时限与单测时限，但不提供操作系统沙箱，因此只应运行可信代码。编译和执行写入 `frontend/.runs`，不修改已有 Java 业务代码。测试失败与编译失败分别显示。

## 安全测试

围绕 HTTP 和 Spring Boot 提供 8 组检查：响应头、Cookie、Spring / 配置暴露、输入反射线索、SQL / Java 异常信息、CORS、外部跳转与技术指纹。默认不访问额外敏感路径或发送探测参数；启用轻量主动探测需确认目标授权，所有探测为有限 GET，不执行脚本、不跟随外部重定向。

结论区分风险、待确认、通过、不适用和检查失败。无 Cookie 不计为通过；配置路径返回 200 还需匹配内容结构；输入反射和 CORS 配置需要结合上下文复核。基线得分有明确扣分规则，不等于漏洞覆盖率或系统安全证明。

## 兼容性测试

可从已有 UI 用例载入起始地址（不执行登录步骤），选择 Chromium / Edge、已安装的 Firefox / WebKit 和五种视口，检查实际 HTTP 状态、横向溢出、viewport 声明、关键元素可见性、控制台错误及资源失败。每个组合使用独立浏览器上下文，保存真实截图与问题证据，支持导出 JSON、下载原图、历史恢复与取消。

设备为视口、触摸与 UA 模拟，不等同真机；浏览器名称只表示实际执行的内核。Firefox / WebKit 未安装时不可选，可按需执行 `npx playwright install firefox webkit`。超过 9000px 的页面只保存当前视口截图，并明确标记。

## 执行记录与产物

新增四种执行使用统一任务接口，后台任务支持进度、取消与失败原因；终态写入 `frontend/.runs/<执行编号>/result.json`，服务重启后仍可读取该编号的结果与产物。界面保留最近 10 次执行索引与本地保存配置。不要删除 `.runs` 后仍期望旧截图与报告可下载。

## 数据与验证

用例、环境、测试配置与最近执行索引通过 Spring 工作区接口同步到数据库，按项目隔离；浏览器 localStorage 保留恢复缓存。AI 密钥不进入该缓存。截图和完整执行产物保存在服务器 .runs 中。请仅对有权测试的目标执行操作。

```powershell
npm test
npm run build
```

集成测试在临时本地 HTTP 夹具上验证实际请求、Newman 变量串联、Playwright 执行、失败截图与页面分析，不依赖外部网站，不写现有数据库。
