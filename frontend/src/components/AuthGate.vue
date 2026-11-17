<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, user, type User } from '../auth';
import Icon from './Icon.vue';
const initialized=ref(true), checking=ref(true), busy=ref(false), error=ref('');
const form=reactive({username:'',password:'',displayName:'',email:''});
async function check() { checking.value=true; error.value=''; try { initialized.value=(await api('auth/status')).initialized; } catch(e) { error.value=(e as Error).message; } finally { checking.value=false; } }
async function submit() {
  busy.value=true; error.value='';
  try { user.value=await api<User>(initialized.value?'auth/login':'auth/setup','POST',form); form.password=''; }
  catch(e) { error.value=(e as Error).message; } finally {busy.value=false;}
}
onMounted(check);
</script>
<template><div class="auth-shell"><section class="auth-story"><div class="brand-mark"><Icon name="layers" :size="30" /></div><div class="eyebrow">TESTPILOT / SHARED WORKSPACE</div><h1>把测试上下文，<br>交还给团队。</h1><p>项目、环境和测试资产共享存储，<br>每一次修改都有明确的身份与权限。</p><div class="auth-feature"><Icon name="security" />数据库会话 · 服务端鉴权</div></section><section class="auth-form"><span class="eyebrow">WELCOME TO TESTPILOT</span><h2>{{ initialized?'登录工作区':'创建首位测试负责人' }}</h2><p class="muted">{{initialized?'使用团队账号继续测试。':'首次启动请自行设置账号。平台不提供默认密码。'}}</p><div v-if="checking" class="inline-note"><Icon name="loader" class="spin" />正在检查数据库…</div><form v-else @submit.prevent="submit"><label class="field">账号<input v-model="form.username" aria-label="登录账号" required autocomplete="username" minlength="3" maxlength="80" pattern="[A-Za-z0-9_.-]+" /></label><label v-if="!initialized" class="field">姓名<input v-model="form.displayName" required maxlength="100" aria-label="负责人姓名" autocomplete="name" /></label><label v-if="!initialized" class="field">邮箱（选填）<input v-model="form.email" type="email" maxlength="200" autocomplete="email" /></label><label class="field">密码<input v-model="form.password" type="password" aria-label="登录密码" required :minlength="initialized?1:10" maxlength="128" :autocomplete="initialized?'current-password':'new-password'" /></label><p v-if="!initialized" class="muted help">至少 10 个字符。后续成员由测试负责人创建。</p><div v-if="error" class="error-banner" role="alert">{{error}} <button type="button" class="text-button" @click="check">重新连接</button></div><button class="button primary" :disabled="busy"><Icon :name="busy?'loader':'arrow'" :class="{spin:busy}" />{{busy?'正在验证…':initialized?'登录':'创建并进入工作区'}}</button></form></section></div></template>
