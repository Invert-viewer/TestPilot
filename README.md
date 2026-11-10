# TestPilot

《软件质量保证与测试》课程大作业的自动化测试平台。

## 项目目标

采用 Spring Boot 后端与独立前端，由后端集成 Apifox CLI 执行测试，提供任务管理、执行状态查询、报告查看与结果对比。示例被测网站为徐州工程学院官网：https://www.xzit.edu.cn/。

当前仓库为后端初始化框架，上述业务功能尚待实现。

## 技术与目录

- Java 21、Spring Boot、Maven Wrapper
- `src/main/java/edu/xzit/testpilot`：后端代码
- `src/main/resources/application.yaml`：应用配置
- `src/test`：测试代码

## 本地运行

安装 JDK 21，在仓库根目录执行：

```powershell
.\mvnw.cmd spring-boot:run
```

首次运行需要联网下载 Maven 与项目依赖。Apifox CLI 接入后需在执行环境单独安装并配置账号。

## 协作约定

功能开发使用独立分支，通过 Pull Request 合并。访问令牌、数据库密码和个人环境配置不得提交到仓库。
