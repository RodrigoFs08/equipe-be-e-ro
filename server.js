'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3030;

const BASE = __dirname;
const DOCS_DIR  = process.env.DOCS_DIR   ? path.resolve(process.env.DOCS_DIR)   : path.join(BASE, 'docs');
const SQUADS_DIR = process.env.SQUADS_DIR ? path.resolve(process.env.SQUADS_DIR) : path.join(BASE, 'squads');

const READABLE_EXTS = new Set(['.md', '.yaml', '.yml', '.json', '.txt', '.html', '.js', '.ts']);

// ─── Briefing context (loaded once) ──────────────────────────────────────────
const briefingPath = path.join(DOCS_DIR, 'briefing.md');
const BRIEFING = fs.existsSync(briefingPath)
  ? fs.readFileSync(briefingPath, 'utf8').slice(0, 8000)
  : '';

// ─── Simple YAML field extractor (no external dep) ───────────────────────────
function ymlField(content, field) {
  const re = new RegExp(`^\\s*${field}:\\s*["']?(.+?)["']?\\s*$`, 'm');
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

function extractYamlBlock(content) {
  const m = content.match(/```yaml\n([\s\S]*?)```/);
  return m ? m[1] : '';
}

function agentField(agentMd, field) {
  const block = extractYamlBlock(agentMd);
  return ymlField(block, field);
}

// ─── Squad loader ─────────────────────────────────────────────────────────────
const SQUAD_ICONS = {
  'copy-squad':       '✍️',
  'brand-squad':      '🎨',
  'hormozi-squad':    '💰',
  'traffic-masters':  '📈',
  'advisory-board':   '🎩',
  'storytelling':     '📖',
  'cybersecurity':    '🔒',
  'data-squad':       '📊',
  'design-squad':     '🖌️',
  'c-level-squad':    '🏢',
  'movement':         '🌊',
  'claude-code-mastery': '🤖',
};

function loadSquads() {
  if (!fs.existsSync(SQUADS_DIR)) return [];

  return fs.readdirSync(SQUADS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(e => {
      const id = e.name;
      const dir = path.join(SQUADS_DIR, id);

      // Read squad.yaml for metadata
      let name = id, description = '';
      const configPath = path.join(dir, 'squad.yaml');
      if (fs.existsSync(configPath)) {
        const yml = fs.readFileSync(configPath, 'utf8');
        name = ymlField(yml, 'short-title') || id;
        description = ymlField(yml, 'description') || '';
      }

      // Discover agents from agents/ dir
      const agentsDir = path.join(dir, 'agents');
      const agents = [];
      if (fs.existsSync(agentsDir)) {
        for (const f of fs.readdirSync(agentsDir).filter(f => f.endsWith('.md')).sort()) {
          const agentId = f.replace('.md', '');
          const content = fs.readFileSync(path.join(agentsDir, f), 'utf8');
          const agentName = agentField(content, 'name') || agentId;
          const icon = agentField(content, 'icon') || '🤖';
          const tier = parseInt(agentField(content, 'tier') || '1', 10);
          const whenToUse = agentField(content, 'whenToUse') || '';
          agents.push({ id: agentId, name: agentName.replace(/['"]/g, ''), icon, tier, whenToUse });
        }
      }

      // Sort: tier 0 (orchestrators) first
      agents.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));

      return { id, name, icon: SQUAD_ICONS[id] || '🤖', description, agents };
    });
}

// ─── Cache squads at startup ──────────────────────────────────────────────────
let SQUADS_CACHE = [];
try {
  SQUADS_CACHE = loadSquads();
  console.log(`  Squads carregados: ${SQUADS_CACHE.map(s => s.id).join(', ')}`);
} catch (err) {
  console.error('  Erro ao carregar squads:', err.message);
}

function getAgentDefinition(squadId, agentId) {
  const agentFile = path.join(SQUADS_DIR, squadId, 'agents', `${agentId}.md`);
  if (!fs.existsSync(agentFile)) return null;
  return fs.readFileSync(agentFile, 'utf8');
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
app.use(express.json({ limit: '100kb' }));
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
  if (!content) return res.status(404).json({ error: 'Not found' });
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

// ─── Squads API ───────────────────────────────────────────────────────────────
app.get('/api/squads', (_req, res) => {
  res.json(SQUADS_CACHE.map(s => ({
    id: s.id, name: s.name, icon: s.icon, description: s.description,
    agents: s.agents.map(a => ({ id: a.id, name: a.name, icon: a.icon, tier: a.tier, whenToUse: a.whenToUse })),
  })));
});

// ─── Chat API (SSE streaming) ─────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, squadId, agentId } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Invalid messages' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurado.' });

  // Build system prompt from actual squad agent definition
  let systemPrompt = '';
  if (squadId && agentId) {
    const agentDef = getAgentDefinition(squadId, agentId);
    if (agentDef) {
      systemPrompt = `# CONTEXTO DO PROJETO\n\n${BRIEFING}\n\n---\n\n# DEFINIÇÃO DO AGENTE\n\n${agentDef}`;
    }
  }

  if (!systemPrompt) {
    systemPrompt = `Você é um assistente especializado para o projeto Beatriz & Rodrigo.\n\n${BRIEFING}`;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const client = new Anthropic({ apiKey });

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Equipe Beatriz & Rodrigo`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  Squads: ${SQUADS_CACHE.length} | Docs: ${DOCS_DIR}\n`);
});
