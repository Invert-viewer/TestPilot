package edu.xzit.testpilot.service;

import edu.xzit.testpilot.util.*;
import edu.xzit.testpilot.web.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import java.nio.file.*;
import java.util.*;

/** Server-side evidence is selected by project references, never by a client supplied file path. */
@Service
public class AiContextService {
    private final JdbcTemplate db;
    private final Path runs;
    public AiContextService(JdbcTemplate db,@Value("${testpilot.ai.runs-directory:./frontend/.runs}") String runs){this.db=db;this.runs=Path.of(runs).toAbsolutePath().normalize();}
    @SuppressWarnings("unchecked") public Map<String,Object> resource(String kind,String id){
        var rows=db.queryForList("SELECT payload FROM workspace_resource WHERE kind=? AND id=?",String.class,kind,id);
        return rows.isEmpty()?new LinkedHashMap<>():new LinkedHashMap<>((Map<String,Object>)Json.parse(rows.getFirst()));
    }
    public Map<String,Object> project(String id){
        if(id==null||id.isBlank())return Map.of("id","","name","未选择项目");
        if(!id.matches("[A-Za-z0-9_-]{1,100}"))throw ApiException.validation("项目 ID 无效");
        var row=resource("sites",id);if(row.isEmpty())throw ApiException.notFound("项目不存在");return row;
    }
    @SuppressWarnings("unchecked") public Map<String,Object> space(String id){
        if(id==null||id.isBlank())return new LinkedHashMap<>();
        var rows=db.queryForList("SELECT id,payload,revision FROM workspace_resource WHERE kind='executionSpaces'");
        for(var row:rows){var value=(Map<String,Object>)Json.parse((String)row.get("payload"));if(id.equals(value.get("siteId"))){value.put("id",row.get("id"));value.put("revision",row.get("revision"));return value;}}
        return new LinkedHashMap<>();
    }
    public static Map<?,?> map(Object value){return value instanceof Map<?,?> m?m:Map.of();}
    public static List<?> list(Object value){return value instanceof List<?> l?l:List.of();}
    private static double number(Object value){return value instanceof Number n?n.doubleValue():0;}
    private static String text(Object value){return Objects.toString(value,"");}
    private static Map<String,Object> select(Map<?,?> source,String... keys){var result=new LinkedHashMap<String,Object>();for(String key:keys)if(source.get(key)!=null)result.put(key,source.get(key));return result;}
    @SuppressWarnings("unchecked") public Map<String,Object> snapshot(String siteId){
        var site=project(siteId);var space=space(siteId);var state=map(space.get("data"));var jobs=new ArrayList<Map<String,Object>>();
        var ids=new LinkedHashSet<String>();var saved=map(space.get("workspaces"));
        for(Object value:map(saved.get("history")).values())for(Object item:list(value))ids.add(text(map(item).get("id")));
        for(Object value:map(saved.get("lastJobIds")).values())ids.add(text(value));
        for(String id:ids.stream().limit(30).toList()){
            if(!id.matches("[a-fA-F0-9-]{36}"))continue;
            Path file=runs.resolve(id).resolve("result.json").normalize();
            if(!file.startsWith(runs))continue;
            try {
                if(!Files.isRegularFile(file)||Files.size(file)>4000000)continue;
                var raw=(Map<String,Object>)Json.parse(Files.readString(file));var result=map(raw.get("result"));
                var job=select(raw,"id","kind","name","status","createdAt","error");
                job.put("metrics",select(result,"total","passed","failed","skipped","errors","compileError","durationMs","p95Ms","p99Ms","errorRate","tps","riskCount","reviewCount","issueCount"));
                var details=new ArrayList<Object>();
                for(String key:List.of("findings","cases","results"))for(Object item:list(result.get(key)).stream().limit(15).toList()){
                    var row=map(item);var entry=select(row,"name","title","group","status","severity","evidence","recommendation","error","device","passed","issues");
                    details.add(entry);
                }
                job.put("details",details);jobs.add(job);
            }catch(Exception ignored){/* Missing or unreadable artifacts are not counted as passing runs. */}
        }
        for(Object item:list(state.get("uiHistory")).stream().limit(10).toList()){
            var row=map(item);var steps=list(row.get("steps"));var job=select(row,"id","name");
            job.put("kind","ui");job.put("createdAt",text(row.get("time")));job.put("status",Boolean.TRUE.equals(row.get("passed"))?"COMPLETED":"FAILED");
            job.put("metrics",Map.of("total",steps.size(),"failed",steps.stream().filter(s->"FAILED".equals(map(s).get("status"))).count(),"durationMs",number(row.get("durationMs"))));
            job.put("details",steps.stream().filter(s->!"PASSED".equals(map(s).get("status"))).limit(6).map(s->select(map(s),"index","action","selector","status","error")).toList());jobs.add(job);
        }
        if(siteId!=null&&!siteId.isBlank())db.query("SELECT id,name,tool,status,outcome,created_at,error_message FROM task WHERE site_id=? ORDER BY created_at DESC LIMIT 10",rs->{
            jobs.add(new LinkedHashMap<>(Map.of("id",rs.getString("id"),"name",rs.getString("name"),"kind","api","status",rs.getString("status"),"outcome",rs.getString("outcome"),"createdAt",rs.getString("created_at"),"error",Objects.toString(rs.getString("error_message"),""),"metrics",Map.of())));
        },siteId);
        jobs.sort(Comparator.comparing(j->text(j.get("createdAt")),Comparator.reverseOrder()));
        if(jobs.size()>10)jobs.subList(10,jobs.size()).clear();
        Set<String> requestIds=new HashSet<>();for(Object row:list(state.get("requests")))requestIds.add(text(map(row).get("id")));
        if(siteId!=null&&!siteId.isBlank())for(String payload:db.queryForList("SELECT payload FROM workspace_resource WHERE kind='requests'",String.class)){
            var row=(Map<?,?>)Json.parse(payload);if(siteId.equals(map(row.get("definition")).get("siteId")))requestIds.add(text(row.get("id")));
        }
        var requestHistory=new ArrayList<Object>();for(Object item:list(state.get("history")).stream().limit(10).toList()){
            var row=map(item);var summary=select(row,"name","status","time","durationMs");summary.putAll(select(map(row.get("draft")),"method","url"));
            summary.put("assertions",list(row.get("assertions")).stream().limit(20).map(a->select(map(a),"type","target","operator","expected","actual","passed","error")).toList());requestHistory.add(summary);
        }
        var output=new LinkedHashMap<String,Object>();output.put("project",select(site,"id","name","scope","description"));
        output.put("counts",Map.of("apiCases",requestIds.size(),"uiCases",list(state.get("uiCases")).size(),"executions",jobs.size(),"apiRequests",requestHistory.size()));
        output.put("runs",jobs);output.put("requests",requestHistory);
        output.put("dimensions",dimensions(jobs,requestHistory));
        output.put("limitations",List.of("只分析当前项目可读取的执行产物与请求状态，不代表完整测试覆盖率。","当前未接入缺陷管理模块，不推测缺陷数量。","无采样的类别显示暂无数据，风险依据与采样数量一并展示。"));
        return (Map<String,Object>)Json.parse(redact(JsonWriter.write(bounded(output,0)),siteId));
    }
    private static List<Map<String,Object>> dimensions(List<Map<String,Object>> jobs,List<Object> requests){
        var result=new ArrayList<Map<String,Object>>();
        for(var spec:List.of(List.of("api","接口与功能"),List.of("ui","UI 流程"),List.of("unit","代码单元"),List.of("perf","性能"),List.of("security","安全"),List.of("compat","兼容性"))){
            String kind=spec.getFirst();var samples=jobs.stream().filter(j->kind.equals(j.get("kind"))).toList();
            int count=samples.size()+(kind.equals("api")?requests.size():0),score=0;var evidence=new ArrayList<String>();
            for(var job:samples){
                var metrics=map(job.get("metrics"));String name=text(job.get("name"));
                if(Set.of("FAILED","ERROR").contains(text(job.get("status")))||"FAILED".equals(job.get("outcome"))){score=Math.max(score,70);evidence.add(name+"：执行失败");}
                if(Boolean.TRUE.equals(metrics.get("compileError"))){score=Math.max(score,70);evidence.add(name+"：编译或加载失败");}
                if(Set.of("perf","unit","compat").contains(kind)&&metrics.containsKey("total")&&number(metrics.get("total"))==0){score=Math.max(score,30);evidence.add(name+"：没有完成有效采样");}
                if(number(metrics.get("skipped"))>0||number(metrics.get("errors"))>0){score=Math.max(score,30);evidence.add(name+"：存在跳过或检查失败项");}
                if("perf".equals(kind)){
                    if(number(metrics.get("errorRate"))>0){score=Math.max(score,70);evidence.add(name+"：错误率 "+metrics.get("errorRate")+"%");}
                    if(number(metrics.get("p95Ms"))>2000){score=Math.max(score,60);evidence.add(name+"：P95 超过 2000 ms 的参考阈值");}
                }else if("security".equals(kind)){
                    if(number(metrics.get("riskCount"))>0){score=Math.max(score,70);evidence.add(name+"：发现 "+metrics.get("riskCount")+" 项风险线索");}
                    if(number(metrics.get("reviewCount"))>0){score=Math.max(score,30);evidence.add(name+"：存在待复核项");}
                }else if(number(metrics.get("failed"))>0||(kind.equals("compat")&&number(metrics.get("passed"))<number(metrics.get("total")))){score=Math.max(score,60);evidence.add(name+"：存在未通过项");}
                if("CANCELLED".equals(job.get("status"))||"RUNNING".equals(job.get("status"))){score=Math.max(score,30);evidence.add(name+"：执行尚未完整结束");}
            }
            if(kind.equals("api"))for(Object item:requests){var request=map(item);
                if(list(request.get("assertions")).stream().anyMatch(a->Boolean.FALSE.equals(map(a).get("passed")))){score=Math.max(score,60);evidence.add(text(request.get("name"))+"：接口断言失败");}
                else if(number(request.get("status"))>=400){score=Math.max(score,30);evidence.add(text(request.get("name"))+"：HTTP "+request.get("status")+"，需要结合预期判断");}
            }
            String level=count==0?"NO_DATA":score>=60?"HIGH":score>0?"REVIEW":"LOW";
            var row=new LinkedHashMap<String,Object>();row.put("id",kind);row.put("label",spec.get(1));row.put("level",level);row.put("score",count==0?null:score);row.put("samples",count);row.put("evidence",evidence.stream().distinct().limit(6).toList());
            row.put("rule","0=未发现已记录的失败；30=需复核/未完成；60–70=失败或超过参考阈值。不是漏洞概率。" );result.add(row);
        }return result;
    }
    public String redact(String text,String siteId){
        Set<String> secrets=new HashSet<>();
        if(siteId!=null&&!siteId.isBlank())for(String payload:db.queryForList("SELECT payload FROM workspace_resource WHERE kind='environments'",String.class)){
            var row=map(Json.parse(payload));if(siteId.equals(row.get("siteId")))collectSecrets(row.get("variables"),secrets);
        }
        String clean=text;
        for(String secret:secrets)if(secret.length()>=4){String escaped=JsonWriter.write(secret);clean=clean.replace(escaped.substring(1,escaped.length()-1),"[已脱敏]");}
        return clean.replaceAll("(?i)Bearer\\s+[A-Za-z0-9._~+/=-]+","Bearer [已脱敏]")
            .replaceAll("(?i)([?&](?:access_token|token|api[_-]?key|password|secret)=)[^&\\s\"\\\\]+","$1[已脱敏]");
    }
    private static void collectSecrets(Object value,Set<String> secrets){
        if(value instanceof List<?> list)for(Object item:list){var row=map(item);if(text(row.get("key")).matches("(?i).*(token|secret|password|api.?key|authorization|cookie).*"))secrets.add(text(row.get("value")));}
        if(value instanceof Map<?,?> map)map.forEach((k,v)->{if(text(k).matches("(?i).*(token|secret|password|api.?key|authorization|cookie).*"))secrets.add(text(v));});
    }
    private static Object bounded(Object value,int depth){
        if(value instanceof String s)return s.length()>1200?s.substring(0,1200)+"…":s;
        if(depth>9)return "[已省略深层数据]";
        if(value instanceof List<?> list)return list.stream().limit(10).map(v->bounded(v,depth+1)).toList();
        if(value instanceof Map<?,?> map){var result=new LinkedHashMap<String,Object>();map.forEach((k,v)->result.put(text(k),bounded(v,depth+1)));return result;}
        return value;
    }
}
