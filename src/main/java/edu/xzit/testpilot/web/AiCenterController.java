package edu.xzit.testpilot.web;
import edu.xzit.testpilot.service.AiCenterService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController @RequestMapping("/api/v1/ai")
public class AiCenterController {
    private final AiCenterService service;public AiCenterController(AiCenterService service){this.service=service;}
    @GetMapping("/state") public Object state(@RequestParam(defaultValue="") String projectId,HttpServletRequest req){return WorkspaceController.ok(service.state(PlatformAuthController.user(req),projectId),req);}
    @PostMapping("/chat") public Object chat(@RequestBody Map<String,Object> body,HttpServletRequest req){return WorkspaceController.ok(service.chat(PlatformAuthController.user(req),body),req);}
    @DeleteMapping("/chat") public Object clear(@RequestParam(defaultValue="") String projectId,HttpServletRequest req){service.clearChat(PlatformAuthController.user(req),projectId);return WorkspaceController.ok(Map.of("cleared",true),req);}
    @PostMapping("/cases") public Object cases(@RequestBody Map<String,Object> body,HttpServletRequest req){return WorkspaceController.ok(service.cases(PlatformAuthController.user(req),body),req);}
    @PostMapping("/data") public Object data(@RequestBody Map<String,Object> body,HttpServletRequest req){return WorkspaceController.ok(service.data(PlatformAuthController.user(req),body),req);}
    @PostMapping("/risk") public Object risk(@RequestBody Map<String,Object> body,HttpServletRequest req){return WorkspaceController.ok(service.risk(PlatformAuthController.user(req),body),req);}
    public record ImportBody(List<String> caseIds){}
    @PostMapping("/records/{id}/import") public Object save(@PathVariable String id,@RequestBody ImportBody body,HttpServletRequest req){return WorkspaceController.ok(service.importCases(PlatformAuthController.user(req),id,body.caseIds()),req);}
}
