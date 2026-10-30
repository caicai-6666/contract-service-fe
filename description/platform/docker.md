# Docker 部署

> 本文说明前端镜像的构建与运行。镜像只包含前端静态页面和 Nginx，不包含合同后端、数据库或检索服务。

## 构建与路径

在仓库根目录执行：

```bash
docker build -t contract-service-fe:local .
```

Dockerfile 使用 Node 24 安装锁文件中的依赖并构建，再将完整 `dist/` 复制到 Nginx 运行镜像。`prebuild` 自动生成 PDF.js 的 CMap、字体和 WASM 资源；本地 `node_modules/`、`dist/`、生成资源和 `.env` 文件不会进入构建上下文。运行镜像不包含项目源码或 Node 依赖。

容器构建显式使用 `/knowledge-accumulation/contract/` 作为 Vite 基础路径，不修改本地开发配置。页面入口为 `/knowledge-accumulation/contract/library`，API 为同源 `/knowledge-accumulation/contract/api/`；根路径跳转到 `/knowledge-accumulation/contract/`。外层反向代理应保留完整 `/knowledge-accumulation/contract/` 前缀。开发环境则保留完整 `/dev/knowledge-accumulation/contract/`，由开发后端提供同名 API 前缀。

统一入口与合同平台需使用相同协议、域名和端口，以共享 `localStorage.access_token`；网关同时转发 `/knowledge-accumulation/` 统一入口与本平台子路径。返回入口的链接由外层网关处理。

## 运行

后端位于宿主机且通过端口 `17000` 提供生产 API 前缀 `/knowledge-accumulation/contract/api` 时：

```bash
docker run -d --name contract-service-fe \
  -p 8080:80 \
  --add-host=host.docker.internal:host-gateway \
  -e BACKEND_UPSTREAM=host.docker.internal:17000 \
  contract-service-fe:local
```

访问 `http://localhost:8080/knowledge-accumulation/contract/library`。宿主机后端必须监听容器可达的地址；仅绑定宿主机 `127.0.0.1` 的服务通常不能通过宿主机网关访问。不要为此将后端无保护地暴露到公网。

直接运行后端 `app/main.py` 使用带 `/dev` 的开发 API 前缀，不能直接接入此生产 Nginx 示例；仅调整端口不会转换 API 路径。生产后端应使用 ASGI 入口且不设置 `APP_PATH_PREFIX=/dev`，具体启动方式由后端部署文档维护。本机开发使用 Vite 对接开发后端。

后端也在 Docker 中时，将前后端加入同一自定义网络，并将 `BACKEND_UPSTREAM` 设置为后端容器名称及容器内端口。默认值 `contract-service:20000` 是部署约定，不代表已创建该后端；该名称必须能够在容器启动时解析，否则 Nginx 无法启动。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `BACKEND_UPSTREAM` | `contract-service:20000` | HTTP 后端的 `主机:端口`，不含协议、路径或尾斜杠 |
| `ICON_CACHE_MAX_AGE` | `2592000` | 图片和图标的浏览器缓存秒数，默认 30 天；使用非负整数 |
| `CLIENT_MAX_BODY_SIZE` | `100m` | Nginx 请求体上限，可按部署需要调整；不是后端业务限制 |

仓库根目录的 [`nginx.conf`](../../nginx.conf) 是服务配置模板，Dockerfile 将其复制到 `/etc/nginx/templates/default.conf.template`，容器启动时替换环境变量并生成 `/etc/nginx/conf.d/default.conf`。它是 `server` 配置片段，不是用于替换 `/etc/nginx/nginx.conf` 的全局配置。

变量由 Nginx 官方镜像启动脚本写入配置，修改后需重建容器，不必重新构建镜像。只允许可信部署人员设置这些变量，不放入 access_token。HTTPS 在外层网关终止；本镜像监听 HTTP 80。

## 转发与缓存边界

- API 保留原始路径、查询参数和 Authorization 请求头，不做 SPA 回退或共享缓存。
- 关闭代理响应缓冲以支持 SSE；读取超时为两次上游读取之间最长 3600 秒，而非任务总时长。外层网关也必须支持流式转发。
- 页面路由回退到 `index.html`；缺失的构建资源和 PDF.js 文件返回 404。
- 图片图标构建时不内联到 JS，独立输出到 `assets/`，默认缓存 30 天并标记 `immutable`；内容更新后通过带内容哈希的新文件名获取新版本。JS/CSS 等其他带哈希资源仍缓存一年。组件内直接绘制的 SVG 无独立网络请求，随所属 JS 缓存。此行为使用 [Vite 图片内联配置](https://vite.dev/config/build-options.html#build-assetsinlinelimit)。
- `public/` 中固定文件名的图片（包括 SVG 图标）默认缓存 30 天，覆盖 AVIF、WebP、PNG、JPEG、GIF、SVG、ICO、BMP、TIFF 和 APNG。过期后可通过 ETag / Last-Modified 协商缓存；同名替换在有效期内可能仍显示旧图，需要立即更新时应更换文件名或引用 URL 的版本参数。缺失图片返回 404，不附加长期缓存头。
- HTML 和未带版本路径的 PDF.js 资源仍要求重新验证；API 和受保护的合同 PDF 不受图片缓存规则影响。以上配置仅针对 Docker 内的生产 Nginx，不修改开发服务器缓存；外层网关不应覆盖这些响应头。
- `/healthz` 仅验证 Nginx 存活，不表示后端可用。正式合同 PDF 通过鉴权 API 获取，不写入前端镜像。

配置机制参见 [Nginx 官方镜像模板脚本](https://github.com/nginx/docker-nginx/blob/master/entrypoint/20-envsubst-on-templates.sh)，SSE 缓冲行为参见 [Nginx 代理模块文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)。基础镜像使用版本系列标签，严格复现发布时应锁定已验证的镜像摘要。

## 验证

```bash
docker exec contract-service-fe nginx -t
curl -I http://localhost:8080/knowledge-accumulation/contract/library
curl -I http://localhost:8080/knowledge-accumulation/contract/ingestion
curl -i http://localhost:8080/knowledge-accumulation/contract/assets/missing.js
docker logs contract-service-fe
```

前两个页面应返回 HTML，缺失资源应返回 404。进一步在浏览器验证登录、页面刷新、PDF 封面与预览、上传和 SSE；后端未启动时 API 应返回网关错误而非 HTML 页面。

图片缓存检查应从页面或构建产物中取得真实资源 URL，用 `curl -I` 核对图片的 `Cache-Control` 默认包含 `max-age=2592000`，JS/CSS 包含 `max-age=31536000`，HTML 与 PDF.js 资源为 `no-cache`。覆盖 `ICON_CACHE_MAX_AGE` 并重新创建容器后，确认图片响应使用新值；同时检查缺失资源返回 404、API 不套用图片缓存。仓库不提供独立的图片缓存回归脚本，不能将这些检查视为构建自动完成。
