'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  theme: localStorage.getItem('br-theme') || 'dark',
  activeFile: null,
  searchTimeout: null,
  squads: [],
  activeSquad: null,   // squad object
  activeAgent: null,   // agent object
  messages: [],
  streaming: false,
};

const $ = id => document.getElementById(id);

// ─── Theme ────────────────────────────────────────────────────────────────────
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const hl = $('hlTheme');
  if (hl) hl.href = t === 'light'
    ? 'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css'
    : 'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css';
  localStorage.setItem('br-theme', t);
  state.theme = t;
}
$('themeToggle').addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));
applyTheme(state.theme);

// ─── View switching ───────────────────────────────────────────────────────────
function switchView(v) {
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  document.querySelectorAll('.view-panel').forEach(p => p.classList.toggle('active', p.id === `view-${v}`));
  $('sidebar').classList.toggle('collapsed', v !== 'docs');
}
document.querySelectorAll('.view-tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));
window.switchView = switchView;

// ─── Sidebar toggle ───────────────────────────────────────────────────────────
$('sidebarToggle').addEventListener('click', () => {
  const s = $('sidebar');
  window.innerWidth <= 768 ? s.classList.toggle('mobile-open') : s.classList.toggle('collapsed');
});

// ─── Utils ────────────────────────────────────────────────────────────────────
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function extCls(ext) { return ({'.md':'ext-md','.yaml':'ext-yaml','.yml':'ext-yml','.json':'ext-json','.js':'ext-js','.ts':'ext-js','.html':'ext-html'})[ext]||'ext-other'; }
const fileIco = () => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>`;
const chevIco = () => `<svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9,6 15,12 9,18"/></svg>`;

// ─── Doc tree ─────────────────────────────────────────────────────────────────
function renderTree(node, container, depth = 0) {
  if (!node) return;
  if (node.type === 'file') {
    const el = document.createElement('div');
    el.className = 'tree-file';
    el.innerHTML = `${fileIco()}<span title="${node.path}">${esc(node.name)}</span><span class="ext-badge ${extCls(node.ext)}">${node.ext.slice(1)}</span>`;
    el.addEventListener('click', () => loadDoc(node.path, el));
    container.appendChild(el);
    return;
  }
  if (node.type === 'dir') {
    const wrap = document.createElement('div');
    const header = document.createElement('div');
    header.className = 'tree-dir-header';
    header.innerHTML = `${chevIco()}<span>${esc(node.name)}</span>`;
    const children = document.createElement('div');
    children.className = 'tree-dir-children';
    if (depth === 0) { header.classList.add('open'); children.classList.add('open'); }
    header.addEventListener('click', () => { header.classList.toggle('open'); children.classList.toggle('open'); });
    wrap.appendChild(header);
    wrap.appendChild(children);
    container.appendChild(wrap);
    for (const child of node.children || []) renderTree(child, children, depth + 1);
  }
}

async function loadTree() {
  try {
    const res = await fetch('/api/tree');
    const data = await res.json();
    const tree = $('treeDocs');
    tree.innerHTML = '';
    if (data.docs) renderTree(data.docs, tree);
    let docs = 0;
    function cntF(n) { if (!n) return; if (n.type==='file') docs++; (n.children||[]).forEach(cntF); }
    cntF(data.docs);
    $('statDocs').textContent = docs;
  } catch (err) {
    $('treeDocs').innerHTML = `<div class="tree-loading" style="color:var(--pink)">Erro: ${esc(err.message)}</div>`;
  }
}

async function loadDoc(filePath, el) {
  document.querySelectorAll('.tree-file.active').forEach(f => f.classList.remove('active'));
  if (el) el.classList.add('active');
  state.activeFile = filePath;
  $('welcome').style.display = 'none';
  $('docView').classList.remove('hidden');
  $('docBody').innerHTML = '<div class="tree-loading" style="padding:24px"><span class="spinner"></span> Carregando…</div>';
  const parts = filePath.split('/');
  $('docBreadcrumb').innerHTML = parts.map((p,i) => i===parts.length-1 ? `<span>${esc(p)}</span>` : `<span style="color:var(--muted)">${esc(p)}</span><span class="sep">/</span>`).join('');
  try {
    const res = await fetch(`/api/file?p=${encodeURIComponent(filePath)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    if (ext === '.md') {
      marked.setOptions({ highlight: (code, lang) => lang && hljs.getLanguage(lang) ? hljs.highlight(code,{language:lang}).value : hljs.highlightAuto(code).value, breaks: true, gfm: true });
      $('docBody').innerHTML = marked.parse(data.content);
      $('docBody').querySelectorAll('a[href^="http"]').forEach(a => { a.target='_blank'; a.rel='noopener noreferrer'; });
    } else {
      const pre = document.createElement('pre'); pre.className = 'raw-view';
      const code = document.createElement('code'); const lang = ext.slice(1);
      code.innerHTML = hljs.getLanguage(lang) ? hljs.highlight(data.content,{language:lang}).value : esc(data.content);
      pre.appendChild(code); $('docBody').innerHTML = ''; $('docBody').appendChild(pre);
    }
  } catch (err) { $('docBody').innerHTML = `<div style="padding:24px;color:var(--pink)">Erro: ${esc(err.message)}</div>`; }
}

$('copyPathBtn').addEventListener('click', () => {
  if (state.activeFile) { navigator.clipboard.writeText(state.activeFile).catch(()=>{}); $('copyPathBtn').style.color='var(--green)'; setTimeout(()=>{$('copyPathBtn').style.color='';},1200); }
});

// ─── Search ───────────────────────────────────────────────────────────────────
const searchInput = $('searchInput');
const searchOverlay = $('searchOverlay');
const searchResults = $('searchResults');
searchInput.addEventListener('focus', () => { if (searchInput.value.trim()) showSearch(); });
searchInput.addEventListener('input', () => {
  clearTimeout(state.searchTimeout);
  const q = searchInput.value.trim();
  if (!q) { hideSearch(); return; }
  state.searchTimeout = setTimeout(() => doSearch(q), 200);
});
searchInput.addEventListener('keydown', e => { if (e.key==='Escape') { hideSearch(); searchInput.blur(); } });
searchOverlay.addEventListener('click', e => { if (e.target===searchOverlay) hideSearch(); });
document.addEventListener('keydown', e => { if ((e.metaKey||e.ctrlKey) && e.key==='k') { e.preventDefault(); searchInput.focus(); searchInput.select(); } });
async function doSearch(q) {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`).catch(()=>null); if (!res) return;
  const data = await res.json();
  searchResults.innerHTML = data.results.length
    ? data.results.map(r=>`<div class="search-result-item" data-path="${esc(r.path)}"><div><div class="search-result-name">${esc(r.name)}</div><div class="search-result-path">${esc(r.path)}</div></div></div>`).join('')
    : `<div class="search-empty">Nenhum resultado para "<strong>${esc(q)}</strong>"</div>`;
  searchResults.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => { hideSearch(); searchInput.value=''; switchView('docs'); loadDoc(item.dataset.path, null); });
  });
  showSearch();
}
function showSearch() { searchOverlay.classList.add('visible'); }
function hideSearch() { searchOverlay.classList.remove('visible'); }

// ─── Squads ───────────────────────────────────────────────────────────────────
const SUGGESTIONS = {
  'copy-squad':      ['Escreva uma legenda para um post sobre comunicação no casal','Crie 5 headlines para um Reels sobre vida de casados','Escreva um CTA poderoso para o link da bio'],
  'storytelling':    ['Monte um arco de história para o casamento deles','Roteiro de Reels sobre como se conheceram pelo Tinder','Estrutura narrativa para série de conteúdo semanal'],
  'brand-squad':     ['Analise o posicionamento de marca do casal','Sugira pilares de conteúdo para o perfil deles','Como diferenciar a marca deles no nicho de casais?'],
  'traffic-masters': ['Estratégia de anúncios para crescer o Instagram deles','Como usar Meta Ads para o nicho de relacionamento','Otimize o funil de crescimento orgânico deles'],
  'advisory-board':  ['Conselho estratégico para monetização do casal','Como o casal deve pensar o próximo ano de conteúdo?','Avalie riscos e oportunidades para o projeto deles'],
  'hormozi-squad':   ['Crie uma oferta irresistível baseada no conteúdo deles','Como o Hormozi estruturaria o negócio desse casal?','Workshop de relacionamento: como monetizar?'],
  'data-squad':      ['Quais métricas acompanhar para crescer o perfil?','Estratégia de retenção de seguidores para criadores de casal','Como medir o engajamento real no nicho deles?'],
};

async function loadSquads() {
  try {
    const res = await fetch('/api/squads');
    state.squads = await res.json();
    $('statSquads').textContent = state.squads.length;
    renderSquadSelector();
  } catch (err) {
    $('squadSelector').innerHTML = `<div style="padding:12px;color:var(--pink);font-size:13px">Erro ao carregar squads</div>`;
  }
}

function renderSquadSelector() {
  const el = $('squadSelector');
  const grid = document.createElement('div');
  grid.className = 'squad-grid';
  for (const squad of state.squads) {
    const btn = document.createElement('button');
    btn.className = 'squad-btn';
    btn.dataset.id = squad.id;
    btn.innerHTML = `<span class="squad-icon">${squad.icon}</span>${squad.name}`;
    btn.title = squad.description;
    btn.addEventListener('click', () => selectSquad(squad));
    grid.appendChild(btn);
  }
  el.innerHTML = '';
  el.appendChild(grid);
}

function selectSquad(squad) {
  state.activeSquad = squad;
  state.activeAgent = null;
  state.messages = [];

  // Update squad buttons
  document.querySelectorAll('.squad-btn').forEach(b => b.classList.toggle('active', b.dataset.id === squad.id));

  // Render agent selector
  const as = $('agentSelector');
  const inner = $('agentSelectorInner');
  as.classList.remove('hidden');
  inner.innerHTML = `<span class="agent-label">Agente:</span>`;

  let prevTier = null;
  for (const agent of squad.agents) {
    if (prevTier !== null && prevTier === 0 && agent.tier !== 0) {
      const div = document.createElement('div');
      div.className = 'tier-divider';
      inner.appendChild(div);
    }
    const btn = document.createElement('button');
    btn.className = `agent-btn${agent.tier === 0 ? ' tier-0' : ''}`;
    btn.dataset.id = agent.id;
    btn.innerHTML = `${agent.icon} ${agent.name}`;
    btn.title = agent.whenToUse || agent.name;
    btn.addEventListener('click', () => selectAgent(agent, btn));
    inner.appendChild(btn);
    prevTier = agent.tier;
  }

  // Auto-select the tier-0 (orchestrator) agent if available
  const orchestrator = squad.agents.find(a => a.tier === 0) || squad.agents[0];
  if (orchestrator) {
    const btn = inner.querySelector(`[data-id="${orchestrator.id}"]`);
    selectAgent(orchestrator, btn);
  }
}

function selectAgent(agent, btn) {
  state.activeAgent = agent;
  state.messages = [];

  document.querySelectorAll('.agent-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  // Update context pill
  const pill = $('chatContextPill');
  pill.innerHTML = `<span class="context-pill">${state.activeSquad.icon} ${state.activeSquad.name} · ${agent.icon} ${agent.name}</span>`;

  // Enable send button
  $('sendBtn').disabled = false;

  // Show suggestions
  resetChat(agent);
}

function resetChat(agent) {
  const msgs = $('chatMessages');
  msgs.innerHTML = '';

  const welcome = document.createElement('div');
  welcome.className = 'chat-welcome';

  const icon = document.createElement('div');
  icon.className = 'chat-welcome-icon';
  icon.style.fontSize = '32px';
  icon.textContent = agent.icon;

  const p = document.createElement('p');
  p.innerHTML = `Você está conversando com <strong>${agent.name}</strong><br/><span style="font-size:12px;color:var(--subtle)">${state.activeSquad.icon} ${state.activeSquad.name}</span>`;

  welcome.appendChild(icon);
  welcome.appendChild(p);

  const suggestions = SUGGESTIONS[state.activeSquad.id];
  if (suggestions) {
    const sugg = document.createElement('div');
    sugg.className = 'chat-suggestions';
    for (const s of suggestions) {
      const btn = document.createElement('button');
      btn.className = 'suggestion';
      btn.textContent = s;
      btn.addEventListener('click', () => { chatInput.value = s; chatInput.focus(); autoResize(); });
      sugg.appendChild(btn);
    }
    welcome.appendChild(sugg);
  }

  msgs.appendChild(welcome);
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
const chatInput = $('chatInput');
const sendBtn = $('sendBtn');

function autoResize() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
}
chatInput.addEventListener('input', autoResize);
chatInput.addEventListener('keydown', e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
sendBtn.addEventListener('click', sendMessage);

function md(text) {
  marked.setOptions({ breaks: true, gfm: true });
  return marked.parse(text);
}

function appendUserMsg(text) {
  document.querySelectorAll('.chat-welcome').forEach(e => e.remove());
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-user';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);
  $('chatMessages').appendChild(wrap);
  scrollChat();
}

function appendStreamBubble() {
  document.querySelectorAll('.chat-welcome').forEach(e => e.remove());
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-assistant';
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = `${state.activeAgent.icon} ${state.activeAgent.name}`;
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  wrap.appendChild(meta);
  wrap.appendChild(bubble);
  $('chatMessages').appendChild(wrap);
  scrollChat();
  return bubble;
}

function scrollChat() { const m = $('chatMessages'); m.scrollTop = m.scrollHeight; }

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || state.streaming || !state.activeAgent) return;

  chatInput.value = '';
  autoResize();
  state.streaming = true;
  sendBtn.disabled = true;

  state.messages.push({ role: 'user', content: text });
  appendUserMsg(text);

  const bubble = appendStreamBubble();
  let fullText = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        squadId: state.activeSquad.id,
        agentId: state.activeAgent.id,
        messages: state.messages,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
      bubble.textContent = `⚠️ ${err.error}`;
      state.messages.pop();
      state.streaming = false;
      sendBtn.disabled = false;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) fullText += `\n⚠️ ${parsed.error}`;
          else if (parsed.text) fullText += parsed.text;
          bubble.innerHTML = md(fullText || '…');
          scrollChat();
        } catch (_) {}
      }
    }

    state.messages.push({ role: 'assistant', content: fullText });
  } catch (err) {
    bubble.textContent = `⚠️ Erro de conexão: ${err.message}`;
    state.messages.pop();
  }

  state.streaming = false;
  sendBtn.disabled = false;
  scrollChat();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadTree();
loadSquads();
