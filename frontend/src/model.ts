export type Pair = { id: string; key: string; value: string; enabled: boolean };
export type Environment = { id: string; name: string; variables: Pair[] };
export type Assertion = { id: string; type: string; target: string; operator: string; expected: string; enabled: boolean };
export type Extraction = { id: string; name: string; path: string; enabled: boolean };
export type RequestDraft = {
  id: string; name: string; method: string; url: string; query: Pair[]; headers: Pair[];
  body: { mode: string; text: string; fields: Pair[] };
  auth: { type: string; token: string; username: string; password: string };
  timeoutMs: number; followRedirects: boolean; assertions: Assertion[]; extractions: Extraction[];
};
export type AssertionResult = Assertion & { actual: string; passed: boolean; error?: string };
export type RequestResult = {
  status: number; statusText: string; durationMs: number; sizeBytes: number;
  headers: Record<string, string>; body: string; contentType: string; truncated: boolean;
  request: { method: string; url: string; headers: Record<string, string>; body?: string };
  assertions: AssertionResult[]; extracted: Record<string, string>;
  extractionResults: { name: string; path: string; value?: string; error?: string }[];
};
export type Step = { id: string; action: string; selector: string; value: string };
export type UiCase = {
  id: string; name: string; url: string; width: number; height: number;
  stopOnFailure: boolean; steps: Step[];
};
export type UiResult = {
  passed: boolean; durationMs: number; url: string; title: string; screenshot?: string;
  steps: { index: number; action: string; selector: string; value: string; status: string; durationMs: number; error?: string; screenshot?: string }[];
};
export type HistoryEntry = { id: string; name: string; time: string; status: number; draft: RequestDraft; durationMs?: number; assertions?: Pick<AssertionResult,'type'|'target'|'operator'|'expected'|'actual'|'passed'|'error'>[] };
export type UiHistoryEntry = { id:string; name:string; time:string; passed:boolean; durationMs:number; url:string; steps:Pick<UiResult['steps'][number],'index'|'action'|'selector'|'status'|'error'>[] };
export const uid = () => crypto.randomUUID();
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const pair = (key = '', value = ''): Pair => ({ id: uid(), key, value, enabled: true });
export const assertion = (): Assertion => ({ id: uid(), type: 'status', target: '', operator: 'eq', expected: '200', enabled: true });
export const step = (action = 'click', selector = '', value = ''): Step => ({ id: uid(), action, selector, value });
export const newRequest = (): RequestDraft => ({
  id: '', name: '未命名请求', method: 'GET', url: '{{baseUrl}}/', query: [], headers: [],
  body: { mode: 'none', text: '', fields: [] }, auth: { type: 'none', token: '', username: '', password: '' },
  timeoutMs: 30000, followRedirects: true, assertions: [assertion()], extractions: [],
});
export const newUiCase = (): UiCase => ({
  id: '', name: '未命名 UI 用例', url: '{{baseUrl}}/', width: 1440, height: 900,
  stopOnFailure: true, steps: [step('goto', '', '{{baseUrl}}/')],
});
export const actions = [
  ['goto', '打开页面'], ['fill', '输入文本'], ['click', '点击'], ['press', '按键'],
  ['wait', '等待毫秒'], ['waitFor', '等待元素'], ['assertText', '断言文本'],
  ['assertVisible', '断言可见'], ['assertHidden', '断言隐藏'], ['assertUrl', '断言地址'],
  ['assertTitle', '断言标题'], ['assertCount', '断言数量'], ['select', '下拉选择'],
  ['hover', '悬停'], ['screenshot', '截图'], ['check', '勾选'], ['uncheck', '取消勾选'], ['scroll', '滚动'],
];
export const actionLabel = (action: string) => actions.find(a => a[0] === action)?.[1] || action;
export const noSelector = (action: string) => ['goto', 'wait', 'assertUrl', 'assertTitle', 'screenshot', 'scroll'].includes(action);
