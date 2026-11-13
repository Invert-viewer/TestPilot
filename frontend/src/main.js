import {createApp} from 'vue';
import {createRouter,createWebHashHistory} from 'vue-router';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import App from './App.vue';
import {recordUnexpected} from './services/diagnostics';
import {isCancelled} from './api/index';
import './style.css';
import './editors.css';
import './styles/dashboard.css';
const routes=[
  {path:'/',redirect:()=>({path:'/overview'})},
  ...Object.entries(import.meta.glob('./pages/*Page.vue')).map(([path,component])=>({path:'/'+({Overview:'overview',Sites:'sites',Assets:'assets',Debug:'debug',Tasks:'tasks',Compare:'compare',Regression:'regression',Checks:'checks'}[path.split('/').pop().replace('Page.vue','')]),component})),
  {path:'/:pathMatch(.*)*',redirect:'/overview'},
];
const legacyTaskId=new URLSearchParams(location.search).get('taskId');
if(legacyTaskId&&!location.hash.includes('taskId='))location.hash='/tasks?taskId='+encodeURIComponent(legacyTaskId);
const router=createRouter({history:createWebHashHistory(),routes});
const app=createApp(App);
function fallback(error,operation){if(isCancelled(error))return;recordUnexpected(error,operation);window.dispatchEvent(new Event('testpilot:runtime-error'));}
app.config.errorHandler=(error)=>fallback(error,'vue');
window.addEventListener('unhandledrejection',event=>{event.preventDefault();fallback(event.reason,'promise');});
app.use(router).use(ElementPlus);
router.isReady().then(()=>app.mount('#app'));
