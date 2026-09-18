import { createRouter, createWebHistory } from 'vue-router'
import ContractIngestionView from './components/ContractIngestionView.vue'
import ContractLibraryView from './components/ContractLibraryView.vue'
import ContractNetworkView from './components/ContractNetworkView.vue'

const routes = [
  { path: '/', redirect: '/library' },
  {
    path: '/library',
    name: 'contract-library',
    component: ContractLibraryView,
    meta: { sectionIndex: 0 },
  },
  {
    path: '/ingestion',
    name: 'contract-ingestion',
    component: ContractIngestionView,
    meta: { sectionIndex: 1 },
  },
  {
    path: '/network',
    name: 'contract-network',
    component: ContractNetworkView,
    meta: { sectionIndex: 2 },
  },
  { path: '/:pathMatch(.*)*', redirect: '/library' },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
