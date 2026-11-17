import { computed, reactive, shallowRef, watch } from 'vue';
import { pair, uid, type Environment, type RequestDraft, type UiCase, type HistoryEntry, type UiHistoryEntry } from './model';

const key = 'testpilot.execution.v1';
type Data = { environments: Environment[]; environmentId: string; requests: RequestDraft[]; uiCases: UiCase[]; history: HistoryEntry[]; uiHistory: UiHistoryEntry[] };
function load(): Data {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (value && Array.isArray(value.environments) && value.environments.length &&
      value.environments.every((e: Environment) => typeof e.id === 'string' && Array.isArray(e.variables)) &&
      Array.isArray(value.requests) && Array.isArray(value.uiCases) && Array.isArray(value.history)) return {...value,uiHistory:Array.isArray(value.uiHistory)?value.uiHistory:[]};
  } catch { /* Fresh storage remains usable if an old entry is invalid. */ }
  const environment = { id: uid(), name: '本地环境', variables: [pair('baseUrl', 'http://127.0.0.1:8080')] };
  return { environments: [environment], environmentId: environment.id, requests: [], uiCases: [], history: [], uiHistory:[] };
}
export const data = reactive<Data>(load());
export const busyTasks = reactive<Record<string, boolean>>({});
export const storageError = reactive({ message: '' });
watch(data, () => {
  try { localStorage.setItem(key, JSON.stringify(data)); storageError.message = ''; }
  catch { storageError.message = '浏览器存储空间不足，当前改动尚未保存。请清理最近请求后重试。'; }
}, { deep: true });
export const environment = computed(() => data.environments.find(e => e.id === data.environmentId) || data.environments[0]!);
export const variables = computed(() => Object.fromEntries(environment.value.variables.filter(v => v.enabled && v.key.trim()).map(v => [v.key.trim(), v.value])));
export function applyExtractions(values: Record<string, string>, environmentId = environment.value.id) {
  const target = data.environments.find(e => e.id === environmentId);
  if (!target) return;
  for (const [key, value] of Object.entries(values)) {
    const existing = target.variables.find(v => v.key === key);
    if (existing) { existing.value = value; existing.enabled = true; }
    else target.variables.push(pair(key, value));
  }
}
export const notice = reactive({ text: '', error: false });
export const confirmation = shallowRef<{ message: string; resolve: (value: boolean) => void }>();
export function ask(message: string): Promise<boolean> {
  return new Promise(resolve => { confirmation.value = { message, resolve }; });
}
export function answerConfirmation(value: boolean) {
  const pending = confirmation.value; confirmation.value = undefined; pending?.resolve(value);
}
let noticeTimer: ReturnType<typeof setTimeout>;
export function toast(text: string, error = false) {
  clearTimeout(noticeTimer); notice.text = text; notice.error = error;
  noticeTimer = setTimeout(() => { notice.text = ''; }, 4500);
}
