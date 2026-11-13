package edu.xzit.testpilot.store;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class TaskStore {

    private final JdbcTemplate jdbc;

    public TaskStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ---------------------------------------------------------------- assets

    public boolean assetExists(String id) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM tool_asset WHERE id = ?", Integer.class, id);
        return count != null && count > 0;
    }

    public void insertAsset(String id, String name, String tool, String kind, String sourceJson,
                            String scenarioKey, String requestRefsJson, int version, String now) {
        jdbc.update("INSERT INTO tool_asset (id, name, tool, kind, source_json, scenario_key, request_refs_json, version, created_at)"
                + " VALUES (?,?,?,?,?,?,?,?,?)", id, name, tool, kind, sourceJson, scenarioKey, requestRefsJson, version, now);
    }

    public List<Map<String, Object>> listAssets(String tool, int offset, int limit) {
        StringBuilder sql = new StringBuilder("SELECT * FROM tool_asset");
        List<Object> args = new ArrayList<>();
        if (tool != null && !tool.isBlank()) {
            sql.append(" WHERE tool = ?");
            args.add(tool);
        }
        sql.append(" ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?");
        args.add(limit);
        args.add(offset);
        return jdbc.queryForList(sql.toString(), args.toArray());
    }

    public long countAssets(String tool) {
        if (tool == null || tool.isBlank()) {
            Long count = jdbc.queryForObject("SELECT COUNT(*) FROM tool_asset", Long.class);
            return count == null ? 0 : count;
        }
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM tool_asset WHERE tool = ?", Long.class, tool);
        return count == null ? 0 : count;
    }

    public Map<String, Object> findAsset(String id) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM tool_asset WHERE id = ?", id);
        return rows.isEmpty() ? null : rows.get(0);
    }

    // ----------------------------------------------------------------- tasks

    public void insertTask(Map<String, Object> task) {
        jdbc.update("INSERT INTO task (id, name, site_id, environment_id, tool, asset_id, asset_version, status, outcome,"
                        + " iterations, delay_request_ms, timeout_request_ms, created_at, started_at, finished_at, source_task_id,"
                        + " idempotency_key, request_hash, exit_code, error_code, error_message, summary_json, metrics_json,"
                        + " report_text, run_dir)"
                        + " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                task.get("id"), task.get("name"), task.get("siteId"), task.get("environmentId"), task.get("tool"),
                task.get("assetId"), task.get("assetVersion"), task.get("status"), task.get("outcome"),
                task.get("iterations"), task.get("delayRequestMs"), task.get("timeoutRequestMs"),
                task.get("createdAt"), task.get("startedAt"), task.get("finishedAt"), task.get("sourceTaskId"),
                task.get("idempotencyKey"), task.get("requestHash"), task.get("exitCode"), task.get("errorCode"),
                task.get("errorMessage"), task.get("summaryJson"), task.get("metricsJson"), task.get("reportText"),
                task.get("runDir"));
    }

    public Map<String, Object> findTask(String id) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM task WHERE id = ?", id);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public Map<String, Object> findTaskByIdempotencyKey(String key) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM task WHERE idempotency_key = ?", key);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public List<Map<String, Object>> listTasks(String siteId, String tool, String status, String outcome, int offset, int limit) {
        StringBuilder sql = new StringBuilder("SELECT * FROM task WHERE 1 = 1");
        List<Object> args = new ArrayList<>();
        if (siteId != null && !siteId.isBlank()) {
            sql.append(" AND site_id = ?");
            args.add(siteId);
        }
        if (tool != null && !tool.isBlank()) {
            sql.append(" AND tool = ?");
            args.add(tool);
        }
        if (status != null && !status.isBlank()) {
            sql.append(" AND status = ?");
            args.add(status);
        }
        if (outcome != null && !outcome.isBlank()) {
            sql.append(" AND outcome = ?");
            args.add(outcome);
        }
        sql.append(" ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?");
        args.add(limit);
        args.add(offset);
        return jdbc.queryForList(sql.toString(), args.toArray());
    }

    public long countTasks(String siteId, String tool, String status, String outcome) {
        StringBuilder sql = new StringBuilder("SELECT COUNT(*) FROM task WHERE 1 = 1");
        List<Object> args = new ArrayList<>();
        if (siteId != null && !siteId.isBlank()) {
            sql.append(" AND site_id = ?");
            args.add(siteId);
        }
        if (tool != null && !tool.isBlank()) {
            sql.append(" AND tool = ?");
            args.add(tool);
        }
        if (status != null && !status.isBlank()) {
            sql.append(" AND status = ?");
            args.add(status);
        }
        if (outcome != null && !outcome.isBlank()) {
            sql.append(" AND outcome = ?");
            args.add(outcome);
        }
        Long count = jdbc.queryForObject(sql.toString(), Long.class, args.toArray());
        return count == null ? 0 : count;
    }

    public void markRunning(String id, String startedAt, String runDir) {
        jdbc.update("UPDATE task SET status = 'RUNNING', started_at = ?, run_dir = ? WHERE id = ?", startedAt, runDir, id);
    }

    public void updateStatus(String id, String status, String errorCode, String errorMessage) {
        jdbc.update("UPDATE task SET status = ?, error_code = ?, error_message = ? WHERE id = ?",
                status, errorCode, errorMessage, id);
    }

    public void finishTask(String id, String status, String outcome, String finishedAt, Integer exitCode,
                           String errorCode, String errorMessage, String summaryJson, String metricsJson,
                           String reportText) {
        jdbc.update("UPDATE task SET status = ?, outcome = ?, finished_at = ?, exit_code = ?, error_code = ?,"
                        + " error_message = ?, summary_json = ?, metrics_json = ?, report_text = ? WHERE id = ?",
                status, outcome, finishedAt, exitCode, errorCode, errorMessage, summaryJson, metricsJson, reportText, id);
    }

    /** 任务被取消时当前处于启动/运行阶段，结束后补记终态。 */
    public List<Map<String, Object>> findNonTerminalTasks() {
        return jdbc.queryForList("SELECT * FROM task WHERE status IN ('QUEUED','RUNNING','CANCELLING') ORDER BY created_at ASC");
    }

    // ------------------------------------------------------------------ logs

    public synchronized long appendLog(String taskId, String logTime, String stream, String text) {
        Long max = jdbc.queryForObject("SELECT COALESCE(MAX(seq), 0) FROM task_log WHERE task_id = ?", Long.class, taskId);
        long seq = (max == null ? 0 : max) + 1;
        jdbc.update("INSERT INTO task_log (task_id, seq, log_time, stream, text) VALUES (?,?,?,?,?)",
                taskId, seq, logTime, stream, text);
        return seq;
    }

    public List<Map<String, Object>> logs(String taskId, long afterSeq, int limit) {
        return jdbc.queryForList("SELECT seq, log_time, stream, text FROM task_log WHERE task_id = ? AND seq > ?"
                + " ORDER BY seq ASC LIMIT ?", taskId, afterSeq, limit);
    }

    public long countLogs(String taskId) {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM task_log WHERE task_id = ?", Long.class, taskId);
        return count == null ? 0 : count;
    }

    // --------------------------------------------------------------- results

    public void deleteResults(String taskId) {
        jdbc.update("DELETE FROM task_result WHERE task_id = ?", taskId);
    }

    public void insertResult(String taskId, int order, String caseId, String name, String status, Integer durationMs,
                             Integer statusCode, String failureKind, String failureMessage, String assertionsJson) {
        jdbc.update("INSERT INTO task_result (task_id, case_order, case_id, name, status, duration_ms, status_code,"
                        + " failure_kind, failure_message, assertions_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
                taskId, order, caseId, name, status, durationMs, statusCode, failureKind, failureMessage, assertionsJson);
    }

    public List<Map<String, Object>> listResults(String taskId, String status, int offset, int limit) {
        StringBuilder sql = new StringBuilder("SELECT * FROM task_result WHERE task_id = ?");
        List<Object> args = new ArrayList<>();
        args.add(taskId);
        if (status != null && !status.isBlank()) {
            sql.append(" AND status = ?");
            args.add(status);
        }
        sql.append(" ORDER BY case_order ASC LIMIT ? OFFSET ?");
        args.add(limit);
        args.add(offset);
        return jdbc.queryForList(sql.toString(), args.toArray());
    }

    public long countResults(String taskId, String status) {
        if (status == null || status.isBlank()) {
            Long count = jdbc.queryForObject("SELECT COUNT(*) FROM task_result WHERE task_id = ?", Long.class, taskId);
            return count == null ? 0 : count;
        }
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM task_result WHERE task_id = ? AND status = ?",
                Long.class, taskId, status);
        return count == null ? 0 : count;
    }

    public Map<String, Object> findResult(String taskId, String caseId) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT * FROM task_result WHERE task_id = ? AND case_id = ?", taskId, caseId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public List<Map<String, Object>> allResults(String taskId) {
        return jdbc.queryForList("SELECT * FROM task_result WHERE task_id = ? ORDER BY case_order ASC", taskId);
    }

    public Map<String, Object> firstTaskByStatus(String taskId) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT status FROM task WHERE id = ?", taskId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    // -------------------------------------------------------------- deletion

    public void deleteAsset(String id) {
        jdbc.update("DELETE FROM tool_asset WHERE id = ?", id);
    }

    public boolean isAssetTombstoned(String id) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM tool_asset_tombstone WHERE id = ?", Integer.class, id);
        return count != null && count > 0;
    }

    public void markAssetDeleted(String id, String now) {
        jdbc.update("DELETE FROM tool_asset_tombstone WHERE id = ?", id);
        jdbc.update("INSERT INTO tool_asset_tombstone (id, deleted_at) VALUES (?, ?)", id, now);
    }

    public long countTasksByAsset(String assetId) {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM task WHERE asset_id = ?", Long.class, assetId);
        return count == null ? 0 : count;
    }

    public void deleteTask(String id) {
        jdbc.update("DELETE FROM task_log WHERE task_id = ?", id);
        jdbc.update("DELETE FROM task_result WHERE task_id = ?", id);
        jdbc.update("DELETE FROM task WHERE id = ?", id);
    }

    public List<Map<String, Object>> workspaceRows(String kind) {
        return jdbc.queryForList("SELECT id, revision, payload FROM workspace_resource WHERE kind = ? ORDER BY id", kind);
    }

    public void updateWorkspacePayload(String kind, String id, int revision, String payload) {
        jdbc.update("UPDATE workspace_resource SET revision = revision + 1, payload = ? WHERE kind = ? AND id = ? AND revision = ?",
                payload, kind, id, revision);
    }

    public void deleteWorkspaceRow(String kind, String id) {
        jdbc.update("DELETE FROM workspace_resource WHERE kind = ? AND id = ?", kind, id);
    }

    public static Map<String, Object> row(Object... keyValues) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < keyValues.length; i += 2) {
            map.put(String.valueOf(keyValues[i]), keyValues[i + 1]);
        }
        return map;
    }
}
