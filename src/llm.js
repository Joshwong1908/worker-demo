// LLM 封装：Workers AI 流式调用
// 兼容两种流格式：
// 1) 旧格式：对象 chunk {response: "..."}
// 2) 新格式(OpenAI 兼容)：Uint8Array 字节，内容为 SSE 文本 data: {"choices":[{"delta":{"content":"..."}}]}
export const MODELS = [
  { id: '@cf/meta/llama-3.2-3b-instruct', name: 'Llama 3.2 3B · 最快' },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B · 大杯' },
  { id: '@cf/openai/gpt-oss-20b', name: 'GPT-OSS 20B · OpenAI' },
];

export const DEFAULT_MODEL = MODELS[0].id;

export async function* streamChat(env, { model, messages }) {
  const res = await env.AI.run(model || DEFAULT_MODEL, { messages, stream: true });

  const dec = new TextDecoder();
  let buf = '';

  const handleLine = function* (line) {
    if (!line.startsWith('data: ')) return;
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') return;
    try {
      const d = JSON.parse(payload);
      const out = d.response ?? d.choices?.[0]?.delta?.content ?? '';
      if (out) yield out;
    } catch { /* 忽略半行 */ }
  };

  for await (const chunk of res) {
    let text;
    if (typeof chunk === 'string') {
      text = chunk;
    } else if (chunk instanceof Uint8Array) {
      text = dec.decode(chunk, { stream: true });
    } else if (chunk?.response !== undefined) {
      text = chunk.response;
    } else if (chunk?.choices?.[0]?.delta?.content) {
      text = chunk.choices[0].delta.content;
    } else {
      continue;
    }

    if (!text.includes('\n')) {
      // 可能是纯文本增量或 SSE 半行，先攒着
      buf += text;
      continue;
    }
    buf += text;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) yield* handleLine(line);
  }

  // 处理残余
  if (buf) yield* handleLine(buf.trim());
}
