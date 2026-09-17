import { MODELS, DEFAULT_MODEL, streamChat } from './llm.js';
import { buildMessages } from './engine.js';
import { createStore } from './db.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

// 把 async generator 包成 SSE 流式响应
function sse(gen) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        for await (const text of gen) {
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ delta: text })}\n\n`));
        }
      } catch (e) {
        ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ error: e.message })}\n\n`));
      }
      ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
      ctrl.close();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 静态资源
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

    const store = createStore(env);

    try {
      // ---------- 模型列表 ----------
      if (path === '/api/models' && request.method === 'GET') {
        return json({ models: MODELS, default: DEFAULT_MODEL });
      }

      // ---------- 聊天（流式） ----------
      if (path === '/api/chat' && request.method === 'POST') {
        const { messages, model } = await request.json();
        if (!Array.isArray(messages) || messages.length === 0) {
          return json({ error: 'messages 不能为空' }, 400);
        }
        return sse(streamChat(env, { model, messages }));
      }

      // ---------- 工作流 CRUD ----------
      if (path === '/api/workflows') {
        if (request.method === 'GET') return json({ workflows: await store.list() });
        if (request.method === 'POST') {
          const wf = await request.json();
          return json(await store.create(wf), 201);
        }
      }

      // ---------- 运行工作流（流式），放在 /:id 之前匹配 ----------
      const runMatch = path.match(/^\/api\/workflows\/([^/]+)\/run$/);
      if (runMatch && request.method === 'POST') {
        const { variables } = await request.json();
        const wf = await store.get(runMatch[1]);
        if (!wf) return json({ error: '工作流不存在' }, 404);
        const messages = buildMessages(wf, variables || {});
        return sse(streamChat(env, { model: wf.model, messages }));
      }

      const idMatch = path.match(/^\/api\/workflows\/([^/]+)$/);
      if (idMatch) {
        const id = idMatch[1];
        if (request.method === 'GET') {
          const wf = await store.get(id);
          return wf ? json(wf) : json({ error: '工作流不存在' }, 404);
        }
        if (request.method === 'PUT') {
          const wf = await store.update(id, await request.json());
          return wf ? json(wf) : json({ error: '工作流不存在' }, 404);
        }
        if (request.method === 'DELETE') return json(await store.remove(id));
      }

      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};
