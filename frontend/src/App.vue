<script setup lang="ts">
import {ref,computed,provide,onMounted,onBeforeUnmount,nextTick,watch} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import {usePreview} from './preview';
import {useSharedWorkspace} from './composables/useSharedWorkspace';
import {workspaceKey} from './context';
const route=useRoute(),router=useRouter(),preview=usePreview(),navOpen=ref(false),runtimeError=ref(false),menuButton=ref<HTMLButtonElement|null>(null),isNarrow=ref(matchMedia('(max-width:900px)').matches);
const narrowMedia=matchMedia('(max-width:900px)'),onResize=()=>{isNarrow.value=narrowMedia.matches;if(!isNarrow.value)navOpen.value=false;};
const navigation=[{id:'overview',label:'概览',icon:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z'},{id:'sites',label:'网站与环境',icon:'M3 5h18v14H3z M3 9h18 M7 7h.01 M10 7h.01'},{id:'assets',label:'测试资产',icon:'M4 4h6l2 3h8v13H4z M8 12h8 M8 16h5'},{id:'debug',label:'请求调试',icon:'m8 7-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16'},{id:'tasks',label:'任务与报告',icon:'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5'},{id:'compare',label:'实验对比',icon:'M4 20V10h5v10 M10 20V4h5v16 M16 20v-7h5v7'},{id:'regression',label:'断言回归',icon:'m4 6 2 2 4-4 M13 6h7 M4 14l2 2 4-4 M13 14h7 M13 20h7'},{id:'checks',label:'检查验收',icon:'M12 3 3 7v6c0 5 9 8 9 8s9-3 9-8V7z m-5 9 3 3 6-6'}];
const page=computed(()=>navigation.find(p=>'/'+p.id===route.path)||navigation[0]);
const source=computed(()=>page.value.id==='debug'?'真实请求 / 本地模拟':'共享平台');
function newTask(){void router.push({path:'/tasks',query:{...route.path==='/tasks'?route.query:{},compose:'1'}});}
const shared=useSharedWorkspace(preview.state);
const {sharedError,refresh}=shared;
provide(workspaceKey,{...preview,...shared,newTask});
function onRuntime(){runtimeError.value=true;}
async function closeNav(){navOpen.value=false;await nextTick();menuButton.value?.focus();}
function skip(){document.getElementById('main-content')?.focus();}
function trapNav(event:KeyboardEvent){if(!navOpen.value||!isNarrow.value||event.key!=='Tab')return;const links=[...document.querySelectorAll<HTMLAnchorElement>('#sidebar a')],first=links[0],last=links.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
watch(navOpen,async open=>{if(open&&isNarrow.value){await nextTick();document.querySelector<HTMLAnchorElement>('#sidebar a')?.focus();}});
watch(()=>route.path,async()=>{void shared.refresh();navOpen.value=false;await nextTick();document.getElementById('page-title')?.focus();});
onMounted(()=>{window.addEventListener('testpilot:runtime-error',onRuntime);narrowMedia.addEventListener('change',onResize);});onBeforeUnmount(()=>{window.removeEventListener('testpilot:runtime-error',onRuntime);narrowMedia.removeEventListener('change',onResize);});
</script>
<template>
<a class="skip-link" href="#main-content" @click.prevent="skip">跳到主要内容</a>
<div class="app-shell" @keydown.esc="navOpen&&closeNav()" @keydown="trapNav">
<aside id="sidebar" :inert="isNarrow&&!navOpen" :class="['sidebar',{open:navOpen}]" aria-label="工作空间导航">
<RouterLink class="brand" to="/overview"><span class="brand-icon">T</span><span>TestPilot<small>自动化测试平台</small></span></RouterLink>
<div class="rail-caption">工作空间</div><nav aria-label="主导航"><RouterLink v-for="item in navigation" :key="item.id" :to="'/'+item.id" :class="['nav-item',{current:page.id===item.id}]" :aria-current="page.id===item.id?'page':undefined"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path :d="item.icon"/></svg>{{item.label}}</RouterLink></nav>
<div class="rail-footer"><span class="connection-dot"></span>本地工作空间<small>Apifox CLI · Spring Boot</small></div>
</aside><button v-if="navOpen" class="nav-backdrop" aria-label="关闭导航" @click="closeNav"></button>
<div class="app-main"><header class="topbar"><button ref="menuButton" class="menu-toggle" :aria-expanded="navOpen" aria-controls="sidebar" aria-label="切换导航" @click="navOpen=!navOpen">☰</button><span class="breadcrumb">工作空间 <span>/</span> {{page.label}}</span><span class="source-chip">{{source}}</span><button class="button small" @click="newTask">＋ 新建任务</button></header>
<main id="main-content" tabindex="-1" class="work-area wrap"><div class="work-heading"><div><p class="eyebrow">TESTPILOT / WORKSPACE</p><h1 id="page-title" tabindex="-1">{{page.label}}</h1></div><span class="muted">本地运行</span></div>
<div v-if="runtimeError" class="error-banner" role="alert">页面发生异常，已记录不含请求内容的诊断信息。可刷新后重试。<button class="link" @click="runtimeError=false">关闭提示</button></div>
<div v-if="sharedError" class="error-banner" role="alert">共享配置 · {{sharedError}} <button class="link" @click="refresh">重新加载</button></div>
<RouterView/>
<footer class="workspace-footer">TestPilot <span>组内共享工作空间</span></footer></main></div></div>
</template>
