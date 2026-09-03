# 现象合同智能管理平台前端

当前项目处于原型设计阶段。登录页暂未接入认证接口，输入任意非空管理密钥即可进入原型工作台。

“合同库”工作台当前采用左右分区：左侧为可交互的合同智能助手原型，右侧预留 Three.js 合同文件柜区域。

“现象合同智能管理平台”是集合同管理、合同处理和合同智能助手于一体的工具。本仓库仅包含该平台的前端项目。

## 开发命令

安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

开发服务器固定监听 `127.0.0.1:10080`；端口被占用时直接启动失败，不会自动切换端口。

生产构建：

```bash
npm run build
```

## 项目文档

- 开发规范见 [`AGENTS.md`](AGENTS.md)。
- 项目原则与前端边界见 [`description/project.md`](description/project.md)。
- 文档导航见 [`description/readme.md`](description/readme.md)。
