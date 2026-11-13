<script setup>
import { ref } from 'vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import { useWorkspace } from '../context';
import ResourcePanel from '../ResourcePanel.vue';
import { resources } from '../resources';

const { state, newTask, commit, remove, upsert, importLegacy } = useWorkspace();
const siteManager = ref(null);

async function removeSite(site) {
  try {
    await ElMessageBox.confirm(
      `删除「${site.name}」及其共享环境？历史任务和报告仍可查看。`,
      '删除网站', { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' }
    );
  } catch { return; }
  const workspace = state.value;
  const changes=[remove('sites',site)];
  for(const env of workspace.environments.filter(e=>e.siteId===site.id))changes.push(remove('environments',env));
  for(const plan of workspace.comparisons.filter(p=>p.siteIds?.includes(site.id)))changes.push(upsert('comparisons',{...plan,siteIds:plan.siteIds.filter(id=>id!==site.id)}));
  for(const check of workspace.checks.filter(c=>c.siteId===site.id))changes.push(upsert('checks',{...check,siteId:''}));
  try{await commit(changes);}catch(e){ElMessage.error(e.message);}
}
async function migrate(file){try{const count=await importLegacy(file);ElMessage.success('已导入 '+count+' 条网站、环境和请求配置');}catch(e){ElMessage.error(e.message);}}
</script>
<template>
  <div class="cards-two">
    <article v-for="(site,index) in state.sites" :key="site.id" class="surface site-card"
      :style="{ '--site-hue': site.cardHue ?? (220 + index * 137.507764) % 360 }">
      <h2>{{ site.name }}</h2>
      <p class="url">{{ site.baseUrl }}</p>
      <dl>
        <dt>环境</dt><dd>{{ site.environment || '—' }}</dd>
        <dt>测试范围</dt><dd>{{ site.scope || '—' }}</dd>
        <dt>可比业务</dt><dd>{{ site.scenarioKey || '—' }}</dd>
      </dl>
      <div class="inline-actions">
        <RouterLink class="link" :to="{path:'/debug',query:{siteId:site.id}}">调试请求</RouterLink>
        <button class="link" @click="newTask()">运行登记场景</button>
        <button class="link" @click="siteManager.edit(site)">编辑网站</button>
        <button class="link delete-site" @click="removeSite(site)">删除网站</button>
      </div>
    </article>
    <button class="surface add-site" @click="siteManager.openCreate()">＋ 添加网站</button>
  </div>
  <button class="link" @click="migrate()">导入此浏览器旧版网站与请求（跳过已有 ID）</button>
  <label class="file-button">导入旧版导出文件<input type="file" accept=".json" @change="async e=>{const file=e.target.files[0];if(file)await migrate(file);e.target.value='';}"/></label>
  <ResourcePanel ref="siteManager" :state="state" v-bind="resources.sites" />
  <ResourcePanel :state="state" v-bind="resources.environments" />
</template>
<style scoped>
.site-card { background: hsl(var(--site-hue) 64% 96%); border-top: 4px solid hsl(var(--site-hue) 51% 52%); overflow-wrap:anywhere }
.site-card .delete-site { color: var(--color-negative-ink) }
.add-site { border-style: dashed; color: var(--color-indigo); min-height: 72px }
.cards-two { margin-bottom: 24px }
</style>
