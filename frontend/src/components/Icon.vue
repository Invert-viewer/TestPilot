<script setup lang="ts">
import { Braces, MousePointer2, Gauge, FlaskConical, ShieldCheck, Smartphone, Plus, Trash2, Pencil,
  Send, Save, Upload, Terminal, RotateCcw, ChevronDown, ChevronUp, X, Play, Search, Sparkles,
  ArrowRight, Check, CircleAlert, Clock3, Copy, Menu, ChevronRight, LoaderCircle, CheckCircle2, Globe, Layers, FolderOpen, Settings2, Users, Database, Sun, LogOut } from 'lucide-vue-next';
defineProps<{ name: string; size?: number }>();
const icons: Record<string, typeof Braces> = { api: Braces, ui: MousePointer2, perf: Gauge, unit: FlaskConical,
  security: ShieldCheck, compat: Smartphone, plus: Plus, trash: Trash2, edit: Pencil, send: Send,
  save: Save, upload: Upload, terminal: Terminal, reset: RotateCcw, down: ChevronDown, up: ChevronUp,
  close: X, play: Play, search: Search, sparkles: Sparkles, arrow: ArrowRight, check: Check,
  alert: CircleAlert, clock: Clock3, copy: Copy, menu: Menu, chevron: ChevronRight, loader: LoaderCircle,
  success: CheckCircle2, globe: Globe, layers: Layers, projects:FolderOpen, toolchain:Terminal, settings:Settings2, team:Users, database:Database, sun:Sun, logout:LogOut, ai:Sparkles };
</script>
<template><component :is="icons[name] || Braces" :size="size || 18" :stroke-width="1.8" aria-hidden="true" /></template>
