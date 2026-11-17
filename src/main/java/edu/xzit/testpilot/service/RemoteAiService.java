package edu.xzit.testpilot.service;

import edu.xzit.testpilot.util.*;
import edu.xzit.testpilot.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import java.net.*;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayOutputStream;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.Flow;

/** Real provider calls only. Never substitute a rule engine for a failed model request. */
@Service
public class RemoteAiService {
    public record Completion(String text,String provider,String model,long durationMs,Map<String,Object> usage) {}
    private final PlatformSettings settings;
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build();
    public RemoteAiService(PlatformSettings settings) {this.settings=settings;}
    public String call(String system,String prompt,boolean test) {
        return complete(system,List.of(Map.of("role","user","content",prompt)),false,test?64:4096).text();
    }
    @SuppressWarnings("unchecked")
    public Completion complete(String system,List<Map<String,String>> messages,boolean jsonMode,int maxTokens) {
        var config=settings.aiCredentials();boolean anthropic="ANTHROPIC".equals(config.provider());
        if(messages.isEmpty()||messages.size()>26||maxTokens<1||maxTokens>8192)throw ApiException.validation("AI 请求规模无效");
        var body=new LinkedHashMap<String,Object>();body.put("model",config.model());body.put("max_tokens",maxTokens);body.put("stream",false);
        if(anthropic){body.put("system",system);body.put("messages",messages);}
        else {
            var all=new ArrayList<Map<String,String>>();all.add(Map.of("role","system","content",system));all.addAll(messages);body.put("messages",all);
            if(jsonMode)body.put("response_format",Map.of("type","json_object"));
        }
        var request=HttpRequest.newBuilder(URI.create(config.baseUrl()+(anthropic?"/messages":"/chat/completions")))
            .timeout(Duration.ofSeconds(90)).header("Content-Type","application/json");
        if(anthropic)request.header("x-api-key",config.key()).header("anthropic-version",config.version());
        else request.header("Authorization","Bearer "+config.key());
        long started=System.nanoTime();
        try {
            var response=client.send(request.POST(HttpRequest.BodyPublishers.ofString(JsonWriter.write(body))).build(),info->new LimitedBody());
            if(response.statusCode()<200||response.statusCode()>=300)throw new ApiException(HttpStatus.BAD_GATEWAY,"AI_UPSTREAM_ERROR","AI 服务返回 HTTP "+response.statusCode()+"，请检查 API 地址、密钥、模型和额度");
            var value=(Map<String,Object>)Json.parse(response.body());String text;
            if(anthropic){
                if("max_tokens".equals(value.get("stop_reason")))throw truncated();
                var result=new StringBuilder();for(var block:(List<Map<String,Object>>)value.get("content"))if("text".equals(block.get("type")))result.append(block.get("text"));text=result.toString();
            }else{
                var choice=(Map<?,?>)((List<?>)value.get("choices")).getFirst();
                if("length".equals(choice.get("finish_reason")))throw truncated();
                text=Objects.toString(((Map<?,?>)choice.get("message")).get("content"),"");
            }
            if(text.isBlank())throw invalidOutput();
            var usage=new LinkedHashMap<String,Object>();
            if(value.get("usage") instanceof Map<?,?> raw)for(String key:List.of("prompt_tokens","completion_tokens","total_tokens","input_tokens","output_tokens"))if(raw.get(key) instanceof Number n)usage.put(key,n.longValue());
            return new Completion(text,config.provider(),config.model(),TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started),usage);
        }catch(ApiException e){throw e;}
        catch(InterruptedException e){Thread.currentThread().interrupt();throw new ApiException(HttpStatus.BAD_GATEWAY,"AI_CANCELLED","AI 调用已中断");}
        catch(Exception e){throw new ApiException(HttpStatus.BAD_GATEWAY,"AI_RESPONSE_ERROR","AI 连接失败、超过 90 秒或响应不符合所选协议");}
    }
    private static ApiException truncated(){return new ApiException(HttpStatus.BAD_GATEWAY,"AI_OUTPUT_TRUNCATED","模型输出达到长度上限，请减少生成数量或缩短描述后重试");}
    public static ApiException invalidOutput(){return new ApiException(HttpStatus.BAD_GATEWAY,"AI_INVALID_OUTPUT","AI 返回的内容结构无效，请调整描述或减少数量后重试");}
    @SuppressWarnings("unchecked") public static Map<String,Object> object(String raw){
        try{return (Map<String,Object>)Json.parse(raw.trim().replaceAll("(?s)^```(?:json)?\\s*|\\s*```$",""));}
        catch(RuntimeException e){throw invalidOutput();}
    }
    public Object test(){var result=complete("Reply OK.",List.of(Map.of("role","user","content","Reply OK.")),false,64);return Map.of("connected",true,"provider",result.provider(),"model",result.model());}
    public static final Set<String> ACTIONS=Set.of("goto","fill","click","press","wait","waitFor","assertText","assertVisible","assertHidden","assertUrl","assertTitle","assertCount","select","hover","screenshot","check","uncheck","scroll");
    @SuppressWarnings("unchecked") public Object compose(String text){
        if(text==null||text.isBlank()||text.length()>12000)throw ApiException.validation("流程描述长度为 1–12000 字符");
        String instruction="Return JSON only: {\"steps\":[{\"action\":\"...\",\"selector\":\"...\",\"value\":\"...\"}],\"unmatched\":[]}. Allowed actions: "+String.join(",",ACTIONS)+". Use only selectors explicitly provided by the user. Never invent selectors. Put ambiguous instructions in unmatched. No code execution. Preserve {{variables}}.";
        var completion=complete(instruction,List.of(Map.of("role","user","content",text)),true,4096);
        try {
            var json=object(completion.text());var steps=(List<Map<String,Object>>)json.get("steps");var unmatched=(List<?>)json.getOrDefault("unmatched",List.of());
            if(steps==null||steps.size()>100||unmatched.size()>100||unmatched.stream().anyMatch(v->!(v instanceof String)))throw invalidOutput();
            for(var step:steps)if(!ACTIONS.contains(step.get("action"))||!(step.get("selector") instanceof String s)||s.length()>4000||!(step.get("value") instanceof String v)||v.length()>8000)throw invalidOutput();
            return Map.of("steps",steps,"unmatched",unmatched,"engine",completion.provider()+" · "+completion.model());
        }catch(RuntimeException e){throw new ApiException(HttpStatus.BAD_GATEWAY,"AI_INVALID_STEPS","AI 返回的步骤格式无效，请补充选择器和操作后重试");}
    }
    /** Completes after the entire bounded response, so request timeout covers response reading too. */
    private static final class LimitedBody implements HttpResponse.BodySubscriber<String>{
        private final CompletableFuture<String> body=new CompletableFuture<>();private final ByteArrayOutputStream bytes=new ByteArrayOutputStream();private Flow.Subscription subscription;
        public CompletionStage<String> getBody(){return body;}
        public void onSubscribe(Flow.Subscription s){subscription=s;s.request(1);}
        public void onNext(List<ByteBuffer> items){
            for(var item:items){if(bytes.size()+item.remaining()>1048576){subscription.cancel();body.completeExceptionally(new IllegalStateException("response too large"));return;}byte[] chunk=new byte[item.remaining()];item.get(chunk);bytes.writeBytes(chunk);}subscription.request(1);
        }
        public void onError(Throwable error){body.completeExceptionally(error);}
        public void onComplete(){body.complete(bytes.toString(StandardCharsets.UTF_8));}
    }
}