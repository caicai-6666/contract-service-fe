<script setup>
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import CenteredLoading from './CenteredLoading.vue'

defineOptions({ inheritAttrs: false })
const props = defineProps({ active: Boolean, load: { type: Function, required: true }, label: { type: String, required: true } })
const page = shallowRef(null)
const loading = ref(false)
const failed = ref(false)
let revision = 0, timer

async function loadPage() {
  if (page.value || loading.value) return
  const current = ++revision
  loading.value = true
  failed.value = false
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (revision === current) { loading.value = false; failed.value = true }
  }, import.meta.env.DEV ? 60000 : 20000)
  try {
    const module = await props.load()
    // 首次访问后持续挂载，保留会话、校对与处理连接；旧身份的迟到模块不恢复页面。
    if (revision === current) { page.value = module.default; failed.value = false }
  } catch {
    if (revision === current) failed.value = true
  } finally {
    if (revision === current) { clearTimeout(timer); loading.value = false }
  }
}
watch(() => props.active, active => { if (active && !failed.value) void loadPage() }, { immediate: true })
onBeforeUnmount(() => { revision++; clearTimeout(timer) })
</script>

<template>
  <component :is="page" v-if="page" v-bind="$attrs" :active="active" />
  <div v-else-if="active" class="workspace-page-loading" :aria-busy="loading">
    <div v-if="failed" class="workspace-page-loading__error selectable-content" role="alert">
      <p>{{ label }}暂时无法加载，请重试。</p>
      <button type="button" @click="loadPage">重新尝试</button>
    </div>
    <CenteredLoading v-else :label="`正在加载${label}`" />
  </div>
</template>

<style scoped>
.workspace-page-loading { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; min-height: 240px; padding: 24px; box-sizing: border-box; }
.workspace-page-loading__error { color: #68746d; text-align: center; font-size: 14px; }
.workspace-page-loading__error button { padding: 8px 16px; border: 1px solid #d6e0d9; border-radius: 9px; background: #ffffffc9; color: #4b6053; font: inherit; cursor: pointer; }
.workspace-page-loading__error button:focus-visible { outline: 3px solid #7063d8; outline-offset: 3px; }
</style>
