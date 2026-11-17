import { computed, ref } from 'vue';
export type User = { id: string; username: string; displayName: string; email: string; role: string };
export const user = ref<User>();
export const lead = computed(() => user.value?.role === 'LEAD');
export const roleNames: Record<string,string> = { LEAD: '测试负责人', TESTER: '测试工程师', DEVELOPER: '开发工程师', VIEWER: '观察员' };
export class ApiError extends Error { constructor(message:string,public code:string,public status:number){super(message);} }
export async function api<T = any>(path: string, method = 'GET', body?: unknown, signal?:AbortSignal): Promise<T> {
  let response: Response;
  try { response = await fetch('/api/v1/' + path, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),signal }); }
  catch { if(signal?.aborted)throw new DOMException('已取消','AbortError');throw new Error('后端连接失败，请先启动 Spring Boot 服务。'); }
  const value = await response.json().catch(() => null);
  if (response.status === 401 && !path.startsWith('auth/')) user.value = undefined;
  if (!response.ok || value?.code !== 'OK') throw new ApiError(value?.message || '后端暂不可用，请检查数据库连接与服务端口。',value?.code||'CONNECTION_ERROR',response.status);
  return value.data;
}
export async function identify() { try { user.value = await api<User>('auth/me'); } catch { user.value = undefined; } }
