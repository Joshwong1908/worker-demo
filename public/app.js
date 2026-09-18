/* ================= 状态 ================= */
const $ = (s) => document.querySelector(s);

const state = {
  tab: 'chat',
  models: [],
  sessions: JSON.parse(localStorage.getItem('flowai_sessions') || '[]'),
  activeSessionId: null,
  workflows: [],
  activeWf: null,        // 当前编辑的工作流对象
  streaming: false,
};

/* ================= 工具 ================= */
function saveSessions() {
  localStorage.setItem('flowai_sessions', JSON.stringify(state.sessions));
}
function activeSession() {
  return state.sessions.find((s) => s.id === state.activeSessionId);
}
function newSession() {
  const s = { id: 's-' + Date.now(), title: '新会话', messages: [], model: state.models[0]?.id || '' };
  state.sessions.unshift(s);
  state.activeSessionId = s.id;
  saveSessions();
}
function esc(t) {
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

/* SSE 流式请求：返回接收文本的 async generator */
async function* streamFetch(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || '请求失败');
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const part of parts) {
      const line = part.replace(/^data: /, '');
      if (line === '[DONE]') return;
      const data = JSON.parse(line);
      if (data.error) throw new Error(data.error);
      if (data.delta) yield data.delta;
    }
  }
}

/* ================= Tab 切换 ================= */
document.querySelectorAll('.tab').forEach((btn) => {
  btn.onclick = () => {
    state.tab = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + state.tab));
    if (state.tab === 'workflows') loadWorkflows();
  };
});

/* ================= 文档页目录 ================= */
document.querySelectorAll('.toc-link').forEach((a) => {
  a.onclick = (e) => {
    e.preventDefault();
    document.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth' });
  };
});

/* ================= 聊天 ================= */
async function initModels() {
  const data = await fetch('/api/models').then((r) => r.json());
  state.models = data.models;
  const sel = $('#modelSelect');
  sel.innerHTML = data.models.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  sel.value = data.default;
  sel.onchange = () => {
    const s = activeSession();
    if (s) { s.model = sel.value; saveSessions(); }
  };
}

function renderSessions() {
  const list = $('#sessionList');
  list.innerHTML = state.sessions
    .map(
      (s) => `
      <div class="session-item ${s.id === state.activeSessionId ? 'active' : ''}" data-id="${s.id}">
        <span class="title">${esc(s.title)}</span>
        <button class="del" title="删除">✕</button>
      </div>`
    )
    .join('');
  list.querySelectorAll('.session-item').forEach((el) => {
    el.onclick = (e) => {
      if (e.target.classList.contains('del')) {
        state.sessions = state.sessions.filter((s) => s.id !== el.dataset.id);
        if (state.activeSessionId === el.dataset.id) state.activeSessionId = state.sessions[0]?.id || null;
        saveSessions();
        renderSessions();
        renderMessages();
        return;
      }
      state.activeSessionId = el.dataset.id;
      const s = activeSession();
      if (s?.model) $('#modelSelect').value = s.model;
      renderSessions();
      renderMessages();
    };
  });
}

function renderMessages() {
  const box = $('#messages');
  const s = activeSession();
  if (!s || s.messages.length === 0) {
    box.innerHTML = `<div class="empty-hint"><h2>开始对话</h2><p>多会话管理 · 流式输出 · 模型可切换</p></div>`;
    return;
  }
  box.innerHTML = s.messages
    .map((m) => `
      <div class="msg ${m.role}">
        <div class="avatar">${m.role === 'user' ? '🧑' : '🤖'}</div>
        <div class="bubble ${m.error ? 'error' : ''}">${esc(m.content)}</div>
      </div>`)
    .join('');
  box.scrollTop = box.scrollHeight;
}

function appendStreamingMsg() {
  const box = $('#messages');
  const empty = box.querySelector('.empty-hint');
  if (empty) empty.remove();
  box.insertAdjacentHTML(
    'beforeend',
    `<div class="msg assistant"><div class="avatar">🤖</div><div class="bubble"><span class="text"></span><span class="cursor"></span></div></div>`
  );
  box.scrollTop = box.scrollHeight;
  return box.lastElementChild.querySelector('.text');
}

async function sendChat() {
  if (state.streaming) return;
  const input = $('#chatInput');
  const text = input.value.trim();
  if (!text) return;

  if (!activeSession()) { newSession(); renderSessions(); }
  const s = activeSession();
  s.model = $('#modelSelect').value;

  s.messages.push({ role: 'user', content: text });
  if (s.messages.length === 1) {
    s.title = text.slice(0, 18) || '新会话';
    renderSessions();
  }
  input.value = '';
  saveSessions();
  renderMessages();

  state.streaming = true;
  $('#sendBtn').disabled = true;
  const target = appendStreamingMsg();
  const reply = { role: 'assistant', content: '' };
  s.messages.push(reply);

  try {
    for await (const delta of streamFetch('/api/chat', { messages: s.messages.slice(0, -1), model: s.model })) {
      reply.content += delta;
      target.textContent = reply.content;
      $('#messages').scrollTop = $('#messages').scrollHeight;
    }
  } catch (e) {
    reply.content = '⚠ ' + e.message;
    reply.error = true;
    target.textContent = reply.content;
  }
  saveSessions();
  renderMessages();
  state.streaming = false;
  $('#sendBtn').disabled = false;
}

$('#sendBtn').onclick = sendChat;
$('#chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});
$('#newSessionBtn').onclick = () => { newSession(); renderSessions(); renderMessages(); };

/* ================= 工作流 ================= */
async function loadWorkflows() {
  const data = await fetch('/api/workflows').then((r) => r.json());
  state.workflows = data.workflows || [];
  $('#storageBadge').textContent = state.workflows[0]?.id?.startsWith('mem-')
    ? '💾 内存模式（重启丢失）'
    : '🗄️ D1 持久化';
  renderWfList();
}

function renderWfList() {
  const list = $('#wfList');
  list.innerHTML = state.workflows
    .map(
      (w) => `
      <div class="session-item ${state.activeWf?.id === w.id ? 'active' : ''}" data-id="${w.id}">
        <span class="title">${esc(w.name)}</span>
        <button class="del" title="删除">✕</button>
      </div>`
    )
    .join('');
  list.querySelectorAll('.session-item').forEach((el) => {
    el.onclick = async (e) => {
      if (e.target.classList.contains('del')) {
        await fetch('/api/workflows/' + el.dataset.id, { method: 'DELETE' });
        if (state.activeWf?.id === el.dataset.id) state.activeWf = null;
        await loadWorkflows();
        if (!state.activeWf) renderWfEditor();
        return;
      }
      const wf = state.workflows.find((w) => w.id === el.dataset.id);
      state.activeWf = { ...wf };
      renderWfList();
      renderWfEditor();
    };
  });
}

function blankWf() {
  return { name: '', system_prompt: '', user_prompt: '', model: state.models[0]?.id || '' };
}

function renderWfEditor() {
  const box = $('#wfEditor');
  const wf = state.activeWf;
  if (!wf) {
    box.innerHTML = `<div class="empty-hint"><h2>选择或新建工作流</h2><p>提示词模板 + 变量 + 模型 = 可复用的 AI 流程</p></div>`;
    return;
  }
  const vars = extractVars(wf.system_prompt, wf.user_prompt);
  box.innerHTML = `
    <div class="wf-form">
      <div class="row">
        <div class="field">
          <label>工作流名称</label>
          <input id="wfName" value="${esc(wf.name)}" placeholder="如：翻译助手、周报生成器" />
        </div>
        <div class="field">
          <label>模型</label>
          <select id="wfModel">
            ${state.models.map((m) => `<option value="${m.id}" ${wf.model === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <label>系统提示词（可选）</label>
        <textarea id="wfSystem" placeholder="你是一个专业翻译，将用户输入翻译为英文">${esc(wf.system_prompt)}</textarea>
      </div>
      <div class="field">
        <label>用户提示词模板</label>
        <textarea id="wfUser" placeholder="请翻译以下内容：{{text}}">${esc(wf.user_prompt)}</textarea>
        <div class="hint">用 <code>{{变量名}}</code> 插入变量，例如 <code>{{text}}</code>、<code>{{topic}}</code></div>
      </div>
      <div class="field">
        <label>输入变量（自动从模板提取）</label>
        <div class="vars-grid" id="wfVars">
          ${vars.length ? vars.map((v) => `<input data-var="${v}" placeholder="${v}" />`).join('') : '<div class="hint" style="grid-column:1/-1">模板中暂无变量</div>'}
        </div>
      </div>
      <div class="wf-actions">
        <button class="btn primary" id="wfSaveBtn">💾 保存</button>
        <button class="btn ghost" id="wfRunBtn">▶ 运行</button>
        ${wf.id ? '<button class="btn danger" id="wfDelBtn">删除</button>' : ''}
      </div>
      <div class="field">
        <label>运行结果</label>
        <div class="run-result" id="wfResult"><span class="label">stdout</span>等待运行…</div>
      </div>
    </div>`;

  // 输入时实时刷新变量表单
  const refreshVars = () => {
    const nowVars = extractVars($('#wfSystem').value, $('#wfUser').value);
    const grid = $('#wfVars');
    const old = {};
    grid.querySelectorAll('input[data-var]').forEach((i) => (old[i.dataset.var] = i.value));
    grid.innerHTML = nowVars.length
      ? nowVars.map((v) => `<input data-var="${v}" placeholder="${v}" value="${esc(old[v] || '')}" />`).join('')
      : '<div class="hint" style="grid-column:1/-1">模板中暂无变量</div>';
  };
  $('#wfSystem').oninput = refreshVars;
  $('#wfUser').oninput = refreshVars;

  const collect = () => ({
    name: $('#wfName').value.trim() || '未命名工作流',
    system_prompt: $('#wfSystem').value,
    user_prompt: $('#wfUser').value,
    model: $('#wfModel').value,
  });

  $('#wfSaveBtn').onclick = async () => {
    const body = collect();
    if (!body.user_prompt.trim()) return alert('用户提示词不能为空');
    const res = await fetch(wf.id ? '/api/workflows/' + wf.id : '/api/workflows', {
      method: wf.id ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const saved = await res.json();
    state.activeWf = { ...saved };
    await loadWorkflows();
    renderWfEditor();
  };

  $('#wfRunBtn').onclick = async () => {
    const variables = {};
    $('#wfVars').querySelectorAll('input[data-var]').forEach((i) => (variables[i.dataset.var] = i.value));
    const result = $('#wfResult');
    result.innerHTML = '<span class="label">stdout</span><span class="out"></span><span class="cursor"></span>';
    const out = result.querySelector('.out');
    if (!wf.id) { out.textContent = '⚠ 请先保存工作流再运行'; return; }
    try {
      for await (const delta of streamFetch(`/api/workflows/${wf.id}/run`, { variables })) {
        out.textContent += delta;
      }
    } catch (e) {
      out.textContent = '⚠ ' + e.message;
    }
  };

  const delBtn = $('#wfDelBtn');
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm('确定删除该工作流？')) return;
    await fetch('/api/workflows/' + wf.id, { method: 'DELETE' });
    state.activeWf = null;
    await loadWorkflows();
    renderWfEditor();
  };
}

function extractVars(...tpls) {
  const set = new Set();
  for (const t of tpls) {
    if (!t) continue;
    for (const m of t.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) set.add(m[1]);
  }
  return [...set];
}

$('#newWfBtn').onclick = () => {
  state.activeWf = blankWf();
  renderWfList();
  renderWfEditor();
};

/* ================= 启动 ================= */
(async function init() {
  await initModels();
  if (!state.sessions.length) newSession();
  renderSessions();
  renderMessages();
})();
