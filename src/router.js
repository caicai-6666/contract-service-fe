import { createRouter, createWebHistory } from 'vue-router'

// 路由只维护地址与轨道位置；页面由 App 按首次访问加载并持续挂载。
const WorkspaceRoute = { name: 'WorkspaceRoute', render: () => null }
const routes = [
  { path: '/', redirect: '/library' },
  {
    path: '/library',
    name: 'contract-library',
    component: WorkspaceRoute,
    meta: { sectionIndex: 0 },
  },
  {
    path: '/ingestion',
    name: 'contract-ingestion',
    component: WorkspaceRoute,
    meta: { sectionIndex: 1 },
  },
  {
    path: '/network',
    name: 'contract-network',
    component: WorkspaceRoute,
    meta: { sectionIndex: 2 },
  },
  { path: '/:pathMatch(.*)*', redirect: '/library' },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
