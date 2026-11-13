import {it,expect,vi} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import {ref} from 'vue';
import TaskReportPanel from '../src/content/TaskReportPanel.vue';
import * as api from '../src/api/index';
import type {TaskFlow} from '../src/composables/useTaskFlow';
it('keeps file actions usable when preview refresh overlaps a file request',async()=>{
  vi.spyOn(api,'fetchReportPreview').mockResolvedValue(new Blob(['<h1>Report</h1>']));
  let finish:(blob:Blob)=>void=()=>{};
  vi.spyOn(api,'fetchReportFile').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const flow={activeId:ref('task-report'),report:ref({taskId:'task-report',metrics:{},files:[{name:'run.json',size:2}]}),reportError:ref(null),reportLoading:ref(false),loadReport:vi.fn()} as unknown as TaskFlow;
  const wrapper=mount(TaskReportPanel,{props:{flow},global:{stubs:{'el-dialog':{template:'<div><slot/></div>'}}}});
  await flushPromises();const view=wrapper.findAll('button').find(b=>b.text()==='查看')!;await view.trigger('click');expect(view.attributes('disabled')).toBeDefined();
  await wrapper.findAll('button').find(b=>b.text()==='刷新预览')!.trigger('click');await flushPromises();finish(new Blob(['{}']));await flushPromises();expect(view.attributes('disabled')).toBeUndefined();wrapper.unmount();
});
