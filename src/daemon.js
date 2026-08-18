import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync, execFile } from 'child_process';
import { sendNotification } from './notification.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, '../config/approval.json');
const rosterPath = join(__dirname, '../config/roster.json');
const statePath = join(__dirname, '../config/state.json');
const logsDir = join(__dirname, '../logs');

// Ensure logs directory exists
mkdirSync(logsDir, { recursive: true });

const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const roster = JSON.parse(readFileSync(rosterPath, 'utf-8'));

const PORT = config.port || 4317;
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// State management
let state = {
  sessions: {},      // session_id -> session object
  queue: [],         // pending sessions waiting for a slot
  pendingApprovals: {} // approval_id -> approval object
};

function getOccupiedSlots() {
  return new Set(
    Object.values(state.sessions).map(s => s.slot_id).filter(Boolean)
  );
}

function getAvailableSlot() {
  const occupied = getOccupiedSlots();
  for (let i = 1; i <= 6; i++) {
    if (!occupied.has(i)) return i;
  }
  return null;
}

function getCharacterForSlot(slotId) {
  const slot = roster.slots.find(s => s.id === slotId);
  return slot ? { name: slot.name, color: slot.color } : { name: 'Unknown', color: '#999' };
}

function assignSessionToSlot(sessionId, sessionData) {
  const availableSlot = getAvailableSlot();
  if (availableSlot) {
    const character = getCharacterForSlot(availableSlot);
    state.sessions[sessionId] = {
      ...sessionData,
      slot_id: availableSlot,
      character_name: character.name,
      color: character.color,
      status: 'idle',
      created_at: Date.now(),
      status_changed_at: Date.now()
    };
    return true;
  } else {
    // Queue for next available slot
    state.queue.push({
      session_id: sessionId,
      cwd: sessionData.cwd,
      queued_at: Date.now()
    });
    return false;
  }
}

// Map an incoming event to the session card it belongs to.
// Exact session_id wins. Otherwise fall back to a live session in the same cwd
// (bridges hook UUIDs to "+接続"/UI cards). Returns the original id when there
// is nothing to reconcile to — callers guard on state.sessions[sid].
function resolveSessionId(sessionId, cwd, adapter) {
  if (state.sessions[sessionId]) return sessionId;
  if (cwd && cwd !== '/') {
    const match = Object.keys(state.sessions).find(id => state.sessions[id].cwd === cwd);
    if (match) return match;
  }
  return sessionId;
}

function processQueue() {
  while (state.queue.length > 0) {
    const availableSlot = getAvailableSlot();
    if (!availableSlot) break;

    const queuedItem = state.queue.shift();
    const sessionId = queuedItem.session_id;

    // Find the queued session data (should already exist as a pending session)
    if (!state.sessions[sessionId]) {
      state.sessions[sessionId] = {
        session_id: sessionId,
        cwd: queuedItem.cwd,
        created_at: Date.now()
      };
    }

    const character = getCharacterForSlot(availableSlot);
    state.sessions[sessionId] = {
      ...state.sessions[sessionId],
      slot_id: availableSlot,
      character_name: character.name,
      color: character.color,
      status: 'idle',
      status_changed_at: Date.now()
    };
  }
}

// Build the full payload sent to the UI (state + roster for name/color labels)
function getStatePayload() {
  return { ...state, roster: roster.slots };
}

// Broadcast state to all connected WebSocket clients
function broadcastState() {
  const message = JSON.stringify({
    type: 'state_update',
    data: getStatePayload()
  });
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(message);
    }
  });
  saveState();
}

// --- 状態の永続化（daemon 再起動でセッションが消えないように） ---
// sessions と queue だけをディスクに保存する。pendingApprovals は待機中の
// HTTP 接続に紐づくので復元しても無意味なため保存しない。書き込みは軽く
// デバウンスして、activity イベント連発時の過剰な書き込みを避ける。
let saveTimer = null;
function saveState() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushState();
  }, 300);
}

function flushState() {
  try {
    writeFileSync(statePath, JSON.stringify({
      sessions: state.sessions,
      queue: state.queue
    }, null, 2));
  } catch (err) {
    console.error('saveState failed:', err.message);
  }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 = liveness probe, doesn't actually kill
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists but owned by another user
  }
}

// 起動時に前回の状態を復元。復元時に「掃除」する:
//  - discover 由来(pid-*)でプロセスが既に死んでいるカードは捨てる（ゾンビ防止）
//  - 承認待ちのまま落ちた場合、承認は失われているので idle に戻す
function loadState() {
  let saved;
  try {
    saved = JSON.parse(readFileSync(statePath, 'utf-8'));
  } catch {
    return; // ファイルなし/壊れ → 何もせず新規状態で開始
  }

  const restored = {};
  let dropped = 0;
  for (const [id, s] of Object.entries(saved.sessions || {})) {
    if (id.startsWith('pid-')) {
      const pid = parseInt(id.slice(4), 10);
      if (!Number.isNaN(pid) && !isPidAlive(pid)) { dropped++; continue; }
    }
    if (s.status === 'awaiting-approval') {
      s.status = 'idle';
      s.detail = '承認待ちのまま再起動しました';
    }
    restored[id] = s;
  }

  state.sessions = restored;
  state.queue = Array.isArray(saved.queue) ? saved.queue : [];
  const kept = Object.keys(restored).length;
  console.log(`  Restored ${kept} session(s)${dropped ? `, dropped ${dropped} dead` : ''}`);
}

// Log event to JSONL file
function logEvent(event) {
  const timestamp = new Date().toISOString();
  const logEntry = JSON.stringify({
    timestamp,
    ...event
  });
  appendFileSync(join(logsDir, 'events.jsonl'), logEntry + '\n');
}

// Middleware
// CORS: allow browser adapters (e.g. a ChatGPT tab on chatgpt.com) to POST events.
// The daemon binds to localhost only, so this stays on-machine.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Get current state (includes roster)
app.get('/api/state', (req, res) => {
  res.json(getStatePayload());
});

// Known AI apps/CLIs to detect, matched by the process's executable basename.
// The FIRST match wins, so put more specific names first. Helper subprocesses
// (renderers, services) have different basenames and are naturally skipped.
const KNOWN_AIS = [
  { name: 'Claude Code', bin: 'claude', kind: 'cli' },
  { name: 'ChatGPT', bin: 'ChatGPT', kind: 'app' },
  { name: 'Cursor', bin: 'Cursor', kind: 'app' }
];

// ブラウザで動く AI（タブ）。ps では拾えないので Google Chrome を AppleScript で
// 列挙して該当ホストのタブを検知する。フックが無いので状態のライブ更新はできない
// （Tier 3: 存在表示＋タブへジャンプ）。
const listTabsScript = join(__dirname, '../scripts/list-chrome-tabs.applescript');
const activateTabScript = join(__dirname, '../scripts/activate-chrome-tab.applescript');
const BROWSER_AIS = [
  { host: 'claude.ai', name: 'Claude (ブラウザ)' },
  { host: 'chatgpt.com', name: 'ChatGPT (ブラウザ)' },
  { host: 'chat.openai.com', name: 'ChatGPT (ブラウザ)' },
  { host: 'gemini.google.com', name: 'Gemini (ブラウザ)' }
];

// Stable id for a tab, derived from host+pathname (ignores query/hash) so the
// same conversation keeps its card across reloads.
function tabSessionId(url) {
  let key = url;
  try { const u = new URL(url); key = u.host + u.pathname; } catch { /* keep raw */ }
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return 'browser-' + (h >>> 0).toString(36);
}

function discoverBrowserTabs() {
  const found = [];
  let out = '';
  try {
    out = execSync(`osascript "${listTabsScript}"`, { encoding: 'utf-8', timeout: 5000 });
  } catch {
    return found; // Chrome not running / no automation permission
  }
  const US = String.fromCharCode(31);
  const seen = new Set();
  out.split('\n').forEach(line => {
    if (!line) return;
    const parts = line.split(US);
    if (parts.length < 3) return;
    const url = parts[2] || '';
    const title = parts[3] || '';
    const ai = BROWSER_AIS.find(a => url.includes('://' + a.host) || url.includes('.' + a.host));
    if (!ai) return;
    const sessionId = tabSessionId(url);
    if (seen.has(sessionId)) return; // same conversation open in 2 windows -> once
    seen.add(sessionId);
    found.push({
      session_id: sessionId,
      ai_name: ai.name,
      kind: 'browser',
      url,
      project: title || ai.name,
      started: '',
      connected: !!state.sessions[sessionId]
    });
  });
  return found;
}

function activateBrowserTab(url) {
  try {
    execSync(`osascript "${activateTabScript}" ${JSON.stringify(url)}`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// --- ブラウザカードのライブ状態（Tier2）---
// 接続中のブラウザタブに claude-observe.js を実行して「生成中/完了」を検知し、
// 生成が終わったら「✅ 確認してね」を出す。要「Apple Events からの JavaScript を許可」。
const observeJsPath = join(__dirname, '../scripts/claude-observe.js');
const probeScript = join(__dirname, '../scripts/probe-chrome-tab.applescript');

function probeBrowserTab(url) {
  return new Promise(resolve => {
    execFile('osascript', [probeScript, url, observeJsPath], { timeout: 4000 }, (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse((stdout || '').trim())); } catch { resolve(null); }
    });
  });
}

let polling = false;
async function pollBrowserTabs() {
  if (polling) return; // avoid overlap if a probe is slow
  const targets = Object.values(state.sessions).filter(s => s.browser && s.url);
  if (targets.length === 0) return;
  polling = true;
  let changed = false;
  try {
    for (const s of targets) {
      const r = await probeBrowserTab(s.url);
      if (!r || r.err || typeof r.len !== 'number') continue;
      // 主信号 = busy（送信ボタンが無効 or stop ボタン）。思考ポーズを跨いで
      // 安定するので、これが true の間は「生成中」。補助として会話テキストが
      // 過去最大を超えて伸びた場合も動きありとみなす（点滅等では誤爆しない）。
      const grew = typeof s._maxLen === 'number' && r.len > s._maxLen;
      s._maxLen = Math.max(s._maxLen || 0, r.len);
      const active = r.busy === true || grew;
      if (active) s._lastActive = Date.now();
      // busy が true の間は無条件で生成中。busy が落ちた後は、バースト配信の
      // 小さなギャップを吸収するため DONE_DELAY_MS だけ猶予してから「完了」。
      const DONE_DELAY_MS = 2500;
      const now = r.busy === true || (Date.now() - (s._lastActive || 0)) < DONE_DELAY_MS;
      const prev = s._gen === true;
      if (now && !prev) {
        s.status = 'working';
        s.detail = '生成中…';
        s.status_changed_at = Date.now();
        changed = true;
      } else if (!now && prev) {
        s.status = 'awaiting-input';
        s.detail = '✅ 回答完了・確認してね';
        s.status_changed_at = Date.now();
        changed = true;
      }
      s._gen = now;
      s._len = r.len;
    }
  } finally {
    polling = false;
  }
  if (changed) broadcastState();
}

setInterval(() => { pollBrowserTabs().catch(() => {}); }, 1500);

// Discover running AI sessions (Claude Code CLI, ChatGPT app, etc.).
// Returns each process's pid, cwd, start time, AI name, and whether anima tracks it.
app.get('/api/discover', (req, res) => {
  const found = [];
  try {
    const psOut = execSync('ps -axo pid=,comm=', { encoding: 'utf-8' });
    psOut.split('\n').forEach(line => {
      const trimmed = line.trim();
      const sp = trimmed.indexOf(' ');
      if (sp < 0) return;
      const pid = trimmed.slice(0, sp).trim();
      const comm = trimmed.slice(sp + 1).trim();
      const base = comm.split('/').pop();

      const ai = KNOWN_AIS.find(a => a.bin === base);
      if (!ai) return;

      let cwd = '';
      try {
        const lsof = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null`, { encoding: 'utf-8' });
        const nline = lsof.split('\n').find(x => x.startsWith('n'));
        if (nline) cwd = nline.slice(1);
      } catch { /* ignore */ }

      let started = '';
      try {
        started = execSync(`ps -o lstart= -p ${pid}`, { encoding: 'utf-8' }).trim();
      } catch { /* ignore */ }

      // For CLI tools the cwd (project) is meaningful; for apps it's usually "/".
      const hasProject = cwd && cwd !== '/';
      const project = ai.kind === 'cli' && hasProject
        ? `${ai.name} · ${cwd.split('/').pop()}`
        : ai.name;

      const sessionId = `pid-${pid}`;
      found.push({
        pid,
        session_id: sessionId,
        ai_name: ai.name,
        kind: 'process',
        cwd,
        project,
        started,
        connected: !!state.sessions[sessionId]
      });
    });
  } catch (err) {
    return res.status(500).json({ error: 'discover failed', detail: String(err) });
  }

  // Also surface browser-tab AIs (claude.ai / ChatGPT web, etc.).
  const tabs = discoverBrowserTabs();
  res.json({ sessions: found, tabs });
});

// Bring a browser tab to the front (Tier 2/3 "タブへジャンプ").
app.post('/api/tabs/activate', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  const ok = activateBrowserTab(url);
  res.json({ ok });
});

// Get roster (slot names / colors)
app.get('/api/roster', (req, res) => {
  res.json({ slots: roster.slots });
});

// Update roster (slot names / colors) — persists to config/roster.json
app.post('/api/roster', (req, res) => {
  const { slots } = req.body;
  if (!Array.isArray(slots)) {
    return res.status(400).json({ error: 'slots array required' });
  }

  // Merge incoming values into the existing roster by slot id
  slots.forEach(incoming => {
    const slot = roster.slots.find(s => s.id === incoming.id);
    if (slot) {
      if (typeof incoming.name === 'string' && incoming.name.trim()) slot.name = incoming.name.trim();
      if (typeof incoming.color === 'string' && incoming.color.trim()) slot.color = incoming.color.trim();
      if (typeof incoming.emoji === 'string' && incoming.emoji.trim()) slot.emoji = incoming.emoji.trim();
    }
  });

  // Persist to disk
  writeFileSync(rosterPath, JSON.stringify(roster, null, 2));

  // Reflect new names/colors onto any active sessions
  Object.values(state.sessions).forEach(s => {
    const slot = roster.slots.find(x => x.id === s.slot_id);
    if (slot) {
      s.character_name = slot.name;
      s.color = slot.color;
    }
  });

  broadcastState();
  res.json({ ok: true, slots: roster.slots });
});

// Delete a single session (manual clear)
app.delete('/api/sessions/:id', (req, res) => {
  if (state.sessions[req.params.id]) {
    delete state.sessions[req.params.id];
    processQueue();
    broadcastState();
  }
  res.json({ ok: true });
});

// Clear all sessions and the queue (cleanup)
app.post('/api/sessions/clear', (req, res) => {
  state.sessions = {};
  state.queue = [];
  broadcastState();
  res.json({ ok: true });
});

// Event endpoint
app.post('/api/events', (req, res) => {
  const { adapter, session_id, cwd, kind, status, detail, ts, model, model_name, url } = req.body;

  if (!session_id) {
    return res.status(400).json({ error: 'session_id required' });
  }

  logEvent({ adapter, session_id, cwd, kind, status, detail });

  // Handle different event kinds
  //
  // Timer semantics: status_changed_at marks "when we started waiting for YOU".
  //   - prompt (you sent a message) -> reset timer, AI is now working
  //   - activity (AI ran a tool)    -> keep timer running (don't reset mid-work)
  //   - stop (AI finished replying)  -> reset timer; from here it counts how long
  //                                     the AI has been waiting for your reply
  // Reconcile identity. Hooks key events by Claude's session UUID, but a card
  // may have been created by "+接続" (keyed pid-*) or the UI (ui-*). When the
  // exact id is unknown, route the event to an existing session in the same cwd
  // so the card the user is actually watching updates. Timestamps are always
  // stamped server-side in ms — hook `ts` is in seconds and would break the
  // frontend's `Date.now() - status_changed_at` math.
  const sid = resolveSessionId(session_id, cwd, adapter);

  if (kind === 'start') {
    // Only create a new card if we can't reconcile to an existing one.
    if (state.sessions[sid]) {
      if (model) state.sessions[sid].model = model;
      if (model_name) state.sessions[sid].model_name = model_name;
    } else {
      // Browser-tab AIs (adapter 'browser') are Tier-2/3: no hooks, so no live
      // status — carry the tab URL so the card can offer "タブへジャンプ".
      const extra = adapter === 'browser' ? { url, browser: true } : {};
      assignSessionToSlot(session_id, { session_id, cwd, adapter, model, model_name, ...extra });
    }
  } else if (kind === 'prompt') {
    if (state.sessions[sid]) {
      state.sessions[sid].status = 'working';
      state.sessions[sid].detail = 'あなたのメッセージを処理中';
      state.sessions[sid].status_changed_at = Date.now(); // reset on your send
    }
  } else if (kind === 'activity') {
    if (state.sessions[sid]) {
      state.sessions[sid].status = status || 'working';
      state.sessions[sid].detail = detail;
      // Do NOT reset the timer here — the AI is mid-work, still your turn later.
      if (model) state.sessions[sid].model = model;
      if (model_name) state.sessions[sid].model_name = model_name;
    }
  } else if (kind === 'notification') {
    if (state.sessions[sid]) {
      state.sessions[sid].status = status || 'awaiting-input';
      if (detail) state.sessions[sid].detail = detail; // e.g. 「❓ <質問文>」
      state.sessions[sid].status_changed_at = Date.now();
    }
  } else if (kind === 'stop') {
    if (state.sessions[sid]) {
      // AI finished replying — now waiting for your reply. Start counting here.
      state.sessions[sid].status = 'idle';
      state.sessions[sid].detail = '返答完了・あなたの返信待ち';
      state.sessions[sid].status_changed_at = Date.now();
    }
  }

  processQueue();
  broadcastState();

  res.json({ ok: true });
});

// Non-serializable per-approval handles (timers, the pending res callback).
// Kept OUT of `state` so state can be JSON-serialized for /api/state and WS
// broadcasts without hitting circular references.
const approvalHandles = {};

// Approval endpoint (long-polling)
app.post('/api/approvals', (req, res) => {
  const { adapter, session_id, cwd, tool_name, tool_input, timeout_ms } = req.body;

  if (!session_id) {
    return res.status(400).json({ error: 'session_id required' });
  }

  // Generate approval ID
  const approvalId = `${session_id}-${Date.now()}`;
  const timeoutMs = timeout_ms || config.approval_timeout_ms;

  // Resolve which visible card this belongs to (hooks key by UUID, cards may
  // be keyed pid-*/ui-*). card_session_id lets the UI attach the speech bubble
  // to the right character.
  const sid = resolveSessionId(session_id, cwd, adapter);

  // Update session status
  if (state.sessions[sid]) {
    state.sessions[sid].status = 'awaiting-approval';
    state.sessions[sid].detail = `${tool_name}: ${JSON.stringify(tool_input).substring(0, 60)}...`;
    state.sessions[sid].status_changed_at = Date.now();
  }

  // Create approval object
  const approval = {
    id: approvalId,
    session_id,
    card_session_id: sid,
    tool_name,
    tool_input,
    adapter,
    cwd,
    created_at: Date.now(),
    decided: false,
    decision: null,
    reason: null
  };

  state.pendingApprovals[approvalId] = approval;
  broadcastState();

  logEvent({
    kind: 'approval_request',
    approval_id: approvalId,
    session_id,
    tool_name
  });

  // Send macOS notification
  const character = state.sessions[sid]?.character_name || 'Unknown';
  sendNotification(
    'anima - 承認待ち',
    `${character}が承認を待っています`,
    `${tool_name}の実行を許可しますか？`
  );

  // Set timeout - if no decision within timeoutMs, respond with timeout
  const timeoutHandle = setTimeout(() => {
    if (state.pendingApprovals[approvalId] && !state.pendingApprovals[approvalId].decided) {
      delete state.pendingApprovals[approvalId];
      delete approvalHandles[approvalId];
      broadcastState();

      if (!res.headersSent) {
        res.json({
          decision: 'timeout',
          reason: `No decision within ${timeoutMs}ms`
        });
      }
    }
  }, timeoutMs);

  // Keep connection alive with ping
  const pingInterval = setInterval(() => {
    if (!res.headersSent && res.socket?.writable) {
      res.write(':ping\n');
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);

  // Store handles OUT of state (non-serializable) so the decision endpoint can
  // resolve the waiting request and clear timers.
  approvalHandles[approvalId] = {
    timeoutHandle,
    pingInterval,
    responseCallback: () => {
      clearTimeout(timeoutHandle);
      clearInterval(pingInterval);
      if (!res.headersSent) {
        const a = state.pendingApprovals[approvalId] || approval;
        res.json({
          decision: a.decision,
          reason: a.reason || ''
        });
      }
    }
  };

  res.on('close', () => {
    clearInterval(pingInterval);
    clearTimeout(timeoutHandle);
    delete approvalHandles[approvalId];
  });
});

// Approval decision endpoint
app.post('/api/approvals/:id/decision', (req, res) => {
  const { decision, reason } = req.body;
  const approvalId = req.params.id;

  const approval = state.pendingApprovals[approvalId];
  if (!approval) {
    return res.status(404).json({ error: 'approval not found' });
  }

  approval.decided = true;
  approval.decision = decision;
  approval.reason = reason;

  logEvent({
    kind: 'approval_decision',
    approval_id: approvalId,
    decision,
    reason
  });

  // Resolve the waiting request BEFORE clearing so the callback can read the
  // decision, then drop pending state + handles.
  const handles = approvalHandles[approvalId];
  if (handles && handles.responseCallback) {
    handles.responseCallback();
  }
  delete approvalHandles[approvalId];
  delete state.pendingApprovals[approvalId];
  broadcastState();

  res.json({ ok: true });
});

// Set a session's task name (the user-editable "what am I working on" label)
app.post('/api/sessions/:id/task', (req, res) => {
  const session = state.sessions[req.params.id];
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }
  const { task } = req.body;
  session.task = typeof task === 'string' ? task : '';
  broadcastState();
  res.json({ ok: true });
});

// Reset session timer
app.post('/api/sessions/:id/reset-timer', (req, res) => {
  const sessionId = req.params.id;

  const session = state.sessions[sessionId];
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  session.status_changed_at = Date.now();
  broadcastState();

  logEvent({
    kind: 'timer_reset',
    session_id: sessionId
  });

  res.json({ ok: true, session_id: sessionId });
});

// WebSocket connection
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  // Send initial state
  ws.send(JSON.stringify({
    type: 'initial_state',
    data: getStatePayload()
  }));

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Restore persisted sessions before accepting connections, then fill any slots
// freed by zombie cleanup from the waiting queue.
loadState();
processQueue();

// Start server
server.listen(PORT, () => {
  console.log(`anima daemon listening on localhost:${PORT}`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
  console.log(`  API state: http://localhost:${PORT}/api/state`);
  console.log(`  WebSocket: ws://localhost:${PORT}/ws`);
});

// Graceful shutdown — flush the latest state so nothing is lost on restart.
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  flushState();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
