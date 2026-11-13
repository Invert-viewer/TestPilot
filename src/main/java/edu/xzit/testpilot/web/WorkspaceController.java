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
        var state=cascade(read());
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
    /**
     * 删除资源后清理悬空引用：删网站连带删它的环境与绑定请求、清空检查记录的 siteId、
     * 从实验方案移除该网站；删请求连带删引用它的断言用例；删实验方案连带删工具体验记录。
     */
    private Map<String,List<Map<String,Object>>> cascade(Map<String,List<Map<String,Object>>> state) {
        for (int guard = 0; guard < 8; guard++) {
            boolean changed = false;
            Set<Object> sites = ids(state, "sites");
            Set<Object> environments = ids(state, "environments");
            Set<Object> requests = ids(state, "requests");
            Set<Object> plans = ids(state, "comparisons");
            for (Map<String,Object> row : state.get("environments")) {
                String siteId = text(row.get("siteId"));
                if (!siteId.isEmpty() && !sites.contains(siteId)) { deleteRow("environments", row); changed = true; }
            }
            for (Map<String,Object> row : state.get("requests")) {
                Map<?,?> definition = row.get("definition") instanceof Map<?,?> map ? map : Map.of();
                String siteId = text(definition.get("siteId"));
                String environmentId = text(definition.get("environmentId"));
                if ((!siteId.isEmpty() && !sites.contains(siteId))
                        || (!environmentId.isEmpty() && !environments.contains(environmentId))) {
                    deleteRow("requests", row); changed = true;
                }
            }
            for (Map<String,Object> row : state.get("assertionCases")) {
                String requestId = text(row.get("requestId"));
                if (!requestId.isEmpty() && !requests.contains(requestId)) { deleteRow("assertionCases", row); changed = true; }
            }
            for (Map<String,Object> row : state.get("checks")) {
                String siteId = text(row.get("siteId"));
                if (!siteId.isEmpty() && !sites.contains(siteId)) { row.put("siteId", ""); updateRow("checks", row); changed = true; }
            }
            for (Map<String,Object> row : state.get("comparisons")) {
                List<Object> kept = new ArrayList<>();
                if (row.get("siteIds") instanceof List<?> values) {
                    for (Object value : values) {
                        if (value instanceof String siteId && sites.contains(siteId)) kept.add(siteId);
                    }
                }
                if (!kept.equals(row.get("siteIds"))) { row.put("siteIds", kept); updateRow("comparisons", row); changed = true; }
            }
            for (Map<String,Object> row : state.get("comparisonExperiences")) {
                String comparisonId = text(row.get("comparisonId"));
                if (!comparisonId.isEmpty() && !plans.contains(comparisonId)) { deleteRow("comparisonExperiences", row); changed = true; }
            }
            if (!changed) return state;
            state = read();
        }
        return state;
    }

    private static Set<Object> ids(Map<String,List<Map<String,Object>>> state, String kind) {
        Set<Object> result = new HashSet<>();
        for (Map<String,Object> row : state.get(kind)) result.add(row.get("id"));
        return result;
    }

    private static String text(Object value) { return value == null ? "" : String.valueOf(value); }

    private void deleteRow(String kind, Map<String,Object> row) {
        db.update("DELETE FROM workspace_resource WHERE kind=? AND id=?", kind, row.get("id"));
    }

    private void updateRow(String kind, Map<String,Object> row) {
        int revision = row.get("revision") instanceof Number number ? number.intValue() : 0;
        Map<String,Object> payload = new LinkedHashMap<>(row);
        payload.remove("revision");
        db.update("UPDATE workspace_resource SET revision=revision+1, payload=? WHERE kind=? AND id=? AND revision=?",
                JsonWriter.write(payload), kind, row.get("id"), revision);
    }

    static ApiException conflict(){return ApiException.conflict("VERSION_CONFLICT","其他会话已更新此配置，请刷新页面核对后重试");}
}
