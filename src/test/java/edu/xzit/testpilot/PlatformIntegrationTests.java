package edu.xzit.testpilot;

import com.sun.net.httpserver.HttpServer;
import edu.xzit.testpilot.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import java.net.*;
import java.net.http.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT, properties={"spring.datasource.url=jdbc:h2:mem:platformtests;MODE=MySQL;DB_CLOSE_DELAY=-1","testpilot.secret-file=./target/test-secret.key"})
class PlatformIntegrationTests {
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate db;
    final HttpClient client=HttpClient.newHttpClient();
    record Result(int status,Map<String,Object> json,String cookie) {
        @SuppressWarnings("unchecked") Map<String,Object> data(){return (Map<String,Object>)json.get("data");}
    }
    @SuppressWarnings("unchecked") Result call(String path,String method,Object body,String cookie,String origin) throws Exception {
        var req=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1/"+path));
        if(cookie!=null) req.header("Cookie",cookie); if(origin!=null)req.header("Origin",origin);
        if(body!=null)req.header("Content-Type","application/json");
        var res=client.send(req.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(JsonWriter.write(body))).build(),HttpResponse.BodyHandlers.ofString());
        String session=res.headers().allValues("set-cookie").stream().filter(s->s.contains("Max-Age=43200")).findFirst().orElse("");
        return new Result(res.statusCode(),(Map<String,Object>)Json.parse(res.body()),session.split(";")[0]);
    }
    Result call(String path,String method,Object body,String cookie) throws Exception{return call(path,method,body,cookie,null);}
    Map<String,Object> person(String username,String role){return Map.of("username",username,"displayName",username,"email",username+"@test.invalid","password","test-only-long-password","role",role);}
    String owner() throws Exception {var r=call("auth/setup","POST",person("owner","LEAD"),null);assertEquals(200,r.status());return r.cookie();}
    @BeforeEach void reset(){for(String table:List.of("platform_session","platform_user","platform_setting","workspace_resource")) db.update("DELETE FROM "+table);}

    @Test void authAndTeamPermissionsAreEnforcedOnServer() throws Exception {
        assertEquals(401,call("workspace","GET",null,null).status());
        assertEquals(false,call("auth/status","GET",null,null).data().get("initialized"));
        String lead=owner();assertEquals(409,call("auth/setup","POST",person("intruder","LEAD"),null).status());
        var tester=call("team","POST",person("tester","TESTER"),lead);assertEquals(200,tester.status());String testerId=(String)tester.data().get("id");
        var login=call("auth/login","POST",person("tester","TESTER"),null);assertEquals(200,login.status());String member=login.cookie();
        assertEquals(200,call("team","GET",null,member).status());
        assertEquals(403,call("team","POST",person("forged","LEAD"),member).status());
        assertEquals(403,call("team/"+testerId+"/role","PUT",Map.of("role","LEAD"),member).status());
        assertEquals(403,call("team/"+testerId,"DELETE",null,member).status());
        assertEquals(403,call("platform/settings/executor","PUT",Map.of("headless",false),member).status());
        assertEquals(403,call("team","POST",person("crosssite","LEAD"),lead,"https://evil.invalid").status());
        // Revocation is checked from the DB on the next request, not from a stale client role.
        assertEquals(200,call("team/"+testerId+"/role","PUT",Map.of("role","LEAD"),lead).status());
        assertEquals(200,call("team","POST",person("createdbynewlead","VIEWER"),member).status());
        assertEquals(200,call("team/"+testerId+"/role","PUT",Map.of("role","VIEWER"),lead).status());
        assertEquals(403,call("team","POST",person("nowdenied","LEAD"),member).status());
        String ownerId=(String)call("auth/me","GET",null,lead).data().get("id");
        assertEquals(400,call("team/"+ownerId+"/role","PUT",Map.of("role","TESTER"),lead).status());
        assertEquals(400,call("team/"+ownerId,"DELETE",null,lead).status());
        assertEquals(200,call("team/"+testerId,"DELETE",null,lead).status());assertEquals(401,call("auth/me","GET",null,member).status());
        assertFalse(db.queryForList("SELECT password_hash FROM platform_user",String.class).stream().anyMatch(s->s.contains("test-only")));
        call("auth/logout","POST",Map.of(),lead);assertEquals(401,call("auth/me","GET",null,lead).status());
    }
    @Test void projectsReuseWorkspaceTransactionsAndDatabaseMetadata() throws Exception {
        String lead=owner();
        var site=Map.of("name","支付系统","scope","订单测试","baseUrl","http://localhost:8080");
        var env=Map.of("name","预发布","siteId","project-one","baseUrl","https://staging.example.invalid","variables",List.of(Map.of("key","baseUrl","value","https://staging.example.invalid","enabled",true)));
        var space=Map.of("name","测试配置","siteId","project-one","data",Map.of("requests",List.of()),"workspaces",Map.of());
        var changes=List.of(Map.of("collection","sites","id","project-one","revision",0,"value",site),Map.of("collection","environments","id","staging-env","revision",0,"value",env),Map.of("collection","executionSpaces","id","project-one","revision",0,"value",space));
        assertEquals(200,call("workspace","POST",changes,lead).status());
        assertEquals(409,call("workspace","POST",changes,lead).status());
        var about=call("platform/about","GET",null,lead);assertEquals("H2",about.data().get("database"));assertEquals(true,about.data().get("connected"));
        assertEquals(200,call("platform/export","GET",null,lead).status());
        Map<String,Object> deletion=new LinkedHashMap<>();deletion.put("collection","sites");deletion.put("id","project-one");deletion.put("revision",1);deletion.put("value",null);
        assertEquals(200,call("workspace","POST",List.of(deletion),lead).status());
        assertEquals(0,db.queryForObject("SELECT COUNT(*) FROM workspace_resource",Integer.class));
    }
    @Test void openAiAndAnthropicProtocolsRequireKeysAndValidateResponses() throws Exception {
        String lead=owner();assertEquals(409,call("platform/ai/compose","POST",Map.of("text","点击 #submit"),lead).status());
        var observed=new AtomicReference<Map<String,Object>>();var headers=new AtomicReference<com.sun.net.httpserver.Headers>();
        var provider=new AtomicReference<>("OPENAI");var invalid=new AtomicReference<>(false);
        HttpServer mock=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        mock.createContext("/v1",exchange->{
            @SuppressWarnings("unchecked") var body=(Map<String,Object>)Json.parse(new String(exchange.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));observed.set(body);headers.set(exchange.getRequestHeaders());
            String output=invalid.get()?"{\"steps\":[{\"action\":\"exec\",\"selector\":\"\",\"value\":\"bad\"}]}":"{\"steps\":[{\"action\":\"click\",\"selector\":\"#submit\",\"value\":\"\"}],\"unmatched\":[]}";
            Object response=provider.get().equals("OPENAI")?Map.of("choices",List.of(Map.of("message",Map.of("content",output)))):Map.of("content",List.of(Map.of("type","text","text",output)));
            byte[] bytes=JsonWriter.write(response).getBytes(java.nio.charset.StandardCharsets.UTF_8);exchange.getResponseHeaders().add("Content-Type","application/json");exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
        });mock.start();
        try {
            String url="http://127.0.0.1:"+mock.getAddress().getPort()+"/v1",key="test-only-api-key-at-least-20";
            for(String protocol:List.of("OPENAI","ANTHROPIC")) {
                provider.set(protocol);
                assertEquals(400,call("platform/settings/ai","PUT",Map.of("provider",protocol,"baseUrl",url,"model","mock-model","apiKey",""),lead).status());
                var saved=call("platform/settings/ai","PUT",Map.of("provider",protocol,"baseUrl",url,"model","mock-model","apiKey",key),lead);
                assertEquals(200,saved.status());assertFalse(JsonWriter.write(saved.json()).contains(key));
                assertFalse(db.queryForObject("SELECT payload FROM platform_setting WHERE setting_key='ai'",String.class).contains(key));
                var composed=call("platform/ai/compose","POST",Map.of("text","点击 #submit"),lead);assertEquals(200,composed.status());assertEquals("mock-model",observed.get().get("model"));
                if(protocol.equals("OPENAI")) assertEquals("Bearer "+key,headers.get().getFirst("Authorization"));
                else {assertEquals(key,headers.get().getFirst("x-api-key"));assertEquals("2023-06-01",headers.get().getFirst("anthropic-version"));assertTrue(observed.get().containsKey("system"));}
                assertEquals(200,call("platform/ai/test","POST",Map.of(),lead).status());
                call("platform/settings/ai","DELETE",null,lead);
            }
            call("platform/settings/ai","PUT",Map.of("provider","OPENAI","baseUrl",url,"model","mock-model","apiKey",key),lead);
            invalid.set(true);assertEquals(502,call("platform/ai/compose","POST",Map.of("text","点击 #submit"),lead).status());
            call("platform/settings/ai","DELETE",null,lead);assertEquals(409,call("platform/ai/test","POST",Map.of(),lead).status());
        } finally {mock.stop(0);}
    }
}
