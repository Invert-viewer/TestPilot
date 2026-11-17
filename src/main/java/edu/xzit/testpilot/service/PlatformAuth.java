package edu.xzit.testpilot.service;

import edu.xzit.testpilot.web.ApiException;
import jakarta.servlet.http.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.security.*;
import java.time.Instant;
import java.util.*;

/** Database sessions are revocable; a client's role is never trusted. */
@Service
public class PlatformAuth {
    public static final String COOKIE = "TP_SESSION";
    public record User(String id, String username, String displayName, String email, String role, String createdAt) {}
    private final JdbcTemplate db;
    private final SecureRandom random = new SecureRandom();
    public PlatformAuth(JdbcTemplate db) { this.db = db; }
    public boolean initialized() { return db.queryForObject("SELECT COUNT(*) FROM platform_user", Integer.class) > 0; }
    public List<User> members() {
        return db.query("SELECT * FROM platform_user ORDER BY created_at,id", (rs,n) -> new User(rs.getString("id"),rs.getString("username"),rs.getString("display_name"),rs.getString("email"),rs.getString("role"),rs.getString("created_at")));
    }
    public static ApiException unauthorized() { return new ApiException(HttpStatus.UNAUTHORIZED,"LOGIN_REQUIRED","请先登录，或重新登录已过期的会话"); }
    public static void requireLead(User user) {
        if(user == null) throw unauthorized();
        if(!"LEAD".equals(user.role())) throw new ApiException(HttpStatus.FORBIDDEN,"LEAD_REQUIRED","只有测试负责人可以修改此配置");
    }
    public User authenticate(HttpServletRequest req) {
        String token = token(req);
        if(token.isEmpty()) throw unauthorized();
        var rows = db.queryForList("SELECT user_id FROM platform_session WHERE token_hash=? AND expires_at>?", digest(token),System.currentTimeMillis());
        if(rows.isEmpty()) throw unauthorized();
        String id = Objects.toString(rows.getFirst().get("user_id"));
        return members().stream().filter(u->u.id().equals(id)).findFirst().orElseThrow(PlatformAuth::unauthorized);
    }
    public String token(HttpServletRequest req) {
        if(req.getCookies()!=null) for(var c:req.getCookies()) if(COOKIE.equals(c.getName())) return c.getValue();
        return "";
    }
    private String randomToken() { byte[] b=new byte[32]; random.nextBytes(b); return Base64.getUrlEncoder().withoutPadding().encodeToString(b); }
    private static String digest(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(java.nio.charset.StandardCharsets.UTF_8))); }
        catch(GeneralSecurityException e) { throw new IllegalStateException(e); }
    }
    private static String password(String raw, byte[] salt) {
        try { return Base64.getEncoder().encodeToString(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(new PBEKeySpec(raw.toCharArray(),salt,210000,256)).getEncoded()); }
        catch(GeneralSecurityException e) { throw new IllegalStateException(e); }
    }
    private String encode(String raw) { byte[] salt=new byte[16]; random.nextBytes(salt); return Base64.getEncoder().encodeToString(salt)+":"+password(raw,salt); }
    private boolean matches(String raw,String hash) {
        try { String[] p=hash.split(":"); return MessageDigest.isEqual(password(raw,Base64.getDecoder().decode(p[0])).getBytes(),p[1].getBytes()); }
        catch(RuntimeException e) { return false; }
    }
    public static String field(Map<String,Object> body,String key,int min,int max) {
        if(!(body.get(key) instanceof String s) || s.trim().length()<min || s.length()>max) throw ApiException.validation(key+" 长度应为 "+min+"–"+max);
        return key.equals("password")?s:s.trim();
    }
    private User create(Map<String,Object> body,String role) {
        String username=field(body,"username",3,80);
        if(!username.matches("[A-Za-z0-9_.-]+")) throw ApiException.validation("账号只能包含字母、数字、点、横线和下划线");
        String hash=encode(field(body,"password",10,128)),name=field(body,"displayName",1,100);
        String email=Objects.toString(body.getOrDefault("email",""),"").trim();
        if(email.length()>200 || (!email.isEmpty()&&!email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"))) throw ApiException.validation("邮箱格式无效");
        if(db.queryForObject("SELECT COUNT(*) FROM platform_user WHERE username=?",Integer.class,username)>0) throw ApiException.conflict("USERNAME_EXISTS","账号已存在");
        User user=new User(UUID.randomUUID().toString(),username,name,email,role,Instant.now().toString());
        db.update("INSERT INTO platform_user(id,username,display_name,email,role,password_hash,created_at) VALUES(?,?,?,?,?,?,?)",user.id(),username,name,email,role,hash,user.createdAt());
        return user;
    }
    private void lock() { db.queryForObject("SELECT id FROM workspace_lock WHERE id=1 FOR UPDATE",Integer.class); }
    @Transactional
    public User setup(Map<String,Object> body) {
        lock();
        if(initialized()) throw ApiException.conflict("ALREADY_INITIALIZED","测试负责人已创建，请使用账号登录");
        return create(body,"LEAD");
    }
    public User login(Map<String,Object> body) {
        String username=field(body,"username",1,80),raw=field(body,"password",1,128);
        var hashes=db.queryForList("SELECT password_hash FROM platform_user WHERE username=?",String.class,username);
        // Keep comparable password work for an unknown account.
        String hash=hashes.isEmpty()?"AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=":hashes.getFirst();
        if(!matches(raw,hash)||hashes.isEmpty()) throw new ApiException(HttpStatus.UNAUTHORIZED,"BAD_CREDENTIALS","账号或密码不正确");
        return members().stream().filter(u->u.username().equals(username)).findFirst().orElseThrow(PlatformAuth::unauthorized);
    }
    public void session(User user,HttpServletRequest req,HttpServletResponse res) {
        db.update("DELETE FROM platform_session WHERE expires_at<?",System.currentTimeMillis());
        String token=randomToken();
        db.update("INSERT INTO platform_session(token_hash,user_id,expires_at) VALUES(?,?,?)",digest(token),user.id(),System.currentTimeMillis()+43200000);
        res.addHeader("Set-Cookie",COOKIE+"="+token+"; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200"+(req.isSecure()?"; Secure":""));
    }
    public void logout(HttpServletRequest req,HttpServletResponse res) {
        db.update("DELETE FROM platform_session WHERE token_hash=?",digest(token(req)));
        res.addHeader("Set-Cookie",COOKIE+"=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
    }
    private String role(Map<String,Object> body) {
        String value=field(body,"role",1,30);
        if(!Set.of("LEAD","TESTER","DEVELOPER","VIEWER").contains(value)) throw ApiException.validation("无效的团队角色");
        return value;
    }
    @Transactional
    public User add(User caller,Map<String,Object> body) { lock(); requireLead(current(caller.id())); return create(body,role(body)); }
    private User current(String id) { return members().stream().filter(u->u.id().equals(id)).findFirst().orElseThrow(PlatformAuth::unauthorized); }
    @Transactional
    public void change(User caller,String id,Map<String,Object> body,boolean delete) {
        lock(); requireLead(current(caller.id())); User target=current(id);
        String next=delete?"":role(body);
        if(delete&&id.equals(caller.id())) throw ApiException.validation("不能删除当前登录账号");
        if(target.role().equals("LEAD")&&!next.equals("LEAD")&&members().stream().filter(u->u.role().equals("LEAD")).count()==1) throw ApiException.validation("必须保留至少一位测试负责人");
        if(delete) { db.update("DELETE FROM platform_session WHERE user_id=?",id); db.update("DELETE FROM platform_user WHERE id=?",id); }
        else db.update("UPDATE platform_user SET role=? WHERE id=?",next,id);
    }
}
