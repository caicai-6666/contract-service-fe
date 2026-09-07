# Docker 部署

> 本文说明前端镜像的构建与运行。镜像只包含前端静态页面和 Nginx，不包含合同后端、数据库或检索服务。

## 构建与路径

在仓库根目录执行：

```bash
docker build -t contract-service-fe:local .
```

Dockerfile 使用 Node 24 安装锁文件中的依赖并构建，再将完整 `dist/` 复制到 Nginx 运行镜像。`prebuild` 自动生成 PDF.js 的 CMap、字体和 WASM 资源；本地 `node_modules/`、`dist/`、生成资源和 `.env` 文件不会进入构建上下文。运行镜像不包含项目源码或 Node 依赖。

容器构建显式使用 `/contract/` 作为 Vite 基础路径，不修改本地开发配置。页面入口为 `/contract/library`，API 为同源 `/contract/api/`；根路径跳转到 `/contract/`。外层反向代理应保留完整 `/contract/` 前缀，不沿用开发环境去除 `/dev` 的规则。

## 运行

后端位于宿主机时：

```bash
docker run -d --name contract-service-fe \
  -p 8080:80 \
  --add-host=host.docker.internal:host-gateway \
  -e BACKEND_UPSTREAM=host.docker.internal:20000 \
  contract-service-fe:local
```

访问 `http://localhost:8080/contract/library`。宿主机后端必须监听容器可达的地址；仅绑定宿主机 `127.0.0.1` 的服务通常不能通过宿主机网关访问。不要为此将后端无保护地暴露到公网。

后端也在 Docker 中时，将前后端加入同一自定义网络，并将 `BACKEND_UPSTREAM` 设置为后端容器名称及容器内端口。默认值 `contract-service:20000` 是部署约定，不代表已创建该后端；该名称必须能够在容器启动时解析，否则 Nginx 无法启动。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `BACKEND_UPSTREAM` | `contract-service:20000` | HTTP 后端的 `主机:端口`，不含协议、路径或尾斜杠 |
| `CLIENT_MAX_BODY_SIZE` | `100m` | Nginx 请求体上限，可按部署需要调整；不是后端业务限制 |

变量由 Nginx 官方镜像启动脚本写入配置，修改后需重建容器，不必重新构建镜像。只允许可信部署人员设置这些变量，不放入登录密钥。HTTPS 在外层网关终止；本镜像监听 HTTP 80。

## 转发与缓存边界

- API 保留原始路径、查询参数和 Authorization 请求头，不做 SPA 回退或共享缓存。
- 关闭代理响应缓冲以支持 SSE；读取超时为两次上游读取之间最长 3600 秒，而非任务总时长。外层网关也必须支持流式转发。
- 页面路由回退到 `index.html`；缺失的构建资源和 PDF.js 文件返回 404。
- 带内容哈希的 `assets/` 长期缓存；HTML 和未带版本路径的 PDF.js 资源要求重新验证，避免发布后读取旧资源。
- `/healthz` 仅验证 Nginx 存活，不表示后端可用。正式合同 PDF 通过鉴权 API 获取，不写入前端镜像。

配置机制参见 [Nginx 官方镜像模板脚本](https://github.com/nginx/docker-nginx/blob/master/entrypoint/20-envsubst-on-templates.sh)，SSE 缓冲行为参见 [Nginx 代理模块文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)。基础镜像使用版本系列标签，严格复现发布时应锁定已验证的镜像摘要。

## 验证

```bash
docker exec contract-service-fe nginx -t
curl -I http://localhost:8080/contract/library
curl -I http://localhost:8080/contract/ingestion
curl -i http://localhost:8080/contract/assets/missing.js
docker logs contract-service-fe
```

前两个页面应返回 HTML，缺失资源应返回 404。进一步在浏览器验证登录、页面刷新、PDF 封面与预览、上传和 SSE；后端未启动时 API 应返回网关错误而非 HTML 页面。
