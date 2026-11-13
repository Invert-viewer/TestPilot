package edu.xzit.testpilot.model;

import java.util.List;

public final class Models {

    private Models() {
    }

    public record ParsedAssertion(String id, String type, String target, String operator,
                                  String expected, String actual, String status, String message) {
    }

    public record ParsedCase(String caseId, String name, String status, Integer durationMs,
                             Integer statusCode, String failureKind, String failureMessage,
                             List<ParsedAssertion> assertions) {
    }

    /** 一条 Apifox 场景执行结果：cases 按 HTTP 步骤聚合，assertions 统计全部断言。 */
    public record ParsedReport(List<ParsedCase> cases, int passedAssertions, int failedAssertions,
                               int skippedAssertions, String source) {
    }
}
