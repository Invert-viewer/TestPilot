package edu.xzit.testpilot.web;

import java.util.Map;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 仅本地开发用：优雅关闭 Spring 上下文，让 H2 正常落盘。
 * 强杀 JVM 会让 H2 数据文件变成只读（见 PLAN.md 已知问题），验收重启请走这个入口。
 */
@RestController
@RequestMapping("/api/v1/admin")
public class AdminController {

    private final ConfigurableApplicationContext context;

    public AdminController(ConfigurableApplicationContext context) {
        this.context = context;
    }

    @PostMapping("/shutdown")
    public Map<String, Object> shutdown(jakarta.servlet.http.HttpServletRequest request) throws java.net.UnknownHostException {
        if (!java.net.InetAddress.getByName(request.getRemoteAddr()).isLoopbackAddress() || request.getHeader("Origin") != null) throw new ApiException(org.springframework.http.HttpStatus.FORBIDDEN,"LOCAL_ONLY","仅允许本机维护");
        Thread thread = new Thread(() -> {
            try {
                Thread.sleep(300);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            try { context.close(); } catch (Throwable ignored) { }
            Runtime.getRuntime().halt(0);
        }, "testpilot-graceful-shutdown");
        thread.setDaemon(false);
        thread.start();
        return ApiResult.ok(Map.of("stopping", true), "-");
    }
}
