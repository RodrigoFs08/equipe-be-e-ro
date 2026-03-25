'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3030;

// ─── Paths ────────────────────────────────────────────────────────────────────
// AIOS_CORE_DIR é o projeto raiz onde o claude roda (onde está o CLAUDE.md, squads, etc.)
const AIOS_CORE_DIR = process.env.AIOS_CORE_DIR
  ? path.resolve(process.env.AIOS_CORE_DIR)
  : path.resolve(__dirname, '../../Downloads/beatriz-rodrigo/aios-core');

const DOCS_DIR = path.join(AIOS_CORE_DIR, 'docs');

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

const READABLE_EXTS = new Set(['.md', '.yaml', '.yml', '.json', '.txt', '.html', '.js', '.ts']);

// ─── File watcher clients (SSE) ───────────────────────────────────────────────
const watchClients = new Set();

function notifyWatchers(event, filePath) {
  const msg = `data: ${JSON.stringify({ event, path: filePath })}\n\n`;
  for (const res of watchClients) {
    try { res.write(msg); } catch (_) {}
  }
}

// Watch AIOS_CORE_DIR docs dir for any .md changes
if (fs.existsSync(DOCS_DIR)) {
  try {
    fs.watch(DOCS_DIR, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const ext = path.extname(filename).toLowerCase();
      if (!READABLE_EXTS.has(ext)) return;
      notifyWatchers(eventType, filename);
    });
  } catch (err) {
    console.warn('  fs.watch não disponível:', err.message);
  }
}

// ─── Doc helpers ─────────────────────────────────────────────────────────────
function buildTree(dir, label, relBase = '') {
  if (!fs.existsSync(dir)) return null;
  const children = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const sub = buildTree(path.join(dir, e.name), e.name, rel);
      if (sub && sub.children.length) children.push(sub);
    } else {
      const ext = path.extname(e.name).toLowerCase();
      if (READABLE_EXTS.has(ext)) children.push({ type: 'file', name: e.name, path: rel, ext });
    }
  }
  return { type: 'dir', name: label, path: relBase, children };
}

function safeRead(relPath, base) {
  const full = path.resolve(base, relPath);
  if (!full.startsWith(base) || !fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Docs API ─────────────────────────────────────────────────────────────────
app.get('/api/tree', (_req, res) => {
  try { res.json({ docs: buildTree(DOCS_DIR, 'docs', '') }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/file', (req, res) => {
  const { p } = req.query;
  if (!p) return res.status(400).json({ error: 'Missing path' });
  const content = safeRead(p, DOCS_DIR);
  if (content === null) return res.status(404).json({ error: 'Not found' });
  res.json({ content, path: p });
});

app.get('/api/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [] });
  const term = q.toLowerCase();
  const results = [];
  function walk(dir, relBase) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(path.join(dir, e.name), rel); }
      else if (READABLE_EXTS.has(path.extname(e.name).toLowerCase()) && e.name.toLowerCase().includes(term)) {
        results.push({ name: e.name, path: rel });
      }
    }
  }
  walk(DOCS_DIR, '');
  res.json({ results: results.slice(0, 40) });
});

// ─── File watcher SSE ─────────────────────────────────────────────────────────
app.get('/api/watch', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('data: {"event":"connected"}\n\n');

  watchClients.add(res);

  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    watchClients.delete(res);
  });
});

// ─── Config API ───────────────────────────────────────────────────────────────
app.get('/api/config', (_req, res) => {
  res.json({
    aiosCoreDir: AIOS_CORE_DIR,
    docsDir: DOCS_DIR,
    claudeBin: CLAUDE_BIN,
    ready: fs.existsSync(AIOS_CORE_DIR),
  });
});

// ─── Claude CLI — streaming chat ──────────────────────────────────────────────
// POST /api/claude
// Body: { message: string, sessionId?: string }
// Response: SSE stream (stream-json events)
app.post('/api/claude', (req, res) => {
  const { message, sessionId } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  if (!fs.existsSync(AIOS_CORE_DIR)) {
    return res.status(500).json({
      error: `AIOS_CORE_DIR não encontrado: ${AIOS_CORE_DIR}. Configure a variável AIOS_CORE_DIR.`,
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Build claude args
  const args = [
    '--print', message,
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--permission-mode', 'bypassPermissions',
  ];

  // Session continuity
  if (sessionId) {
    args.push('--resume', sessionId);
  }

  const proc = spawn(CLAUDE_BIN, args, {
    cwd: AIOS_CORE_DIR,
    env: { ...process.env, PATH: process.env.PATH },
  });

  let buf = '';
  let currentToolUseId = null;

  function send(obj) {
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch (_) {}
  }

  proc.stdout.on('data', chunk => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (!line.trim()) continue;

      let parsed;
      try { parsed = JSON.parse(line); }
      catch (_) {
        // Non-JSON output: send as raw text
        send({ type: 'text', text: line + '\n' });
        continue;
      }

      const t = parsed.type;

      // Assistant message (may contain text + tool_use blocks)
      if (t === 'assistant') {
        for (const block of parsed.message?.content || []) {
          if (block.type === 'text' && block.text) {
            send({ type: 'text', text: block.text });
          } else if (block.type === 'tool_use') {
            currentToolUseId = block.id;
            send({ type: 'tool_use', name: block.name, input: block.input, id: block.id });
          }
        }
      }

      // Tool result
      else if (t === 'tool') {
        for (const c of parsed.content || []) {
          if (c.type === 'tool_result') {
            send({ type: 'tool_result', tool_use_id: parsed.tool_use_id, content: c.content });
          }
        }
      }

      // Session result (end)
      else if (t === 'result') {
        send({
          type: 'result',
          subtype: parsed.subtype,
          session_id: parsed.session_id,
          cost_usd: parsed.cost_usd,
          error: parsed.error,
        });
      }

      // System init
      else if (t === 'system' && parsed.subtype === 'init') {
        send({ type: 'system_init', session_id: parsed.session_id, tools: parsed.tools });
      }
    }
  });

  proc.stderr.on('data', chunk => {
    const text = chunk.toString();
    // Filter out noise; send meaningful errors
    if (text.includes('Error') || text.includes('error')) {
      send({ type: 'error', text });
    }
  });

  proc.on('error', err => {
    send({ type: 'error', text: `Falha ao iniciar claude: ${err.message}. Verifique se o claude CLI está instalado e autenticado.` });
    send({ type: 'done' });
    res.end();
  });

  proc.on('close', code => {
    if (buf.trim()) {
      try { const last = JSON.parse(buf); if (last.type === 'result') send({ type: 'result', session_id: last.session_id, subtype: last.subtype }); }
      catch (_) {}
    }
    send({ type: 'done' });
    res.end();
  });

  req.on('close', () => {
    try { proc.kill('SIGTERM'); } catch (_) {}
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Equipe Beatriz & Rodrigo`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  AIOS Core: ${AIOS_CORE_DIR} ${fs.existsSync(AIOS_CORE_DIR) ? '✓' : '✗ NÃO ENCONTRADO'}`);
  console.log(`  Claude:    ${CLAUDE_BIN}\n`);
});
