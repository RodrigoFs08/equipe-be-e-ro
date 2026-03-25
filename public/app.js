'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  theme: localStorage.getItem('br-theme') || 'dark',
  activeFile: null,
  searchTimeout: null,
  sessionId: null,
  streaming: false,
  currentAssistantBubble: null,
  currentAssistantText: '',
  watchEs: null,
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

$('sidebarToggle').addEventListener('click', () => {
  const s = $('sidebar');
  window.innerWidth <= 768 ? s.classList.toggle('mobile-open') : s.classList.toggle('collapsed');
});

// ─── Config ───────────────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    $('terminalCwd').textContent = cfg.aiosCoreDir || '';
    if (!cfg.ready) {
      $('termStatus').textContent = `⚠ AIOS_CORE_DIR não encontrado: ${cfg.aiosCoreDir}`;
      $('termStatus').style.color = 'var(--pink)';
    }
  } catch (_) {}
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function extCls(ext) {
  return ({'.md':'ext-md','.yaml':'ext-yaml','.yml':'ext-yml','.json':'ext-json','.js':'ext-js','.ts':'ext-js','.html':'ext-html'})[ext]||'ext-other';
}
const fileIco = () => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>`;
const chevIco = () => `<svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9,6 15,12 9,18"/></svg>`;

function renderMd(text) {
  marked.setOptions({
    highlight: (code, lang) => lang && hljs.getLanguage(lang) ? hljs.highlight(code,{language:lang}).value : hljs.highlightAuto(code).value,
    breaks: true, gfm: true,
  });
  return marked.parse(text);
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, icon = '📄') {
  const t = $('toast');
  t.innerHTML = `${icon} ${esc(msg)}`;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 4000);
}

// ─── Doc tree ─────────────────────────────────────────────────────────────────
function renderTree(node, container, depth = 0) {
  if (!node) return;
  if (node.type === 'file') {
    const el = document.createElement('div');
    el.className = 'tree-file';
    el.dataset.path = node.path;
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

async function loadTree(highlightPath) {
  try {
    const res = await fetch('/api/tree');
    const data = await res.json();
    const tree = $('treeDocs');
    tree.innerHTML = '';
    if (data.docs) renderTree(data.docs, tree);

    // Count docs
    let count = 0;
    function cnt(n) { if (!n) return; if (n.type==='file') count++; (n.children||[]).forEach(cnt); }
    cnt(data.docs);
    $('statDocs').textContent = count;

    // Highlight newly created file
    if (highlightPath) {
      setTimeout(() => {
        const el = tree.querySelector(`[data-path="${highlightPath}"]`);
        if (el) { el.classList.add('new-file'); el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      }, 100);
    }
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
      $('docBody').innerHTML = renderMd(data.content);
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

// ─── File watcher ─────────────────────────────────────────────────────────────
function startWatcher() {
  if (state.watchEs) state.watchEs.close();
  const es = new EventSource('/api/watch');
  state.watchEs = es;

  es.onmessage = e => {
    try {
      const data = JSON.parse(e.data);
      if (data.event === 'connected') {
        $('watchDot').classList.add('active');
        return;
      }
      if (data.event === 'rename' || data.event === 'change') {
        // Reload tree and highlight the changed file
        const fname = data.path ? data.path.split('/').pop() : '';
        loadTree(data.path);
        if (data.event === 'rename' && fname) {
          showToast(`Arquivo criado: ${fname}`, '📄');
        }
      }
    } catch (_) {}
  };

  es.onerror = () => {
    $('watchDot').classList.remove('active');
    setTimeout(startWatcher, 5000);
  };
}

// ─── Terminal / Claude Code ───────────────────────────────────────────────────
const termMessages = $('terminalMessages');
const termInput = $('termInput');
const sendBtn = $('sendBtn');

// New session
$('newSessionBtn').addEventListener('click', () => {
  state.sessionId = null;
  state.streaming = false;
  $('sessionBadge').classList.add('hidden');
  termMessages.innerHTML = '';
  // Re-add welcome
  const w = document.createElement('div');
  w.className = 'term-welcome';
  w.id = 'termWelcome';
  w.innerHTML = `<p style="color:var(--muted);font-size:13px">Nova conversa iniciada. O que você precisa?</p>`;
  termMessages.appendChild(w);
  termInput.focus();
});

// Suggestions
document.querySelectorAll('.term-sugg').forEach(s => {
  s.addEventListener('click', () => { termInput.value = s.textContent; termInput.focus(); autoResize(); });
});

function autoResize() {
  termInput.style.height = 'auto';
  termInput.style.height = Math.min(termInput.scrollHeight, 200) + 'px';
}
termInput.addEventListener('input', autoResize);
termInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  if (e.key === 'Escape' && state.streaming) { /* Could add cancel logic */ }
});
sendBtn.addEventListener('click', sendMessage);

function scrollTerm() { termMessages.scrollTop = termMessages.scrollHeight; }

// Tool use metadata
const TOOL_STYLES = {
  Write:  { cls: 'tool-write', icon: '📝', label: (inp) => `Escrevendo: ${inp.file_path || ''}` },
  Edit:   { cls: 'tool-edit',  icon: '✏️', label: (inp) => `Editando: ${inp.file_path || ''}` },
  Read:   { cls: 'tool-read',  icon: '👁', label: (inp) => `Lendo: ${inp.file_path || ''}` },
  Bash:   { cls: 'tool-bash',  icon: '💻', label: (inp) => `$ ${(inp.command || '').slice(0,80)}` },
  Glob:   { cls: '',           icon: '🔍', label: (inp) => `Buscando: ${inp.pattern || ''}` },
  Grep:   { cls: '',           icon: '🔍', label: (inp) => `Grep: ${inp.pattern || ''}` },
  Task:   { cls: '',           icon: '📋', label: (inp) => `Task: ${inp.description || ''}` },
  Agent:  { cls: '',           icon: '🤖', label: (inp) => `Agente: ${inp.description || ''}` },
};

function makeToolIndicator(name, input) {
  const s = TOOL_STYLES[name] || { cls: '', icon: '⚙️', label: () => name };
  const el = document.createElement('div');
  el.className = `tool-use ${s.cls}`;
  el.innerHTML = `<span class="tool-use-icon">${s.icon}</span><span>${esc(s.label(input || {}))}</span>`;
  return el;
}

function appendUserTurn(text) {
  // Remove welcome on first message
  const w = document.querySelector('.term-welcome');
  if (w) w.remove();

  // Divider between turns (except first)
  if (termMessages.children.length > 0) {
    const hr = document.createElement('hr');
    hr.className = 'turn-divider';
    termMessages.appendChild(hr);
  }

  const wrap = document.createElement('div');
  wrap.className = 'term-msg term-msg-user';
  const prompt = document.createElement('span');
  prompt.className = 'prompt';
  prompt.textContent = '›';
  const txt = document.createElement('span');
  txt.className = 'user-text';
  txt.textContent = text;
  wrap.appendChild(prompt);
  wrap.appendChild(txt);
  termMessages.appendChild(wrap);
  scrollTerm();
}

function startAssistantTurn() {
  const wrap = document.createElement('div');
  wrap.className = 'term-msg term-msg-assistant';
  const bubble = document.createElement('div');
  bubble.className = 'assistant-text typing-cursor';
  wrap.appendChild(bubble);
  termMessages.appendChild(wrap);
  state.currentAssistantBubble = bubble;
  state.currentAssistantText = '';
  scrollTerm();
  return { wrap, bubble };
}

function finalizeAssistantTurn(bubble, costUsd) {
  bubble.classList.remove('typing-cursor');
  if (costUsd !== undefined && costUsd !== null) {
    const badge = document.createElement('div');
    badge.className = 'cost-badge';
    badge.innerHTML = `💰 $${costUsd.toFixed(4)}`;
    bubble.parentElement.appendChild(badge);
  }
}

async function sendMessage() {
  const text = termInput.value.trim();
  if (!text || state.streaming) return;

  termInput.value = '';
  autoResize();
  state.streaming = true;
  sendBtn.disabled = true;

  appendUserTurn(text);
  const { wrap, bubble } = startAssistantTurn();

  let currentCost = null;

  try {
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId: state.sessionId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      bubble.classList.remove('typing-cursor');
      bubble.innerHTML = `<span style="color:var(--pink)">⚠ ${esc(err.error)}</span>`;
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
        const raw = line.slice(6).trim();
        if (!raw) continue;

        let msg;
        try { msg = JSON.parse(raw); } catch (_) { continue; }

        switch (msg.type) {
          case 'text':
            state.currentAssistantText += msg.text;
            bubble.innerHTML = renderMd(state.currentAssistantText);
            bubble.classList.add('typing-cursor');
            scrollTerm();
            break;

          case 'tool_use':
            // Show tool indicator before next text
            bubble.classList.remove('typing-cursor');
            wrap.appendChild(makeToolIndicator(msg.name, msg.input));
            // Start a new bubble for text after tool
            const newBubble = document.createElement('div');
            newBubble.className = 'assistant-text typing-cursor';
            wrap.appendChild(newBubble);
            state.currentAssistantBubble = newBubble;
            state.currentAssistantText = '';
            bubble.__replace = newBubble; // not used but kept for clarity
            scrollTerm();
            break;

          case 'tool_result':
            // Optionally show collapsed tool output
            break;

          case 'system_init':
            if (msg.session_id && !state.sessionId) {
              state.sessionId = msg.session_id;
            }
            break;

          case 'result':
            if (msg.session_id) {
              state.sessionId = msg.session_id;
              $('sessionBadge').classList.remove('hidden');
              $('sessionLabel').textContent = `sessão ${msg.session_id.slice(0,8)}`;
            }
            currentCost = msg.cost_usd;
            break;

          case 'error':
            const errEl = document.createElement('div');
            errEl.className = 'tool-use tool-error';
            errEl.innerHTML = `<span class="tool-use-icon">⚠️</span><span>${esc(msg.text)}</span>`;
            wrap.appendChild(errEl);
            scrollTerm();
            break;

          case 'done':
            break;
        }
      }
    }
  } catch (err) {
    bubble.classList.remove('typing-cursor');
    bubble.innerHTML = `<span style="color:var(--pink)">⚠ Erro de conexão: ${esc(err.message)}</span>`;
  }

  // Finalize the last active bubble
  const lastBubble = state.currentAssistantBubble;
  if (lastBubble) {
    lastBubble.classList.remove('typing-cursor');
    if (state.currentAssistantText) {
      lastBubble.innerHTML = renderMd(state.currentAssistantText);
    }
  }
  finalizeAssistantTurn(bubble, currentCost);

  state.streaming = false;
  sendBtn.disabled = false;
  state.currentAssistantBubble = null;
  state.currentAssistantText = '';
  scrollTerm();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadConfig();
loadTree();
startWatcher();
