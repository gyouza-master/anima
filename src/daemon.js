import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { sendNotification } from './notification.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, '../config/approval.json');
const rosterPath = join(__dirname, '../config/roster.json');
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
        cwd,
        project,
        started,
        connected: !!state.sessions[sessionId]
      });
    });
  } catch (err) {
    return res.status(500).json({ error: 'discover failed', detail: String(err) });
  }
  res.json({ sessions: found });
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
  const { adapter, session_id, cwd, kind, status, detail, ts, model, model_name } = req.body;

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
  if (kind === 'start') {
    assignSessionToSlot(session_id, { session_id, cwd, adapter, model, model_name });
  } else if (kind === 'prompt') {
    if (state.sessions[session_id]) {
      state.sessions[session_id].status = 'working';
      state.sessions[session_id].detail = 'あなたのメッセージを処理中';
      state.sessions[session_id].status_changed_at = Date.now(); // reset on your send
    }
  } else if (kind === 'activity') {
    if (state.sessions[session_id]) {
      state.sessions[session_id].status = status || 'working';
      state.sessions[session_id].detail = detail;
      // Do NOT reset the timer here — the AI is mid-work, still your turn later.
      if (model) state.sessions[session_id].model = model;
      if (model_name) state.sessions[session_id].model_name = model_name;
    }
  } else if (kind === 'notification') {
    if (state.sessions[session_id]) {
      state.sessions[session_id].status = status || 'awaiting-input';
      state.sessions[session_id].status_changed_at = ts || Date.now();
    }
  } else if (kind === 'stop') {
    if (state.sessions[session_id]) {
      // AI finished replying — now waiting for your reply. Start counting here.
      state.sessions[session_id].status = 'idle';
      state.sessions[session_id].detail = '返答完了・あなたの返信待ち';
      state.sessions[session_id].status_changed_at = ts || Date.now();
    }
  }

  processQueue();
  broadcastState();

  res.json({ ok: true });
});

// Approval endpoint (long-polling)
app.post('/api/approvals', (req, res) => {
  const { adapter, session_id, cwd, tool_name, tool_input, timeout_ms } = req.body;

  if (!session_id) {
    return res.status(400).json({ error: 'session_id required' });
  }

  // Generate approval ID
  const approvalId = `${session_id}-${Date.now()}`;
  const timeoutMs = timeout_ms || config.approval_timeout_ms;

  // Update session status
  if (state.sessions[session_id]) {
    state.sessions[session_id].status = 'awaiting-approval';
    state.sessions[session_id].detail = `${tool_name}: ${JSON.stringify(tool_input).substring(0, 60)}...`;
    state.sessions[session_id].status_changed_at = Date.now();
  }

  // Create approval object
  const approval = {
    id: approvalId,
    session_id,
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
  const character = state.sessions[session_id]?.character_name || 'Unknown';
  sendNotification(
    'anima - 承認待ち',
    `${character}が承認を待っています`,
    `${tool_name}の実行を許可しますか？`
  );

  // Set timeout - if no decision within timeoutMs, respond with timeout
  const timeoutHandle = setTimeout(() => {
    if (state.pendingApprovals[approvalId] && !state.pendingApprovals[approvalId].decided) {
      delete state.pendingApprovals[approvalId];
      broadcastState();

      if (!res.headersSent) {
        res.json({
          decision: 'timeout',
          reason: `No decision within ${timeoutMs}ms`
        });
      }
    }
  }, timeoutMs);

  // Store response handle so decision endpoint can clear it
  approval.resHandle = timeoutHandle;
  approval.responseCallback = () => {
    clearTimeout(timeoutHandle);
    if (!res.headersSent) {
      res.json({
        decision: approval.decision,
        reason: approval.reason || ''
      });
    }
  };

  // Keep connection alive with ping
  const pingInterval = setInterval(() => {
    if (!res.headersSent && res.socket?.writable) {
      res.write(':ping\n');
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);

  res.on('close', () => {
    clearInterval(pingInterval);
    clearTimeout(timeoutHandle);
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

  // Clear pending approval from state
  delete state.pendingApprovals[approvalId];
  broadcastState();

  // Resolve the waiting request
  if (approval.responseCallback) {
    approval.responseCallback();
  }

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

// Start server
server.listen(PORT, () => {
  console.log(`anima daemon listening on localhost:${PORT}`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
  console.log(`  API state: http://localhost:${PORT}/api/state`);
  console.log(`  WebSocket: ws://localhost:${PORT}/ws`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
