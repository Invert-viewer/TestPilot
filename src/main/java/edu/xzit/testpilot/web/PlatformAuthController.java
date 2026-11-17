package edu.xzit.testpilot.web;

import edu.xzit.testpilot.service.PlatformAuth;
import jakarta.servlet.http.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/api/v1")
public class PlatformAuthController {
    private final PlatformAuth auth;
    private record Attempt(long at,int count) {}
    private final Map<String,Attempt> attempts=new ConcurrentHashMap<>();
    public PlatformAuthController(PlatformAuth auth) { this.auth=auth; }
    public static PlatformAuth.User user(HttpServletRequest req) { return (PlatformAuth.User) req.getAttribute("platformUser"); }
    @GetMapping("/auth/status") public Object status(HttpServletRequest req) { return WorkspaceController.ok(Map.of("initialized",auth.initialized()),req); }
    @PostMapping("/auth/setup") public Object setup(@RequestBody Map<String,Object> body,HttpServletRequest req,HttpServletResponse res) {
        var user=auth.setup(body); auth.session(user,req,res); return WorkspaceController.ok(user,req);
    }
    @PostMapping("/auth/login") public Object login(@RequestBody Map<String,Object> body,HttpServletRequest req,HttpServletResponse res) {
        String key=req.getRemoteAddr()+":"+Objects.toString(body.get("username"),""); long now=System.currentTimeMillis();
        attempts.entrySet().removeIf(e->now-e.getValue().at()>60000);
        if(attempts.size()>1024) throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,"LOGIN_THROTTLED","登录尝试过多，请稍后重试");
        var a=attempts.compute(key,(k,old)->new Attempt(old==null?now:old.at(),old==null?1:old.count()+1));
        if(a.count()>8) throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,"LOGIN_THROTTLED","登录尝试过多，一分钟后重试");
        var user=auth.login(body); attempts.remove(key); auth.logout(req,res); auth.session(user,req,res); return WorkspaceController.ok(user,req);
    }
    @GetMapping("/auth/me") public Object me(HttpServletRequest req) { return WorkspaceController.ok(user(req),req); }
    @PostMapping("/auth/logout") public Object logout(HttpServletRequest req,HttpServletResponse res) { auth.logout(req,res); return WorkspaceController.ok(Map.of("loggedOut",true),req); }
    @GetMapping("/team") public Object members(HttpServletRequest req) { return WorkspaceController.ok(auth.members(),req); }
    @PostMapping("/team") public Object add(@RequestBody Map<String,Object> body,HttpServletRequest req) { return WorkspaceController.ok(auth.add(user(req),body),req); }
    @PutMapping("/team/{id}/role") public Object role(@PathVariable String id,@RequestBody Map<String,Object> body,HttpServletRequest req) { auth.change(user(req),id,body,false); return members(req); }
    @DeleteMapping("/team/{id}") public Object delete(@PathVariable String id,HttpServletRequest req) { auth.change(user(req),id,Map.of(),true); return members(req); }
}
