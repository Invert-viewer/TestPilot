package edu.xzit.testpilot.web;

import edu.xzit.testpilot.util.Json;
import edu.xzit.testpilot.util.JsonWriter;
import jakarta.servlet.http.HttpServletRequest;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.stream.Collectors;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/http-debug/executions")
public class HttpDebugController {
    public record Pair(String key,String value,boolean enabled) {}
    public record Body(String mode,String text,List<Pair> fields) {}
    public record Assertion(String id,String type,String target,String operator,String expected,boolean enabled) {}
    public record Definition(String name,String method,String url,String charset,List<Pair> query,List<Pair> headers,List<Pair> cookies,Body body,
                             int timeoutMs,boolean followRedirects,List<Assertion> assertions) {}
    private final HttpClient client=HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).proxy(new ProxySelector(){
        public List<Proxy> select(URI u){return List.of(Proxy.NO_PROXY);}
        public void connectFailed(URI u,SocketAddress a,IOException e){}
    }).build();
    private static String encode(String s,Charset charset){return URLEncoder.encode(s,charset);}
    private static List<Pair> enabled(List<Pair> pairs,String field) {
        if(pairs==null || pairs.stream().anyMatch(p->p==null || p.key()==null || p.value()==null))throw ResourceValidation.invalid(field,"需要有效键值行");
        return pairs.stream().filter(p->p.enabled()&&!p.key().isBlank()).toList();
    }
    private static String form(List<Pair> rows,Charset cs){return rows.stream().map(p->encode(p.key(),cs)+"="+encode(p.value(),cs)).collect(Collectors.joining("&"));}
    @PostMapping
    public Map<String,Object> execute(@RequestBody Definition d,HttpServletRequest request) {
        long start=System.nanoTime();
        if(d.method()==null || !Set.of("GET","HEAD","POST","PUT","DELETE","OPTIONS","PATCH").contains(d.method()))throw ResourceValidation.invalid("method","不支持的方法");
        if(d.timeoutMs()<1||d.timeoutMs()>60000)throw ResourceValidation.invalid("timeoutMs","范围为 1 至 60000 ms");
        if(d.charset()==null||!Set.of("UTF-8","GB18030").contains(d.charset()))throw ResourceValidation.invalid("charset","不支持的字符集");
        Charset cs=Charset.forName(d.charset()); URI uri=ResourceValidation.url(d.url());
        String query=form(enabled(d.query(),"query"),cs);
        if(!query.isEmpty())uri=URI.create(uri+(uri.getQuery()==null?"?":"&")+query);
        var headers=new TreeMap<String,String>(String.CASE_INSENSITIVE_ORDER);
        for(Pair p:enabled(d.headers(),"headers")) {
            if(Set.of("host","cookie","connection","expect","content-length","transfer-encoding","upgrade","proxy-authorization").contains(p.key().toLowerCase(Locale.ROOT))||headers.put(p.key(),p.value())!=null)
                throw ResourceValidation.invalid("headers","存在保留或重复的请求头");
        }
        var cookies=enabled(d.cookies(),"cookies");
        for(Pair p:cookies)if(!p.key().matches("[A-Za-z0-9_.-]+")||p.value().matches("(?s).*[;\\r\\n].*"))throw ResourceValidation.invalid("cookies","Cookie 名称或值无效");
        if(!cookies.isEmpty())headers.put("Cookie",cookies.stream().map(p->p.key()+"="+p.value()).collect(Collectors.joining("; ")));
        Body body=d.body();if(body==null||body.mode()==null)throw ResourceValidation.invalid("body","缺少正文模式");
        String content=switch(body.mode()){
            case "NONE"->null;
            case "JSON","RAW"->Objects.requireNonNullElse(body.text(),"");
            case "FORM_URLENCODED"->form(enabled(body.fields(),"body.fields"),cs);
            default->throw ResourceValidation.invalid("body.mode","不支持的正文模式");};
        if(content!=null&&Set.of("GET","HEAD").contains(d.method()))throw ResourceValidation.invalid("body","此方法不接受正文");
        if("JSON".equals(body.mode()))try{Json.parse(content);}catch(RuntimeException e){throw ResourceValidation.invalid("body.text","JSON 格式错误");}
        if(Set.of("JSON","FORM_URLENCODED").contains(body.mode())){
            String type="JSON".equals(body.mode())?"application/json":"application/x-www-form-urlencoded";
            if(headers.containsKey("Content-Type")&&!headers.get("Content-Type").split(";")[0].trim().equalsIgnoreCase(type))throw ResourceValidation.invalid("headers","Content-Type 与正文模式冲突");
            headers.put("Content-Type",type+"; charset="+cs.name());
        }
        if(d.assertions()==null)throw ResourceValidation.invalid("assertions","需要数组");
        for(Assertion a:d.assertions()){
            if(a==null||a.type()==null||a.expected()==null||a.operator()==null)throw ResourceValidation.invalid("assertions","断言字段不完整");
            boolean valid=switch(a.type()){case "STATUS_CODE"->a.operator().equals("EQ");case "RESPONSE_TIME_MS"->a.operator().equals("LTE");case "HEADER","BODY","JSON_FIELD"->Set.of("EQ","CONTAINS").contains(a.operator());default->false;};
            if(!valid)throw ResourceValidation.invalid("assertions","断言类型或运算符无效");
        }
        Map<String,Object> result=new LinkedHashMap<>();Map<String,Object> response=null,error=null;
        String method=d.method();
        try {
            for(int hop=0;;hop++){
                long remaining=d.timeoutMs()-TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start);
                if(remaining<=0)throw new TimeoutException();
                var builder=HttpRequest.newBuilder(uri).timeout(Duration.ofMillis(remaining)); headers.forEach(builder::header);
                var req=builder.method(method,content==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(content,cs)).build();
                var reply=client.send(req,HttpResponse.BodyHandlers.ofInputStream());
                try(var stream=reply.body()){
                    int status=reply.statusCode();var location=reply.headers().firstValue("location");
                    if(d.followRedirects()&&Set.of(301,302,303,307,308).contains(status)&&location.isPresent()){
                        if(hop>=5){error=Map.of("code","TARGET_REDIRECT_LIMIT_EXCEEDED","message","超出重定向次数");break;}
                        URI next;
                        try{next=ResourceValidation.url(uri.resolve(location.get()).toString());}catch(RuntimeException e){error=Map.of("code","TARGET_REDIRECT_NOT_ALLOWED","message","重定向地址无效");break;}
                        if(!ResourceValidation.origin(uri).equals(ResourceValidation.origin(next)))headers.clear();
                        if(status==303||((status==301||status==302)&&method.equals("POST"))){method="GET";content=null;headers.remove("Content-Type");}
                        uri=next;continue;
                    }
                    var bytes=CompletableFuture.supplyAsync(()->{try{return stream.readNBytes(262145);}catch(IOException e){throw new UncheckedIOException(e);}})
                        .get(Math.max(1,d.timeoutMs()-TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start)),TimeUnit.MILLISECONDS);
                    var pairs=new ArrayList<Map<String,String>>();
                    reply.headers().map().forEach((k,vs)->vs.forEach(v->pairs.add(Map.of("key",k,"value",k.equalsIgnoreCase("set-cookie")?"[已隐藏]":v))));
                    String type=reply.headers().firstValue("Content-Type").orElse("text/plain").toLowerCase(Locale.ROOT);
                    boolean binary=!(type.startsWith("text/")||type.contains("json")||type.contains("xml")||type.contains("javascript")||type.contains("form-urlencoded"));
                    boolean truncated=bytes.length>262144;if(truncated)bytes=Arrays.copyOf(bytes,262144);
                    Charset encoding=cs;var match=java.util.regex.Pattern.compile("charset=([^; ]+)").matcher(type);if(match.find())try{encoding=Charset.forName(match.group(1).replace("\"",""));}catch(IllegalArgumentException ignored){}
                    response=Map.of("statusCode",status,"headers",pairs,"bodyText",binary?Base64.getEncoder().encodeToString(bytes):new String(bytes,encoding),"bodyEncoding",binary?"base64":"text","sizeBytes",bytes.length,"truncated",truncated);break;
                }
            }
        }catch(HttpTimeoutException|TimeoutException e){error=Map.of("code","REQUEST_TIMEOUT","message","被测请求超时");}
        catch(IOException|ExecutionException e){error=Map.of("code","CONNECTION_ERROR","message","被测目标连接、TLS 或响应读取失败");}
        catch(InterruptedException e){Thread.currentThread().interrupt();error=Map.of("code","INTERRUPTED","message","请求已中止");}
        catch(IllegalArgumentException e){throw ResourceValidation.invalid("headers/url","请求地址或头字段无效");}
        long elapsed=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start);
        var assertions=new ArrayList<Map<String,Object>>();
        for(Assertion a:d.assertions())assertions.add(evaluate(a,response,elapsed));
        result.put("assertions",assertions);result.put("response",response);result.put("error",error);
        result.put("transportStatus",response==null?"FAILED":"COMPLETED");result.put("durationMs",elapsed);
        result.put("outcome",assertions.stream().anyMatch(a->"FAILED".equals(a.get("status")))?"FAILED":assertions.stream().anyMatch(a->"PASSED".equals(a.get("status")))?"PASSED":"NOT_EVALUATED");
        result.put("id","HTTP-"+UUID.randomUUID());result.put("resolvedUrl",uri.toString());
        return WorkspaceController.ok(result,request);
    }
    @SuppressWarnings("unchecked")
    private static Map<String,Object> evaluate(Assertion a,Map<String,Object> response,long elapsed){
        String actual=null,status="SKIPPED";
        if(a.enabled()&&response!=null){
            Object value=switch(a.type()){
                case "STATUS_CODE"->response.get("statusCode");case "BODY"->response.get("bodyText");case "RESPONSE_TIME_MS"->elapsed;
                case "HEADER"->((List<Map<String,String>>)response.get("headers")).stream().filter(p->p.get("key").equalsIgnoreCase(a.target())).map(p->p.get("value")).findFirst().orElse(null);
                case "JSON_FIELD"->pointer((String)response.get("bodyText"),a.target());default->null;};
            actual=value==null?null:value instanceof Map||value instanceof List?JsonWriter.write(value):value.toString();
            boolean passed=false;
            if(actual!=null)try{passed=switch(a.operator()){case "LTE"->Double.parseDouble(actual)<=Double.parseDouble(a.expected());case "CONTAINS"->actual.contains(a.expected());default->actual.equals(a.expected());};}catch(NumberFormatException ignored){}
            status=passed?"PASSED":"FAILED";
        }
        var r=new LinkedHashMap<String,Object>();r.put("id",a.id());r.put("type",a.type());r.put("target",a.target());r.put("expected",a.expected());r.put("operator",a.operator());r.put("actual",actual);r.put("status",status);return r;
    }
    private static Object pointer(String json,String pointer){
        try {Object v=Json.parse(json);if(pointer.isEmpty())return v;if(!pointer.startsWith("/"))return null;
            for(String part:pointer.substring(1).split("/",-1)){String k=part.replace("~1","/").replace("~0","~");v=v instanceof Map<?,?> m?m.get(k):v instanceof List<?> l?l.get(Integer.parseInt(k)):null;}return v;
        }catch(RuntimeException e){return null;}
    }
}
