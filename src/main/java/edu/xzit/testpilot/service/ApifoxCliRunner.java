package edu.xzit.testpilot.service;

import edu.xzit.testpilot.config.TestPilotProperties;
import edu.xzit.testpilot.model.Models;
import edu.xzit.testpilot.store.TaskStore;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** 调用本机 Apifox CLI 执行已登记场景，并把 stdout/stderr 逐行写入任务日志。 */
@Component
public class ApifoxCliRunner {

    private static final Logger log = LoggerFactory.getLogger(ApifoxCliRunner.class);

    private final TaskStore store;
    private final TestPilotProperties properties;
    private final Map<String, Process> running = new ConcurrentHashMap<>();
    private final Map<String, Boolean> cancelRequested = new ConcurrentHashMap<>();
    private final ApifoxReportParser parser;

    public ApifoxCliRunner(TaskStore store, TestPilotProperties properties, ApifoxReportParser parser) {
        this.store = store;
        this.properties = properties;
        this.parser = parser;
    }

    public record Outcome(int exitCode, Models.ParsedReport report, boolean reportFound, String error) {
    }

    public void requestCancel(String taskId) {
        cancelRequested.put(taskId, Boolean.TRUE);
        Process process = running.get(taskId);
        if (process != null) {
            killTree(process);
        }
    }

    public boolean isCancelRequested(String taskId) {
        return Boolean.TRUE.equals(cancelRequested.get(taskId));
    }

    public Outcome run(String taskId, String scenarioId, String projectId, String apifoxEnvironmentId,
                       int iterations, int delayRequestMs, int timeoutRequestMs) {
        TestPilotProperties.Apifox cfg = properties.getApifox();
        Path runDir = Path.of(cfg.getReportDir()).toAbsolutePath().normalize().resolve(taskId);
        try {
            Files.createDirectories(runDir);
        } catch (IOException e) {
            return new Outcome(-1, new Models.ParsedReport(List.of(), 0, 0, 0, ""), false, "无法创建报告目录：" + e.getMessage());
        }
        store.markRunning(taskId, OffsetDateTime.now().toString(), runDir.toString());

        List<String> command = buildCommand(cfg, scenarioId, projectId, apifoxEnvironmentId, iterations,
                delayRequestMs, timeoutRequestMs, runDir);
        String readable = String.join(" ", command);
        append(taskId, "PLATFORM", "执行命令：" + readable);
        append(taskId, "PLATFORM", "报告目录：" + runDir);

        Process process;
        try {
            ProcessBuilder builder = new ProcessBuilder(command);
            builder.directory(runDir.toFile());
            builder.redirectErrorStream(false);
            process = builder.start();
        } catch (IOException e) {
            String message = "无法启动 Apifox CLI：" + e.getMessage() + "（检查 testpilot.apifox.cli-path 配置）";
            append(taskId, "PLATFORM", message);
            return new Outcome(-1, new Models.ParsedReport(List.of(), 0, 0, 0, ""), false, message);
        }
        running.put(taskId, process);
        Thread out = pump(taskId, "STDOUT", process.getInputStream());
        Thread err = pump(taskId, "STDERR", process.getErrorStream());

        int exitCode;
        boolean timedOut = false;
        try {
            boolean finished = process.waitFor(Math.max(30, cfg.getTimeoutSeconds()), TimeUnit.SECONDS);
            if (!finished) {
                timedOut = true;
                killTree(process);
                process.waitFor(10, TimeUnit.SECONDS);
            }
            exitCode = process.exitValue();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            killTree(process);
            exitCode = -1;
        } finally {
            running.remove(taskId);
            joinQuietly(out);
            joinQuietly(err);
        }

        append(taskId, "PLATFORM", "CLI 退出码：" + exitCode);
        if (timedOut) {
            return new Outcome(exitCode, new Models.ParsedReport(List.of(), 0, 0, 0, ""), false,
                    "Apifox CLI 执行超时（超过 " + cfg.getTimeoutSeconds() + " 秒），已终止进程");
        }

        Models.ParsedReport report = parser.parse(runDir);
        boolean reportFound = hasReportFile(runDir);
        if (reportFound) {
            redactAccessToken(runDir);
        }
        if (!reportFound) {
            String hint = isCancelRequested(taskId) ? "任务已取消" : "Apifox CLI 未生成 JSON/JUnit 报告（退出码 " + exitCode + "）";
            return new Outcome(exitCode, report, false, hint);
        }
        return new Outcome(exitCode, report, true, null);
    }

    private List<String> buildCommand(TestPilotProperties.Apifox cfg, String scenarioId, String projectId,
                                      String apifoxEnvironmentId, int iterations, int delayRequestMs,
                                      int timeoutRequestMs, Path runDir) {
        List<String> command = new ArrayList<>();
        String shell = cfg.getShell() == null || cfg.getShell().isBlank() ? "cmd.exe" : cfg.getShell();
        command.add(shell);
        command.add("/c");
        command.add(cfg.getCliPath());
        command.add("test-scenario");
        command.add("run");
        command.add(String.valueOf(scenarioId));
        if (projectId != null && !projectId.isBlank()) {
            command.add("--project");
            command.add(projectId);
        }
        if (apifoxEnvironmentId != null && !apifoxEnvironmentId.isBlank()) {
            command.add("-e");
            command.add(apifoxEnvironmentId);
        }
        command.add("-r");
        command.add("cli,json,junit");
        command.add("--out-dir");
        command.add(runDir.toString());
        command.add("--out-file");
        command.add("run");
        command.add("-n");
        command.add(String.valueOf(Math.max(1, iterations)));
        command.add("--delay-request");
        command.add(String.valueOf(Math.max(0, delayRequestMs)));
        if (timeoutRequestMs > 0) {
            command.add("--timeout-request");
            command.add(String.valueOf(timeoutRequestMs));
        }
        command.add("--color");
        command.add("off");
        return command;
    }

    /** Apifox CLI 会把 access_token 明文写进 JSON 报告的 options 字段，落盘前必须脱敏。 */
    private void redactAccessToken(Path runDir) {
        try (var stream = Files.list(runDir)) {
            for (Path file : stream.filter(p -> p.getFileName().toString().toLowerCase().endsWith(".json")).toList()) {
                String text = Files.readString(file, StandardCharsets.UTF_8);
                String redacted = text.replaceAll("(\"accessToken\"\\s*:\\s*\")([^\"]*)(\")", "$1***REDACTED-TOKEN***$3");
                if (!redacted.equals(text)) {
                    Files.writeString(file, redacted, StandardCharsets.UTF_8);
                    log.info("已脱敏报告文件中的 accessToken：{}", file.getFileName());
                }
            }
        } catch (IOException e) {
            log.warn("脱敏报告文件失败：{}", e.getMessage());
        }
    }

    private boolean hasReportFile(Path runDir) {
        try (var stream = Files.list(runDir)) {
            return stream.anyMatch(p -> {
                String name = p.getFileName().toString().toLowerCase();
                return (name.endsWith(".json") || name.endsWith(".xml")) && p.toFile().length() > 2;
            });
        } catch (IOException e) {
            return false;
        }
    }

    private Thread pump(String taskId, String streamName, java.io.InputStream in) {
        Thread thread = new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    append(taskId, streamName, line);
                }
            } catch (IOException e) {
                log.debug("读取 {} 流失败 taskId={}：{}", streamName, taskId, e.getMessage());
            }
        }, "apifox-" + streamName.toLowerCase() + "-" + taskId);
        thread.setDaemon(true);
        thread.start();
        return thread;
    }

    private void append(String taskId, String stream, String text) {
        String lower=text.toLowerCase(java.util.Locale.ROOT);
        if (java.util.stream.Stream.of("authorization", "cookie", "accesstoken", "access_token", "access-token", "password", "private key").anyMatch(lower::contains))
            text="[敏感日志行已隐藏]";
        try {
            store.appendLog(taskId, OffsetDateTime.now().toString(), stream,
                    text.length() > 3900 ? text.substring(0, 3900) + "…（截断）" : text);
        } catch (Exception e) {
            log.warn("写入任务日志失败 taskId={}", taskId);
        }
    }

    private void killTree(Process process) {
        try {
            Process killer = new ProcessBuilder("taskkill", "/T", "/F", "/PID", String.valueOf(process.pid()))
                    .redirectErrorStream(true).start();
            killer.waitFor(10, TimeUnit.SECONDS);
        } catch (Exception ignored) {
            process.destroyForcibly();
        }
    }

    private void joinQuietly(Thread thread) {
        try {
            thread.join(3000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
