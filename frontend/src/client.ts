import { user } from './auth';
export async function execute<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/__runner/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
  } catch (error) {
    if (signal?.aborted) throw new DOMException('执行已取消', 'AbortError');
    throw new Error('执行服务连接失败，请使用 frontend 中的 npm run dev 或 npm start 启动平台。');
  }
  const value = await response.json().catch(() => null);
  if(response.status===401)user.value=undefined;
  if (!response.ok || !value || !Object.hasOwn(value, 'data')) throw new Error(value?.message || '执行服务返回了无效响应');
  return value.data;
}
