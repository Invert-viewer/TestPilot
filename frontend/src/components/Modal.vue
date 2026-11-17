<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import Icon from './Icon.vue';
defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();
let before: HTMLElement | null;
function keyboard(e: KeyboardEvent) {
  const backdrops = document.querySelectorAll('.modal-backdrop');
  if (backdrops[backdrops.length - 1] !== panel.value?.parentElement) return;
  if (e.key === 'Escape') emit('close');
  if (e.key !== 'Tab') return;
  const items = panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]');
  if (!items?.length) return;
  if (e.shiftKey && document.activeElement === items[0]) { items[items.length - 1]!.focus(); e.preventDefault(); }
  else if (!e.shiftKey && document.activeElement === items[items.length - 1]) { items[0]!.focus(); e.preventDefault(); }
}
onMounted(() => { before = document.activeElement as HTMLElement; document.addEventListener('keydown', keyboard); panel.value?.querySelector<HTMLElement>('input, textarea, button')?.focus(); });
onBeforeUnmount(() => { document.removeEventListener('keydown', keyboard); before?.focus(); });
</script>
<template>
  <Teleport to="body"><div class="modal-backdrop" @mousedown.self="emit('close')"><section ref="panel" class="modal" :class="{wide}" role="dialog" aria-modal="true" :aria-label="title">
    <header class="modal-header"><h2>{{ title }}</h2><button class="icon-button" aria-label="关闭弹窗" @click="emit('close')"><Icon name="close" /></button></header>
    <div class="modal-body"><slot /></div><footer v-if="$slots.footer" class="modal-footer"><slot name="footer" /></footer>
  </section></div></Teleport>
</template>
