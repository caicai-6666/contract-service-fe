<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ContractIngestionView from './components/ContractIngestionView.vue'
import ContractLibraryView from './components/ContractLibraryView.vue'
import ContractNetworkView from './components/ContractNetworkView.vue'
import AuthenticationStatus from './components/AuthenticationStatus.vue'
import MolecularFieldBackground from './components/MolecularFieldBackground.vue'
import ReviewLogDialog from './components/ReviewLogDialog.vue'
import logoUrl from './assets/logo.webp'
import mailboxUrl from './assets/mailbox.webp'
import {
  ACCESS_TOKEN_STORAGE_KEY,
  AUTH_EXPIRED_EVENT,
  ACCESS_DENIED_EVENT,
  KNOWLEDGE_ENTRY_PATH,
  clearAuthSession,
  getAccessToken,
  fetchCurrentUser,
} from './services/contractApi.js'

const loginState = ref('loading')
const loginError = ref('')
const authSession = ref(null)
const visualEffectsPaused = ref(false)
const reviewLogOpen = ref(false)
const route = useRoute()
const router = useRouter()

const workspaceSections = [
  { label: '合同库', to: '/library' },
  { label: '处理流', to: '/ingestion' },
  { label: '关系网', to: '/network' },
]
const activeSection = computed(() => Number(route.meta.sectionIndex) || 0)

let loginRequestController = null
let activeToken = null

function resetWorkspace(state) {
  loginRequestController?.abort()
  loginRequestController = null
  clearAuthSession()
  authSession.value = null
  reviewLogOpen.value = false
  visualEffectsPaused.value = false
  loginError.value = ''
  loginState.value = state
}

async function authenticate() {
  activeToken = getAccessToken()
  resetWorkspace(activeToken ? 'loading' : 'missing')
  if (!activeToken) return

  const controller = new AbortController()
  loginRequestController = controller
  try {
    const session = await fetchCurrentUser({ signal: controller.signal })
    if (loginRequestController !== controller) return
    authSession.value = session
    loginState.value = 'success'
  } catch (error) {
    if (loginRequestController !== controller) return
    if (error?.name === 'AbortError') {
      if (!controller.signal.aborted) void authenticate()
      return
    }
    loginState.value = error?.status === 401 ? 'expired' : error?.status === 403 ? 'denied' : 'error'
    loginError.value = error instanceof TypeError
      ? '无法连接用户服务，请稍后重试。'
      : error?.message || '用户服务暂时不可用，请稍后重试。'
  } finally {
    if (loginRequestController === controller) loginRequestController = null
  }
}

function handleAuthExpired() {
  resetWorkspace(getAccessToken() ? 'expired' : 'missing')
}

function handleAccessDenied() {
  resetWorkspace('denied')
}

function handleTokenChange(event) {
  if (event?.type === 'storage' && event.key !== ACCESS_TOKEN_STORAGE_KEY && event.key !== null) return
  if (getAccessToken() !== activeToken) void authenticate()
}

function setVisualEffectsPaused(paused) {
  visualEffectsPaused.value = Boolean(paused)
}

function navigateToSection(section) {
  if (route.path === section.to) return
  router.push(section.to)
}

watch(() => route.fullPath, () => {
  visualEffectsPaused.value = false
  reviewLogOpen.value = false
})

window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
window.addEventListener(ACCESS_DENIED_EVENT, handleAccessDenied)
window.addEventListener('storage', handleTokenChange)
window.addEventListener('focus', handleTokenChange)
onMounted(authenticate)

onBeforeUnmount(() => {
  loginRequestController?.abort()
  window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
  window.removeEventListener(ACCESS_DENIED_EVENT, handleAccessDenied)
  window.removeEventListener('storage', handleTokenChange)
  window.removeEventListener('focus', handleTokenChange)
})
</script>

<template>
  <main class="welcome-page">
    <MolecularFieldBackground :paused="visualEffectsPaused" />

    <section v-if="loginState !== 'success'" class="welcome-page__stage">
      <AuthenticationStatus :state="loginState" :error="loginError" @retry="authenticate" />
    </section>

    <Transition name="workspace-enter" appear :css="loginState === 'success'">
      <section
        v-if="loginState === 'success'"
        :key="authSession.userId"
        class="prototype-workspace"
        aria-labelledby="workspace-title"
        data-molecular-field-block
      >
        <header class="prototype-workspace__header">
          <div class="prototype-workspace__brand">
            <span class="prototype-workspace__logo-wrap">
              <img :src="logoUrl" alt="" draggable="false" />
            </span>
            <strong id="workspace-title">现象合同智能管理平台</strong>
          </div>

          <nav
            class="prototype-workspace__nav"
            :style="{ '--workspace-nav-offset': `calc(${activeSection * 100}% + ${activeSection * 4}px)` }"
            aria-label="主要模块"
          >
            <span class="prototype-workspace__nav-slider" aria-hidden="true"></span>
            <button
              v-for="(section, index) in workspaceSections"
              :key="section.to"
              type="button"
              class="prototype-workspace__nav-item"
              :class="{ 'prototype-workspace__nav-item--active': activeSection === index }"
              :aria-current="activeSection === index ? 'page' : undefined"
              @click="navigateToSection(section)"
            >
              {{ section.label }}
            </button>
          </nav>

          <div class="prototype-workspace__identity">
            <span class="prototype-workspace__user" :title="authSession?.userName">
              {{ authSession?.userName }}
            </span>
            <button
              type="button"
              class="prototype-workspace__mailbox"
              aria-label="信箱：查看审核日志"
              aria-haspopup="dialog"
              :aria-expanded="reviewLogOpen"
              title="审核日志"
              @click="reviewLogOpen = true"
            >
              <img :src="mailboxUrl" alt="" draggable="false" />
            </button>
            <a
              :href="KNOWLEDGE_ENTRY_PATH"
              class="prototype-workspace__return"
              aria-label="返回知识沉淀"
              title="返回知识沉淀"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 7 4 12l5 5M4 12h11M14 5h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4" />
              </svg>
            </a>
          </div>
        </header>

        <div
          class="prototype-workspace__content"
          :class="{
            'prototype-workspace__content--contract-library': activeSection === 0,
            'prototype-workspace__content--contract-ingestion': activeSection === 1,
            'prototype-workspace__content--contract-network': activeSection === 2,
          }"
        >
          <div
            class="workspace-route-track"
            :style="{ transform: `translate3d(-${activeSection * 100}%, 0, 0)` }"
          >
            <section
              class="workspace-route-panel workspace-route-panel--library"
              :aria-hidden="activeSection !== 0"
              :inert="activeSection !== 0"
            >
              <ContractLibraryView
                :active="activeSection === 0"
              />
            </section>
            <section
              class="workspace-route-panel workspace-route-panel--ingestion"
              :aria-hidden="activeSection !== 1"
              :inert="activeSection !== 1"
            >
              <ContractIngestionView
                :active="activeSection === 1"
                @visual-pause-change="setVisualEffectsPaused"
              />
            </section>
            <section
              class="workspace-route-panel workspace-route-panel--network"
              :aria-hidden="activeSection !== 2"
              :inert="activeSection !== 2"
            >
              <ContractNetworkView :active="activeSection === 2" />
            </section>
          </div>
        </div>
        <ReviewLogDialog :open="reviewLogOpen" @close="reviewLogOpen = false" />
      </section>
    </Transition>
  </main>
</template>
