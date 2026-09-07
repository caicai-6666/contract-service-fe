import { createRouter, createWebHistory } from 'vue-router'
import ContractIngestionView from './components/ContractIngestionView.vue'
import ContractLibraryView from './components/ContractLibraryView.vue'
import { getAuthSession } from './services/contractApi.js'
import { getContractPermissions } from './models/contractPermissions.js'

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
  { path: '/:pathMatch(.*)*', redirect: '/library' },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

router.beforeEach((to) => {
  if (to.name === 'contract-ingestion' && !getContractPermissions(getAuthSession()?.permissionLevel).canCreate) return '/library'
})

export default router
