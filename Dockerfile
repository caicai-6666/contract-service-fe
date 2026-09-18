FROM node:24-alpine AS build

WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
# 容器使用正式路径；prebuild 会同步当前依赖版本的 PDF.js 资源。
RUN npm run build -- --base=/contract/

FROM nginx:stable-alpine AS runtime

ENV BACKEND_UPSTREAM=contract-service:20000 \
    CLIENT_MAX_BODY_SIZE=100m \
    ICON_CACHE_MAX_AGE=2592000 \
    NGINX_ENVSUBST_FILTER="^(BACKEND_UPSTREAM|CLIENT_MAX_BODY_SIZE|ICON_CACHE_MAX_AGE)$"

COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /workspace/dist /usr/share/nginx/html/contract

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
