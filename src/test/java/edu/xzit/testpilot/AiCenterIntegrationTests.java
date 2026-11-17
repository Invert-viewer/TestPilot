package edu.xzit.testpilot;

import com.sun.net.httpserver.HttpServer;
import edu.xzit.testpilot.service.AiDataFactory;
import edu.xzit.testpilot.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"spring.datasource.url=jdbc:h2:mem:aicenter;MODE=MySQL;DB_CLOSE_DELAY=-1","testpilot.secret-file=./target/ai-test-secret.key","testpilot.ai.runs-directory=./target/ai-evidence"})
class AiCenterIntegrationTests {
    @Value("${local.server.port}") int port;@Autowired JdbcTemplate db;
    final HttpClient client=HttpClient.newHttpClient();HttpServer mock;String owner,other;
    final AtomicReference<String> output=new AtomicReference<>("中文测试建议");final AtomicReference<String> observed=new AtomicReference<>("");final AtomicInteger calls=new AtomicInteger();final AtomicInteger upstreamStatus=new AtomicInteger(200);final AtomicBoolean truncated=new AtomicBoolean();
    final List<Path> files=new ArrayList<>();
    record Response(int status,Map<String,Object> json,String cookie){@SuppressWarnings("unchecked")Map<String,Object> data(){return (Map<String,Object>)json.get("data");}}
    @SuppressWarnings("unchecked") Response request(String path,String method,Object body,String cookie)throws Exception{
        var builder=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1/"+path));if(cookie!=null)builder.header("Cookie",cookie);
        if(body!=null)builder.header("Content-Type","application/json");var response=client.send(builder.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(JsonWriter.write(body))).build(),HttpResponse.BodyHandlers.ofString());
        return new Response(response.statusCode(),(Map<String,Object>)Json.parse(response.body()),response.headers().allValues("set-cookie").stream().filter(v->v.contains("Max-Age=43200")).findFirst().orElse("").split(";")[0]);
    }
    Map<String,Object> person(String username){return Map.of("username",username,"displayName",username,"password","ai-test-password-only","role","TESTER");}
    @BeforeEach void setup()throws Exception{
        for(String table:List.of("ai_record","platform_session","platform_user","platform_setting","workspace_resource"))db.update("DELETE FROM "+table);
        calls.set(0);upstreamStatus.set(200);truncated.set(false);output.set("中文测试建议");
        mock=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);mock.createContext("/v1/chat/completions",exchange->{
            observed.set(new String(exchange.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));calls.incrementAndGet();
            byte[] bytes=JsonWriter.write(Map.of("choices",List.of(Map.of("message",Map.of("content",output.get()),"finish_reason",truncated.get()?"length":"stop")),"usage",Map.of("prompt_tokens",20,"completion_tokens",30))).getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type","application/json");exchange.sendResponseHeaders(upstreamStatus.get(),bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
        });mock.start();owner=request("auth/setup","POST",person("ai_owner"),null).cookie();
        request("team","POST",person("ai_tester"),owner);other=request("auth/login","POST",person("ai_tester"),null).cookie();
        var project=Map.of("name","证据项目","scope","测试","baseUrl","http://test.invalid");
        assertEquals(200,request("workspace","POST",List.of(Map.of("collection","sites","id","project","revision",0,"value",project)),owner).status());
    }
    @AfterEach void close()throws Exception{mock.stop(0);for(Path path:files){Files.deleteIfExists(path);Files.deleteIfExists(path.getParent());}files.clear();}
    void configure()throws Exception{assertEquals(200,request("platform/settings/ai","PUT",Map.of("provider","OPENAI","baseUrl","http://127.0.0.1:"+mock.getAddress().getPort()+"/v1","model","mock-deepseek","apiKey","synthetic-api-key-for-tests"),owner).status());}
    @Test void missingKeyIsExplicitAndChatHistoryIsPrivateAndMultiTurn()throws Exception{
        assertEquals(401,request("ai/state?projectId=project","GET",null,null).status());
        var missing=request("ai/state?projectId=project","GET",null,owner);assertEquals(409,missing.status());assertEquals("AI_NOT_CONFIGURED",missing.json().get("code"));configure();
        var state=request("ai/state?projectId=project","GET",null,owner).data();for(Object item:(List<?>)((Map<?,?>)state.get("context")).get("dimensions")){assertEquals("NO_DATA",((Map<?,?>)item).get("level"));assertNull(((Map<?,?>)item).get("score"));}
        assertEquals(200,request("ai/chat","POST",Map.of("projectId","project","message","第一轮问题","context","none"),owner).status());
        assertEquals(200,request("ai/chat","POST",Map.of("projectId","project","message","第二轮问题","context","none"),owner).status());
        var sent=(Map<?,?>)Json.parse(observed.get());assertEquals(4,((List<?>)sent.get("messages")).size());assertTrue(observed.get().contains("第一轮问题"));
        assertEquals(0,((List<?>)request("ai/state?projectId=project","GET",null,other).data().get("chat")).size());
        assertEquals(2,((List<?>)request("ai/state?projectId=project","GET",null,owner).data().get("chat")).size());
        assertEquals(200,request("ai/chat?projectId=project","DELETE",null,owner).status());assertEquals(0,db.queryForObject("SELECT COUNT(*) FROM ai_record",Integer.class));
    }
    Map<String,Object> apiCase(){var result=new LinkedHashMap<String,Object>();result.putAll(Map.of("name","登录成功","type","api","priority","P0","description","有效账号","expected","状态正确","preconditions",List.of(),"notes",List.of(),"method","POST","url","{{baseUrl}}/login","bodyText","{\"name\":\"demo\"}"));result.put("expectedStatus",200);return result;}
    @Test void generatedCasesAreValidatedSavedAtomicallyAndImportsAreIdempotent()throws Exception{
        configure();var ui=new LinkedHashMap<String,Object>();ui.putAll(Map.of("name","页面提交","type","ui","priority","P1","description","按钮行为","expected","跳转首页","url","{{baseUrl}}/login","steps",List.of(Map.of("action","click","selector","#invented","value",""))));
        output.set(JsonWriter.write(Map.of("cases",List.of(apiCase(),ui))));
        var result=request("ai/cases","POST",Map.of("projectId","project","requirement","POST /login 接口与页面登录","type","auto","count",2),owner);assertEquals(200,result.status(),JsonWriter.write(result.json()));
        var record=result.data();var cases=(List<?>)((Map<?,?>)record.get("value")).get("cases");var uiResult=(Map<?,?>)cases.get(1);assertTrue(((List<?>)((Map<?,?>)uiResult.get("draft")).get("steps")).isEmpty());
        List<String> ids=cases.stream().map(v->(String)((Map<?,?>)v).get("id")).toList();String id=(String)record.get("id");
        assertEquals(2L,request("ai/records/"+id+"/import","POST",Map.of("caseIds",ids),owner).data().get("added"));
        assertEquals(0L,request("ai/records/"+id+"/import","POST",Map.of("caseIds",ids),owner).data().get("added"));
        assertEquals(404,request("ai/records/"+id+"/import","POST",Map.of("caseIds",ids),other).status());
        assertEquals(400,request("ai/records/"+id+"/import","POST",Map.of("caseIds",List.of("foreign")),owner).status());
        var payload=(Map<?,?>)Json.parse(db.queryForObject("SELECT payload FROM workspace_resource WHERE kind='executionSpaces'",String.class));var data=(Map<?,?>)payload.get("data");assertEquals(1,((List<?>)data.get("requests")).size());assertEquals(1,((List<?>)data.get("uiCases")).size());
        int before=calls.get();assertEquals(400,request("ai/cases","POST",Map.of("projectId","project","requirement","测试","count",0),owner).status());assertEquals(before,calls.get());
        output.set("{\"cases\":[]}");assertEquals(502,request("ai/cases","POST",Map.of("projectId","project","requirement","测试","count",1),owner).status());assertEquals(1,db.queryForObject("SELECT COUNT(*) FROM ai_record",Integer.class));
        assertTrue(observed.get().contains("json_object"));
    }
    @Test void dataFactoryChecksFormatsAndChecksumsAndRejectsMalformedModelRows()throws Exception{
        configure();var types=List.of(Map.of("field","手机号","type","PHONE"),Map.of("field","身份证","type","IDCARD"),Map.of("field","银行卡","type","BANKCARD"));var row=Map.of("手机号","fake","身份证","fake","银行卡","fake");output.set(JsonWriter.write(Map.of("types",types,"rows",List.of(row,row))));
        var result=request("ai/data","POST",Map.of("projectId","project","fields","手机号，身份证,银行卡","mode","VALID","count",2),owner);assertEquals(200,result.status(),JsonWriter.write(result.json()));
        var rows=(List<?>)((Map<?,?>)result.data().get("value")).get("rows");
        for(Object item:rows){var r=(Map<?,?>)item;String phone=(String)r.get("手机号"),identity=(String)r.get("身份证"),bank=(String)r.get("银行卡");assertTrue(phone.matches("1[3-9]\\d{9}"));assertEquals(identity,AiDataFactory.idChecksum(identity.substring(0,17)));assertEquals(bank,AiDataFactory.bankChecksum(bank.substring(0,bank.length()-1)));}
        assertEquals("11010519491231002X",AiDataFactory.idChecksum("11010519491231002"));assertEquals("4111111111111111",AiDataFactory.bankChecksum("411111111111111"));
        var invalid=request("ai/data","POST",Map.of("projectId","project","fields","手机号,身份证,银行卡","mode","INVALID","count",2),owner);assertEquals(200,invalid.status());var bad=(Map<?,?>)((List<?>)((Map<?,?>)invalid.data().get("value")).get("rows")).getFirst();String badId=(String)bad.get("身份证");assertNotEquals(badId,AiDataFactory.idChecksum(badId.substring(0,17)));
        output.set("{\"types\":[],\"rows\":[]}");assertEquals(502,request("ai/data","POST",Map.of("projectId","project","fields","手机号","count",1),owner).status());
    }
    @Test void riskUsesProjectEvidenceRedactsSecretsAndDoesNotInventMissingData()throws Exception{
        configure();assertEquals(400,request("ai/risk","POST",Map.of("projectId","project"),owner).status());
        String jobId=UUID.randomUUID().toString();Path file=Path.of("target/ai-evidence",jobId,"result.json").toAbsolutePath().normalize();assertTrue(file.startsWith(Path.of("target/ai-evidence").toAbsolutePath().normalize()));Files.createDirectories(file.getParent());files.add(file);
        Files.writeString(file,JsonWriter.write(Map.of("id",jobId,"kind","unit","name","编译测试","status","COMPLETED","createdAt","2026-01-01T00:00:00Z","result",Map.of("compileError",true,"total",0,"cases",List.of(Map.of("name","加载","error","credential-fixture-secret"))),"screenshot","never-transmit-image")));
        var space=Map.of("name","执行记录","siteId","project","data",Map.of(),"workspaces",Map.of("history",Map.of("unit",List.of(Map.of("id",jobId)))));
        var env=Map.of("name","环境","siteId","project","baseUrl","http://test.invalid","variables",List.of(Map.of("key","password","value","credential-fixture-secret","enabled",true)));
        assertEquals(200,request("workspace","POST",List.of(Map.of("collection","executionSpaces","id","project","revision",0,"value",space),Map.of("collection","environments","id","environment","revision",0,"value",env)),owner).status());
        output.set(JsonWriter.write(Map.of("summary","先处理编译失败","actions",List.of(Map.of("priority","P1","title","修复编译","reason","已有加载失败证据","verification","重新运行单测")),"gaps",List.of("缺少性能数据"))));
        var result=request("ai/risk","POST",Map.of("projectId","project"),owner);assertEquals(200,result.status(),JsonWriter.write(result.json()));assertFalse(observed.get().contains("credential-fixture-secret"));assertFalse(observed.get().contains("never-transmit-image"));
        var dims=(List<?>)((Map<?,?>)((Map<?,?>)result.data().get("value")).get("evidence")).get("dimensions");
        for(Object item:dims){var d=(Map<?,?>)item;if("unit".equals(d.get("id")))assertEquals("HIGH",d.get("level"));if("perf".equals(d.get("id"))){assertEquals("NO_DATA",d.get("level"));assertNull(d.get("score"));}}
    }
    @Test void upstreamErrorsAndTruncatedResponsesNeverCreateFakeSuccessRecords()throws Exception{
        configure();upstreamStatus.set(429);assertEquals(502,request("ai/chat","POST",Map.of("message","测试"),owner).status());assertEquals(0,db.queryForObject("SELECT COUNT(*) FROM ai_record",Integer.class));
        upstreamStatus.set(200);truncated.set(true);var result=request("ai/chat","POST",Map.of("message","测试"),owner);assertEquals(502,result.status());assertEquals("AI_OUTPUT_TRUNCATED",result.json().get("code"));assertEquals(0,db.queryForObject("SELECT COUNT(*) FROM ai_record",Integer.class));
    }
}
