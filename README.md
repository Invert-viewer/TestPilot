# TestPilot

《软件质量保证与测试》课程大作业的自动化测试平台。

## 项目目标

采用 Spring Boot 后端与独立前端，由后端集成 Apifox CLI 执行测试，提供任务管理、执行状态查询、报告查看与结果对比。示例被测网站为徐州工程学院官网：https://www.xzit.edu.cn/。

当前仓库为后端初始化框架，上述业务功能尚待实现。

## 技术与目录

- Java 21、Spring Boot 4、Maven Wrapper
- Spring Web MVC：HTTP 接口与 JSON 序列化
- Jakarta Validation：请求参数校验
- MyBatis、MySQL Connector/J：数据库访问
- Apache Commons CSV：JMeter CSV 结果解析
- Spring Boot Test、H2（仅测试）：无需本机 MySQL 的上下文启动验证
- `src/main/java/edu/xzit/testpilot`：后端代码
- `src/main/resources/application.yaml`：应用配置
- `src/test`：测试代码

## 本地运行

安装 JDK 21 和 MySQL，创建 `testpilot` 数据库。配置数据库环境变量，在仓库根目录执行：

```powershell
$env:JAVA_HOME = '你的 JDK 21 安装目录'
$env:DB_USERNAME = '你的数据库用户名'
$env:DB_PASSWORD = '你的数据库密码'
# 可选：通过 DB_URL 覆盖默认的本机 testpilot 数据库连接。
.\mvnw.cmd spring-boot:run
```

首次运行需要联网下载 Maven 与项目依赖。Apifox CLI 接入后需在执行环境单独安装并配置账号。

Apifox CLI 与 JMeter 是独立安装的外部工具，不作为 Maven 依赖引入。后续使用 JDK 自带的 `ProcessBuilder` 调用，并使用 Spring 线程池执行后台任务；本地文件读写和日志由 JDK 与现有 Spring Boot 依赖提供，无需额外引入框架。工具调用、业务接口和前端尚未实现。

## 构建验证

```powershell
.\mvnw.cmd clean verify
```

测试使用独立的 H2 内存数据库，不读取真实数据库凭据；它用于验证基础启动，不替代后续 MySQL SQL 兼容性与业务测试。

## 协作约定

功能开发使用独立分支，通过 Pull Request 合并。访问令牌、数据库密码和个人环境配置不得提交到仓库。
