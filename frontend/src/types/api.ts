/** Boundary DTOs: web/TaskController, ToolAssetController, TaskService and
 * docs/前后端接口契约.md §§1,3–6,8. No platform OpenAPI exists in this repository.
 * Current service returns ratios in [0,1], report files use size, not sizeBytes. */
export const taskStatuses = ['QUEUED','RUNNING','CANCELLING','FINISHED','CANCELLED','ERROR'] as const;
export type TaskStatus = typeof taskStatuses[number];
export const outcomes = ['PASSED','FAILED','NOT_EVALUATED'] as const;
export type Outcome = typeof outcomes[number];
export const caseStatuses = ['PASSED','FAILED','SKIPPED','NOT_EVALUATED'] as const;
export type CaseStatus = typeof caseStatuses[number];
export type Tool = 'APIFOX_CLI' | 'JMETER';
export interface FieldError { field: string; message: string }
export interface PageResult<T> { items: T[]; page: number; pageSize: number; total: number }
export interface TaskParameters { iterations: number; delayRequestMs: number; timeoutRequestMs: number }
export interface CreateTaskRequest { name: string; assetId: string; parameters: TaskParameters }
export interface TaskSummary {
  totalCases: number | null; passedCases: number | null; failedCases: number | null;
  skippedCases: number | null; notEvaluatedCases: number | null;
}
export interface TaskRecord {
  id: string; name: string; siteId: string; environmentId: string; tool: Tool;
  status: TaskStatus; terminal: boolean; outcome: Outcome; createdAt: string;
  startedAt: string | null; finishedAt: string | null; sourceTaskId: string | null;
  summary: TaskSummary;
}
export interface TaskDetail extends TaskRecord {
  asset: { id: string; name: string | null; version: number; tool: Tool };
  parameters: TaskParameters; exitCode: number | null; errorCode: string | null;
  errorMessage: string | null; toolVersion?: string | null;
  error?: { code: string; message: string };
}
export interface ToolAsset {
  id: string; name: string; tool: Tool; kind: 'APIFOX_SCENARIO' | 'APIFOX_FILE' | 'JMETER_FILE';
  version: number; scenarioKey: string; requestRefs: { id: string; version: number }[];
  source: { projectId?: string; scenarioId?: string; apifoxEnvironmentId?: string;
    environmentName?: string; siteUrl?: string; fileId?: string };
}
export interface TaskLog { time: string; stream: 'STDOUT' | 'STDERR' | 'PLATFORM'; text: string }
export interface CursorLogs { items: TaskLog[]; nextCursor: number | null; hasMore: boolean; complete: boolean }
export interface AssertionResult {
  id: string; type: string; target: string | null; operator: string;
  expected: string | null; actual: string | null; status: 'PASSED' | 'FAILED' | 'SKIPPED'; message: string | null;
}
export interface CaseResult {
  caseId: string; name: string; status: CaseStatus; durationMs: number | null;
  statusCode: number | null; failureKind: 'REQUEST' | 'ASSERTION' | null; failureMessage: string | null;
}
export interface CaseDetail extends CaseResult { assertions: AssertionResult[] }
export const metricKeys = ['sampleCount','timedSampleCount','avgResponseMs','p95ResponseMs','throughputRps',
  'errorRate','passRate','evaluatedPassRate','assertionPassRate','passedAssertions','failedAssertions','skippedAssertions'] as const;
export type Metrics = Record<typeof metricKeys[number], number | null>;
export interface ReportFile { name: string; size: number; contentType?: string }
export interface TaskReport { taskId: string; summary: TaskSummary; metrics: Metrics; files: ReportFile[] }
export interface KeyValueRow { key: string; value: string; enabled: boolean }
export interface RequestAssertion {
  id: string; type: 'STATUS_CODE' | 'HEADER' | 'BODY' | 'JSON_FIELD' | 'RESPONSE_TIME_MS';
  target: string | null; operator: 'EQ' | 'CONTAINS' | 'LTE'; expected: string; enabled: boolean;
}
export interface RequestDefinition {
  name: string; siteId: string; environmentId: string;
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS'; url: string;
  charset: 'UTF-8' | 'GB18030'; query: KeyValueRow[]; headers: KeyValueRow[]; cookies: KeyValueRow[];
  body: { mode: 'NONE' | 'JSON' | 'RAW' | 'FORM_URLENCODED'; text?: string; fields?: KeyValueRow[] };
  timeoutMs: number; followRedirects: boolean; assertions: RequestAssertion[];
}
