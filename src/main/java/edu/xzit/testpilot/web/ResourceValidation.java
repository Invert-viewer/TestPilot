package edu.xzit.testpilot.web;

import java.net.URI;
import java.util.*;
import org.springframework.http.HttpStatus;

final class ResourceValidation {
    static ApiException invalid(String field,String message) {
        return new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR",field+" · "+message,List.of(Map.of("field",field,"message",message)));
    }
    static String text(Map<?,?> row,String key) {
        if(!(row.get(key) instanceof String s) || s.isBlank()) throw invalid(key,"请填写文本");
        return s;
    }
    static URI url(String value) {
        try { URI u=URI.create(value);
            if(!Set.of("http","https").contains(u.getScheme()) || u.getHost()==null || u.getUserInfo()!=null || u.getFragment()!=null) throw new IllegalArgumentException();
            return u;
        } catch(RuntimeException e){throw invalid("url","填写不含凭据或片段的完整 HTTP(S) 地址");}
    }
    static String origin(URI u) {return u.getScheme()+"://"+u.getHost().toLowerCase(Locale.ROOT)+":"+(u.getPort()<0?(u.getScheme().equals("https")?443:80):u.getPort());}
    static void check(String type,Map<String,Object> row) {
        if(!type.equals("comparisonExperiences"))text(row,type.equals("checks")?"title":"name");
        if(type.equals("sites") || type.equals("environments")) {
            if(url(text(row,"baseUrl")).getQuery()!=null) throw invalid("baseUrl","网站和环境地址不能包含查询串");
            if(type.equals("environments")) text(row,"siteId");
        }
        if(type.equals("sites"))text(row,"scope");
        if(type.equals("checks")) {
            text(row,"expected");
            if(!Set.of("PENDING","PASSED","FAILED").contains(text(row,"status")))throw invalid("status","无效的检查状态");
        }
        if(type.equals("assertionCases")) {
            text(row,"expected");
            if(!Set.of("NOT_EVALUATED","PASSED","FAILED","SKIPPED").contains(text(row,"status")))throw invalid("status","无效的回归结论");
        }
        if(type.equals("requests")) {
            if(!(row.get("definition") instanceof Map<?,?> def)) throw invalid("definition","需要请求定义");
            text(def,"url");text(def,"name");
            if(!Set.of("GET","HEAD","POST","PATCH","PUT","DELETE","OPTIONS").contains(text(def,"method")))throw invalid("method","无效的请求方法");
            if(!Set.of("UTF-8","GB18030").contains(text(def,"charset")))throw invalid("charset","不支持的字符集");
            if(!(def.get("body") instanceof Map<?,?> body)||!Set.of("NONE","JSON","RAW","FORM_URLENCODED").contains(text(body,"mode")))throw invalid("body","无效的正文配置");
            if(!(def.get("followRedirects") instanceof Boolean)||!(def.get("timeoutMs") instanceof Number n)||n.intValue()<1)throw invalid("timeoutMs/followRedirects","无效的执行配置");
            for(String key:List.of("siteId","environmentId"))if(!(def.get(key) instanceof String))throw invalid(key,"需要字符串，直接请求可为空");
            for(String key:List.of("query","headers","cookies"))if(def.get(key) instanceof List<?> rows)for(Object r:rows)if(!(r instanceof Map<?,?> pair)||!(pair.get("key") instanceof String)||!(pair.get("value") instanceof String)||!(pair.get("enabled") instanceof Boolean))throw invalid(key,"需要有效键值行");
            if(body.get("mode").equals("JSON"))try{edu.xzit.testpilot.util.Json.parse(text(body,"text"));}catch(RuntimeException e){throw invalid("body.text","JSON 正文无效");}
            if(body.get("mode").equals("RAW") && !(body.get("text") instanceof String))throw invalid("body.text","需要文本");
            if(body.get("mode").equals("FORM_URLENCODED") && !(body.get("fields") instanceof List<?>))throw invalid("body.fields","需要表单行");
            if(Set.of("GET","HEAD").contains(def.get("method")) && !body.get("mode").equals("NONE"))throw invalid("body.mode","当前方法不接受正文");
            if(def.get("assertions") instanceof List<?> rows)for(Object r:rows){
                if(!(r instanceof Map<?,?> a) || !(a.get("enabled") instanceof Boolean) || !(a.get("expected") instanceof String))throw invalid("assertions","断言结构无效");
                text(a,"id");String op=text(a,"operator");
                boolean valid=switch(text(a,"type")){case "STATUS_CODE"->op.equals("EQ");case "RESPONSE_TIME_MS"->op.equals("LTE");case "HEADER","JSON_FIELD"->(op.equals("EQ")||op.equals("CONTAINS"))&&!text(a,"target").isBlank();case "BODY"->op.equals("EQ")||op.equals("CONTAINS");default->false;};
                if(!valid)throw invalid("assertions","断言类型或运算符无效");
            }
            for(String key:List.of("query","headers","cookies","assertions")) if(!(def.get(key) instanceof List<?>))throw invalid(key,"需要数组");
        }
        if(type.equals("comparisons")) for(String key:List.of("taskIds","siteIds","groups")) if(!(row.get(key) instanceof List<?>))throw invalid(key,"需要数组");
        if(type.equals("comparisonExperiences")) {text(row,"comparisonId");text(row,"taskId");}
    }
    static void references(Map<String,List<Map<String,Object>>> state) {
        Map<Object,String> origins=new HashMap<>();
        for(var site:state.get("sites")) origins.put(site.get("id"),origin(url((String)site.get("baseUrl"))));
        for(var env:state.get("environments")) if(!origin(url((String)env.get("baseUrl"))).equals(origins.get(env.get("siteId"))))
            throw invalid("environment.siteId","环境必须与所属网站同源，请刷新核对网站和环境");
        Set<Object> requestIds=new HashSet<>();
        state.get("requests").forEach(r->requestIds.add(r.get("id")));
        for(var regression:state.get("assertionCases"))if(regression.get("requestId") instanceof String id && !id.isBlank() && !requestIds.contains(id))throw invalid("requestId","关联请求不存在");
        for(var item:state.get("checks"))if(item.get("siteId") instanceof String id && !id.isBlank() && !origins.containsKey(id))throw invalid("siteId","关联网站不存在");
        for(var request:state.get("requests")) {
            var definition=(Map<?,?>)request.get("definition");
            Object site=definition.get("siteId"), env=definition.get("environmentId");
            if(site instanceof String s && !s.isBlank() && !origins.containsKey(s))throw invalid("requests.siteId","有请求资产引用该网站，请先解除绑定");
            if(env instanceof String e && !e.isBlank() && state.get("environments").stream().noneMatch(r->e.equals(r.get("id")) && Objects.equals(site,r.get("siteId"))))throw invalid("requests.environmentId","找不到请求绑定的环境");
        }
        for(var plan:state.get("comparisons")) for(Object site:(List<?>)plan.get("siteIds")) if(!origins.containsKey(site))throw invalid("siteIds","实验方案引用的网站不存在");
    }
}
