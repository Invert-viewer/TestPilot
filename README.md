# TestPilot

Vue 3 + Spring Boot + MySQL 自动化测试平台，支持真实 HTTP 调试、共享网站与请求资产、Apifox 场景任务、增量日志、断言结果和报告。组长运行服务，组员使用浏览器访问同一平台。

## 在其他 Windows 电脑部署

准备 Git、JDK 21、Node.js（建议 22 或更高版本）、MySQL 8。将 JAVA_HOME 指向 JDK 21，将 Java、Node/npm 加入 PATH。首次构建需要联网下载 Maven 和 npm 依赖。

```powershell
git clone https://github.com/Invert-viewer/TestPilot.git
cd TestPilot
mysql -uroot -p
```

在 MySQL 命令行执行以下命令。自行替换示例口令，数据库应为空库或本项目已有库。

```sql
CREATE DATABASE IF NOT EXISTS testpilot CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'testpilot'@'localhost' IDENTIFIED BY '替换成自己的强口令';
GRANT ALL PRIVILEGES ON testpilot.* TO 'testpilot'@'localhost';
EXIT;
```

复制配置样例，并在编辑器中填写刚设置的数据库账号与口令。

```powershell
Copy-Item local-application.example.yaml local-application.yaml
notepad local-application.yaml
cd frontend
npm ci
npm run typecheck
npm test
npm run build
cd ..
.\mvnw.cmd package
.\启动组内平台.bat
```

打开 http://127.0.0.1:8080/#/debug 。配置文件 local-application.yaml 已被忽略，实际密码仅保存在自己的电脑。也可通过 DB_URL、DB_USERNAME、DB_PASSWORD 环境变量提供数据库配置。启动自动创建数据表。关闭启动窗口前先等待任务完成，升级时停止服务再重新构建。

## 组员访问

组长用 ipconfig 查看联网网卡的 IPv4 地址，将 http://组长IP:8080/#/debug 发给同一局域网的组员。在 Windows 防火墙专用网络中允许组内网段访问 TCP 8080。组员无需安装 Java、MySQL 或 Node。数据库与 CLI 在组长电脑运行。可执行下列命令检查平台。

```powershell
powershell -ExecutionPolicy Bypass -File .\检查组内平台.ps1
```

## 两种测试入口

- 请求调试直接输入完整 URL，点击「发送真实请求」。目标由后端电脑访问，无需先登记网站。组长在本地配置的 testpilot.debug.allowed-origins 中填写允许测试的精确来源，多个来源用逗号分隔，修改后重启。Query、Header、Cookie、Body 和断言支持逐字段或 JSON 编辑。「运行本地调试」使用模拟响应。保存请求会写入共享数据库，调试历史保留在当前会话。
- 真实场景任务需要另行安装 Apifox CLI，在运行后端的同一 Windows 账号下完成工具登录或凭据配置，并准备有访问权限的场景及被测站点。运行 apifox --help 核对安装。按 local-application.example.yaml 的注释填写自己的 CLI 路径、项目 ID、场景 ID、环境 ID 和站点地址。重启后在「新建任务」选择已登记场景，核对目标再提交。默认配置没有个人场景，也不包含被测博客。

任务详情可以查看状态、日志、失败断言与报告，通过 taskId 链接恢复。网站、环境、请求、实验方案、回归及检查记录在组内共享。并发修改发生冲突时刷新核对后再编辑。已有请求引用网站时，需要先解除该绑定才能删除。旧版浏览器数据可在网站页主动导入。

## 验证与目录

```powershell
cd frontend
npm run typecheck
npm test
npm run build
cd ..
.\mvnw.cmd test
```

前端在 frontend/src，后端在 src/main/java，建表 SQL 在 src/main/resources/schema.sql，接口约定在 docs/前后端接口契约.md。浏览器端到端测试需要运行平台、匹配的已登记场景和本机 Edge，执行前阅读 frontend/e2e 中的真实执行前提。

本地配置、工具凭据、数据库文件、执行报告、依赖缓存、生成产物和交付压缩包均排除提交。仓库默认不附带业务数据。JMeter 执行和完整服务端调试历史仍有待接入；跨工具或跨网站结论需要完整的真实样本。组内模式按可信局域网使用，当前没有成员账号和细分权限。
