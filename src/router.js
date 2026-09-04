import { createRouter, createWebHistory } from 'vue-router'
import ContractIngestionView from './components/ContractIngestionView.vue'
import ContractLibraryView from './components/ContractLibraryView.vue'

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

export default createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})
