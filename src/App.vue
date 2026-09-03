<script setup>
import { onBeforeUnmount, ref } from 'vue'
import ContractIngestionView from './components/ContractIngestionView.vue'
import ContractLibraryView from './components/ContractLibraryView.vue'
import LoginCard from './components/LoginCard.vue'
import MolecularFieldBackground from './components/MolecularFieldBackground.vue'
import logoUrl from './assets/logo.webp'
import {
  AUTH_EXPIRED_EVENT,
  clearAuthSession,
  getAuthSession,
  loginWithSecretKey,
} from './services/contractApi.js'

const initialAuthSession = getAuthSession()
const loginState = ref(initialAuthSession ? 'success' : 'idle')
const loginError = ref('')
const loginNotice = ref('')
const authSession = ref(initialAuthSession)
const activeSection = ref(0)
const visualEffectsPaused = ref(false)

const workspaceSections = ['合同库', '处理流']

let loginRequestController = null

async function login(secretKey) {
  if (loginState.value === 'loading') return

  loginState.value = 'loading'
  loginError.value = ''
  loginNotice.value = ''
  loginRequestController?.abort()
  const requestController = new AbortController()
  loginRequestController = requestController

  try {
    authSession.value = await loginWithSecretKey(secretKey, {
      signal: requestController.signal,
    })
    loginState.value = 'success'
  } catch (error) {
    if (error?.name === 'AbortError') return
    loginState.value = 'error'
    loginError.value = error instanceof TypeError
      ? '无法连接登录服务，请稍后重试'
      : error?.message || '登录失败，请稍后重试'
  } finally {
    if (loginRequestController === requestController) loginRequestController = null
  }
}

function clearLoginMessage() {
  loginError.value = ''
  loginNotice.value = ''
}

function logout({ expired = false } = {}) {
  loginRequestController?.abort()
  loginRequestController = null
  clearAuthSession()
  authSession.value = null
  loginState.value = 'idle'
  loginError.value = ''
  loginNotice.value = expired ? '登录状态已失效，请重新登录' : ''
  activeSection.value = 0
  visualEffectsPaused.value = false
}

function handleAuthExpired() {
  logout({ expired: true })
}

function setVisualEffectsPaused(paused) {
  visualEffectsPaused.value = Boolean(paused)
}

window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)

onBeforeUnmount(() => {
  loginRequestController?.abort()
  window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
})
</script>

<template>
  <main class="welcome-page">
    <MolecularFieldBackground :paused="visualEffectsPaused" />

    <section v-if="loginState !== 'success'" class="welcome-page__stage">
      <LoginCard
        :loading="loginState === 'loading'"
        :error="loginError"
        :notice="loginNotice"
        @input="clearLoginMessage"
        @submit="login"
      />
    </section>

    <Transition name="workspace-enter" appear>
      <section
        v-if="loginState === 'success'"
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
              :key="section"
              type="button"
              class="prototype-workspace__nav-item"
              :class="{ 'prototype-workspace__nav-item--active': activeSection === index }"
              :aria-current="activeSection === index ? 'page' : undefined"
              @click="activeSection = index"
            >
              {{ section }}
            </button>
          </nav>

          <div class="prototype-workspace__identity">
            <span class="prototype-workspace__user" :title="authSession?.userName">
              {{ authSession?.userName }}
            </span>
            <button
              type="button"
              class="prototype-workspace__logout"
              aria-label="退出登录"
              title="退出登录"
              @click="logout"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 7 4 12l5 5M4 12h11M14 5h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4" />
              </svg>
            </button>
          </div>
        </header>

        <div
          class="prototype-workspace__content"
          :class="{
            'prototype-workspace__content--contract-library': activeSection === 0,
            'prototype-workspace__content--contract-ingestion': activeSection === 1,
          }"
        >
          <ContractLibraryView
            v-if="activeSection === 0"
            @visual-pause-change="setVisualEffectsPaused"
          />
          <ContractIngestionView
            v-else
            @visual-pause-change="setVisualEffectsPaused"
          />
        </div>
      </section>
    </Transition>
  </main>
</template>
