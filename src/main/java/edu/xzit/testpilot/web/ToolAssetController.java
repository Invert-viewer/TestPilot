package edu.xzit.testpilot.web;

import edu.xzit.testpilot.service.TaskService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/tool-assets")
public class ToolAssetController {

    private final TaskService taskService;

    public ToolAssetController(TaskService taskService) {
        this.taskService = taskService;
    }

    @GetMapping
    public Map<String, Object> list(@RequestParam(required = false) String tool,
                                    @RequestParam(defaultValue = "1") int page,
                                    @RequestParam(defaultValue = "20") int pageSize,
                                    HttpServletRequest request) {
        Object traceId = request.getAttribute(TraceIdFilter.ATTRIBUTE);
        return ApiResult.ok(taskService.listAssets(tool, page, pageSize),
                traceId == null ? "-" : traceId.toString());
    }
}
