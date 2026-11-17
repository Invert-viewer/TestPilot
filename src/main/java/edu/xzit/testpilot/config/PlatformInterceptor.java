package edu.xzit.testpilot.config;

import edu.xzit.testpilot.service.PlatformAuth;
import edu.xzit.testpilot.web.ApiException;
import jakarta.servlet.http.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.*;
import java.net.URI;
import java.util.Set;

/** Login extension point: protects existing controllers as well as platform configuration. */
@Component
public class PlatformInterceptor implements HandlerInterceptor, WebMvcConfigurer {
    private final PlatformAuth auth;
    public PlatformInterceptor(PlatformAuth auth) { this.auth=auth; }
    @Override public void addInterceptors(InterceptorRegistry registry) { registry.addInterceptor(this).addPathPatterns("/api/v1/**"); }
    @Override public boolean preHandle(HttpServletRequest req,HttpServletResponse res,Object handler) {
        res.setHeader("Cache-Control","no-store");
        String origin=req.getHeader("Origin");
        if(!Set.of("GET","HEAD","OPTIONS").contains(req.getMethod())&&origin!=null) {
            try { if(!URI.create(origin).getAuthority().equalsIgnoreCase(req.getHeader("Host"))) throw new IllegalArgumentException(); }
            catch(RuntimeException e) { throw new ApiException(HttpStatus.FORBIDDEN,"ORIGIN_REJECTED","拒绝跨站修改请求"); }
        }
        if(Set.of("/api/v1/auth/status","/api/v1/auth/login","/api/v1/auth/setup").contains(req.getRequestURI())) return true;
        var user=auth.authenticate(req); req.setAttribute("platformUser",user);
        // Existing process shutdown is an administrative action too.
        if(req.getRequestURI().startsWith("/api/v1/admin")) PlatformAuth.requireLead(user);
        return true;
    }
}
