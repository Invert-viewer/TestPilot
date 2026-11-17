package edu.xzit.testpilot.web;
import edu.xzit.testpilot.service.IdeFrontendService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.servlet.view.RedirectView;

@Controller
@ConditionalOnProperty(name="testpilot.frontend.enabled",havingValue="true")
public class IdeHomeController {
    private final IdeFrontendService frontend;
    public IdeHomeController(IdeFrontendService frontend) {this.frontend=frontend;}
    @GetMapping("/") public RedirectView index() {return new RedirectView(frontend.url()+"/");}
}
