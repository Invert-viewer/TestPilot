package edu.xzit.testpilot.web;

import edu.xzit.testpilot.service.TaskService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/tasks")
public class TaskController {

    private final TaskService taskService;

    public TaskController(TaskService taskService) {
        this.taskService = taskService;
    }

    private static String traceId(HttpServletRequest request) {
        Object value = request.getAttribute(TraceIdFilter.ATTRIBUTE);
        return value == null ? "-" : value.toString();
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestHeader("Idempotency-Key") String idempotencyKey,
                                                      @RequestBody Map<String, Object> body,
                                                      HttpServletRequest request) {
        TaskService.CreateOutcome outcome = taskService.createTask(body, idempotencyKey);
        HttpStatus status = outcome.created() ? HttpStatus.ACCEPTED : HttpStatus.OK;
        return ResponseEntity.status(status).body(ApiResult.ok(outcome.body(), traceId(request)));
    }

    @GetMapping
    public Map<String, Object> list(@RequestParam(required = false) String siteId,
                                    @RequestParam(required = false) String tool,
                                    @RequestParam(required = false) String status,
                                    @RequestParam(required = false) String outcome,
                                    @RequestParam(defaultValue = "1") int page,
                                    @RequestParam(defaultValue = "20") int pageSize,
                                    HttpServletRequest request) {
        return ApiResult.ok(taskService.listTasks(siteId, tool, status, outcome, page, pageSize), traceId(request));
    }

    @GetMapping("/{id}")
    public Map<String, Object> detail(@PathVariable String id, HttpServletRequest request) {
        return ApiResult.ok(taskService.getTask(id), traceId(request));
    }

    @GetMapping("/{id}/logs")
    public Map<String, Object> logs(@PathVariable String id,
                                    @RequestParam(defaultValue = "0") long cursor,
                                    @RequestParam(defaultValue = "200") int limit,
                                    HttpServletRequest request) {
        return ApiResult.ok(taskService.logs(id, cursor, limit), traceId(request));
    }

    @GetMapping("/{id}/results")
    public Map<String, Object> results(@PathVariable String id,
                                       @RequestParam(required = false) String status,
                                       @RequestParam(defaultValue = "1") int page,
                                       @RequestParam(defaultValue = "20") int pageSize,
                                       HttpServletRequest request) {
        return ApiResult.ok(taskService.results(id, status, page, pageSize), traceId(request));
    }

    @GetMapping("/{id}/results/{caseId}")
    public Map<String, Object> resultDetail(@PathVariable String id, @PathVariable String caseId,
                                            HttpServletRequest request) {
        return ApiResult.ok(taskService.resultDetail(id, caseId), traceId(request));
    }

    @GetMapping("/{id}/report")
    public Map<String, Object> report(@PathVariable String id, HttpServletRequest request) {
        return ApiResult.ok(taskService.report(id), traceId(request));
    }

    @GetMapping(value = "/{id}/report/view", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> reportView(@PathVariable String id) {
        return ResponseEntity.ok().contentType(new MediaType(MediaType.TEXT_HTML, java.nio.charset.StandardCharsets.UTF_8))
                .body(taskService.reportHtml(id));
    }

    @GetMapping("/{id}/report/files/{name}")
    public ResponseEntity<byte[]> reportFile(@PathVariable String id, @PathVariable String name) {
        TaskService.ReportFile file = taskService.reportFile(id, name);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(file.contentType()))
                .header("Content-Disposition", org.springframework.http.ContentDisposition.inline()
                        .filename(file.name(), java.nio.charset.StandardCharsets.UTF_8).build().toString())
                .body(file.content());
    }

    @PostMapping("/{id}/cancel")
    public Map<String, Object> cancel(@PathVariable String id, HttpServletRequest request) {
        return ApiResult.ok(taskService.cancel(id), traceId(request));
    }
}
