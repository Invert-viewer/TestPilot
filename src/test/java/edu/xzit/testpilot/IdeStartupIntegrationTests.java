package edu.xzit.testpilot;

import com.sun.net.httpserver.HttpServer;
import edu.xzit.testpilot.service.IdeFrontendService;
import edu.xzit.testpilot.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import java.net.*;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Runs the same lifecycle as clicking TestPilotApplication.main in IDEA. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
    "spring.datasource.url=jdbc:h2:mem:idefrontend;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "testpilot.frontend.enabled=true","testpilot.frontend.port=0"})
@DirtiesContext
class IdeStartupIntegrationTests {
    @Autowired IdeFrontendService frontend;
    @Value("${local.server.port}") int backendPort;
    final HttpClient client=HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(3)).build();
    HttpResponse<String> call(String url,String method,Object body,String cookie) throws Exception {
        var request=HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(35));
        if(cookie!=null)request.header("Cookie",cookie);
        if(body!=null)request.header("Content-Type","application/json").header("Origin",URI.create(url).getScheme()+"://"+URI.create(url).getAuthority());
        return client.send(request.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(JsonWriter.write(body))).build(),HttpResponse.BodyHandlers.ofString());
    }
    @SuppressWarnings("unchecked") Map<String,Object> data(HttpResponse<String> response) {
        assertEquals(200,response.statusCode(),response.body());var envelope=(Map<String,Object>)Json.parse(response.body());
        return (Map<String,Object>)envelope.get("data");
    }
    @Test @Timeout(120)
    void javaMainOwnsFrontendLoginProxyJMeterAndShutdown() throws Exception {
        String url=frontend.url();
        String cancelledId=null;
        HttpServer target=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        target.createContext("/probe",exchange->{byte[] body="{\"ok\":true}".getBytes();exchange.getResponseHeaders().add("Content-Type","application/json");exchange.sendResponseHeaders(200,body.length);exchange.getResponseBody().write(body);exchange.close();});target.start();
        try {
            var root=call("http://127.0.0.1:"+backendPort+"/","GET",null,null);
            assertEquals(302,root.statusCode());assertEquals(url+"/",root.headers().firstValue("Location").orElseThrow());
            var page=call(url+"/","GET",null,null);assertEquals(200,page.statusCode());assertTrue(page.body().contains("TestPilot"));
            assertEquals(false,data(call(url+"/api/v1/auth/status","GET",null,null)).get("initialized"));
            assertEquals(401,call(url+"/__runner/capabilities","GET",null,null).statusCode());
            var setup=call(url+"/api/v1/auth/setup","POST",Map.of("username","idea_test_owner","displayName","IDEA 测试负责人","password","temporary-test-password"),null);
            assertEquals(200,setup.statusCode());String cookie=setup.headers().firstValue("set-cookie").orElseThrow().split(";")[0];
            assertEquals(true,data(call(url+"/__runner/capabilities","GET",null,cookie)).get("jmeter"));
            var draft=new LinkedHashMap<String,Object>();
            draft.put("name","IDEA 启动 JMeter");draft.put("method","GET");draft.put("url","http://127.0.0.1:"+target.getAddress().getPort()+"/probe");
            draft.put("headers",List.of());draft.put("query",List.of());draft.put("body",Map.of("mode","none","text","","fields",List.of()));draft.put("auth",Map.of("type","none"));draft.put("timeoutMs",5000);draft.put("followRedirects",true);
            var config=Map.of("name","IDEA 集成验收","engine","jmeter","request",draft,"users",1,"duration",1,"rampUp",0,"thinkTime",100,"expectedStatus",200);
            var job=data(call(url+"/__runner/jobs/start","POST",Map.of("kind","perf","payload",config,"variables",Map.of()),cookie));
            String id=(String)job.get("id");long end=System.nanoTime()+Duration.ofSeconds(45).toNanos();
            do {Thread.sleep(200);job=data(call(url+"/__runner/jobs/get","POST",Map.of("id",id),cookie));}while("RUNNING".equals(job.get("status"))&&System.nanoTime()<end);
            assertEquals("COMPLETED",job.get("status"),JsonWriter.write(job));
            var result=(Map<?,?>)job.get("result");assertEquals("Apache JMeter",result.get("engine"));assertTrue(((Number)result.get("total")).intValue()>0);assertEquals(0,((Number)result.get("failed")).intValue());
            var artifact=((List<?>)job.get("artifacts")).stream().map(v->(Map<?,?>)v).filter(a->"jmeter.csv".equals(a.get("filename"))).findFirst().orElseThrow();
            assertEquals(200,call(url+artifact.get("url"),"GET",null,cookie).statusCode());
            var longConfig=new LinkedHashMap<>(config);longConfig.put("engine","http");longConfig.put("duration",30);
            var pending=data(call(url+"/__runner/jobs/start","POST",Map.of("kind","perf","payload",longConfig,"variables",Map.of()),cookie));
            cancelledId=(String)pending.get("id");Thread.sleep(150);
        } finally {target.stop(0);frontend.close();}
        assertFalse(frontend.isRunning());
        assertThrows(java.io.IOException.class,()->call(url+"/","GET",null,null));
        var saved=(Map<?,?>)Json.parse(java.nio.file.Files.readString(java.nio.file.Path.of("frontend/.runs",cancelledId,"result.json")));
        assertEquals("CANCELLED",saved.get("status"));
    }
}
