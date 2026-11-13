import {it,expect} from 'vitest';
import {mount} from '@vue/test-utils';
import DualEditor from '../src/components/DualEditor.vue';
import {requestDefinition} from '../src/types/validation';
import {requestSeed} from '../src/preview';
import {requestModel,taskModel,taskSeed} from '../src/config';
it('preserves invalid JSON and the last valid configuration, then synchronizes repaired JSON',async()=>{
  const seed=structuredClone(requestSeed),wrapper=mount(DualEditor,{props:{modelValue:seed,label:'请求 JSON',validate:requestDefinition}});
  await wrapper.findAll('button')[1].trigger('click');const area=wrapper.find('textarea');await area.setValue('{invalid');await wrapper.findAll('button')[0].trigger('click');
  expect(wrapper.find('textarea').exists()).toBe(false);expect(wrapper.find('[role="alert"]').text()).toContain('草稿仍保留');expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  await wrapper.findAll('button')[1].trigger('click');expect(wrapper.find('textarea').element.value).toBe('{invalid');
  const modified={...seed,query:[{key:'page',value:'2',enabled:true}]};await wrapper.find('textarea').setValue(JSON.stringify(modified));await wrapper.findAll('button')[0].trigger('click');expect(wrapper.find('textarea').exists()).toBe(false);expect(wrapper.emitted('update:modelValue')?.[0][0]).toEqual(modified);wrapper.unmount();
});
it('allows an unfinished request draft back into fields while keeping save validation',async()=>{
  const draft={...structuredClone(requestSeed),name:'',timeoutMs:0};
  const wrapper=mount(DualEditor,{props:{modelValue:draft,label:'请求 JSON',validate:requestModel,parseDraft:v=>requestModel(v,{draft:true})}});
  await wrapper.findAll('button')[1].trigger('click');await wrapper.findAll('button')[0].trigger('click');
  expect(wrapper.find('textarea').exists()).toBe(false);expect(wrapper.emitted('update:modelValue')?.[0][0]).toEqual(draft);expect(()=>requestModel(draft)).toThrow();wrapper.unmount();
});
it('distinguishes task draft editing from execution constraints',()=>{const draft=taskSeed();draft.name='';draft.parameters.iterations=0;expect(taskModel(draft,{draft:true}).parameters.iterations).toBe(0);expect(()=>taskModel(draft)).toThrow();});
it('lets the user explicitly replace a retained invalid JSON draft from the current form',async()=>{
  const wrapper=mount(DualEditor,{props:{modelValue:structuredClone(requestSeed),validate:requestDefinition}});
  await wrapper.findAll('button')[1].trigger('click');await wrapper.find('textarea').setValue('{unfinished');await wrapper.findAll('button')[0].trigger('click');await wrapper.findAll('button')[1].trigger('click');
  await wrapper.findAll('button').find(b=>b.text()==='使用当前表单重新生成 JSON')!.trigger('click');expect(JSON.parse(wrapper.find('textarea').element.value)).toEqual(requestSeed);expect(wrapper.find('[role="alert"]').exists()).toBe(false);wrapper.unmount();
});
