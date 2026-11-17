export const backendUrl = process.env.TESTPILOT_BACKEND_URL || 'http://127.0.0.1:8081';
export async function backend(req, path, method = 'GET', body) {
  let response;
  try { response = await fetch(backendUrl + '/api/v1/' + path, { method, headers: { Cookie: req.headers.cookie || '', ...(body === undefined ? {} : {'Content-Type':'application/json'}) }, body:body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(path.includes('ai/')?70000:8000) }); }
  catch { const error=new Error('Spring Boot 后端连接失败，请先启动后端服务'); error.status=503; throw error; }
  const value=await response.json().catch(()=>null);
  if(!response.ok || value?.code!=='OK') { const error=new Error(response.status===404?'后端接口不存在，请重新构建并启动当前版本的 Spring Boot 后端':value?.message || '后端返回无效响应'); error.status=response.status===404?503:response.status; throw error; }
  return value.data;
}
