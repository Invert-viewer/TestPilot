package edu.xzit.testpilot.web;

import edu.xzit.testpilot.service.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import javax.sql.DataSource;
import java.util.*;

@RestController
@RequestMapping("/api/v1/platform")
public class PlatformController {
    private final PlatformSettings settings;
    private final RemoteAiService ai;
    private final JdbcTemplate db;
    private final DataSource source;
    private final WorkspaceController workspace;
    public PlatformController(PlatformSettings settings,RemoteAiService ai,JdbcTemplate db,DataSource source,WorkspaceController workspace) { this.settings=settings;this.ai=ai;this.db=db;this.source=source;this.workspace=workspace; }
    @GetMapping("/settings") public Object settings(HttpServletRequest req) { return WorkspaceController.ok(Map.of("executor",settings.executor(),"ai",settings.aiPublic()),req); }
    @PutMapping("/settings/executor") public Object executor(@RequestBody Map<String,Object> body,HttpServletRequest req) { PlatformAuth.requireLead(PlatformAuthController.user(req)); return WorkspaceController.ok(settings.saveExecutor(body),req); }
    @PutMapping("/settings/ai") public Object ai(@RequestBody Map<String,Object> body,HttpServletRequest req) { PlatformAuth.requireLead(PlatformAuthController.user(req)); return WorkspaceController.ok(settings.saveAi(body),req); }
    @DeleteMapping("/settings/ai") public Object clearAi(HttpServletRequest req) { PlatformAuth.requireLead(PlatformAuthController.user(req)); settings.clearAi(); return WorkspaceController.ok(settings.aiPublic(),req); }
    @PostMapping("/ai/test") public Object test(HttpServletRequest req) { return WorkspaceController.ok(ai.test(),req); }
    @PostMapping("/ai/compose") public Object compose(@RequestBody Map<String,Object> body,HttpServletRequest req) { return WorkspaceController.ok(ai.compose(Objects.toString(body.get("text"),"")),req); }
    @GetMapping("/about") public Object about(HttpServletRequest req) throws Exception {
        try(var connection=source.getConnection()) {
            var meta=connection.getMetaData(); var counts=new LinkedHashMap<String,Object>();
            counts.put("projects",db.queryForObject("SELECT COUNT(*) FROM workspace_resource WHERE kind='sites'",Integer.class));
            counts.put("environments",db.queryForObject("SELECT COUNT(*) FROM workspace_resource WHERE kind='environments'",Integer.class));
            counts.put("workspaceResources",db.queryForObject("SELECT COUNT(*) FROM workspace_resource",Integer.class));
            counts.put("tasks",db.queryForObject("SELECT COUNT(*) FROM task",Integer.class));
            counts.put("members",db.queryForObject("SELECT COUNT(*) FROM platform_user",Integer.class));
            return WorkspaceController.ok(Map.of("database",meta.getDatabaseProductName(),"databaseVersion",meta.getDatabaseProductVersion(),"catalog",Objects.toString(connection.getCatalog(),""),"connected",connection.isValid(2),"counts",counts,"javaVersion",System.getProperty("java.version"),"backend","Spring Boot 4 · JDBC / MyBatis","frontend","Vue 3 · TypeScript · Vite","version","0.3.0","storage","项目、环境、用例配置和团队保存在关系数据库；执行产物保存在服务器 frontend/.runs"),req);
        }
    }
    @GetMapping("/export") public Object export(HttpServletRequest req) {
        PlatformAuth.requireLead(PlatformAuthController.user(req));
        return WorkspaceController.ok(Map.of("exportedAt",java.time.Instant.now().toString(),"workspace",workspace.get(req).get("data"),"settings",Map.of("executor",settings.executor(),"ai",settings.aiPublic()),"note","不包含账号密码、会话、AI 密钥或执行产物。环境变量按原值导出。"),req);
    }
}
