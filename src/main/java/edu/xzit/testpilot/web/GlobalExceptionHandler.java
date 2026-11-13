package edu.xzit.testpilot.web;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import jakarta.servlet.http.HttpServletRequest;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    private static String traceId(HttpServletRequest request) {
        Object value = request.getAttribute(TraceIdFilter.ATTRIBUTE);
        return value == null ? "-" : value.toString();
    }

    private static Map<String, Object> bodyWithErrors(String code, String message, List<Map<String, String>> errors, String traceId) {
        if (errors == null) {
            return ApiResult.error(code, message, null, traceId);
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("errors", errors);
        return ApiResult.error(code, message, data, traceId);
    }

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, Object>> handleApi(ApiException ex, HttpServletRequest request) {
        return ResponseEntity.status(ex.getStatus())
                .body(bodyWithErrors(ex.getCode(), ex.getMessage(), ex.getErrors(), traceId(request)));
    }

    @ExceptionHandler(MissingRequestHeaderException.class)
    public ResponseEntity<Map<String, Object>> handleHeader(MissingRequestHeaderException ex, HttpServletRequest request) {
        List<Map<String, String>> errors = new ArrayList<>();
        Map<String, String> item = new LinkedHashMap<>();
        item.put("field", ex.getHeaderName());
        item.put("message", "缺少请求头 " + ex.getHeaderName());
        errors.add(item);
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(bodyWithErrors("VALIDATION_ERROR", "缺少必需的请求头", errors, traceId(request)));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, Object>> handleBody(HttpMessageNotReadableException ex, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResult.error("VALIDATION_ERROR", "请求体不是合法 JSON", null, traceId(request)));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<Map<String, Object>> handleNoResource(NoResourceFoundException ex, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResult.error("NOT_FOUND", "接口不存在：" + ex.getResourcePath(), null, traceId(request)));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleOther(Exception ex, HttpServletRequest request) {
        log.error("未处理异常 traceId={}", traceId(request));
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResult.error("INTERNAL_ERROR", "服务器内部错误", null, traceId(request)));
    }
}
