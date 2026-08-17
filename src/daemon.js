import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { readFileSync, appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
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

// Broadcast state to all connected WebSocket clients
function broadcastState() {
  const message = JSON.stringify({
    type: 'state_update',
    data: state
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
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Get current state
app.get('/api/state', (req, res) => {
  res.json(state);
});

// Event endpoint
app.post('/api/events', (req, res) => {
  const { adapter, session_id, cwd, kind, status, detail, ts } = req.body;

  if (!session_id) {
    return res.status(400).json({ error: 'session_id required' });
  }

  logEvent({ adapter, session_id, cwd, kind, status, detail });

  // Handle different event kinds
  if (kind === 'start') {
    assignSessionToSlot(session_id, { session_id, cwd, adapter });
  } else if (kind === 'activity') {
    if (state.sessions[session_id]) {
      state.sessions[session_id].status = status || 'working';
      state.sessions[session_id].detail = detail;
      state.sessions[session_id].status_changed_at = ts || Date.now();
    }
  } else if (kind === 'notification') {
    if (state.sessions[session_id]) {
      state.sessions[session_id].status = status || 'awaiting-input';
      state.sessions[session_id].status_changed_at = ts || Date.now();
    }
  } else if (kind === 'stop') {
    if (state.sessions[session_id]) {
      state.sessions[session_id].status = 'done';
      state.sessions[session_id].status_changed_at = ts || Date.now();
      // Auto-cleanup after 30 minutes
      setTimeout(() => {
        if (state.sessions[session_id]?.status === 'done') {
          const slotId = state.sessions[session_id].slot_id;
          delete state.sessions[session_id];
          processQueue();
        }
      }, config.session_cleanup_ms || 1800000);
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

// WebSocket connection
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  // Send initial state
  ws.send(JSON.stringify({
    type: 'initial_state',
    data: state
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
