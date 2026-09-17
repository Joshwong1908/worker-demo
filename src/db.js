// 存储层：优先 D1（持久化），未绑定则降级内存（演示用，重启丢失）

export function createStore(env) {
  return env.DB ? createD1Store(env.DB) : createMemoryStore();
}

function pick(wf) {
  return {
    name: wf.name || '未命名工作流',
    system_prompt: wf.system_prompt || '',
    user_prompt: wf.user_prompt || '',
    model: wf.model || null,
  };
}

// ---------- D1 ----------
function createD1Store(db) {
  const ready = db
    .exec(`CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      system_prompt TEXT DEFAULT '',
      user_prompt TEXT NOT NULL,
      model TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`)
    .catch((e) => console.error('schema init failed:', e));

  return {
    async list() {
      await ready;
      const { results } = await db.prepare('SELECT * FROM workflows ORDER BY created_at DESC').all();
      return results;
    },
    async get(id) {
      await ready;
      return (await db.prepare('SELECT * FROM workflows WHERE id = ?').bind(id).first()) ?? null;
    },
    async create(wf) {
      await ready;
      const id = crypto.randomUUID();
      const row = { id, created_at: new Date().toISOString(), ...pick(wf) };
      await db
        .prepare('INSERT INTO workflows (id, name, system_prompt, user_prompt, model) VALUES (?, ?, ?, ?, ?)')
        .bind(id, row.name, row.system_prompt, row.user_prompt, row.model)
        .run();
      return row;
    },
    async update(id, wf) {
      await ready;
      const row = pick(wf);
      await db
        .prepare('UPDATE workflows SET name = ?, system_prompt = ?, user_prompt = ?, model = ? WHERE id = ?')
        .bind(row.name, row.system_prompt, row.user_prompt, row.model, id)
        .run();
      return { id, ...row };
    },
    async remove(id) {
      await ready;
      await db.prepare('DELETE FROM workflows WHERE id = ?').bind(id).run();
      return { ok: true };
    },
  };
}

// ---------- 内存降级 ----------
function createMemoryStore() {
  const g = globalThis.__flowai_store ?? (globalThis.__flowai_store = { map: new Map(), seq: 0 });
  return {
    async list() {
      return [...g.map.values()].sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
    },
    async get(id) { return g.map.get(id) ?? null; },
    async create(wf) {
      const id = 'wf-' + (++g.seq);
      const row = { id, created_at: new Date().toISOString(), ...pick(wf) };
      g.map.set(id, row);
      return row;
    },
    async update(id, wf) {
      const row = g.map.get(id);
      if (!row) return null;
      Object.assign(row, pick(wf));
      return row;
    },
    async remove(id) { g.map.delete(id); return { ok: true }; },
  };
}
