<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
const model = defineModel<string>({ required: true });
const props = defineProps<{ language: string; label: string }>();
const emit = defineEmits<{ run: [] }>();
const host = ref<HTMLElement>(); const compartment = new Compartment(), attributes = new Compartment(); let view: EditorView | undefined;
const extension = () => props.language === 'java' ? java() : javascript({ typescript: true });
onMounted(() => {
  view = new EditorView({ parent: host.value, state: EditorState.create({ doc: model.value, extensions: [
    lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), drawSelection(), history(), syntaxHighlighting(defaultHighlightStyle), compartment.of(extension()),
    keymap.of([{ key: 'Mod-Enter', run: () => { emit('run'); return true; } }, indentWithTab, ...defaultKeymap, ...historyKeymap]),
    attributes.of(EditorView.contentAttributes.of({ 'aria-label': props.label, 'spellcheck': 'false' })),
    EditorView.updateListener.of(update => { if (update.docChanged) model.value = update.state.doc.toString(); }),
    EditorView.theme({ '&': { fontSize: '12px', minHeight: '380px', backgroundColor: '#fbfcfe' }, '.cm-scroller': { fontFamily: 'Consolas, monospace', overflow: 'auto', lineHeight: '1.9' }, '.cm-content': { padding: '16px 8px', minHeight: '380px' }, '.cm-gutters': { backgroundColor: '#f5f7fb', color: '#a3adbf', border: 'none', padding: '16px 4px' }, '&.cm-focused': { outline: 'none' }, '.cm-line': { padding: '0 7px' } }),
  ] }) });
});
watch(model, value => { if (view && value !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } }); });
watch(() => props.language, () => view?.dispatch({ effects: compartment.reconfigure(extension()) }));
watch(() => props.label, label => view?.dispatch({ effects: attributes.reconfigure(EditorView.contentAttributes.of({ 'aria-label': label, 'spellcheck': 'false' })) }));
onBeforeUnmount(() => view?.destroy());
</script>
<template><div ref="host" class="source-editor"></div></template>
