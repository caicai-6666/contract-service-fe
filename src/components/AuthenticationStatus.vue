<script setup>
import { computed } from 'vue'
import { KNOWLEDGE_ENTRY_PATH } from '../services/contractApi.js'

const props = defineProps({ state: { type: String, required: true }, error: { type: String, default: '' } })
defineEmits(['retry'])
const title = computed(() => ({
  missing: '请从知识沉淀入口进入',
  expired: '登录状态已失效',
  denied: '暂无合同平台访问权限',
  error: '暂时无法确认登录状态',
})[props.state])
const message = computed(() => ({
  missing: '请通过统一入口登录后访问合同平台。',
  expired: '请返回统一入口重新登录。',
  denied: '当前账号尚未获得合同平台访问权限。',
  error: props.error || '用户服务暂时不可用，请稍后重试。',
})[props.state])
</script>

<template>
  <Transition name="auth-status" mode="out-in" appear>
    <div v-if="state === 'loading'" key="loading" class="auth-loading" role="status" aria-label="正在确认登录状态">
      <div class="auth-loading__bars" aria-hidden="true"><span /><span /><span /><span /><span /></div>
    </div>
    <section v-else :key="state" class="auth-status" aria-labelledby="auth-status-title">
      <h1 id="auth-status-title">{{ title }}</h1>
      <p :role="state === 'error' ? 'alert' : undefined">{{ message }}</p>
      <div class="auth-status__actions">
        <a :href="KNOWLEDGE_ENTRY_PATH">返回知识沉淀</a>
        <button v-if="state === 'error'" type="button" @click="$emit('retry')">重试</button>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.auth-status { width: min(440px, 100%); padding: 38px 32px; text-align: center; background: #ffffffc9; border: 1px solid #ffffffd9; border-radius: 24px; box-shadow: 0 22px 60px #33473d1c; backdrop-filter: blur(22px); }
.auth-status h1 { margin: 0 0 14px; color: #33473d; font-size: 22px; font-weight: 500; }
.auth-status p { margin: 0; color: #75877b; font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; user-select: text; }
.auth-status__actions { display: flex; justify-content: center; gap: 16px; margin-top: 30px; }
.auth-status__actions a, .auth-status__actions button { padding: .7em 1.7em; color: #33473d; font: inherit; font-size: 13px; text-decoration: none; cursor: pointer; background: #e8e8e8; border: 1px solid #e8e8e8; border-radius: .5em; box-shadow: 6px 6px 12px #c5c5c5, -6px -6px 12px #fff; transition: box-shadow .2s, color .2s; }
.auth-status__actions :is(a, button):hover { color: #1c6546; }
.auth-status__actions :is(a, button):active { box-shadow: inset 4px 4px 8px #c5c5c5, inset -4px -4px 8px #fff; }
.auth-status__actions :is(a, button):focus-visible { outline: 3px solid #7063d857; outline-offset: 4px; }
.auth-loading { display: flex; align-items: center; justify-content: center; }
.auth-loading__bars { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100px; height: 100px; }
.auth-loading__bars span { width: 4px; height: 50px; background: #4c86f9; animation: auth-loading-scale .9s ease-in-out infinite; }
.auth-loading__bars span:nth-child(2) { background: #49a84c; animation-delay: -.8s; }
.auth-loading__bars span:nth-child(3) { background: #f6bb02; animation-delay: -.7s; }
.auth-loading__bars span:nth-child(4) { background: #f6bb02; animation-delay: -.6s; }
.auth-loading__bars span:nth-child(5) { background: #2196f3; animation-delay: -.5s; }
.auth-status-enter-active, .auth-status-leave-active { transition: opacity .25s ease, transform .25s ease; }
.auth-status-enter-from, .auth-status-leave-to { opacity: 0; transform: translateY(6px); }
@keyframes auth-loading-scale { 0%, 40%, 100% { transform: scaleY(.05); } 20% { transform: scaleY(1); } }
@media (prefers-reduced-motion: reduce) { .auth-loading__bars span { animation: none; transform: scaleY(.4); } .auth-status-enter-active, .auth-status-leave-active { transition: none; } }
</style>
