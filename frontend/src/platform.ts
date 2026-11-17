import { computed, reactive, ref, watch, nextTick } from 'vue';
import { api } from './auth';
import { data, storageError, busyTasks } from './store';
import { workspaces } from './execution';
import { pair, uid, clone, newRequest, type Environment } from './model';

export type Resource = { id: string; revision: number; name: string; [key: string]: any };
export const resources = ref<Record<string, Resource[]>>({ sites: [], environments: [], executionSpaces: [] });
export const projectId = ref(localStorage.getItem('testpilot.project') || '');
export const project = computed(() => resources.value.sites.find(p => p.id === projectId.value));
export const sync = reactive({ ready: false, saving: false, error: '', saved: '' });
export const contextVersion = ref(0);
let muted = false, timer: ReturnType<typeof setTimeout>, queue = Promise.resolve(), dirty = false;
function blankWorkspaces() { return { presets: { perf: [], unit: [], security: [], compat: [] }, history: { perf: [], unit: [], security: [], compat: [] }, lastJobIds: {} }; }
function env(row: Resource): Environment {
  const values = Array.isArray(row.variables) ? row.variables.map((v:any)=>({...pair(String(v.key||''),String(v.value||'')),...v,id:v.id||uid(),enabled:v.enabled!==false})) : Object.entries(row.variables || {}).map(([k,v]) => pair(k,String(v)));
  if (!values.some((v: any) => v.key === 'baseUrl')) values.unshift(pair('baseUrl', row.baseUrl));
  return { id: row.id, name: row.name, variables: values };
}
async function apply() {
  muted = true;
  const p = project.value;
  const space = resources.value.executionSpaces.find(s => s.siteId === p?.id);
  const envs = resources.value.environments.filter(e => e.siteId === p?.id).map(env);
  if (p) {
    if (!envs.length) envs.push({ id: uid(), name: '默认环境', variables: [pair('baseUrl', p.baseUrl)] });
    const saved = space?.data || {};
    Object.assign(data, { environments: envs, environmentId: envs.some(e => e.id === saved.environmentId) ? saved.environmentId : envs[0]!.id,
      requests: saved.requests || legacyRequests(p.id), uiCases: saved.uiCases || [], history: saved.history || [], uiHistory:saved.uiHistory || [] });
    Object.assign(workspaces, blankWorkspaces(), space?.workspaces || {});
  }
  await nextTick(); muted = false; contextVersion.value++;
}
function legacyRequests(siteId:string) {
  return (resources.value.requests||[]).filter(row=>row.definition?.siteId===siteId).map(row=>{
    const d=row.definition, value=newRequest();
    const mode:Record<string,string>={NONE:'none',JSON:'json',RAW:'text',FORM_URLENCODED:'form'};
    const types:Record<string,string>={STATUS_CODE:'status',RESPONSE_TIME_MS:'time',HEADER:'header',JSON_FIELD:'jsonpath',BODY:'body'};
    Object.assign(value,{id:row.id,name:row.name||d.name,method:d.method,url:d.url.startsWith('/')?'{{baseUrl}}'+d.url:d.url,query:clone(d.query||[]),headers:clone(d.headers||[]),timeoutMs:d.timeoutMs,followRedirects:d.followRedirects});
    value.headers.push(...(d.cookies?.length?[pair('Cookie',d.cookies.filter((v:any)=>v.enabled).map((v:any)=>`${v.key}=${v.value}`).join('; '))]:[]));
    value.body={mode:(mode[d.body?.mode]||'none') as any,text:d.body?.text||'',fields:clone(d.body?.fields||[])};
    value.assertions=(d.assertions||[]).map((a:any)=>({...a,id:a.id||uid(),type:types[a.type]||a.type,operator:{EQ:'eq',LTE:'lte',CONTAINS:'contains'}[a.operator as string]||a.operator}));
    return value;
  });
}
export async function refreshProjects() {
  clearTimeout(timer); sync.ready = false;
  try {
    resources.value = await api('workspace');
    if (!project.value) projectId.value = resources.value.sites[0]?.id || '';
    localStorage.setItem('testpilot.project', projectId.value); await apply();
    sync.ready = true; sync.error = ''; dirty = false;
  } catch (e) { sync.error = (e as Error).message; throw e; }
}
function baseUrl(e: Environment) {
  const value = e.variables.find(v => v.enabled && v.key.trim() === 'baseUrl')?.value?.trim();
  if (!value) throw new Error('每个环境都需要启用 baseUrl 变量');
  let url: URL; try { url = new URL(value); } catch { throw new Error('baseUrl 需要完整的 HTTP(S) 地址'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('环境地址不能包含凭据、查询串或片段');
  return value;
}
export async function commit(changes: any[]) {
  if(!changes.length)return;
  const latest=await api<Record<string,Resource[]>>('workspace','POST',changes);
  const written=new Set(changes.map(c=>`${c.collection}:${c.id}`));
  // Do not silently advance the revision of an unrelated row still being edited locally.
  resources.value=Object.fromEntries(Object.entries(latest).map(([kind,rows])=>[kind,rows.map(row=>written.has(`${kind}:${row.id}`)?row:resources.value[kind]?.find(old=>old.id===row.id)||row)]));
}
async function persist() {
  if (!sync.ready || !project.value || !dirty) return;
  sync.saving = true;
  try {
    const id = projectId.value, p = project.value;
    const space = resources.value.executionSpaces.find(s => s.siteId === id);
    const { environments: _, ...state } = clone(data);
    const changes: any[] = [{ collection:'executionSpaces', id:space?.id || id, revision:space?.revision || 0, value:{ name:p.name, siteId:id, data:state, workspaces:clone(workspaces) } }];
    const existing = resources.value.environments.filter(e => e.siteId === id);
    for (const item of data.environments) {
      const old = existing.find(e => e.id === item.id);
      const { revision: _rev, ...row } = old || {};
      const value = { ...row, id:item.id, name:item.name, siteId:id, baseUrl:baseUrl(item), variables:clone(item.variables) };
      if (!old || JSON.stringify(row) !== JSON.stringify(value)) changes.push({ collection:'environments',id:item.id,revision:old?.revision || 0,value });
    }
    for (const old of existing) if (!data.environments.some(e => e.id === old.id)) changes.push({ collection:'environments',id:old.id,revision:old.revision,value:null });
    dirty = false;
    await commit(changes); sync.saved = new Date().toLocaleTimeString(); sync.error = ''; storageError.message = '';
  } catch (e) { dirty = true; sync.error = (e as Error).message; }
  finally { sync.saving = false; }
}
export function flush() { clearTimeout(timer); queue = queue.then(persist); return queue; }
// Materialize legacy request drafts before a server-side AI import changes the project space.
export function persistProject() { if (sync.ready && project.value) dirty = true; return flush(); }
const stopSyncWatch=watch([data, workspaces], () => {
  if (muted || !sync.ready || !project.value) return;
  dirty = true; clearTimeout(timer); timer = setTimeout(flush, 700);
}, { deep:true });
if(import.meta.hot)import.meta.hot.dispose(()=>{stopSyncWatch();clearTimeout(timer);sync.ready=false;});
export async function switchProject(id: string) {
  if (Object.values(busyTasks).some(Boolean)) throw new Error('请等待当前测试完成或取消后再切换项目');
  await flush(); if (sync.error) throw new Error('当前配置尚未同步，请先处理保存错误');
  resources.value=await api('workspace');
  if(id&&!resources.value.sites.some(p=>p.id===id))throw new Error('项目已被其他会话删除，请重新读取工作区');
  projectId.value = id; localStorage.setItem('testpilot.project',id); await apply();
}
export async function saveProject(input: { id?: string; name: string; code: string; description: string; baseUrl: string }, migrate = false) {
  await flush(); if(sync.error) throw new Error(sync.error);
  const old = resources.value.sites.find(p => p.id === input.id), id = input.id || uid();
  const { revision: _, ...previous } = old || {};
  baseUrl({id:'',name:'',variables:[pair('baseUrl',input.baseUrl)]});
  const value = { ...previous, ...input, id, scope:input.description || '项目测试', createdAt:old?.createdAt || new Date().toISOString() };
  const changes: any[] = [{collection:'sites',id,revision:old?.revision || 0,value}];
  if (!old) {
    const envId = uid();
    changes.push({collection:'environments',id:envId,revision:0,value:{id:envId,name:'本地环境',siteId:id,baseUrl:input.baseUrl,variables:[pair('baseUrl',input.baseUrl)]}});
    if(migrate) changes.push({collection:'executionSpaces',id,revision:0,value:{name:input.name,siteId:id,data:{...clone(data),environments:undefined,environmentId:envId},workspaces:clone(workspaces)}});
  }
  await commit(changes);
  if(!old) await switchProject(id);
}
export async function deleteProject(id: string) {
  await flush(); if(sync.error) throw new Error(sync.error);
  if(Object.values(busyTasks).some(Boolean)) throw new Error('请先结束当前测试');
  const row = resources.value.sites.find(p=>p.id===id)!;
  await commit([{collection:'sites',id,revision:row.revision,value:null}]);
  if(projectId.value===id) await switchProject(resources.value.sites[0]?.id || '');
}
export { preferences } from './preferences';
