<script setup>
import {ref,computed} from 'vue';
import {ElMessage,ElMessageBox} from 'element-plus';
import {useWorkspace} from '../context';
import ResourcePanel from '../ResourcePanel.vue';
import {resources} from '../resources';
import {toolLabel} from '../preview';
const {state,newTask,commit,remove}=useWorkspace();
import {useRouter} from 'vue-router';
import {onMounted,onBeforeUnmount} from 'vue';
import {fetchToolAssets,deleteToolAsset,isCancelled} from '../api';
import ErrorState from '../components/ErrorState.vue';
const router=useRouter(),selectedAsset=ref(null),realAssets=ref([]),assetError=ref(null),deleteError=ref(null),deleting=ref(''),loading=ref(false),controller=new AbortController();
async function load(){loading.value=true;assetError.value=null;try{realAssets.value=await fetchToolAssets('APIFOX_CLI',controller.signal);}catch(e){if(!isCancelled(e))assetError.value=e;}finally{loading.value=false;}}
onMounted(load);onBeforeUnmount(()=>controller.abort());
async function confirmDelete(label,detail){try{await ElMessageBox.confirm('删除「'+label+'」？删除后不可恢复。'+(detail||''),'删除配置',{confirmButtonText:'确认删除',cancelButtonText:'取消',type:'warning'});return true;}catch{return false;}}
async function removeRealAsset(asset){
  if(!await confirmDelete(asset.name,'后端会在删除后级联清理引用。'))return;
  deleting.value=asset.id;deleteError.value=null;
  try{await deleteToolAsset(asset.id);ElMessage.success('场景资产已删除');await load();}
  catch(e){if(!isCancelled(e)){deleteError.value=e;ElMessage.error(e.message||'删除失败');}}
  finally{deleting.value='';}
}
async function removeAsset(asset){
  if(!await confirmDelete(asset.name))return;
  deleting.value=asset.id;deleteError.value=null;
  try{await commit([remove('assets',asset)]);ElMessage.success('资产已删除');}
  catch(e){deleteError.value=e;ElMessage.error(e.message||'删除失败');}
  finally{deleting.value='';}
}
async function removeRequest(row){
  if(!await confirmDelete(row.name||row.id,'引用该请求的断言用例会一并清理。'))return;
  deleting.value=row.id;deleteError.value=null;
  try{await commit([remove('requests',row)]);ElMessage.success('请求已删除');}
  catch(e){deleteError.value=e;ElMessage.error(e.message||'删除失败');}
  finally{deleting.value='';}
}
</script><template><section class="surface"><div class="panel-heading"><div><h2>已登记的执行场景</h2><p class="muted">来源：Spring Boot · 可用于真实任务</p></div><button class="button outline" :disabled="loading" @click="load">刷新场景</button></div>
<ErrorState :error="assetError"/><ErrorState :error="deleteError"/><p v-if="loading">读取中…</p><p v-else-if="!realAssets.length && !assetError" class="empty">暂无已登记场景</p>
<div v-for="asset in realAssets" :key="asset.id" class="check-line"><div><strong>{{asset.name}}</strong><small>{{asset.id}} · 场景 {{asset.source.scenarioId}} · v{{asset.version}}</small></div><button class="link" @click="newTask()">配置任务</button><button class="link" style="color:var(--color-negative-ink)" :disabled="deleting===asset.id" @click="removeRealAsset(asset)">{{deleting===asset.id?'删除中…':'删除'}}</button></div></section>
<div class="source-note">资产草稿可在平台内编辑，执行任务时从上方已登记场景中选择。</div>
        <ResourcePanel :state="state" v-bind="resources.assets" />
        <div class="cards-two">
          <article
            v-for="asset in state.assets"
            :key="asset.id"
            class="surface asset-card"
          >
            <span
              class="tool-mark"
              :class="{ orange: asset.tool === 'JMETER' }"
              >{{ asset.tool === "JMETER" ? "J" : "A" }}</span
            >
            <p class="muted">
              {{ toolLabel(asset.tool) }} · v{{ asset.version }}
            </p>
            <h2>{{ asset.name }}</h2>
            <p>{{ asset.description }}</p>
            <div class="asset-bottom">
              <span class="status neutral">{{ asset.status }}</span><button
                class="link"
                @click="selectedAsset = asset"
              >
                查看场景 ›
              </button><button
                class="link"
                style="color:var(--color-negative-ink)"
                :disabled="deleting===asset.id"
                @click="removeAsset(asset)"
              >
                {{ deleting===asset.id ? '删除中…' : '删除' }}
              </button>
            </div>
          </article>
        </div>
        <section class="surface section-space">
          <div class="panel-heading">
            <h2>统一请求清单</h2>
            <span class="muted">场景关联的请求与预期</span>
          </div>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>请求</th>
                  <th>方法 / 目标</th>
                  <th>预期</th>
                  <th>用途</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in state.requests" :key="r.id"><td>{{r.name}}</td><td>{{r.definition.method}} {{r.definition.url}}</td><td>{{r.definition.assertions.length}} 条断言</td><td>共享请求资产</td><td><button class="link" style="color:var(--color-negative-ink)" :disabled="deleting===r.id" @click="removeRequest(r)">{{deleting===r.id?'删除中…':'删除'}}</button></td></tr>
                <tr v-if="!state.requests.length"><td colspan="5">暂无共享请求资产</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      <el-dialog :model-value="!!selectedAsset"
      title="场景与请求。"
      width="560px"
      @close="selectedAsset = null"
      ><template v-if="selectedAsset"
        ><h2>{{ selectedAsset.name }}</h2>
        <p>{{ selectedAsset.description }}</p>
        <dl>
          <dt>工具</dt>
          <dd>{{ toolLabel(selectedAsset.tool) }}</dd>
          <dt>资产类型</dt>
          <dd>{{ selectedAsset.kind }}</dd>
          <dt>业务标识</dt>
          <dd>{{ selectedAsset.scenarioKey }}</dd>
          <dt>资产状态</dt>
          <dd>{{ selectedAsset.status }}</dd>
        </dl>
        <p class="helper">
          关联场景 ID
          或可运行的测试文件后，可在相同请求清单上执行参数实验和断言回归。
        </p>
        <button
          class="button"
          @click="
            selectedAsset = null;
            router.push('/debug');
          "
        >
          查看请求定义
        </button></template
      ></el-dialog
    >
</template>