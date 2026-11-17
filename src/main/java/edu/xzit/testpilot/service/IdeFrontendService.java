package edu.xzit.testpilot.service;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import edu.xzit.testpilot.util.Json;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;

/** The Java run button owns the frontend, proxy and test runners for the whole session. */
@Service
@ConditionalOnProperty(name="testpilot.frontend.enabled",havingValue="true")
public class IdeFrontendService {
    private static final Logger log=LoggerFactory.getLogger(IdeFrontendService.class);
    private final String nodeCommand;
    private final String rootDirectory;
    private final int requestedPort;
    private final String controlToken=UUID.randomUUID().toString();
    private final CountDownLatch ready=new CountDownLatch(1);
    private volatile Process process;
    private volatile int actualPort;
    private volatile boolean stopping;
    public IdeFrontendService(@Value("${testpilot.frontend.node-path:node}") String nodeCommand,
                              @Value("${testpilot.frontend.directory:./frontend}") String rootDirectory,
                              @Value("${testpilot.frontend.port:5174}") int port) {
        this.nodeCommand=nodeCommand; this.rootDirectory=rootDirectory; this.requestedPort=port;
    }
    public String url() {
        if(!isRunning()) throw new IllegalStateException("前端执行服务尚未就绪，请查看 IDEA Run 控制台");
        return "http://127.0.0.1:"+actualPort;
    }
    public boolean isRunning() {var child=process;return actualPort>0&&child!=null&&child.isAlive()&&!stopping;}
    @EventListener(ApplicationReadyEvent.class)
    public synchronized void start(ApplicationReadyEvent event) throws Exception {
        Integer backendPort=event.getApplicationContext().getEnvironment().getProperty("local.server.port",Integer.class);
        if(backendPort==null||process!=null)return;
        Path directory=Path.of(rootDirectory).toAbsolutePath().normalize();
        Path script=directory.resolve("scripts/ide-server.mjs");
        if(!Files.isRegularFile(script)) throw new IllegalStateException("未找到 "+script+"；请把 IDEA 运行配置的工作目录设为 TestPilot 项目目录");
        if(!Files.isRegularFile(directory.resolve("node_modules/vite/bin/vite.js"))) throw new IllegalStateException("缺少前端依赖；请在 IDEA 的 package.json / npm 面板执行 ci 或 install 后重新运行");
        var builder=new ProcessBuilder(nodeCommand,script.toString()).directory(directory.toFile()).redirectErrorStream(true);
        var env=builder.environment();
        env.put("TESTPILOT_BACKEND_URL","http://127.0.0.1:"+backendPort);
        env.put("TESTPILOT_FRONTEND_PORT",Integer.toString(requestedPort));
        env.put("TESTPILOT_PARENT_PID",Long.toString(ProcessHandle.current().pid()));
        env.put("TESTPILOT_IDE_CONTROL_TOKEN",controlToken);
        // Use the IDE's JDK for child Java tools even when the system PATH points to Java 17.
        env.put("TESTPILOT_JAVA_HOME",System.getProperty("java.home"));
        try {process=builder.start();}
        catch(IOException e) {throw new IllegalStateException("无法启动 Node.js；请检查 testpilot.frontend.node-path（当前为 "+nodeCommand+"）",e);}
        Thread.ofPlatform().daemon().name("testpilot-frontend-output").start(()->{
            try(var reader=process.inputReader(StandardCharsets.UTF_8)) {
                String line;
                while((line=reader.readLine())!=null) {
                    if(line.startsWith("TESTPILOT_IDE_READY ")) {
                        try {var value=(Map<?,?>)Json.parse(line.substring("TESTPILOT_IDE_READY ".length()));int p=((Number)value.get("port")).intValue();if(p>0&&p<=65535)actualPort=p;}
                        finally {ready.countDown();}
                    } else log.info("[frontend] {}",line.length()>2000?line.substring(0,2000):line);
                }
            } catch(Exception e) {if(!stopping)log.warn("前端输出读取中断");}
            finally {ready.countDown();if(!stopping&&actualPort>0)log.error("前端执行服务已停止，请在 IDEA 中重新运行 TestPilot");}
        });
        if(!ready.await(45,TimeUnit.SECONDS)||!isRunning()) {
            close();throw new IllegalStateException("前端未能启动，请查看上方 [frontend] 日志，检查 Node.js 依赖和端口 "+requestedPort);
        }
        log.info("TestPilot 已就绪：{} （IDEA Stop 会同时停止前端与测试执行器）",url());
    }
    @PreDestroy
    public synchronized void close() {
        if(stopping)return;stopping=true;var child=process;if(child==null)return;
        var descendants=child.descendants().toList();
        if(child.isAlive()&&actualPort>0)try {
            var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+actualPort+"/__ide/stop"))
                .timeout(Duration.ofSeconds(2)).header("x-testpilot-control",controlToken).POST(HttpRequest.BodyPublishers.noBody()).build();
            HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(1)).build().send(request,HttpResponse.BodyHandlers.discarding());
            child.waitFor(10,TimeUnit.SECONDS);
        } catch(InterruptedException e) {Thread.currentThread().interrupt();}
        catch(Exception ignored) { }
        if(child.isAlive()) {
            descendants.forEach(handle->{if(handle.isAlive())handle.destroy();});child.destroy();
            try {if(!child.waitFor(2,TimeUnit.SECONDS)){descendants.forEach(handle->{if(handle.isAlive())handle.destroyForcibly();});child.destroyForcibly();}}
            catch(InterruptedException e){Thread.currentThread().interrupt();child.destroyForcibly();}
        }
    }
}
