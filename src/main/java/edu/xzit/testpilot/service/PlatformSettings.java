package edu.xzit.testpilot.service;

import edu.xzit.testpilot.util.*;
import edu.xzit.testpilot.web.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import javax.crypto.Cipher;
import javax.crypto.spec.*;
import java.nio.file.*;
import java.security.SecureRandom;
import java.util.*;

@Service
public class PlatformSettings {
    private final JdbcTemplate db;
    private final Path secretFile;
    private byte[] key;
    public PlatformSettings(JdbcTemplate db,@Value("${testpilot.secret-file:./data/platform-secret.key}") String file) { this.db=db; secretFile=Path.of(file); }
    @SuppressWarnings("unchecked") public Map<String,Object> read(String name) {
        var rows=db.queryForList("SELECT payload FROM platform_setting WHERE setting_key=?",String.class,name);
        return rows.isEmpty()?new LinkedHashMap<>():new LinkedHashMap<>((Map<String,Object>)Json.parse(rows.getFirst()));
    }
    public void write(String name,Map<String,Object> value) {
        String text=JsonWriter.write(value);
        if(db.update("UPDATE platform_setting SET payload=? WHERE setting_key=?",text,name)==0) db.update("INSERT INTO platform_setting(setting_key,payload) VALUES(?,?)",name,text);
    }
    public Map<String,Object> executor() {
        var defaults=new LinkedHashMap<String,Object>(Map.of("browserPath","","headless",true,"jmeterHome","","javaHome","")); defaults.putAll(read("executor")); return defaults;
    }
    @Transactional public Map<String,Object> saveExecutor(Map<String,Object> body) {
        db.queryForObject("SELECT id FROM workspace_lock WHERE id=1 FOR UPDATE",Integer.class);
        var value=new LinkedHashMap<String,Object>();
        for(String name:List.of("browserPath","jmeterHome","javaHome")) {
            String p=Objects.toString(body.getOrDefault(name,""),"").trim();
            if(p.length()>1000 || p.contains("\n") || p.indexOf('\0')>=0 || (!p.isEmpty()&&!Path.of(p).isAbsolute())) throw ApiException.validation(name+" 必须是服务器上的绝对路径，或留空自动探测");
            value.put(name,p);
        }
        if(!(body.get("headless") instanceof Boolean)) throw ApiException.validation("headless 需要布尔值");
        value.put("headless",body.get("headless")); write("executor",value); return value;
    }
    private synchronized byte[] key() throws Exception {
        if(key!=null) return key;
        String env=System.getenv("TESTPILOT_SECRET_KEY");
        if(env!=null&&!env.isBlank()) key=Base64.getDecoder().decode(env);
        else {
            Path parent=secretFile.toAbsolutePath().getParent(); Files.createDirectories(parent);
            if(!Files.exists(secretFile)) {
                byte[] bytes=new byte[32]; new SecureRandom().nextBytes(bytes);
                try { Files.write(secretFile,bytes,StandardOpenOption.CREATE_NEW); }
                catch(FileAlreadyExistsException ignored) { }
            }
            key=Files.readAllBytes(secretFile);
        }
        if(key.length!=32) { key=null; throw new IllegalStateException("TESTPILOT_SECRET_KEY 必须是 Base64 编码的 32 字节密钥"); }
        return key;
    }
    private String crypt(String input,boolean encrypt) {
        try {
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); byte[] iv=new byte[12],bytes;
            if(encrypt) { new SecureRandom().nextBytes(iv); bytes=input.getBytes(java.nio.charset.StandardCharsets.UTF_8); }
            else { byte[] all=Base64.getDecoder().decode(input); iv=Arrays.copyOfRange(all,0,12); bytes=Arrays.copyOfRange(all,12,all.length); }
            cipher.init(encrypt?Cipher.ENCRYPT_MODE:Cipher.DECRYPT_MODE,new SecretKeySpec(key(),"AES"),new GCMParameterSpec(128,iv));
            byte[] out=cipher.doFinal(bytes);
            if(!encrypt) return new String(out,java.nio.charset.StandardCharsets.UTF_8);
            byte[] all=new byte[12+out.length]; System.arraycopy(iv,0,all,0,12); System.arraycopy(out,0,all,12,out.length); return Base64.getEncoder().encodeToString(all);
        } catch(Exception e) { throw ApiException.conflict("SECRET_UNAVAILABLE","AI 密钥加解密失败，请检查服务器密钥文件或 TESTPILOT_SECRET_KEY"); }
    }
    public String aiKey() { String cipher=Objects.toString(read("ai").get("encryptedKey"),""); return cipher.isEmpty()?"":crypt(cipher,false); }
    public record AiCredentials(String provider,String baseUrl,String model,String version,String key) {}
    public AiCredentials aiCredentials() {
        var value=read("ai");String encrypted=Objects.toString(value.get("encryptedKey"),"");
        if(encrypted.isBlank())throw ApiException.conflict("AI_NOT_CONFIGURED","请先在平台设置的 AI 引擎中配置 API 密钥");
        return new AiCredentials(Objects.toString(value.get("provider")),Objects.toString(value.get("baseUrl")),Objects.toString(value.get("model")),Objects.toString(value.getOrDefault("anthropicVersion","2023-06-01")),crypt(encrypted,false));
    }
    public Map<String,Object> aiPublic() {
        var ai=read("ai");Object key=ai.remove("encryptedKey"); ai.put("configured",key instanceof String s&&!s.isBlank()); return ai;
    }
    @Transactional public Map<String,Object> saveAi(Map<String,Object> body) {
        db.queryForObject("SELECT id FROM workspace_lock WHERE id=1 FOR UPDATE",Integer.class);
        String provider=PlatformAuth.field(body,"provider",1,30),base=PlatformAuth.field(body,"baseUrl",8,500).replaceAll("/+$","");
        if(!Set.of("OPENAI","ANTHROPIC").contains(provider)) throw ApiException.validation("只支持 OpenAI 或 Anthropic 协议");
        try { var u=java.net.URI.create(base);
            if(u.getHost()==null||u.getUserInfo()!=null||u.getQuery()!=null||u.getFragment()!=null||!("https".equals(u.getScheme())||("http".equals(u.getScheme())&&Set.of("localhost","127.0.0.1","[::1]").contains(u.getHost())))) throw new IllegalArgumentException();
        } catch(RuntimeException e) { throw ApiException.validation("API 基础地址需使用 HTTPS；本机调试可使用 HTTP"); }
        String model=PlatformAuth.field(body,"model",1,150),raw=Objects.toString(body.getOrDefault("apiKey",""),"").trim();
        var old=read("ai");
        if(raw.isEmpty()&&(!provider.equals(old.get("provider"))||!base.equals(old.get("baseUrl"))||!old.containsKey("encryptedKey"))) throw ApiException.validation("请配置 API 密钥；切换协议或地址时需要重新填写");
        if(!raw.isEmpty()&&!raw.matches("[\\x21-\\x7E]{20,500}")) throw ApiException.validation("API 密钥须为 20–500 个非空白 ASCII 字符");
        var ai=new LinkedHashMap<String,Object>(); ai.put("provider",provider); ai.put("baseUrl",base); ai.put("model",model);
        ai.put("encryptedKey",raw.isEmpty()?old.get("encryptedKey"):crypt(raw,true)); ai.put("keyHint",raw.isEmpty()?old.get("keyHint"):"••••"+raw.substring(raw.length()-4));
        String version=Objects.toString(body.getOrDefault("anthropicVersion","2023-06-01"));
        if(!version.matches("\\d{4}-\\d{2}-\\d{2}")) throw ApiException.validation("Anthropic 版本使用 YYYY-MM-DD 格式");
        ai.put("anthropicVersion",version); ai.put("verifiedAt",""); write("ai",ai); return aiPublic();
    }
    @Transactional public void clearAi() { db.update("DELETE FROM platform_setting WHERE setting_key='ai'"); }
}
