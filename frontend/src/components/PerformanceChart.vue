<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { init, use, type EChartsType } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
const props = defineProps<{ points: { second: number; tps: number; p95Ms: number; avgMs: number }[] }>();
const host = ref<HTMLElement>(); let chart: EChartsType | undefined, observer: ResizeObserver;
function render() { chart?.setOption({ animation: false, color: ['#6958e9', '#35a69a'], grid: { top: 45, right: 48, bottom: 35, left: 45 }, legend: { top: 0, right: 12, textStyle: { color: '#919bb0', fontSize: 10 }, itemWidth: 12, itemHeight: 3 }, tooltip: { trigger: 'axis', textStyle: { fontSize: 11 } }, xAxis: { type: 'category', data: props.points.map(p => p.second + 's'), boundaryGap: false, axisLine: { lineStyle: { color: '#e9edf5' } }, axisTick: { show: false }, axisLabel: { color: '#99a3b6', fontSize: 10 } }, yAxis: [{ type: 'value', name: '请求 / 秒', nameTextStyle: { color: '#99a3b6', fontSize: 10 }, axisLabel: { color: '#99a3b6', fontSize: 10 }, splitLine: { lineStyle: { color: '#f0f2f7' } } }, { type: 'value', name: 'ms', axisLabel: { color: '#99a3b6', fontSize: 10 }, nameTextStyle: { color: '#99a3b6', fontSize: 10 }, splitLine: { show: false } }], series: [{ name: 'TPS', type: 'line', data: props.points.map(p => p.tps), showSymbol: false, lineStyle: { width: 2 }, areaStyle: { opacity: .045 } }, { name: 'P95', type: 'line', yAxisIndex: 1, data: props.points.map(p => p.p95Ms), showSymbol: false, lineStyle: { width: 2 } }] }); }
onMounted(() => { if (!host.value) return; chart = init(host.value); observer = new ResizeObserver(() => chart?.resize()); observer.observe(host.value); render(); });
watch(() => props.points, render, { deep: true }); onBeforeUnmount(() => { observer?.disconnect(); chart?.dispose(); });
</script>
<template><div ref="host" class="performance-chart" role="img" aria-label="实测 TPS 和 P95 响应时间趋势"></div></template>
