<script setup>
import {ref,computed} from 'vue';
import {ElMessage} from 'element-plus';
import {useWorkspace} from '../context';
import ResourcePanel from '../ResourcePanel.vue';
import {resources} from '../resources';
import {toolLabel} from '../preview';
const {state,newTask,commit,upsert}=useWorkspace();
const activeCheck = ref(null);
function recordCheck(check) {
  activeCheck.value = JSON.parse(JSON.stringify(check));
}
async function saveCheck(){
  try{await commit([upsert('checks',{...activeCheck.value,updatedAt:new Date().toISOString()})]);activeCheck.value=null;ElMessage.success('检查记录已保存');}
  catch(e){ElMessage.error(e.message);}
}
</script><template>
        <ResourcePanel :state="state" v-bind="resources.checks" />
        <section class="surface">
          <div class="panel-heading">
            <h2>检查清单</h2>
            <span class="muted"
              >{{
                state.checks.filter((item) => item.status === "PASSED").length
              }}
              / {{ state.checks.length }} 已标记通过</span
            >
          </div>
          <div v-for="check in state.checks" :key="check.id" class="check-line">
            <div>
              <h3>{{ check.title }}</h3>
              <p>
                {{ check.kind === "WEBSITE_PAGE" ? "官网页面" : "平台验收" }} ·
                {{ check.method === "HTTP" ? "HTTP 检查" : "人工检查" }}
              </p>
            </div>
            <span
              :class="[
                'status',
                check.status === 'PASSED'
                  ? 'green'
                  : check.status === 'FAILED'
                    ? 'amber'
                    : 'neutral',
              ]"
              >{{
                { PENDING: "待检查", PASSED: "通过", FAILED: "待修复" }[
                  check.status
                ]
              }}</span><button class="link" @click="recordCheck(check)">
              记录结果 ›
            </button>
          </div>
        </section>
        <p class="helper">
          检查记录在平台内共享。正式通过结论应附实际检查步骤与证据。
        </p>
      <el-dialog :model-value="!!activeCheck"
      title="记录检查结果。"
      width="560px"
      @close="activeCheck = null"
      ><template v-if="activeCheck"
        ><h2>{{ activeCheck.title }}</h2>
        <p>预期 · {{ activeCheck.expected }}</p>
        <el-form label-position="top"
          ><el-form-item label="检查结论"
            ><el-select v-model="activeCheck.status"
              ><el-option value="PENDING" label="待检查" /><el-option
                value="PASSED"
                label="通过" /><el-option
                value="FAILED"
                label="待修复" /></el-select></el-form-item
          ><el-form-item label="实际现象与复测说明"
            ><el-input
              v-model="activeCheck.actual"
              type="textarea"
              :rows="3" /></el-form-item
          ><el-form-item label="证据位置"
            ><el-input
              v-model="activeCheck.evidence"
              placeholder="截图、检查记录或任务 ID" /></el-form-item></el-form
        ><button class="button" @click="saveCheck">保存记录</button></template
      ></el-dialog
    >
</template>