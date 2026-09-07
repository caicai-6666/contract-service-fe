# 现象合同智能管理平台前端

本仓库是“现象合同智能管理平台”的 Vue 3 前端项目，提供合同库、合同处理流和智能助手的用户界面与交互能力。

当前前端已接入审核用户登录与 Bearer 鉴权。合同库左侧是可交互的智能助手原型，右侧为预留区域；处理流支持合同上传、后台任务恢复、SSE 状态更新、审核校对和正式入库。具体行为和边界以 [`description/`](description/readme.md) 下的专题文档为准。

## 本地开发

安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

开发服务器固定监听 `0.0.0.0:20080`；端口被占用时直接启动失败。当前开发基础路径为 `/dev/contract/`，API 请求也依赖 Nginx 去除 `/dev` 前缀，因此完整联调应通过项目约定的 Nginx 入口访问，不直接使用 Vite 端口。

## PDF.js 运行时资源

项目使用 PDF.js 读取合同页数和封面。`dev` 和 `build` 命令执行前会自动运行：

```bash
npm run sync:pdfjs-assets
```

该命令从当前安装的 `pdfjs-dist` 同步 CMap、标准字体和 WASM 资源到 `public/pdfjs/`。该目录由脚本生成且不纳入版本控制；Vite 构建时会将其复制到 `dist/pdfjs/`。

## 生产构建

执行：

```bash
npm run build
```

构建产物输出到 `dist/`。部署时需保留完整目录，包括 `dist/pdfjs/` 中的 PDF.js 运行时资源。

## 项目文档

容器部署使用根目录 `Dockerfile`，构建及运行命令见 [Docker 部署](description/platform/docker.md)。

- 开发规范见 [`AGENTS.md`](AGENTS.md)。
- 项目原则与前端边界见 [`description/project.md`](description/project.md)。
- 文档导航见 [`description/readme.md`](description/readme.md)。
