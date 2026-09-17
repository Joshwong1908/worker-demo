export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 动态 API：/api/time
    if (url.pathname === '/api/time') {
      return Response.json({
        now: new Date().toISOString(),
        timezone: 'UTC',
        message: '这个 JSON 由 Cloudflare 全球边缘节点实时生成',
      });
    }

    // 其他请求全部走静态资源（public/ 目录）
    return env.ASSETS.fetch(request);
  },
};
