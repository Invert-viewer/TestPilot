import {ref,onMounted} from 'vue';
import {collections,readWorkspace,commitWorkspace} from '../api/workspace';
import {clone,requestModel} from '../config';

export function useSharedWorkspace(state){
  const sharedError=ref(''),ready=ref(false);
  let generation=0;
  for(const kind of collections)state.value[kind]=[];
  function apply(snapshot){for(const kind of collections)state.value[kind]=snapshot[kind];ready.value=true;sharedError.value='';}
  function describe(e){return [e.code,e.message,e.traceId].filter(Boolean).join(' · ');}
  async function refresh(){const request=++generation;try{const snapshot=await readWorkspace();if(request===generation)apply(snapshot);}catch(e){if(request===generation)sharedError.value=describe(e);}}
  async function commit(changes){
    if(!ready.value)throw new Error('共享配置未加载，请先重试连接');
    if(!changes.length)return;
    try{const snapshot=await commitWorkspace(changes);++generation;apply(snapshot);}
    catch(e){sharedError.value=describe(e);throw e;}
  }
  const upsert=(collection,row)=>({collection,id:row.id,revision:row.revision??0,value:row});
  const remove=(collection,row)=>({...upsert(collection,row),value:null});
  async function importLegacy(file){
    const old=JSON.parse(file?await file.text():localStorage.getItem('testpilot-apple-preview-v1')||'{}');
    if(file && !['sites','environments','requests'].some(k=>Array.isArray(old?.[k])))throw new Error('选择旧版网站与请求导出文件');
    if(!old.environments && old.sites)old.environments=old.sites.map(s=>({id:s.id==='site-xzit'?'env-public':'env-'+s.id,siteId:s.id,name:s.environment||'公开环境',baseUrl:s.baseUrl,variables:[],globalVariables:[]}));
    const changes=[];
    for(const kind of ['sites','environments','requests']){
      for(const entry of old[kind]||[]){
        if(!entry.id || state.value[kind].some(row=>row.id===entry.id))continue;
        const row=clone(entry);delete row.revision;
        if(kind==='requests')requestModel(row.definition);
        changes.push(upsert(kind,row));
      }
    }
    await commit(changes);return changes.length;
  }
  onMounted(refresh);
  return {sharedError,ready,refresh,commit,upsert,remove,importLegacy};
}
