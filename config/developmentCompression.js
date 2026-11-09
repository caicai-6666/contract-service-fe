import compression from 'compression'

export function developmentCompression() {
  const compress = compression({
    threshold: 1024,
    level: 6,
    filter(_request, response) {
      const type = String(response.getHeader('Content-Type') || '')
      const cacheControl = String(response.getHeader('Cache-Control') || '')
      return response.statusCode === 200 && !/\bno-store\b/i.test(cacheControl) &&
        /^(?:text\/(?:html|css|javascript)|application\/(?:javascript|json)|image\/svg\+xml)(?:;|$)/i.test(type)
    },
  })
  return {
    name: 'contract-development-compression',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0] || ''
        // 文本资源在进入 FRP 前压缩，API、凭据和流式响应不经过此中间件。
        if (request.method !== 'GET' || request.headers.range ||
            !path.startsWith('/dev/knowledge-accumulation/contract/') ||
            /^\/dev\/knowledge-accumulation\/contract\/(?:api|__auth)(?:\/|$)/.test(path)) return next()
        compress(request, response, next)
      })
    },
  }
}
