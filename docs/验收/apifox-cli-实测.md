# Apifox CLI 实测记录（场景 8863397）

> 实测人：apifox-probe　实测时间：2026-11-12 19:42–19:44（Asia/Shanghai）
> 工作副本：`F:\SoftwareTest\期末大作业\TestPilot`
> 目的：为 TestPilot 后端（ApifoxCliRunner / ApifoxReportParser）提供真实命令、退出码、报告结构样本。

## 1. 结论摘要

1. **CLI 可用**：`apifox` v2.2.12（`C:\Users\Lenovo\AppData\Roaming\npm\apifox.cmd`），本机已登录，无需在命令中出现任何令牌参数。
2. **退出码**：报告导出成功但存在失败用例时，进程退出码仍为 **1**；环境/参数错误同样为 **1**（本机实测无效环境）。成功全通过应为 **0**（依据 `apifox exit-codes`，本次未能构造全通过样本，见 §3.2）。
3. **JSON 报告没有逐用例字段**：`run.json` 只有汇总 `stats/timings/transfers`、失败明细 `failures` 和仅含 `ref/type` 的 `stepTree`；**没有** per-case 的 name/status/duration/statusCode。
4. **JUnit 报告是唯一的逐用例结构化来源**：每个场景步骤一个 `<testsuite id="{步骤id}">`，每个断言一个 `<testcase>`；但 **testcase 只有断言名，没有步骤名**，步骤名需用 `testsuite@id` 回查 `run.json` 的 `collection.item[0].item[].id`（实测 49/49 一一对应且顺序一致）。
5. **CLI stdout 是最完整的执行日志**：含步骤名、请求行（方法/URL/状态码/大小/耗时）、每条断言通过（`√`）或失败（`1.`）、脚本日志、汇总表、编号失败清单，可逐行入库。
6. **安全**：`apifox` 会把登录令牌明文写进 JSON 报告的 `options.accessToken`（本次长度 41）。后端解析时必须丢弃/脱敏该字段；本次两份 `run.json` 均已就地替换为 `***REDACTED-TOKEN***`。命令行、stdout/stderr、文档中均无令牌。

## 2. 运行方式

### 2.1 前置：被测静态站点

```bash
cd "F:/SoftwareTest/期末大作业/博客功能测试站"
python -m http.server 4000 --directory public --bind 127.0.0.1
# 或项目自带：python serve_local.py   （默认 4000，仅 127.0.0.1）
```

探活（实测 2026-11-12 19:42）：

| 路径 | HTTP | 说明 |
|---|---|---|
| `/` | 200 | 首页，6.51KB |
| `/page/2/` | 200 | 首页第 2 页 |
| `/15-questions-for-blog/` | 404 | 站点中不存在该文章 |
| `/2021-annual-summary/` | 404 | 站点中不存在该文章 |
| `/robots.txt` | 200 | 站点中存在，但场景期望 404 |

### 2.2 最终可用命令

```bash
apifox test-scenario run 8863397 \
  --project 8941754 \
  -e 49735657 \
  -r cli,json,junit \
  -n 1 \
  --delay-request 100 \
  --color off \
  --out-dir .acceptance/cli-run \
  --out-file run
```

- `-e <envId>`：环境 49735657「本地」，baseUrl `http://127.0.0.1:4000`。
- `-r cli,json,junit`：终端输出 + JSON 报告 + JUnit XML 报告。
- `-n 1`：场景循环 1 次；`--delay-request 100`：请求间隔 100ms（参数实验用）。
- `--color off`：关闭 ANSI 颜色，stdout 可直接入库存文本（实测 794 行）。
- `--out-dir/--out-file`：产物 `<out-dir>/<out-file>.json`、`<out-dir>/<out-file>.xml`。
- **不要**加 `--access-token`：本机已登录，令牌只从 `C:\Users\Lenovo\.apifox\config.toml` 读取。

### 2.3 实测结果（两次运行一致）

| 指标 | 值 |
|---|---|
| 退出码 | **1** |
| 步骤 | 总 49 / 通过 9 / 失败 40 |
| 断言 | 总 126 / 失败 41 |
| 请求 | 总 49 / 失败 40 |
| 循环 | 1（iterations.failed = 1） |
| 脚本 | 42（failed 0） |
| 总耗时 | 10.13s（junit `time` 0.369 = 各步骤耗时之和） |
| 平均接口耗时 | 4.69ms（min 4 / max 49 / s.d. 5.82） |
| 失败条目 | JSON `failures` 83 条（不是 40 条，见 §4.3） |

### 2.4 失败原因（重要：不是站点未启动）

同一份 stdout 明确显示首页 `GET http://127.0.0.1:4000/ [200 OK, 6.51KB, 49.00ms]`，且有 9 个步骤通过。40 个失败步骤是**场景登记内容与当前 `public/` 构建不匹配**：

| 现象 | 条数/示例 | 证据 |
|---|---|---|
| 步骤指向站点不存在的页面 | `/15-questions-for-blog/`、`/2021~2024-annual-summary/`、多个 `/2023年/06月归档` 等 | 服务器返回 404，curl 复测同为 404 |
| 期望 404 实际 200 | `robots.txt` | 站点有该文件 |
| 期望 301 实际 200 | 「无尾斜杠（301 用例）」 | python http.server 不做该跳转 |
| 中文路径未编码 | 「标签：测试」→ `TypeError: Request path contains unescaped characters` | 场景内路径未做 URL 编码 |

站点 `public/posts.json` 只有 12 篇文章（`/test-env-checklist/`…`/test-case-design/`），与场景中的文章/归档页清单不同。**要得到全 PASS 样本，必须先按当前站点内容修订场景 8863397，重跑不会自动变绿。**

## 3. 退出码

### 3.1 `apifox exit-codes` 原文

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 操作失败 / API 失败 |
| 2 | 认证失败（未登录、令牌失效） |
| 3 | 输入或校验失败（参数错误） |
| 4 | Schema/发现失败 |
| 5 | 内部错误 |

### 3.2 实测样本

| 场景 | 命令要点 | 退出码 | stdout 形态 | 是否生成报告 |
|---|---|---|---|---|
| 用例失败 | 正常场景，40/49 步失败 | **1** | 人读日志 + 汇总 + 失败清单，末尾 `Export of JSON/JUnit report ... successful` | 是（json+xml） |
| 环境无效 | `-e 99999999` | **1** | 单段 JSON：`{"success":false,"resource":"test-scenario","operation":"run","error":{"code":"ERROR","message":"错误: 无效的环境。"},"agentHints":{...}}` | 否 |

`stderr` 两种情况都只有 Node 警告：`ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.`，可忽略。

**后端判定建议**：
- `exit != 0` 不能直接当"没有报告"：用例失败同样是 1 且报告齐全。
- 先看产物是否存在 → 存在则解析报告、`outcome=FAILED`；不存在且 exit≠0 → 记为执行失败并保留 stdout（JSON 错误包可直接解析 `error.message`）。
- 区分"全通过"用 `stats.steps.failed == 0 && stats.assertions.failed == 0`，不要只看退出码。

## 4. JSON 报告

### 4.1 位置

`F:\SoftwareTest\期末大作业\TestPilot\.acceptance\cli-run\run.json`（约 832KB）
早期样本：`F:\SoftwareTest\期末大作业\TestPilot\.acceptance\cli-probe\probe-8863397.json`

### 4.2 结构（顶层键：`result`, `isTestFlowControl`, `run`, `options`, `collection`）

```text
result / run  (二者结构相同；run.failures 比 result.failures 多 source 字段)
├─ stats   {steps{total,passed,failed}, iterations{...}, assertions{total,pending,failed},
│           tests{total}, scripts{total,pending,failed}, requests{total,pending,failed}}
├─ timings {responseTime, responseAverage, responseMin, responseMax, responseSd,
│           dnsAverage/Min/Max/Sd, firstByteAverage/Min/Max/Sd, started, completed}  // 毫秒
├─ transfers {responseTotal}
├─ failures[] {error, at, cursor}          // result.failures
├─ stepTree[] {ref, type:"http"}           // 仅 49 项，无 name/status
└─ error    // null
options      // 含 accessToken（明文，必须脱敏）、其它运行参数
collection   // 场景定义：item[0].item[] = 49 个步骤定义（含 id、name、request、event 脚本）
```

### 4.3 关键结论：JSON 里没有逐用例结果

对整份 JSON 做递归键统计（脚本 `.acceptance/cli-probe/key_census.py`）：

| 键 | 出现次数 | 说明 |
|---|---|---|
| `statusCode` | **0** | 不存在 |
| `status` | **0** | 不存在 |
| `duration` | **0** | 不存在 |
| `responseBody` | **0** | 不存在 |
| `responseTime` | 2 | 仅 `result.timings` / `run.timings` 聚合值 |
| `body` / `headers` | 97 / 94 | 全是请求/响应**定义**，不是实际响应 |

- `stepTree` 每项只有 `{ref, type}`；`ref` 与 `collection` 中任何 id（item id / metaInfo.id / blockId）**0/49 匹配**，只与 `failures[].cursor.ref` 对应（例：`failures[0].cursor.ref == stepTree[2].ref`）。
- `collection.item[0].item[].response` 全部为空数组（无实际响应）。
- 状态码只能从失败条目里拿：`error.expected` / `error.actual`（数字），或 `error.message` 文本（`... but got 404` / `应该是 200, 实际却是 404`）。
- 通过步骤在 JSON 中**没有任何结果记录**。

### 4.4 failures 条目

```json
{
  "error": {"name":"AssertionError","index":0,"test":"① 状态码为 200",
            "message":"expected response to have status code 200 but got 404",
            "expected":200,"actual":404,
            "stack":"AssertionError: ... at Object.eval sandbox-script.js:1:3)",
            "isNotPlainError":true},
  "at": "assertion:0 in test-script",
  "cursor": {"ref":"…","length":49,"cycles":1,"position":2,"iteration":0,
             "requestIndex":2,"httpRequestId":"…","scriptId":"postProcessors.0.customScript",
             "execution":"…"}
}
```

- `run.failures[].source` 额外带完整步骤定义（`source.id` = collection 步骤 id，`source.name` = 步骤名，如「博客自省问卷15问」），可据此还原步骤名。
- **83 条 ≠ 40 个失败步骤**，一个步骤可产生多条：分布 `AssertionError 37 + HTTP 状态码校验失败 31 + TypeError 8 + 返回数据结构与接口定义不一致 7 = 83`；按 `cursor.requestIndex` 聚合：每步 2 条的 31 步、1 条的 5 步、4 条的 4 步。
- `at` 取值：`assertion:N in test-script`、`request`、`null`（脚本/步骤级错误）。
- 无 `statusCode` 字段可用时，正则 `got (\d{3})` 或 `实际却是 (\d{3})` 可从 message 提取。

## 5. JUnit 报告

### 5.1 位置

`F:\SoftwareTest\期末大作业\TestPilot\.acceptance\cli-run\run.xml`（约 43KB）

### 5.2 结构片段（原文）

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="静态博客测试" tests="126" time="0.369">
  <testsuite id="5b0f8dbe-1182-4d21-a895-21687907093b" timestamp="2026-11-12T11:42:55.487Z"
             time="0.049" tests="3" failures="0" errors="0">
    <testcase name="① 状态码为 200" time="0.049" classname=""/>
    <testcase name="② Content-Type 含 text/html" time="0.049" classname=""/>
    <testcase name="③ 页面含非空 &lt;title>" time="0.049" classname=""/>
  </testsuite>
  <testsuite id="5988eff7-4274-4c33-bc8c-a50f4de19563" timestamp="2026-11-12T11:42:55.487Z"
             time="0.009" tests="3" failures="1" errors="0">
    <testcase name="① 状态码为 200" time="0.009" classname="">
      <failure type="AssertionFailure" message="expected response to have status code 200 but got 404">
        <![CDATA[Failed 1 times.]]>
        <![CDATA[Collection JSON ID: undefined.]]>
        <![CDATA[Collection name: 静态博客测试.]]>
        <![CDATA[Request name: undefined.]]>
        <![CDATA[Test description: ① 状态码为 200.]]>
        <![CDATA[Error message: expected response to have status code 200 but got 404.]]>
        <![CDATA[Stacktrace: AssertionError: expected response ...]]>
      </failure>
    </testcase>
    …
```

### 5.3 逐层含义

| 元素/属性 | 含义 | 实测 |
|---|---|---|
| `testsuites@name` | 场景名 | 静态博客测试 |
| `testsuites@tests` | **断言总数** | 126 |
| `testsuites@time` | 各步骤耗时之和（秒） | 0.369 |
| `testsuite@id` | **步骤 id**（= `run.json` `collection.item[0].item[].id`，49/49 顺序一致） | 首页 = 5b0f8dbe-… |
| `testsuite@timestamp` | **整次运行开始时间**（所有 testsuite 相同，不是步骤时间） | 11:42:55.487Z |
| `testsuite@tests` | 该步骤断言数（本例 3） | 126 = Σ |
| `testsuite@failures` | 该步骤失败断言数 | Σ = 41 |
| `testsuite@time` | **该步骤耗时**（秒，精度 1ms） | 0.049 |
| `testcase@name` | **断言名**（不含步骤名） | ① 状态码为 200 |
| `testcase@classname` | 恒为空串 | "" |
| `testcase@time` | 与所属 testsuite@time 相同（重复步骤耗时，不是断言耗时） | 0.049 |
| `failure@type` | `AssertionFailure` / 其它错误类型 | |
| `failure@message` | 失败信息，**状态码只能从这里正则提取**（`got (\d{3})`） | … got 404 |
| `failure` 内 CDATA | 多段诊断：Failed N times / Collection JSON ID / Collection name / Request name / Test description / Error message / Stacktrace | 前 4 项多为 `undefined` |

### 5.4 JSON + JUnit 联合还原"per-case"

后端需要的 `name / status / durationMs / statusCode` 只能拼出来：

| 字段 | 来源 |
|---|---|
| 步骤名 | `testsuite@id` → `run.json` `collection.item[0].item[]` 按 `id` 匹配取 `name`（JSON 的 `stepTree` 无法直接给名字） |
| 步骤状态 | 该 `testsuite` 有 `failure` 子元素 → FAILED，否则 PASSED（无 skipped/error 实测样本） |
| 步骤耗时 | `testsuite@time` × 1000 |
| 状态码 | `failure@message` 正则 `got (\d{3})`；或 `run.json` `run.failures[]` 中同步骤的 `error.actual`（准确度更高） |
| 断言明细 | `testcase`（name/time）+ `failure`；`run.json` 的 `run.failures[]` 提供 expected/actual/stack |

## 6. CLI 终端输出（stdout，逐行入库）

位置：`.acceptance\cli-run\run.stdout.log`（794 行 / 48.9KB，`--color off` 纯文本）。

### 6.1 行类型（按出现顺序）

| # | 形态（正则/前缀） | 含义 | 样例 |
|---|---|---|---|
| 1 | `apifox` | 固定首行 | `apifox` |
| 2 | 场景名单独一行 | 场景标题 | `静态博客测试` |
| 3 | `□ ` 开头 | 场景块开始 | `□ 静态博客测试` |
| 4 | `└ ` 开头 | **步骤名** | `└ 首页` |
| 5 | `  (GET\|POST) \S+ \[(\d{3})[^,]*, ([^,]+), ([\d.]+)ms\]` | **请求行：方法 URL [状态码, 大小, 耗时]** | `  GET http://127.0.0.1:4000/ [200 OK, 6.51KB, 51.00ms]` |
| 6 | `  √  ` 开头 | 通过的断言 | `  √  ① 状态码为 200` |
| 7 | `  \d+\. ` 开头 | **失败的断言/检查**，编号全局递增 | `  1. ① 状态码为 200` |
| 8 | `  ┌` / `  │` / `  └` 框线 | 脚本 `console.log` 输出 | `  │ '页面标题 = 首页 · 博客功能测试站'` |
| 9 | 空行 | 步骤之间分隔 | |
| 10 | `┌───┬...┐` 表格 | 汇总表（第 436 行起） | 见下 |
| 11 | `   #  失败情况   详情` | 失败清单表头（编号 01..83，与 JSON failures 条数一致） | ` 02.  HTTP 状态码校验失败  博客自省问卷15问` |
| 12 | `Export of (JSON\|JUnit) report (started\|successful)` | 导出标记 | `Export of JUnit report successful` |

### 6.2 样例（原文）

```text
apifox

静态博客测试

□ 静态博客测试
└ 首页
  GET http://127.0.0.1:4000/ [200 OK, 6.51KB, 49.00ms]
  √  ① 状态码为 200
  √  ② Content-Type 含 text/html
  ┌
  │ '页面标题 = 首页 · 博客功能测试站'
  └
  √  ③ 页面含非空 <title>

└ 博客自省问卷15问
  GET http://127.0.0.1:4000/15-questions-for-blog/ [404 File not found, 645B, 9.00ms]
  1. ① 状态码为 200
  √  ② Content-Type 含 text/html
  ┌
  │ '页面标题 = Error response'
  └
  √  ③ 页面含非空 <title>
  2. HTTP 状态码校验失败
```

汇总表（框线内，`--color off` 时仍为全角对齐）：

```text
│                         │               总数 │              失败数 │
│                  循环数 │                  1 │                   1 │
│         HTTP 接口请求数 │                 49 │                  40 │
│                  断言数 │                126 │                  41 │
│ 总耗时: 10.13s
│ 总返回数据: 54.34KB (approx)
│ 平均接口请求耗时: 4.69ms [min: 4.00ms, max: 49.00ms, s.d.: 5.82ms]
```

失败清单（表头行号 451，01..83）：

```text
   #  失败情况                      详情
 01.  AssertionError                ① 状态码为 200
                                    expected response to have status code 200 but got 404
                                    at assertion:0 in test-script
                                    inside "静态博客测试 / 博客自省问卷15问"
 02.  HTTP 状态码校验失败           博客自省问卷15问
                                    HTTP 状态码错误 应该是 200, 实际却是 404
```

### 6.3 解析建议

- 逐行状态机：`□ `→场景；`└ `→当前步骤；请求行→该步骤 HTTP 摘要（状态码/大小/耗时）；`√`→断言通过；`N. `→失败条目（`N` 与失败清单编号同源，可关联）；`inside "场景 / 步骤"`→失败所属步骤。
- 汇总表按 `│` 分行取值，行首中文标签（循环数/HTTP 接口请求数/断言数）稳定。
- 每行末尾去空白；不要按 ANSI 处理（已 `--color off`）。
- stdout 是唯一包含"通过断言 + 每步骤状态码"的产物，建议**原样入库**再异步解析。

## 7. 失败运行样本

命令：`apifox test-scenario run 8863397 --project 8941754 -e 99999999 -r cli,json,junit --color off --out-dir .acceptance/cli-probe --out-file probe-fail-badenv`

- 退出码 1；未生成 json/xml；stdout 只有 JSON 错误包（`success:false` / `error.code:"ERROR"` / `error.message:"错误: 无效的环境。"`），后面跟 `agentHints.nextSteps`（含"检查环境是否有效"等命令提示）。
- 证据：`.acceptance\cli-probe\run-fail-badenv.stdout.log` / `.stderr.log` / `.exit.log`。

## 8. 令牌安全

- 令牌仅存在于 `C:\Users\Lenovo\.apifox\config.toml`，命令行与 `--out-dir` 输出日志中均无令牌；**不要**使用 `--access-token` 参数。
- **风险点**：Apifox 会把令牌明文写入 JSON 报告的 `options.accessToken`（实测长度 41，本次两份报告各 1 处命中，日志无）。后端入库/导出前必须删除 `options` 或对该字段脱敏。
- 本次已就地脱敏：`run.json`、`probe-8863397.json` 中该值替换为 `***REDACTED-TOKEN***`（脚本 `.acceptance\cli-probe\sanitize.py`）；替换后全目录 `grep` 只在脚本源码与 JSON 键名中出现 `accessToken`，无令牌值。
- `.acceptance/` 目前**未被** `.gitignore` 忽略（`git check-ignore` 返回 NOT_IGNORED），提交前需由负责人决定是否加入忽略规则或清理。

## 9. 对后端解析的具体建议

对照现有 `src/main/java/edu/xzit/testpilot/service/ApifoxReportParser.java`：

1. 现有 `collectFailures` 用 `result.failures` + `cursor.requestIndex` 聚合是对的；但建议改用 `run.failures`，因为它多 `source.id/source.name`，可直接拿到步骤名，不必依赖名称猜测。
2. 现有 `parseJunit` 直接遍历全部 `testcase`：得到的是 126 条**断言**而非 49 条**步骤**，且 `name` 是断言名、`classname` 为空。建议改为遍历 `testsuite`：用 `testsuite@id` 到 `run.json` `collection.item[0].item[].id` 取名，步骤状态按该 suite 是否含 `failure` 判定，`durationMs = testsuite@time*1000`，`statusCode` 从 `failure@message`（`got (\d{3})`）或 `run.failures[].error.actual` 提取。
3. 现有 `STATUS_IN_MESSAGE` 正则已覆盖 `got`/`实际却是`/`实际为`，可直接复用；注意 JUnit 里只有 `got NNN` 英文形式。
4. `findReportFile` 用"最大 .json/.xml"选文件：同目录存在历史报告时可能选错，建议按本次运行写入唯一子目录（`runs/<taskId>/`）。
5. 报告解析后务必丢弃 `options`（令牌），并把 stdout 原样保存为执行日志。

## 10. 复现清单

```bash
# 1) 起站点
cd "F:/SoftwareTest/期末大作业/博客功能测试站" && python -m http.server 4000 --directory public --bind 127.0.0.1 &
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/   # 期望 200
# 2) 跑场景
cd "F:/SoftwareTest/期末大作业/TestPilot"
apifox test-scenario run 8863397 --project 8941754 -e 49735657 -r cli,json,junit \
  -n 1 --delay-request 100 --color off --out-dir .acceptance/cli-run --out-file run
echo $?   # 当前站点内容下为 1（40/49 失败）
```

产物（绝对路径）：

| 文件 | 大小 | 内容 |
|---|---|---|
| `F:\SoftwareTest\期末大作业\TestPilot\.acceptance\cli-run\run.json` | 832,485 B | JSON 报告（已脱敏） |
| `F:\SoftwareTest\期末大作业\TestPilot\.acceptance\cli-run\run.xml` | 43,058 B | JUnit 报告 |
| `F:\SoftwareTest\期末大作业\TestPilot\.acceptance\cli-run\run.stdout.log` | 48,870 B / 794 行 | CLI 终端输出 |
| `F:\SoftwareTest\期末大作业\TestPilot\.acceptance\cli-run\run.stderr.log` | 181 B | 仅 Node 警告 |
| `F:\SoftwareTest\期末大作业\TestPilot\.acceptance\cli-run\run.exit.log` | 7 B | `EXIT=1` |
| `F:\SoftwareTest\期末大作业\TestPilot\.acceptance\cli-probe\probe-fail-badenv.*` | — | 无效环境失败样本 |


## 11. 场景与站点版本匹配调查（2026-11-12 追加）

### 11.1 要回答的问题

主运行中 49 步只有 9 步通过、40 步失败（失败多为 404）。需要确认：这是站点没起/程序问题，还是**场景登记的内容与当前站点构建版本不匹配**？以及能否在**不改云端场景、不改环境 baseUrl**的前提下提升通过率？

> 本次调查全程只读本地文件、只写 `.acceptance/` 与 `docs/验收/`；**未修改云端场景、未修改环境配置**。

### 11.2 查找与命中旧构建

在 `F:/SoftwareTest/期末大作业/` 下查找与场景旧 URL 能对上的构建产物，候选包括 `静态博客网站测试/`（含 `public/`、`_待删除存档_20261110/`）、`博客功能测试站.zip` 及备份包。

命中：**`F:/SoftwareTest/期末大作业/静态博客网站测试/public/`**，是一份 hexo 构建（`index.html` 修改时间 2026-09-01 22:25），其中包含场景登记的全部旧页面：

- `/15-questions-for-blog/`、`/2021-annual-summary/` ～ `/2024-annual-summary/` 等旧文章；
- `/archives/2021/08/` 等年/月归档、`/tags/`、`/categories/`、`/about/`、`/friends/`、`/timeline/`、`/travel/`；
- `/rss.xml`、`/atom.xml`、`/feed.json`；
- **不含** `robots.txt`、`sitemap.xml`（正好对应场景里「预期缺失」的两步）。

把该目录起在同一端口 4000（`python -m http.server 4000 --directory public --bind 127.0.0.1`，工作目录 `F:/SoftwareTest/期末大作业/静态博客网站测试`），先用 curl 抽验，再用**与主运行完全相同的命令和同一环境 49735657（baseUrl 仍为 http://127.0.0.1:4000）**重跑场景。

### 11.3 实测结果：9/49 → 38/49

| 站点根目录 | 内容 | 49 步通过 | 失败 | 报告 |
|---|---|---|---|---|
| `F:/SoftwareTest/期末大作业/博客功能测试站/public` | 2026-11-10 构建，仅 12 篇文章 | **9** | 40 | `.acceptance/cli-run/run.json` |
| `F:/SoftwareTest/期末大作业/静态博客网站测试/public` | hexo 构建，含场景全部旧页面 | **38** | 11 | `.acceptance/cli-run-old/run-old.json` |

旧构建运行的 `result.stats`：`steps{total:49, passed:38, failed:11}`、`assertions{total:126, failed:12}`、`requests{total:49, failed:11}`；`timings.responseTime=4669ms`，stdout 汇总为「HTTP 接口请求数 49 / 11、断言数 126 / 12、总耗时 14.02s、平均接口请求耗时 57.91ms [min 5.00ms, max 373.00ms, s.d. 74.37ms]」。退出码仍为 **1**（有失败即 1，与第 3 节一致），并正常导出 JSON/JUnit 报告。

### 11.4 逐条状态码核验

用独立脚本对 49 个 URL 逐条 `curl`（中文路径做 percent-encode、不跟随重定向），**HTTP 状态码与场景期望 49/49 全部一致**：42 个页面步 200；第 45/46/47 步（`sitemap.xml`、`robots.txt`、`no-such-page-xyz`）404；第 48 步（`/about` 无尾斜杠）301 且响应无 body。说明旧构建确实就是场景登记时的版本，失败不是 404 或站点未启动造成的。

### 11.5 剩余 11 个失败步骤及原因

| # | 步骤名 | URL | 期望 | curl 实测 | Apifox 结果 |
|---|---|---|---|---|---|
| 37 | 标签：测试 | `/tags/测试/` | 200 | 200 text/html | FAIL |
| 38 | 标签：技术 | `/tags/技术/` | 200 | 200 text/html | FAIL |
| 39 | 标签：杂谈 | `/tags/杂谈/` | 200 | 200 text/html | FAIL |
| 40 | 标签：杂谈第2页 | `/tags/杂谈/page/2/` | 200 | 200 text/html | FAIL |
| 42 | RSS 订阅源 | `/rss.xml` | 200 | 200 text/xml | FAIL |
| 43 | Atom 订阅源 | `/atom.xml` | 200 | 200 text/xml | FAIL |
| 44 | JSON Feed | `/feed.json` | 200 | 200 application/json | FAIL |
| 45 | sitemap（预期缺失） | `/sitemap.xml` | 404 | 404 text/html | FAIL |
| 46 | robots（预期缺失） | `/robots.txt` | 404 | 404 text/html | FAIL |
| 47 | 不存在路径（404 用例） | `/no-such-page-xyz/` | 404 | 404 text/html | FAIL |
| 48 | 无尾斜杠（301 用例） | `/about` | 301 | 301（无 body） | FAIL |

按成因分三类：

**A. 中文标签页（第 37–40 步，4 步）——apifox 客户端限制。** 请求阶段即报 `TypeError: Request path contains unescaped characters`（客户端不对非 ASCII 路径做 percent-encode），随后 3 条断言因拿不到响应级联失败（`expected t{ …(12) } to have property 'code'`、`Content-Type 实际为: : expected '' to include 'text/html'`、`Cannot read properties of undefined (reading 'match')`）。curl 对编码后的同样路径实测均 200、`<title>` 分别为「标签：测试 / 技术 / 杂谈 / 杂谈」，站点本身完全正常。

**B. 订阅源与 404 步骤（第 42–47 步，6 步）——场景响应体定义与实际不符。** 这 6 步在场景里的 `responseDefinition.contentType` 被设为 `noContent`，但实际响应有 body（rss/atom 为 XML、feed.json 为 JSON；404 由 `python http.server` 返回 HTML 错误页），于是统一报「返回数据结构与接口定义不一致：该响应不应该有 Body」。状态码期望是对的，失败发生在响应体校验层。

**C. 301 步骤（第 48 步，1 步）——客户端自动跟随重定向。** 期望 301，但 apifox 客户端默认跟随重定向后看到 200，报「HTTP 状态码错误 应该是 301, 实际却是 200」，外加同类 `noContent` 的 body 不匹配。该步骤自己的 `responseDefinition.description` 里已写明「需关闭『自动跟随重定向』才看得到 301」。

### 11.6 历史佐证

旧构建目录自带上一轮运行的记录：`_apifox_steps.json` 共 49 条，其中 passed=38、failed=11，失败步骤恰为同一批 11 步（4 个中文标签页 + RSS/Atom/JSON Feed/robots/sitemap/404/301），其 `rv` 字段统一写着 `expect: noContent` / `actual: XML|JSON|HTML`；`_apifox_report_data.json` 的 49 条状态分布为 200×42、null×4（标签页请求阶段失败）、404×3。与本次重跑的 38/49、同一失败集合完全吻合 → 该构建就是场景编写时所对应的版本，11 个失败在场景侧一直存在。

### 11.7 结论

1. 主运行 **9/49** 的根因是**站点内容与场景登记版本不匹配**，不是站点没启动、也不是 TestPilot 程序缺陷（主运行 stdout 中可见 200 OK，失败全是 404/断言失败）。
2. 换用 `静态博客网站测试/public` 后，**不改场景、不改环境 baseUrl（仍为 http://127.0.0.1:4000）**，通过数从 9 提升到 **38/49**，且 49 步 HTTP 状态码全部符合期望。这是该场景在本机可达到的上限。
3. 剩余 11 步失败属于**场景定义 + apifox 客户端限制**（非 ASCII 路径未编码、`noContent` 与实际 body 冲突、自动跟随重定向），与站点无关，重跑不会消失；要全绿必须修改云端场景（标签 URL 做 percent-encode、修正第 42–47 步的响应体定义、单独处理 301 用例）。本次按要求**未修改云端场景**。
4. 验收/演示时若希望展示较高通过率，应把 4000 端口指向旧构建目录；但报告必须如实写 **38/49（11 步失败）**，**不得宣称全部通过**。

### 11.8 复现命令与产物

```bash
# 1) 用旧构建起站（占用 4000，同一时间只能有一个站点）
cd "F:/SoftwareTest/期末大作业/静态博客网站测试" && python -m http.server 4000 --directory public --bind 127.0.0.1 &
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/15-questions-for-blog/   # 期望 200
# 2) 同一场景、同一环境重跑，仅改输出目录
cd "F:/SoftwareTest/期末大作业/TestPilot"
mkdir -p .acceptance/cli-run-old
apifox test-scenario run 8863397 --project 8941754 -e 49735657 -r cli,json,junit \
  -n 1 --delay-request 100 --color off --out-dir .acceptance/cli-run-old --out-file run-old
echo $?   # 1（38 通过 / 11 失败）
```

| 文件 | 大小 | 内容 |
|---|---|---|
| `.acceptance/cli-run-old/run-old.json` | 527,780 B | JSON 报告（`options.accessToken` 已脱敏） |
| `.acceptance/cli-run-old/run-old.xml` | 25,085 B | JUnit 报告 |
| `.acceptance/cli-run-old/run-old.stdout.log` | 24,382 B / 529 行 | CLI 终端输出 |
| `.acceptance/cli-run-old/run-old.stderr.log` | 181 B | 仅 Node 警告 |
| `.acceptance/cli-run-old/run-old.exit.log` | 7 B | `EXIT=1` |
| `.acceptance/cli-run-old/steps-pass-fail.csv` | 4,509 B | 49 步逐条结果（序号/步骤名/URL/curl 状态码/Apifox 结果/失败原因） |
| `.acceptance/cli-probe/steps.json` | — | 49 步定义（id/name/method/url） |
| `.acceptance/cli-probe/curl_old.txt` | 49 行 | 独立 curl 逐条状态码核验 |

### 11.9 备注

- 旧构建位于 TestPilot 仓库之外（同级目录 `静态博客网站测试/`），不会随 TestPilot 打包；换机器验收需另行拷贝，否则只能得到新站的 9/49。
- 切换站点会改变 49 步结果，自动化验收应固定站点来源，并在报告中记录站点目录与构建日期，避免「同一命令结果漂移」。
- 令牌安全同第 8 节：`run-old.json` 中 `options.accessToken` 仅出现 1 次，已就地替换为 `***REDACTED-TOKEN***`，报告仍可正常解析；已扫描 `.acceptance/cli-run-old`、`.acceptance/cli-run`、`.acceptance/cli-probe`、`docs/验收`，无其他令牌痕迹。
