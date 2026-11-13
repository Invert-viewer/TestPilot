<script setup>
import {ref,computed} from 'vue';
import {ElMessage,ElMessageBox} from 'element-plus';
import {useWorkspace} from '../context';
import ResourcePanel from '../ResourcePanel.vue';
import {resources} from '../resources';
import {toolLabel} from '../preview';
const {state,newTask,commit,remove}=useWorkspace();
import {useRouter} from 'vue-router';
const router=useRouter(),caseDetail=ref(null),cases=computed(()=>state.value.assertionCases);
async function removeCase(item){
  try{await ElMessageBox.confirm('删除断言用例「'+item.name+'」？删除后不可恢复。','删除断言用例',{confirmButtonText:'确认删除',cancelButtonText:'取消',type:'warning'});}catch{return;}
  try{await commit([remove('assertionCases',item)]);ElMessage.success('断言用例已删除');}
  catch(e){ElMessage.error(e.message||'删除失败');}
}
</script><template>
        <ResourcePanel :state="state" v-bind="resources.assertionCases" />
        <section class="surface">
          <div class="panel-heading">
            <h2>断言结果</h2>
            <span class="status neutral">共享用例</span>
          </div>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>用例</th>
                  <th>类型</th>
                  <th>预期结果</th>
                  <th>实际结果</th>
                  <th>结论</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in cases"
                  :key="item.id"
                  class="click-row"
                  @click="caseDetail = item"
                >
                  <td>
                    <button class="link">{{ item.name }}</button><small>{{
                      item.id
                    }}</small>
                  </td>
                  <td>{{ item.type }}</td>
                  <td>{{ item.expected }}</td>
                  <td>{{ item.actual }}</td>
                  <td>
                    <span
                      :class="[
                        'status',
                        item.status === 'FAILED' ? 'amber' : 'green',
                      ]"
                      >{{ item.status === "FAILED" ? "失败" : "通过" }}</span
                    >
                  </td>
                  <td>
                    <button
                      class="link"
                      style="color:var(--color-negative-ink)"
                      @click.stop="removeCase(item)"
                    >删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <div class="plain-note">
          <h3>定位失败，再验证修复。</h3>
          <p>
            打开失败断言核对预期与实际，通过任务报告发起复测，并对照两次执行结果。
          </p>
          <button
            class="link"
            @click="
              router.push('/tasks')
            "
          >
            查看任务报告 ›
          </button>
        </div>
      <el-dialog :model-value="!!caseDetail"
      title="断言与回归。"
      width="540px"
      @close="caseDetail = null"
      ><template v-if="caseDetail"
        ><h2>{{ caseDetail.name }}</h2>
        <dl>
          <dt>预期</dt>
          <dd>{{ caseDetail.expected }}</dd>
          <dt>实际</dt>
          <dd>{{ caseDetail.actual }}</dd>
        </dl>
        <p>{{ caseDetail.note }}</p>
        <button
          class="button"
          @click="
            caseDetail = null;
            router.push('/tasks');
          "
        >
          前往任务与复测
        </button></template
      ></el-dialog
    >
</template>