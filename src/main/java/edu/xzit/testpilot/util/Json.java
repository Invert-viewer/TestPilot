package edu.xzit.testpilot.util;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 极简 JSON 读取器（解析 Apifox CLI 报告用），避免绑定具体 Jackson 版本。 */
public final class Json {

    private final String text;
    private int pos;

    private Json(String text) {
        this.text = text;
    }

    public static Object parse(String text) {
        Json reader = new Json(text);
        reader.skipWs();
        Object value = reader.readValue();
        reader.skipWs();
        if (reader.pos < text.length()) {
            throw new IllegalArgumentException("JSON 末尾存在多余内容，位置 " + reader.pos);
        }
        return value;
    }

    private Object readValue() {
        if (pos >= text.length()) {
            throw new IllegalArgumentException("JSON 意外结束");
        }
        char c = text.charAt(pos);
        switch (c) {
            case '{': return readObject();
            case '[': return readArray();
            case '"': return readString();
            case 't': expect("true"); return Boolean.TRUE;
            case 'f': expect("false"); return Boolean.FALSE;
            case 'n': expect("null"); return null;
            default: return readNumber();
        }
    }

    private void expect(String literal) {
        if (!text.startsWith(literal, pos)) {
            throw new IllegalArgumentException("JSON 期望 " + literal + "，位置 " + pos);
        }
        pos += literal.length();
    }

    private Map<String, Object> readObject() {
        Map<String, Object> map = new LinkedHashMap<>();
        pos++;
        skipWs();
        if (peek() == '}') {
            pos++;
            return map;
        }
        while (true) {
            skipWs();
            String key = readString();
            skipWs();
            if (peek() != ':') {
                throw new IllegalArgumentException("JSON 期望冒号，位置 " + pos);
            }
            pos++;
            skipWs();
            map.put(key, readValue());
            skipWs();
            char c = peek();
            pos++;
            if (c == '}') {
                return map;
            }
            if (c != ',') {
                throw new IllegalArgumentException("JSON 期望逗号或右花括号，位置 " + (pos - 1));
            }
        }
    }

    private List<Object> readArray() {
        List<Object> list = new ArrayList<>();
        pos++;
        skipWs();
        if (peek() == ']') {
            pos++;
            return list;
        }
        while (true) {
            skipWs();
            list.add(readValue());
            skipWs();
            char c = peek();
            pos++;
            if (c == ']') {
                return list;
            }
            if (c != ',') {
                throw new IllegalArgumentException("JSON 期望逗号或右方括号，位置 " + (pos - 1));
            }
        }
    }

    private String readString() {
        if (peek() != '"') {
            throw new IllegalArgumentException("JSON 期望字符串，位置 " + pos);
        }
        pos++;
        StringBuilder sb = new StringBuilder();
        while (pos < text.length()) {
            char c = text.charAt(pos++);
            if (c == '"') {
                return sb.toString();
            }
            if (c != '\\') {
                sb.append(c);
                continue;
            }
            char esc = text.charAt(pos++);
            switch (esc) {
                case '"': sb.append('"'); break;
                case '\\': sb.append('\\'); break;
                case '/': sb.append('/'); break;
                case 'b': sb.append('\b'); break;
                case 'f': sb.append('\f'); break;
                case 'n': sb.append('\n'); break;
                case 'r': sb.append('\r'); break;
                case 't': sb.append('\t'); break;
                case 'u':
                    sb.append((char) Integer.parseInt(text.substring(pos, pos + 4), 16));
                    pos += 4;
                    break;
                default:
                    throw new IllegalArgumentException("JSON 非法转义 \\" + esc);
            }
        }
        throw new IllegalArgumentException("JSON 字符串未闭合");
    }

    private Number readNumber() {
        int start = pos;
        while (pos < text.length()) {
            char c = text.charAt(pos);
            if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E') {
                pos++;
            } else {
                break;
            }
        }
        String raw = text.substring(start, pos);
        if (raw.isEmpty()) {
            throw new IllegalArgumentException("JSON 非法数字，位置 " + start);
        }
        if (raw.contains(".") || raw.contains("e") || raw.contains("E")) {
            return Double.parseDouble(raw);
        }
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException e) {
            return Double.parseDouble(raw);
        }
    }

    private char peek() {
        if (pos >= text.length()) {
            throw new IllegalArgumentException("JSON 意外结束");
        }
        return text.charAt(pos);
    }

    private void skipWs() {
        while (pos < text.length()) {
            char c = text.charAt(pos);
            if (c == ' ' || c == '\n' || c == '\r' || c == '\t') {
                pos++;
            } else {
                return;
            }
        }
    }
}
