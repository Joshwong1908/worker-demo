// LLM 封装：Workers AI 流式调用
export const MODELS = [
  { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B · 均衡' },
  { id: '@cf/meta/llama-3.2-3b-instruct', name: 'Llama 3.2 3B · 最快' },
  { id: '@cf/qwen/qwen1.5-14b-chat-awq', name: 'Qwen 1.5 14B · 中文最佳' },
];

export const DEFAULT_MODEL = MODELS[0].id;

export async function* streamChat(env, { model, messages }) {
  const res = await env.AI.run(model || DEFAULT_MODEL, { messages, stream: true });
  for await (const chunk of res) {
    if (chunk?.response) yield chunk.response;
  }
}
