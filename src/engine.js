// 工作流引擎：{{变量}} 模板渲染
export function extractVars(...templates) {
  const set = new Set();
  for (const tpl of templates) {
    if (!tpl) continue;
    for (const m of tpl.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) set.add(m[1]);
  }
  return [...set];
}

export function renderTemplate(tpl, vars = {}) {
  return (tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) =>
    vars[k] !== undefined && vars[k] !== '' ? vars[k] : m
  );
}

// 组装工作流消息
export function buildMessages(workflow, variables) {
  const messages = [];
  if (workflow.system_prompt) {
    messages.push({ role: 'system', content: renderTemplate(workflow.system_prompt, variables) });
  }
  messages.push({ role: 'user', content: renderTemplate(workflow.user_prompt, variables) });
  return messages;
}
