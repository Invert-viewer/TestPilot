package edu.xzit.testpilot.service;

import edu.xzit.testpilot.config.TestPilotProperties;
import edu.xzit.testpilot.model.Models;
import edu.xzit.testpilot.store.TaskStore;
import edu.xzit.testpilot.util.Json;
import edu.xzit.testpilot.util.JsonWriter;
import edu.xzit.testpilot.web.ApiException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

@Service
public class TaskService {

    private static final Logger log = LoggerFactory.getLogger(TaskService.class);
    private static final String TOOL_APIFOX = "APIFOX_CLI";

    private final TaskStore store;
    private final ApifoxCliRunner runner;
    private final TestPilotProperties properties;
    private final ExecutorService executor = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "testpilot-task-runner");
        thread.setDaemon(true);
        return thread;
    });

    public TaskService(TaskStore store, ApifoxCliRunner runner, TestPilotProperties properties) {
        this.store = store;
        this.runner = runner;
        this.properties = properties;
    }

    // ------------------------------------------------------------ lifecycle

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        seedAssets();
        recoverInterruptedTasks();
    }

    private void seedAssets() {
        String now = now();
        for (TestPilotProperties.SeedAsset asset : properties.getApifox().getAssets()) {
            if (asset.getId() == null || asset.getId().isBlank() || store.assetExists(asset.getId())
                    || store.isAssetTombstoned(asset.getId())) {
                continue;
            }
            Map<String, Object> source = new LinkedHashMap<>();
            source.put("projectId", asset.getProjectId());
            source.put("scenarioId", asset.getScenarioId());
            source.put("apifoxEnvironmentId", asset.getApifoxEnvironmentId());
            source.put("environmentName", asset.getEnvironmentName());
            source.put("siteUrl", asset.getSiteUrl());
            store.insertAsset(asset.getId(), asset.getName(), asset.getTool(), asset.getKind(),
                    JsonWriter.write(source), asset.getScenarioKey(), "[]", 1, now);
            log.info("登记工具资产 {}（Apifox 场景 {}）", asset.getId(), asset.getScenarioId());
        }
    }

    private void recoverInterruptedTasks() {
        for (Map<String, Object> row : store.findNonTerminalTasks()) {
            String id = str(row.get("id"));
            store.finishTask(id, "ERROR", "NOT_EVALUATED", now(), null, "SERVICE_RESTARTED",
                    "服务重启，任务执行被中断，请重新提交", null, null, null);
            store.appendLog(id, now(), "PLATFORM", "服务重启，任务执行被中断");
        }
    }

    // --------------------------------------------------------------- assets

    public Map<String, Object> listAssets(String tool, int page, int pageSize) {
        page = Math.max(1, page);
        pageSize = clampPageSize(pageSize);
        int offset = (page - 1) * pageSize;
        List<Map<String, Object>> rows = store.listAssets(tool, offset, pageSize);
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", row.get("id"));
            item.put("name", row.get("name"));
            item.put("tool", row.get("tool"));
            item.put("kind", row.get("kind"));
            item.put("version", row.get("version"));
            item.put("scenarioKey", row.get("scenario_key"));
            item.put("source", parseJsonObject(row.get("source_json")));
            item.put("requestRefs", parseJsonList(row.get("request_refs_json")));
            items.add(item);
        }
        return pageResult(items, page, pageSize, store.countAssets(tool));
    }

    // ---------------------------------------------------------------- tasks

    public CreateOutcome createTask(Map<String, Object> body, String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw ApiException.validation("缺少请求头 Idempotency-Key");
        }
        Map<String, String> fieldErrors = new LinkedHashMap<>();

        String tool = trim(str(body.get("tool")));
        if (tool.isEmpty()) {
            tool = TOOL_APIFOX;
        }
        if (!TOOL_APIFOX.equals(tool)) {
            fieldErrors.put("tool", "本轮仅支持 APIFOX_CLI，JMeter 任务留待后续阶段");
        }
        String assetId = trim(str(body.get("assetId")));
        if (assetId.isEmpty()) {
            fieldErrors.put("assetId", "缺少 assetId");
        }
        Map<String, Object> asset = assetId.isEmpty() ? null : store.findAsset(assetId);
        if (!assetId.isEmpty() && asset == null) {
            fieldErrors.put("assetId", "工具资产不存在：" + assetId);
        }
        if (!fieldErrors.isEmpty()) {
            throw validation(fieldErrors);
        }
        if (!TOOL_APIFOX.equals(str(asset.get("tool")))) {
            throw validation(Map.of("assetId", "该资产不是 APIFOX_CLI 场景"));
        }

        int assetVersion = asset.get("version") instanceof Number number ? number.intValue() : 1;
        Integer bodyVersion = optionalInt(body.get("assetVersion"));
        if (bodyVersion != null && bodyVersion != assetVersion) {
            throw new ApiException(org.springframework.http.HttpStatus.CONFLICT, "ASSET_VERSION_CONFLICT",
                    "工具资产版本已变化，当前版本为 " + assetVersion);
        }

        Map<String, Object> parameters = mapOrEmpty(body.get("parameters"));
        Integer iterations = optionalInt(parameters.get("iterations"));
        Integer delayRequestMs = optionalInt(parameters.get("delayRequestMs"));
        Integer timeoutRequestMs = optionalInt(parameters.get("timeoutRequestMs"));
        if (iterations != null && (iterations < 1 || iterations > 100)) {
            fieldErrors.put("parameters.iterations", "iterations 取值范围 1~100");
        }
        if (delayRequestMs != null && (delayRequestMs < 0 || delayRequestMs > 60000)) {
            fieldErrors.put("parameters.delayRequestMs", "delayRequestMs 取值范围 0~60000");
        }
        if (timeoutRequestMs != null && (timeoutRequestMs < 1 || timeoutRequestMs > 600000)) {
            fieldErrors.put("parameters.timeoutRequestMs", "timeoutRequestMs 取值范围 1~600000");
        }
        if (!fieldErrors.isEmpty()) {
            throw validation(fieldErrors);
        }
        int finalIterations = iterations == null ? 1 : iterations;
        int finalDelay = delayRequestMs == null ? 100 : delayRequestMs;
        int finalTimeout = timeoutRequestMs == null ? 0 : timeoutRequestMs;

        String name = trim(str(body.get("name")));
        if (name.isEmpty()) {
            name = str(asset.get("name"));
        }
        Map<String, Object> source = parseJsonObject(asset.get("source_json"));
        String siteId = trim(str(body.get("siteId")));
        if (siteId.isEmpty()) {
            siteId = trim(str(source.get("siteUrl")));
        }
        String environmentId = trim(str(body.get("environmentId")));
        if (environmentId.isEmpty()) {
            environmentId = trim(str(source.get("apifoxEnvironmentId")));
        }

        Map<String, Object> normalized = new TreeMap<>();
        normalized.put("name", name);
        normalized.put("siteId", siteId);
        normalized.put("environmentId", environmentId);
        normalized.put("tool", tool);
        normalized.put("assetId", assetId);
        normalized.put("assetVersion", assetVersion);
        normalized.put("parameters", new TreeMap<>(Map.of(
                "iterations", finalIterations,
                "delayRequestMs", finalDelay,
                "timeoutRequestMs", finalTimeout)));
        String canonical = JsonWriter.write(normalized);
        String hash = sha256(canonical);

        Map<String, Object> existing = store.findTaskByIdempotencyKey(idempotencyKey);
        if (existing != null) {
            if (hash.equals(str(existing.get("request_hash")))) {
                return new CreateOutcome(false, toSummary(existing));
            }
            throw new ApiException(org.springframework.http.HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT",
                    "同一 Idempotency-Key 已用于不同的请求内容");
        }

        String id = "task-" + UUID.randomUUID().toString().replace("-", "").substring(0, 20);
        String createdAt = now();
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", id);
        row.put("name", name);
        row.put("siteId", siteId);
        row.put("environmentId", environmentId);
        row.put("tool", tool);
        row.put("assetId", assetId);
        row.put("assetVersion", assetVersion);
        row.put("status", "QUEUED");
        row.put("outcome", "NOT_EVALUATED");
        row.put("iterations", finalIterations);
        row.put("delayRequestMs", finalDelay);
        row.put("timeoutRequestMs", finalTimeout);
        row.put("createdAt", createdAt);
        row.put("startedAt", null);
        row.put("finishedAt", null);
        row.put("sourceTaskId", null);
        row.put("idempotencyKey", idempotencyKey);
        row.put("requestHash", hash);
        row.put("exitCode", null);
        row.put("errorCode", null);
        row.put("errorMessage", null);
        row.put("summaryJson", null);
        row.put("metricsJson", null);
        row.put("reportText", null);
        row.put("runDir", null);
        try {
            store.insertTask(row);
        } catch (org.springframework.dao.DuplicateKeyException duplicate) {
            Map<String, Object> raced = store.findTaskByIdempotencyKey(idempotencyKey);
            if (raced != null && hash.equals(str(raced.get("request_hash")))) {
                return new CreateOutcome(false, toSummary(raced));
            }
            throw new ApiException(org.springframework.http.HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT",
                    "同一 Idempotency-Key 已用于不同的请求内容");
        }
        store.appendLog(id, createdAt, "PLATFORM", "任务已创建，等待执行（工具资产 " + assetId + "）");
        executor.submit(() -> executeTask(id));
        log.info("创建任务 {} asset={} scenario={}", id, assetId, source.get("scenarioId"));
        return new CreateOutcome(true, toSummary(store.findTask(id)));
    }

    public record CreateOutcome(boolean created, Map<String, Object> body) {
    }

    private void executeTask(String taskId) {
        Map<String, Object> row = store.findTask(taskId);
        if (row == null || !"QUEUED".equals(str(row.get("status")))) {
            return;
        }
        Map<String, Object> asset = store.findAsset(str(row.get("asset_id")));
        Map<String, Object> source = asset == null ? Map.of() : parseJsonObject(asset.get("source_json"));
        String scenarioId = trim(str(source.get("scenarioId")));
        String projectId = trim(str(source.get("projectId")));
        String apifoxEnvId = trim(str(source.get("apifoxEnvironmentId")));
        if (scenarioId.isEmpty()) {
            finishWithError(taskId, "INVALID_ASSET", "工具资产缺少 Apifox scenarioId，无法执行");
            return;
        }

        int iterations = intOr(row.get("iterations"), 1);
        int delay = intOr(row.get("delay_request_ms"), 100);
        int timeout = intOr(row.get("timeout_request_ms"), 0);
        ApifoxCliRunner.Outcome outcome = runner.run(taskId, scenarioId, projectId, apifoxEnvId, iterations, delay, timeout);
        boolean cancelRequested = runner.isCancelRequested(taskId);
        Map<String, Object> latest = store.findTask(taskId);
        boolean cancelling = latest != null && "CANCELLING".equals(str(latest.get("status")));

        if (cancelRequested || cancelling) {
            store.finishTask(taskId, "CANCELLED", "NOT_EVALUATED", now(), outcome.exitCode(), null,
                    "任务已取消", null, null, null);
            store.appendLog(taskId, now(), "PLATFORM", "任务已取消");
            return;
        }

        if (outcome.error() != null) {
            store.finishTask(taskId, "ERROR", "NOT_EVALUATED", now(), outcome.exitCode(), "TOOL_EXECUTION_FAILED",
                    truncate(outcome.error()), null, null, null);
            store.appendLog(taskId, now(), "PLATFORM", "任务失败：" + outcome.error());
            return;
        }

        List<Models.ParsedCase> cases = outcome.report() == null ? List.of() : outcome.report().cases();
        String summaryJson;
        String metricsJson;
        String status;
        String outcomeValue;
        if (!outcome.reportFound()) {
            status = "ERROR";
            outcomeValue = "NOT_EVALUATED";
            store.finishTask(taskId, status, outcomeValue, now(), outcome.exitCode(), "TOOL_EXECUTION_FAILED",
                    "Apifox CLI 未生成报告", null, null, null);
            return;
        }

        store.deleteResults(taskId);
        int order = 0;
        int passed = 0;
        int failed = 0;
        int skipped = 0;
        int notEvaluated = 0;
        List<Integer> durations = new ArrayList<>();
        for (Models.ParsedCase item : cases) {
            order++;
            store.insertResult(taskId, order, item.caseId(), item.name(), item.status(), item.durationMs(),
                    item.statusCode(), item.failureKind(), truncate(item.failureMessage()),
                    JsonWriter.write(assertionMaps(item.assertions())));
            switch (item.status()) {
                case "PASSED" -> passed++;
                case "FAILED" -> failed++;
                case "SKIPPED" -> skipped++;
                default -> notEvaluated++;
            }
            if (item.durationMs() != null) {
                durations.add(item.durationMs());
            }
        }
        boolean parsed = !cases.isEmpty();
        Map<String, Object> summary = new LinkedHashMap<>();
        if (parsed) {
            int total = passed + failed + skipped + notEvaluated;
            summary.put("totalCases", total);
            summary.put("passedCases", passed);
            summary.put("failedCases", failed);
            summary.put("skippedCases", skipped);
            summary.put("notEvaluatedCases", notEvaluated);
        } else {
            summary.put("totalCases", null);
            summary.put("passedCases", null);
            summary.put("failedCases", null);
            summary.put("skippedCases", null);
            summary.put("notEvaluatedCases", null);
        }
        summaryJson = JsonWriter.write(summary);
        metricsJson = JsonWriter.write(metrics(cases, durations, passed, failed,
                outcome.report().passedAssertions(), outcome.report().failedAssertions(),
                outcome.report().skippedAssertions()));

        status = "FINISHED";
        if (failed > 0) {
            outcomeValue = "FAILED";
        } else if (passed > 0) {
            outcomeValue = "PASSED";
        } else {
            outcomeValue = "NOT_EVALUATED";
        }
        store.finishTask(taskId, status, outcomeValue, now(), outcome.exitCode(), null, null,
                summaryJson, metricsJson, null);
        store.appendLog(taskId, now(), "PLATFORM", String.format(
                "任务完成：共 %d 条用例，通过 %d，失败 %d，跳过 %d，未执行 %d",
                passed + failed + skipped + notEvaluated, passed, failed, skipped, notEvaluated));
    }

    private void finishWithError(String taskId, String code, String message) {
        store.finishTask(taskId, "ERROR", "NOT_EVALUATED", now(), null, code, message, null, null, null);
        store.appendLog(taskId, now(), "PLATFORM", "任务失败：" + message);
    }

    private List<Map<String, Object>> assertionMaps(List<Models.ParsedAssertion> assertions) {
        List<Map<String, Object>> list = new ArrayList<>();
        for (Models.ParsedAssertion assertion : assertions) {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("id", assertion.id());
            map.put("type", assertion.type());
            map.put("target", assertion.target());
            map.put("operator", assertion.operator());
            map.put("expected", assertion.expected());
            map.put("actual", assertion.actual());
            map.put("status", assertion.status());
            map.put("message", assertion.message());
            list.add(map);
        }
        return list;
    }

    private Map<String, Object> metrics(List<Models.ParsedCase> cases, List<Integer> durations, int passed, int failed,
                                        int passedAssertions, int failedAssertions, int skippedAssertions) {
        Map<String, Object> metrics = new LinkedHashMap<>();
        int total = cases.size();
        metrics.put("sampleCount", total == 0 ? null : total);
        if (durations.isEmpty()) {
            metrics.put("avgResponseMs", null);
            metrics.put("p95ResponseMs", null);
            metrics.put("timedSampleCount", null);
        } else {
            double avg = durations.stream().mapToInt(Integer::intValue).average().orElse(0);
            List<Integer> sorted = new ArrayList<>(durations);
            sorted.sort(Comparator.naturalOrder());
            int rank = (int) Math.ceil(sorted.size() * 0.95) - 1;
            rank = Math.max(0, Math.min(rank, sorted.size() - 1));
            metrics.put("avgResponseMs", round(avg));
            metrics.put("p95ResponseMs", sorted.get(rank));
            metrics.put("timedSampleCount", durations.size());
        }
        if (total == 0) {
            metrics.put("throughputRps", null);
            metrics.put("errorRate", null);
            metrics.put("passRate", null);
        } else {
            metrics.put("throughputRps", null);
            metrics.put("errorRate", round((double) failed / total));
            metrics.put("passRate", round((double) passed / total));
        }
        if (passed + failed == 0) {
            metrics.put("evaluatedPassRate", null);
        } else {
            metrics.put("evaluatedPassRate", round((double) passed / (passed + failed)));
        }
        int assertions = passedAssertions + failedAssertions;
        metrics.put("assertionPassRate", assertions == 0 ? null : round((double) passedAssertions / assertions));
        metrics.put("passedAssertions", assertions == 0 ? null : passedAssertions);
        metrics.put("failedAssertions", assertions == 0 ? null : failedAssertions);
        metrics.put("skippedAssertions", assertions == 0 ? null : skippedAssertions);
        return metrics;
    }

    // --------------------------------------------------------------- queries

    public Map<String, Object> listTasks(String siteId, String tool, String status, String outcome, int page, int pageSize) {
        page = Math.max(1, page);
        pageSize = clampPageSize(pageSize);
        int offset = (page - 1) * pageSize;
        List<Map<String, Object>> rows = store.listTasks(siteId, tool, status, outcome, offset, pageSize);
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            items.add(toSummary(row));
        }
        return pageResult(items, page, pageSize, store.countTasks(siteId, tool, status, outcome));
    }

    public Map<String, Object> getTask(String id) {
        Map<String, Object> row = requireTask(id);
        Map<String, Object> summary = toSummary(row);
        Map<String, Object> assetInfo = new LinkedHashMap<>();
        assetInfo.put("id", row.get("asset_id"));
        assetInfo.put("version", row.get("asset_version"));
        Map<String, Object> assetRow = store.findAsset(str(row.get("asset_id")));
        assetInfo.put("name", assetRow == null ? null : assetRow.get("name"));
        assetInfo.put("tool", row.get("tool"));
        summary.put("asset", assetInfo);
        summary.put("parameters", parametersOf(row));
        summary.put("exitCode", row.get("exit_code"));
        summary.put("errorCode", row.get("error_code"));
        summary.put("errorMessage", row.get("error_message"));
        return summary;
    }

    public Map<String, Object> logs(String taskId, long cursor, int limit) {
        Map<String, Object> row = requireTask(taskId);
        int safeLimit = Math.max(1, Math.min(limit, 1000));
        List<Map<String, Object>> rows = store.logs(taskId, Math.max(0, cursor), safeLimit + 1);
        boolean hasMore = rows.size() > safeLimit;
        List<Map<String, Object>> items = new ArrayList<>();
        long nextCursor = cursor;
        int count = 0;
        for (Map<String, Object> logRow : rows) {
            if (count++ >= safeLimit) {
                break;
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("time", logRow.get("log_time"));
            item.put("stream", logRow.get("stream"));
            item.put("text", logRow.get("text"));
            items.add(item);
            nextCursor = logRow.get("seq") instanceof Number number ? number.longValue() : nextCursor;
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("items", items);
        body.put("nextCursor", items.isEmpty() ? cursor : nextCursor);
        body.put("hasMore", hasMore);
        body.put("complete", isTerminal(str(row.get("status"))) && !hasMore);
        return body;
    }

    public Map<String, Object> results(String taskId, String status, int page, int pageSize) {
        requireTask(taskId);
        page = Math.max(1, page);
        pageSize = clampPageSize(pageSize);
        int offset = (page - 1) * pageSize;
        List<Map<String, Object>> rows = store.listResults(taskId, status, offset, pageSize);
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            items.add(resultRow(row));
        }
        return pageResult(items, page, pageSize, store.countResults(taskId, status));
    }

    public Map<String, Object> resultDetail(String taskId, String caseId) {
        requireTask(taskId);
        Map<String, Object> row = store.findResult(taskId, caseId);
        if (row == null) {
            throw ApiException.notFound("用例不存在：" + caseId);
        }
        Map<String, Object> detail = resultRow(row);
        detail.put("assertions", parseJsonList(row.get("assertions_json")));
        return detail;
    }

    public Map<String, Object> report(String taskId) {
        Map<String, Object> row = requireTask(taskId);
        if (!isTerminal(str(row.get("status")))) {
            throw new ApiException(org.springframework.http.HttpStatus.CONFLICT, "REPORT_NOT_READY",
                    "任务尚未结束，报告不可用");
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("taskId", taskId);
        body.put("summary", parseJsonObject(row.get("summary_json")));
        body.put("metrics", parseJsonObject(row.get("metrics_json")));
        body.put("files", reportFiles(row));
        return body;
    }

    public String reportHtml(String taskId) {
        Map<String, Object> row = requireTask(taskId);
        if (!isTerminal(str(row.get("status")))) {
            throw new ApiException(org.springframework.http.HttpStatus.CONFLICT, "REPORT_NOT_READY",
                    "任务尚未结束，报告不可用");
        }
        Map<String, Object> summary = parseJsonObject(row.get("summary_json"));
        Map<String, Object> metrics = parseJsonObject(row.get("metrics_json"));
        List<Map<String, Object>> cases = store.allResults(taskId);
        StringBuilder html = new StringBuilder();
        html.append("<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">")
                .append("<title>TestPilot 报告 ").append(escape(id(taskId))).append("</title>")
                .append("<style>body{font-family:system-ui,'Microsoft YaHei',sans-serif;margin:32px;color:#1f2328;max-width:1100px}")
                .append("h1{font-size:22px}h2{font-size:16px;margin-top:28px}table{border-collapse:collapse;width:100%;margin-top:8px}")
                .append("th,td{border:1px solid #d0d7de;padding:6px 10px;font-size:13px;text-align:left}")
                .append("th{background:#f6f8fa}td.failed{color:#b42318}td.passed{color:#1a7f37}.muted{color:#656d76}")
                .append("code{font-size:12px;background:#f6f8fa;padding:1px 4px;border-radius:4px}</style></head><body>");
        html.append("<h1>TestPilot 测试报告</h1>");
        html.append("<p class=\"muted\">任务 <code>").append(escape(id(taskId))).append("</code> · ")
                .append(escape(str(row.get("tool")))).append(" · 状态 ").append(escape(str(row.get("status"))))
                .append(" · 结论 ").append(escape(str(row.get("outcome")))).append("</p>");
        html.append("<p>创建 ").append(escape(str(row.get("created_at")))).append(" · 开始 ")
                .append(escape(str(row.get("started_at")))).append(" · 结束 ")
                .append(escape(str(row.get("finished_at")))).append("</p>");
        html.append("<h2>统计</h2><table>");
        html.append("<tr><th>总用例</th><th>通过</th><th>失败</th><th>跳过</th><th>未执行</th></tr><tr>");
        for (String key : List.of("totalCases", "passedCases", "failedCases", "skippedCases", "notEvaluatedCases")) {
            html.append("<td>").append(escape(display(summary, key))).append("</td>");
        }
        html.append("</tr></table>");
        html.append("<h2>指标</h2><table><tr><th>指标</th><th>值</th></tr>");
        for (Map.Entry<String, Object> entry : metrics.entrySet()) {
            html.append("<tr><td>").append(escape(entry.getKey())).append("</td><td>")
                    .append(escape(display(metrics, entry.getKey()))).append("</td></tr>");
        }
        html.append("</table>");
        html.append("<h2>用例明细</h2><table><tr><th>#</th><th>用例</th><th>状态</th><th>耗时(ms)</th><th>状态码</th><th>失败说明</th></tr>");
        int index = 0;
        for (Map<String, Object> caseRow : cases) {
            index++;
            String status = str(caseRow.get("status"));
            html.append("<tr><td>").append(index).append("</td><td>").append(escape(str(caseRow.get("name"))))
                    .append("</td><td class=\"").append(status.equals("FAILED") ? "failed" : status.equals("PASSED") ? "passed" : "")
                    .append("\">").append(escape(status)).append("</td><td>")
                    .append(escape(str(caseRow.get("duration_ms")))).append("</td><td>")
                    .append(escape(str(caseRow.get("status_code")))).append("</td><td>")
                    .append(escape(str(caseRow.get("failure_message")))).append("</td></tr>");
        }
        html.append("</table>");
        html.append("<p class=\"muted\">由 TestPilot 生成，数据来源：Apifox CLI 报告。</p></body></html>");
        return html.toString();
    }

    public Map<String, Object> cancel(String taskId) {
        Map<String, Object> row = requireTask(taskId);
        String status = str(row.get("status"));
        switch (status) {
            case "CANCELLED" -> {
                return toSummary(row);
            }
            case "QUEUED" -> {
                store.finishTask(taskId, "CANCELLED", "NOT_EVALUATED", now(), null, null, "任务已取消",
                        null, null, null);
                store.appendLog(taskId, now(), "PLATFORM", "任务在排队阶段被取消");
                return toSummary(store.findTask(taskId));
            }
            case "RUNNING" -> {
                store.updateStatus(taskId, "CANCELLING", null, null);
                store.appendLog(taskId, now(), "PLATFORM", "收到取消请求，正在终止 Apifox CLI 进程");
                runner.requestCancel(taskId);
                return toSummary(store.findTask(taskId));
            }
            default -> throw new ApiException(org.springframework.http.HttpStatus.CONFLICT, "TASK_NOT_CANCELLABLE",
                    "任务已处于 " + status + " 状态，无法取消");
        }
    }

    // -------------------------------------------------------------- deletion

    /** 删除工具资产：仍被任务引用时拒绝，并记墓碑避免重启后种子资产复活。 */
    public Map<String, Object> deleteAsset(String assetId) {
        if (store.findAsset(assetId) == null) {
            throw ApiException.notFound("工具资产不存在：" + assetId);
        }
        long used = store.countTasksByAsset(assetId);
        if (used > 0) {
            throw ApiException.conflict("TOOL_ASSET_IN_USE", "已有 " + used + " 个任务引用该场景，请先删除这些任务");
        }
        store.deleteAsset(assetId);
        store.markAssetDeleted(assetId, now());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", assetId);
        body.put("deleted", true);
        return body;
    }

    /** 删除终态任务：连同日志、用例结果、报告目录和共享配置里的引用一起清理。 */
    public Map<String, Object> deleteTask(String taskId) {
        Map<String, Object> row = requireTask(taskId);
        String status = str(row.get("status"));
        if (!isTerminal(status)) {
            throw ApiException.conflict("TASK_NOT_DELETABLE", "任务仍在排队或运行，请先取消后再删除");
        }
        Path runDir = reportDir(row);
        store.deleteTask(taskId);
        cleanupTaskReferences(taskId);
        deleteQuietly(runDir);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", taskId);
        body.put("deleted", true);
        return body;
    }

    private void cleanupTaskReferences(String taskId) {
        for (Map<String, Object> row : store.workspaceRows("checks")) {
            Map<String, Object> payload = parseJsonObject(row.get("payload"));
            if (taskId.equals(str(payload.get("taskId")))) {
                payload.put("taskId", "");
                store.updateWorkspacePayload("checks", str(row.get("id")), revisionOf(row), JsonWriter.write(payload));
            }
        }
        for (Map<String, Object> row : store.workspaceRows("comparisonExperiences")) {
            Map<String, Object> payload = parseJsonObject(row.get("payload"));
            if (taskId.equals(str(payload.get("taskId")))) {
                store.deleteWorkspaceRow("comparisonExperiences", str(row.get("id")));
            }
        }
        for (Map<String, Object> row : store.workspaceRows("comparisons")) {
            Map<String, Object> payload = parseJsonObject(row.get("payload"));
            if (!(payload.get("taskIds") instanceof List<?> taskIds)) {
                continue;
            }
            List<Object> kept = new ArrayList<>();
            for (Object value : taskIds) {
                if (!taskId.equals(str(value))) {
                    kept.add(value);
                }
            }
            if (kept.size() != taskIds.size()) {
                payload.put("taskIds", kept);
                store.updateWorkspacePayload("comparisons", str(row.get("id")), revisionOf(row), JsonWriter.write(payload));
            }
        }
    }

    private static int revisionOf(Map<String, Object> row) {
        Object value = row.get("revision");
        return value instanceof Number number ? number.intValue() : 0;
    }

    private Path reportDir(Map<String, Object> row) {
        String runDir = str(row.get("run_dir"));
        if (runDir.isEmpty()) {
            return null;
        }
        Path base = Path.of(str(properties.getApifox().getReportDir())).toAbsolutePath().normalize();
        Path target = Path.of(runDir).toAbsolutePath().normalize();
        if (!target.startsWith(base) || target.equals(base)) {
            log.warn("跳过报告目录清理（不在报告根目录内）：{}", runDir);
            return null;
        }
        return target;
    }

    private void deleteQuietly(Path dir) {
        if (dir == null || !Files.exists(dir)) {
            return;
        }
        try (Stream<Path> stream = Files.walk(dir)) {
            stream.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException e) {
                    log.warn("删除报告文件失败：{}", path, e);
                }
            });
        } catch (IOException e) {
            log.warn("清理报告目录失败：{}", dir, e);
        }
    }

    // --------------------------------------------------------------- helpers

    private Map<String, Object> requireTask(String id) {
        Map<String, Object> row = store.findTask(id);
        if (row == null) {
            throw ApiException.notFound("任务不存在：" + id);
        }
        return row;
    }

    private Map<String, Object> toSummary(Map<String, Object> row) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", row.get("id"));
        body.put("name", row.get("name"));
        body.put("siteId", row.get("site_id"));
        body.put("environmentId", row.get("environment_id"));
        body.put("tool", row.get("tool"));
        String status = str(row.get("status"));
        body.put("status", status);
        body.put("terminal", isTerminal(status));
        body.put("outcome", row.get("outcome"));
        body.put("createdAt", row.get("created_at"));
        body.put("startedAt", row.get("started_at"));
        body.put("finishedAt", row.get("finished_at"));
        body.put("sourceTaskId", row.get("source_task_id"));
        Map<String, Object> summary = parseJsonObject(row.get("summary_json"));
        body.put("summary", normalizedSummary(summary));
        return body;
    }

    private Map<String, Object> normalizedSummary(Map<String, Object> summary) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (String key : List.of("totalCases", "passedCases", "failedCases", "skippedCases", "notEvaluatedCases")) {
            result.put(key, summary.get(key));
        }
        return result;
    }

    private Map<String, Object> parametersOf(Map<String, Object> row) {
        Map<String, Object> parameters = new LinkedHashMap<>();
        parameters.put("iterations", row.get("iterations"));
        parameters.put("delayRequestMs", row.get("delay_request_ms"));
        parameters.put("timeoutRequestMs", row.get("timeout_request_ms"));
        return parameters;
    }

    private Map<String, Object> resultRow(Map<String, Object> row) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("caseId", row.get("case_id"));
        item.put("name", row.get("name"));
        item.put("status", row.get("status"));
        item.put("durationMs", row.get("duration_ms"));
        item.put("statusCode", row.get("status_code"));
        item.put("failureKind", row.get("failure_kind"));
        item.put("failureMessage", row.get("failure_message"));
        return item;
    }

    private List<Map<String, Object>> reportFiles(Map<String, Object> row) {
        List<Map<String, Object>> files = new ArrayList<>();
        String runDir = str(row.get("run_dir"));
        if (runDir.isEmpty()) {
            return files;
        }
        Path dir = Path.of(runDir);
        if (!Files.isDirectory(dir)) {
            return files;
        }
        try (Stream<Path> stream = Files.list(dir)) {
            stream.filter(Files::isRegularFile).sorted().forEach(path -> {
                Map<String, Object> file = new LinkedHashMap<>();
                file.put("name", path.getFileName().toString());
                file.put("size", path.toFile().length());
                files.add(file);
            });
        } catch (Exception ignored) {
            return files;
        }
        return files;
    }

    /** 报告目录里的单个原始文件（用于下载与验收核对）。 */
    public record ReportFile(String name, byte[] content, String contentType) {
    }

    public ReportFile reportFile(String taskId, String name) {
        Map<String, Object> row = requireTask(taskId);
        String runDir = str(row.get("run_dir"));
        if (runDir.isEmpty()) {
            throw ApiException.notFound("该任务没有报告目录");
        }
        Path dir = Path.of(runDir).toAbsolutePath().normalize();
        Path target = dir.resolve(name).normalize();
        if (!target.startsWith(dir) || !Files.isRegularFile(target)) {
            throw ApiException.notFound("报告文件不存在：" + name);
        }
        try {
            return new ReportFile(target.getFileName().toString(), Files.readAllBytes(target), contentTypeOf(target.getFileName().toString()));
        } catch (Exception e) {
            throw new ApiException(org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR",
                    "读取报告文件失败：" + e.getMessage());
        }
    }

    private static String contentTypeOf(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html;charset=utf-8";
        if (lower.endsWith(".json")) return "application/json;charset=utf-8";
        if (lower.endsWith(".xml")) return "application/xml;charset=utf-8";
        if (lower.endsWith(".csv")) return "text/csv;charset=utf-8";
        if (lower.endsWith(".txt") || lower.endsWith(".log")) return "text/plain;charset=utf-8";
        return "application/octet-stream";
    }

    private static int clampPageSize(int pageSize) {
        return Math.max(1, Math.min(pageSize, 100));
    }

    private static Map<String, Object> pageResult(List<Map<String, Object>> items, int page, int pageSize, long total) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("items", items);
        body.put("page", page);
        body.put("pageSize", pageSize);
        body.put("total", total);
        return body;
    }

    public static boolean isTerminal(String status) {
        return "FINISHED".equals(status) || "CANCELLED".equals(status) || "ERROR".equals(status);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> mapOrEmpty(Object value) {
        return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseJsonObject(Object value) {
        if (value == null) {
            return new LinkedHashMap<>();
        }
        if (value instanceof Map<?, ?> map) {
            return new LinkedHashMap<>((Map<String, Object>) map);
        }
        String text = str(value);
        if (text.isBlank()) {
            return new LinkedHashMap<>();
        }
        try {
            Object parsed = Json.parse(text);
            return parsed instanceof Map<?, ?> map ? new LinkedHashMap<>((Map<String, Object>) map) : new LinkedHashMap<>();
        } catch (Exception e) {
            return new LinkedHashMap<>();
        }
    }

    private List<Object> parseJsonList(Object value) {
        if (value == null) {
            return List.of();
        }
        String text = str(value);
        if (text.isBlank()) {
            return List.of();
        }
        try {
            Object parsed = Json.parse(text);
            return parsed instanceof List<?> list ? new ArrayList<>(list) : List.of();
        } catch (Exception e) {
            return List.of();
        }
    }

    private ApiException validation(Map<String, String> fieldErrors) {
        List<Map<String, String>> errors = new ArrayList<>();
        for (Map.Entry<String, String> entry : fieldErrors.entrySet()) {
            Map<String, String> error = new LinkedHashMap<>();
            error.put("field", entry.getKey());
            error.put("message", entry.getValue());
            errors.add(error);
        }
        return new ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
                "请求参数校验失败", errors);
    }

    private String sha256(String text) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : bytes) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String now() {
        return OffsetDateTime.now().toString();
    }

    private static String str(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private static String id(String value) {
        return value == null ? "" : value;
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }

    private static Integer optionalInt(Object value) {
        if (value == null || value instanceof Boolean) {
            return null;
        }
        if (value instanceof Number number) {
            return number.intValue();
        }
        try {
            return Integer.valueOf(String.valueOf(value).trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static int intOr(Object value, int fallback) {
        Integer parsed = optionalInt(value);
        return parsed == null ? fallback : parsed;
    }

    private static double round(double value) {
        return Math.round(value * 1000.0) / 1000.0;
    }

    private static String truncate(String value) {
        if (value == null) {
            return null;
        }
        return value.length() > 1900 ? value.substring(0, 1900) + "…" : value;
    }

    private static String display(Map<String, Object> map, String key) {
        Object value = map.get(key);
        return value == null ? "—" : String.valueOf(value);
    }

    private static String escape(String value) {
        if (value == null) {
            return "";
        }
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
