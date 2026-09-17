// LLM 封装：Workers AI 流式调用
export const MODELS = [
  { id: '@cf/meta/llama-3.2-3b-instruct', name: 'Llama 3.2 3B · 最快' },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B · 大杯' },
  { id: '@cf/openai/gpt-oss-20b', name: 'GPT-OSS 20B · OpenAI' },
];

export const DEFAULT_MODEL = MODELS[0].id;

export async function* streamChat(env, { model, messages }) {
  const res = await env.AI.run(model || DEFAULT_MODEL, { messages, stream: true });
  for await (const chunk of res) {
    // 兼容多种流格式 + 调试原始 chunk
    const text =
      chunk?.response ??
      chunk?.choices?.[0]?.delta?.content ??
      (typeof chunk === 'string' ? chunk : '');
    yield text || `[debug:${JSON.stringify(chunk).slice(0, 120)}]`;
  }
}
