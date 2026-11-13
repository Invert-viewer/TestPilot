package edu.xzit.testpilot.service;

import edu.xzit.testpilot.model.Models;
import edu.xzit.testpilot.util.Json;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.xml.parsers.DocumentBuilderFactory;
import org.springframework.stereotype.Component;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * 解析 Apifox CLI 报告。
 * JSON 报告只有统计与失败明细；JUnit 报告按 testsuite(HTTP 步骤) + testcase(断言) 组织，
 * 因此逐步骤用例取自 JUnit，步骤名用 testsuite@id 回查 JSON 的 collection 定义。
 */
@Component
public class ApifoxReportParser {

    private static final Pattern STATUS_IN_MESSAGE = Pattern.compile("(?:got|实际却是|实际为)\\s*(\\d{3})");

    public Models.ParsedReport parse(Path runDir) {
        Path jsonFile = findReportFile(runDir, ".json");
        Path junitFile = findReportFile(runDir, ".xml");

        Map<String, Object> root = null;
        if (jsonFile != null) {
            try {
                Object parsed = Json.parse(Files.readString(jsonFile, StandardCharsets.UTF_8));
                if (parsed instanceof Map<?, ?> map) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> typed = (Map<String, Object>) map;
                    root = typed;
                }
            } catch (Exception ignored) {
                root = null;
            }
        }

        List<Step> steps = root == null ? List.of() : collectionSteps(root);
        Map<Integer, StepFailure> jsonFailures = new LinkedHashMap<>();
        if (root != null) {
            collectFailures(root, jsonFailures);
        }

        if (junitFile != null) {
            Models.ParsedReport fromJunit = parseJunit(junitFile, steps, jsonFailures);
            if (fromJunit != null) {
                return fromJunit;
            }
        }
        if (!steps.isEmpty()) {
            return fromSteps(steps, jsonFailures);
        }
        return new Models.ParsedReport(List.of(), 0, 0, 0, "");
    }

    private Path findReportFile(Path runDir, String suffix) {
        if (runDir == null || !Files.isDirectory(runDir)) {
            return null;
        }
        try (var stream = Files.list(runDir)) {
            return stream.filter(p -> p.getFileName().toString().toLowerCase().endsWith(suffix))
                    .max(Comparator.comparingLong(p -> p.toFile().length()))
                    .orElse(null);
        } catch (Exception e) {
            return null;
        }
    }

    // ------------------------------------------------------- collection map

    private record Step(String id, String name) {
    }

    @SuppressWarnings("unchecked")
    private List<Step> collectionSteps(Map<String, Object> root) {
        List<Step> steps = new ArrayList<>();
        Object collection = root.get("collection");
        if (!(collection instanceof Map<?, ?> collectionMap)) {
            return steps;
        }
        Object items = collectionMap.get("item");
        if (!(items instanceof List<?> outer)) {
            return steps;
        }
        for (Object group : outer) {
            if (group instanceof Map<?, ?> groupMap && groupMap.get("item") instanceof List<?> inner) {
                for (Object step : inner) {
                    if (step instanceof Map<?, ?> stepMap) {
                        Map<String, Object> typed = (Map<String, Object>) stepMap;
                        steps.add(new Step(str(typed.get("id")), str(typed.get("name"))));
                    }
                }
            }
        }
        return steps;
    }

    // -------------------------------------------------------------- failures

    /** 单个步骤在 JSON 报告中的失败信息：断言失败与请求级失败分开收集，避免断言重复计数。 */
    static final class StepFailure {
        final List<Models.ParsedAssertion> assertions = new ArrayList<>();
        final List<String> requestMessages = new ArrayList<>();
        Integer statusCode;
    }

    @SuppressWarnings("unchecked")
    private void collectFailures(Map<String, Object> root, Map<Integer, StepFailure> out) {
        Object resultNode = root.get("result");
        if (!(resultNode instanceof Map<?, ?> result)) {
            return;
        }
        Object failures = result.get("failures");
        if (!(failures instanceof List<?> list)) {
            return;
        }
        int seq = 0;
        for (Object raw : list) {
            if (!(raw instanceof Map<?, ?> failure)) {
                continue;
            }
            Map<String, Object> failureMap = (Map<String, Object>) failure;
            Map<String, Object> error = failureMap.get("error") instanceof Map<?, ?> e
                    ? (Map<String, Object>) e : Map.of();
            Map<String, Object> cursor = failureMap.get("cursor") instanceof Map<?, ?> c
                    ? (Map<String, Object>) c : Map.of();
            Integer index = cursor.get("requestIndex") instanceof Number n ? n.intValue() : null;
            if (index == null) {
                continue;
            }
            String message = str(error.get("message"));
            String test = str(error.get("test"));
            String errorName = str(error.get("name"));
            String at = str(failureMap.get("at"));
            String expected = error.get("expected") == null ? null : String.valueOf(error.get("expected"));
            String actual = error.get("actual") == null ? null : String.valueOf(error.get("actual"));
            if (actual == null) {
                actual = statusFromMessage(message);
            }
            StepFailure info = out.computeIfAbsent(index, k -> new StepFailure());
            Integer code = parseInt(actual == null ? null : actual);
            if (code != null && info.statusCode == null) {
                info.statusCode = code;
            }
            if (at.startsWith("assertion:")) {
                seq++;
                info.assertions.add(new Models.ParsedAssertion(
                        "fail-" + seq,
                        errorName.isEmpty() ? "ASSERTION" : errorName,
                        test.isEmpty() ? errorName : test,
                        "EQUALS",
                        expected,
                        actual,
                        "FAILED",
                        message));
            } else {
                String text = message.isEmpty() ? errorName : message;
                if (!test.isEmpty() && !text.contains(test)) {
                    text = test + "：" + text;
                }
                if (!text.isBlank()) {
                    info.requestMessages.add(text);
                }
            }
        }
    }

    private String statusFromMessage(String message) {
        if (message == null) {
            return null;
        }
        Matcher matcher = STATUS_IN_MESSAGE.matcher(message);
        return matcher.find() ? matcher.group(1) : null;
    }

    // ---------------------------------------------------------------- junit

    private Models.ParsedReport parseJunit(Path junitFile, List<Step> steps,
                                           Map<Integer, StepFailure> jsonFailures) {
        List<Models.ParsedCase> cases = new ArrayList<>();
        int assertionPassed = 0;
        int assertionFailed = 0;
        int assertionSkipped = 0;
        try (InputStream in = Files.newInputStream(junitFile)) {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setExpandEntityReferences(false);
            Document document = factory.newDocumentBuilder().parse(in);
            NodeList suites = document.getElementsByTagName("testsuite");
            int order = 0;
            for (int i = 0; i < suites.getLength(); i++) {
                Element suite = (Element) suites.item(i);
                String suiteId = suite.getAttribute("id");
                long durationMs = 0;
                String time = suite.getAttribute("time");
                if (!time.isBlank()) {
                    try {
                        durationMs = Math.round(Double.parseDouble(time) * 1000);
                    } catch (NumberFormatException ignored) {
                        durationMs = 0;
                    }
                }
                NodeList testcases = suite.getElementsByTagName("testcase");
                List<Models.ParsedAssertion> assertions = new ArrayList<>();
                Integer statusCode = null;
                String failureMessage = null;
                boolean failed = false;
                boolean skipped = false;
                for (int j = 0; j < testcases.getLength(); j++) {
                    Element testcase = (Element) testcases.item(j);
                    String name = testcase.getAttribute("name");
                    NodeList failureNodes = testcase.getElementsByTagName("failure");
                    NodeList skippedNodes = testcase.getElementsByTagName("skipped");
                    String status = "PASSED";
                    String message = null;
                    if (failureNodes.getLength() > 0) {
                        status = "FAILED";
                        failed = true;
                        Element failure = (Element) failureNodes.item(0);
                        message = failure.getAttribute("message");
                        if (message == null || message.isBlank()) {
                            message = failure.getTextContent();
                        }
                        if (failureMessage == null) {
                            failureMessage = message;
                        }
                        Integer code = parseInt(statusFromMessage(message));
                        if (code != null && statusCode == null) {
                            statusCode = code;
                        }
                        assertionFailed++;
                    } else if (skippedNodes.getLength() > 0) {
                        status = "SKIPPED";
                        skipped = true;
                        assertionSkipped++;
                    } else {
                        assertionPassed++;
                    }
                    assertions.add(new Models.ParsedAssertion(
                            "assertion-" + (i + 1) + "-" + (j + 1), "ASSERTION", name, "EQUALS", null,
                            null, status, message));
                }
                // JSON 失败明细的 requestIndex 与 JUnit testsuite 顺序一致：
                // 断言失败已计入 testcase，这里只补请求级失败（如响应体/状态码校验）与失败原因。
                StepFailure jsonInfo = jsonFailures.get(order);
                String failureKind = failed ? "ASSERTION" : null;
                if (jsonInfo != null) {
                    if (statusCode == null) {
                        statusCode = jsonInfo.statusCode;
                    }
                    if (!failed && !jsonInfo.requestMessages.isEmpty()) {
                        failed = true;
                        failureKind = "REQUEST";
                        failureMessage = jsonInfo.requestMessages.get(0);
                    }
                    if (failureMessage == null && !jsonInfo.assertions.isEmpty()) {
                        failureMessage = jsonInfo.assertions.get(0).message();
                    }
                }
                String name = null;
                if ("id".equals(suite.getAttribute("id")) || !suiteId.isEmpty()) {
                    name = stepName(steps, suiteId);
                }
                if (name == null) {
                    name = suite.getAttribute("name");
                }
                if (name == null || name.isBlank()) {
                    name = "步骤 " + (order + 1);
                }
                order++;
                cases.add(new Models.ParsedCase(
                        String.format("case-%03d", order), name, failed ? "FAILED" : skipped ? "SKIPPED" : "PASSED",
                        durationMs > 0 ? (int) durationMs : null, statusCode, failureKind,
                        failureMessage, assertions));
            }
        } catch (Exception e) {
            return null;
        }
        if (cases.isEmpty()) {
            return null;
        }
        return new Models.ParsedReport(cases, assertionPassed, assertionFailed, assertionSkipped,
                junitFile.getFileName().toString());
    }

    private String stepName(List<Step> steps, String suiteId) {
        if (suiteId == null || suiteId.isBlank()) {
            return null;
        }
        for (Step step : steps) {
            if (suiteId.equals(step.id())) {
                return step.name();
            }
        }
        return null;
    }

    private Models.ParsedReport fromSteps(List<Step> steps, Map<Integer, StepFailure> jsonFailures) {
        List<Models.ParsedCase> cases = new ArrayList<>();
        int order = 0;
        for (Step step : steps) {
            StepFailure info = jsonFailures.get(order);
            List<Models.ParsedAssertion> assertions = info == null ? List.of() : info.assertions;
            boolean failed = info != null && (!info.assertions.isEmpty() || !info.requestMessages.isEmpty());
            String kind = !failed ? null : info.assertions.isEmpty() ? "REQUEST" : "ASSERTION";
            String message = !failed ? null : info.assertions.isEmpty() ? info.requestMessages.get(0)
                    : info.assertions.get(0).message();
            order++;
            cases.add(new Models.ParsedCase(
                    String.format("case-%03d", order), step.name(), failed ? "FAILED" : "PASSED",
                    null, info == null ? null : info.statusCode, kind, message, assertions));
        }
        int failedAssertions = jsonFailures.values().stream().mapToInt(v -> v.assertions.size()).sum();
        return new Models.ParsedReport(cases, 0, failedAssertions, 0, "");
    }

    private Integer parseInt(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Integer.valueOf(value.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private String str(Object value) {
        return value == null ? "" : String.valueOf(value);
    }
}
