package edu.xzit.testpilot.web;

import java.util.LinkedHashMap;
import java.util.Map;

/** 统一响应外层：{code,message,data,traceId}。 */
public final class ApiResult {

    private ApiResult() {
    }

    public static Map<String, Object> ok(Object data, String traceId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", "OK");
        body.put("message", "");
        body.put("data", data);
        body.put("traceId", traceId);
        return body;
    }

    public static Map<String, Object> error(String code, String message, Object data, String traceId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", code);
        body.put("message", message);
        body.put("data", data);
        body.put("traceId", traceId);
        return body;
    }
}
