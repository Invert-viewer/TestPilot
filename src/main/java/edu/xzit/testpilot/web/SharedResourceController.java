package edu.xzit.testpilot.web;

import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/** Single-resource clients and the Vue batch editor share the same transaction and version checks. */
@RestController
@RequestMapping("/api/v1")
public class SharedResourceController {
    private static final String ROOT="/{kind:sites|requests|checks|parameter-plans|comparisons}";
    private final WorkspaceController workspace;
    public SharedResourceController(WorkspaceController workspace){this.workspace=workspace;}
    private String collection(String kind){return kind.equals("parameter-plans")?"parameterPlans":kind;}
    @SuppressWarnings("unchecked")
    private List<Map<String,Object>> rows(String kind,HttpServletRequest req){
        var data=(Map<String,List<Map<String,Object>>>)workspace.get(req).get("data");
        return data.get(collection(kind));
    }
    private Map<String,Object> find(String kind,String id,HttpServletRequest req){
        return rows(kind,req).stream().filter(r->id.equals(r.get("id"))).findFirst().orElseThrow(()->ApiException.notFound("资源不存在"));
    }
    @GetMapping(ROOT)
    public Object list(@PathVariable String kind,@RequestParam Map<String,String> query,HttpServletRequest req){
        int page=number(query.getOrDefault("page","1")),size=number(query.getOrDefault("pageSize","20"));
        if(size>100)throw ResourceValidation.invalid("pageSize","最大 100");
        var items=rows(kind,req).stream().filter(row->{
            String title=Objects.toString(row.getOrDefault("title",row.get("name")),"");
            if(!title.contains(query.getOrDefault("keyword","")))return false;
            for(String k:List.of("siteId","kind","mode","tool","status")){
                Object value=row.get(k);
                if(k.equals("siteId")&&row.get("definition") instanceof Map<?,?> d)value=d.get(k);
                if(query.containsKey(k)&&!query.get(k).equals(value))return false;
            }
            return true;
        }).toList();
        int from=(int)Math.min((long)(page-1)*size,items.size());
        return WorkspaceController.ok(Map.of("page",page,"pageSize",size,"total",items.size(),"items",items.subList(from,Math.min(from+size,items.size()))),req);
    }
    private int number(String raw){try{int n=Integer.parseInt(raw);if(n>0)return n;}catch(NumberFormatException ignored){}throw ResourceValidation.invalid("page/pageSize","需要正整数");}
    @GetMapping(ROOT+"/{id}")
    public Object detail(@PathVariable String kind,@PathVariable String id,HttpServletRequest req){return WorkspaceController.ok(find(kind,id,req),req);}
    @PostMapping(ROOT) @ResponseStatus(HttpStatus.CREATED)
    public Object create(@PathVariable String kind,@RequestBody Map<String,Object> body,HttpServletRequest req){return save(kind,UUID.randomUUID().toString(),0,body,req);}
    @PutMapping(ROOT+"/{id}")
    public Object update(@PathVariable String kind,@PathVariable String id,@RequestBody Map<String,Object> body,HttpServletRequest req){
        var existing=find(kind,id,req);return save(kind,id,revision(body,existing),body,req);
    }
    private int revision(Map<String,Object> body,Map<String,Object> existing){
        Object version=body.getOrDefault("revision",existing.get("revision"));
        if(!(version instanceof Number n)||n.intValue()<1)throw ResourceValidation.invalid("revision","需要正整数");
        return n.intValue();
    }
    private Object save(String kind,String id,int revision,Map<String,Object> body,HttpServletRequest req){
        Map<String,Object> value=new LinkedHashMap<>(body);
        if(kind.equals("requests")&&!body.containsKey("definition")){
            value=new LinkedHashMap<>();value.put("definition",body);value.put("name",body.get("name"));value.put("version",revision+1);
        }
        workspace.commit(List.of(new WorkspaceController.Change(collection(kind),id,revision,value)),req);
        return detail(kind,id,req);
    }
    @GetMapping("/sites/{id}/environments")
    public Object environments(@PathVariable String id,HttpServletRequest req){
        find("sites",id,req);
        return WorkspaceController.ok(rows("environments",req).stream().filter(e->id.equals(e.get("siteId"))).toList(),req);
    }
    @PostMapping("/sites/{id}/environments") @ResponseStatus(HttpStatus.CREATED)
    public Object createEnvironment(@PathVariable String id,@RequestBody Map<String,Object> body,HttpServletRequest req){
        body.put("siteId",id);return save("environments",UUID.randomUUID().toString(),0,body,req);
    }
    @PutMapping("/sites/{id}/environments/{env}")
    public Object editEnvironment(@PathVariable String id,@PathVariable String env,@RequestBody Map<String,Object> body,HttpServletRequest req){
        var row=find("environments",env,req);if(!id.equals(row.get("siteId")))throw ApiException.notFound("环境不属于此网站");
        body.put("siteId",id);return save("environments",env,revision(body,row),body,req);
    }
}
