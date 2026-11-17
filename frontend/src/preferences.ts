import { reactive, watch, nextTick } from 'vue';
function load() { try { return {...{dark:false,notifyFailure:true,openReport:true},...JSON.parse(localStorage.getItem('testpilot.preferences')||'{}')}; } catch {return {dark:false,notifyFailure:true,openReport:true};} }
export const preferences=reactive(load());
watch(preferences,()=>{localStorage.setItem('testpilot.preferences',JSON.stringify(preferences));document.documentElement.dataset.theme=preferences.dark?'dark':'light';},{deep:true,immediate:true});
export async function revealReport(selector:string) { if(!preferences.openReport)return;await nextTick();document.querySelector(`main ${selector}`)?.scrollIntoView({behavior:'smooth',block:'start'}); }
