package edu.xzit.testpilot.web;

import edu.xzit.testpilot.util.Json;
import edu.xzit.testpilot.util.JsonWriter;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1/workspace")
public class WorkspaceController {
    static final List<String> TYPES = List.of("sites","environments","requests","assets","parameterPlans","comparisons","comparisonExperiences","assertionCases","checks");
    private final JdbcTemplate db;
    public WorkspaceController(JdbcTemplate db) { this.db = db; }
    public record Change(String collection, String id, int revision, Map<String,Object> value) {}

    @SuppressWarnings("unchecked")
    private Map<String,List<Map<String,Object>>> read() {
        Map<String,List<Map<String,Object>>> result = new LinkedHashMap<>();
        TYPES.forEach(type -> result.put(type,new ArrayList<>()));
        db.query("SELECT kind, payload, revision FROM workspace_resource ORDER BY kind, id", rs -> {
            Map<String,Object> row = (Map<String,Object>)Json.parse(rs.getString("payload"));
            row.put("revision",rs.getInt("revision"));
            result.get(rs.getString("kind")).add(row);
        });
        return result;
    }
    static Map<String,Object> ok(Object value,HttpServletRequest request) {
        return ApiResult.ok(value,String.valueOf(request.getAttribute(TraceIdFilter.ATTRIBUTE)));
    }
    @GetMapping
    public Map<String,Object> get(HttpServletRequest request) {return ok(read(),request);}

    @PostMapping @Transactional
    public Map<String,Object> commit(@RequestBody List<Change> changes,HttpServletRequest request) {
        if(changes.isEmpty() || changes.size()>1000) throw ApiException.validation("提交 1 至 1000 条配置");
        // Serialize reference checks and site/environment deletion across sessions.
        db.queryForObject("SELECT id FROM workspace_lock WHERE id=1 FOR UPDATE",Integer.class);
        for(Change c:changes) {
            if(!TYPES.contains(c.collection()) || c.id()==null || !c.id().matches("[a-zA-Z0-9_-]{1,100}") || c.revision()<0)
                throw ApiException.validation("资源类型、ID 或版本无效");
            if(c.value()==null) {
                if(!c.collection().equals("sites") && !c.collection().equals("environments")) throw ApiException.validation("不支持删除此资源");
                if(db.update("DELETE FROM workspace_resource WHERE kind=? AND id=? AND revision=?",c.collection(),c.id(),c.revision())!=1) throw conflict();
                continue;
            }
            Map<String,Object> row=new LinkedHashMap<>(c.value());
            row.put("id",c.id()); row.remove("revision");
            ResourceValidation.check(c.collection(),row);
            if(c.collection().equals("sites") && c.revision()==0){
                var hues=db.queryForList("SELECT payload FROM workspace_resource WHERE kind='sites'",String.class).stream().map(Json::parse)
                    .map(v->((Map<?,?>)v).get("cardHue")).filter(Number.class::isInstance).map(v->((Number)v).doubleValue()).collect(java.util.stream.Collectors.toSet());
                double hue=row.get("cardHue") instanceof Number n?n.doubleValue():220.0;
                while(hues.contains(hue))hue=(hue+137.507764)%360;
                row.put("cardHue",hue);
            }
            String payload=JsonWriter.write(row);
            if(payload.length()>500000) throw ApiException.validation("资源配置过大");
            if(c.revision()==0) {
                try {db.update("INSERT INTO workspace_resource(kind,id,revision,payload) VALUES(?,?,1,?)",c.collection(),c.id(),payload);}
                catch(DuplicateKeyException ex){throw conflict();}
            } else if(db.update("UPDATE workspace_resource SET revision=revision+1,payload=? WHERE kind=? AND id=? AND revision=?",payload,c.collection(),c.id(),c.revision())!=1) throw conflict();
        }
        var state=read();
        ResourceValidation.references(state);
        for (Change c: changes) {
            if (c.value()==null) continue;
            List<?> ids=c.collection().equals("comparisons")?(List<?>)c.value().get("taskIds"):
                Set.of("checks","comparisonExperiences").contains(c.collection()) && c.value().get("taskId") instanceof String id && !id.isBlank()?List.of(id):List.of();
            for(Object id:ids)if(!(id instanceof String) || db.queryForObject("SELECT COUNT(*) FROM task WHERE id=?",Integer.class,id)==0)
                throw ResourceValidation.invalid("taskId","来源任务不存在");
        }
        return ok(state,request);
    }
    static ApiException conflict(){return ApiException.conflict("VERSION_CONFLICT","其他组员已更新此配置，请刷新页面核对后重试");}
}
