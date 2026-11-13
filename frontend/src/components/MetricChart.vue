<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref,watch} from 'vue';
import * as echarts from 'echarts/core';
import {LineChart,BarChart} from 'echarts/charts';
import {GridComponent,TooltipComponent,LegendComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
echarts.use([LineChart,BarChart,GridComponent,TooltipComponent,LegendComponent,CanvasRenderer]);
const props=withDefaults(defineProps<{labels:string[];series:{name:string;values:(number|null)[]}[];unit?:string;kind?:'line'|'bar';description:string}>(),{unit:'ms',kind:'line'});
const element=ref<HTMLDivElement|null>(null);let chart:echarts.ECharts|undefined,observer:ResizeObserver;
function render(){chart?.setOption({animation:!matchMedia('(prefers-reduced-motion: reduce)').matches,textStyle:{fontFamily:'Inter,system-ui,sans-serif'},color:['#6366f1','#a5b4fc'],tooltip:{trigger:'axis'},legend:{bottom:0,icon:'circle'},grid:{left:48,right:20,top:28,bottom:64},xAxis:{type:'category',data:props.labels,axisLine:{show:false},axisTick:{show:false}},yAxis:{type:'value',name:props.unit,splitLine:{lineStyle:{type:'dashed',color:'#f3f4f6'}}},series:props.series.map(s=>({name:s.name,type:props.kind,data:s.values,connectNulls:false,symbolSize:6,lineStyle:{width:2},barMaxWidth:40}))},true);}
onMounted(()=>{if(element.value){chart=echarts.init(element.value);observer=new ResizeObserver(()=>chart?.resize());observer.observe(element.value);render();}});
watch(()=>[props.labels,props.series,props.kind],render,{deep:true});onBeforeUnmount(()=>{observer?.disconnect();chart?.dispose();});
</script>
<template><div ref="element" class="chart" role="img" :aria-label="description"></div></template>
