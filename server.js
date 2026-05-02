const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const compression = require('compression');
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined
});

const ROOT = __dirname;
const motdPath = path.join(ROOT, 'motd.txt');
const publicPath = path.join(ROOT, 'public');

const app = express();

const server = http.createServer(app);
logger.info('Starting HTTP server');

const io = new Server(server, {
  maxHttpBufferSize: 100 * 1024,
  pingTimeout: 60000,
  pingInterval: 45000,
  path: '/socket.io',
});

app.set('trust proxy', 'loopback');

app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://cdn.socket.io https://cdn.jsdelivr.net",
    "connect-src 'self' https: wss:",
    "img-src 'self' http: https: data:",
    "style-src 'self'",
    "font-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'none'"
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

app.use((req, _res, next) => {
  req.appHost = String(req.headers.host || '').toLowerCase().split(':')[0];
  next();
});

app.use(express.static(publicPath));

app.get('/online', (req, res) => {
  const users = Array.from(socketToUsername.values());
  const count = users.length;
  const token = req.headers['x-admin-token'];
  const allowList = process.env.ONLINE_TOKEN && token && token === process.env.ONLINE_TOKEN;
  res.json(allowList ? { count, users } : { count });
});

app.get('/admin/rooms', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!process.env.ROOMS_TOKEN || !token || token !== process.env.ROOMS_TOKEN) {
    return res.status(403).json({ ok: false });
  }

  const rooms = {};
  for (const [sId, rId] of socketToRoom.entries()) {
    if (!rooms[rId]) {
      rooms[rId] = {
        users: [],
        color: getRoomColor(rId),
        userCount: 0
      };
    }
    rooms[rId].users.push(socketToUsername.get(sId));
    rooms[rId].userCount++;
  }

  logger.info({ event: 'admin_rooms_list', count: Object.keys(rooms).length }, 'Admin rooms list requested');
  res.json({ ok: true, rooms, maxGlobalUsers: MAX_GLOBAL_USERS, maxUsersPerRoom: MAX_USERS_PER_ROOM });
});

app.get('/admin/messages', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!process.env.ROOMS_TOKEN || !token || token !== process.env.ROOMS_TOKEN) {
    return res.status(403).json({ ok: false });
  }
  res.json({ ok: true, messages: recentMessages });
});

app.post('/admin/announce', (req, res) => {
  const token = req.headers['x-admin-token'];
  const { text } = req.body || {};
  if (!process.env.ANNOUNCE_TOKEN || !token || token !== process.env.ANNOUNCE_TOKEN) {
    return res.status(403).json({ ok: false });
  }
  if (!text || typeof text !== 'string') return res.status(400).json({ ok: false, error: 'text required' });
  io.emit('chat message', { type: 'system', text: text.trim(), time: getTimestamp() });
  logger.info({ event: 'announce', text: text.trim() }, 'Admin announcement sent');
  res.json({ ok: true });
});

app.post('/admin/ntfy-stats', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!process.env.ROOMS_TOKEN || !token || token !== process.env.ROOMS_TOKEN) {
    return res.status(403).json({ ok: false });
  }

  const stats = [
    `👥 Total Sockets: ${io.engine.clientsCount}`,
    `👤 Joined Users: ${socketToUsername.size}`,
    `🏠 Active Rooms: ${roomToUsernames.size}`
  ].join('\n');

  sendNtfy(stats, { 
    title: 'Admin Stats Summary', 
    tags: 'bar_chart,stats',
    priority: 'default'
  });
  
  logger.info({ event: 'admin_ntfy_stats' }, 'Admin stats ntfy sent');
  res.json({ ok: true });
});

app.use((req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

const MAX_USERS_PER_ROOM        = parseInt(process.env.MAX_USERS_PER_ROOM) || 20;
const MAX_GLOBAL_USERS          = parseInt(process.env.MAX_GLOBAL_USERS) || 20;
const MAX_CONNECTIONS_PER_IP    = 3;
const MAX_MSG_LENGTH            = 2048; // Increased for encrypted payloads
const URL_LIMIT_PER_MSG         = 5;
const DUP_WINDOW_MS             = 10_000;
const DUP_MAX_SAME_TEXT         = 3;
const REPEAT_CHAR_THRESHOLD     = 0.9; // Relaxed slightly for base64 payloads
const TEMP_MUTE_MS              = 30_000;
const RATE_LIMIT_RATE           = 2;
const RATE_LIMIT_BURST          = 6;
const MAX_STRIKES_BEFORE_MUTE   = 5;
const CMD_COOLDOWN_MS           = 2000;
const MAX_USERNAME_LEN          = 15;
const MAX_USERNAME_SET_ATTEMPTS = 5;
const USERNAME_ATTEMPT_WINDOW   = 60_000;

const DEFAULT_TRUSTED_PROXIES = ['127.0.0.1', '::1'];
const TRUSTED_PROXY_IPS = new Set(
  (process.env.TRUSTED_PROXY_IPS || DEFAULT_TRUSTED_PROXIES.join(','))
    .split(',')
    .map(ip => ip.trim())
    .filter(Boolean)
);
const socketToUsername = new Map();
const socketToRoom = new Map();
const roomToUsernames = new Map(); // roomId -> Set(usernameLower)
const ipConnCounts = new Map();
const socketIp = new Map();

// IP-based protection
const rateLimiters = new Map(); // IP -> TokenBucket
const lastMsgs = new Map();     // IP -> { history: [] }
const strikes = new Map();      // IP -> count
const ipMuteUntil = new Map();
const usernameAttempts = new Map(); // IP -> [ {ts} ]
const ipCmdCooldowns = new Map();  // IP -> { [cmdName]: timestamp }

const recentMessages = [];
const MAX_RECENT_MSGS = 20;

const ROOM_COLORS = [
  '#c0392b', // Dark Red
  '#27ae60', // Dark Green
  '#2980b9', // Dark Blue
  '#8e44ad', // Dark Purple
  '#16a085', // Dark Cyan
  '#d35400', // Dark Orange
  '#f39c12', // Orange/Yellow
  '#e84393', // Pink/Magenta
];

function getRoomColor(roomId) {
  if (!roomId) return '#ffffff';
  // Use a more robust hash of the 64-char hex string
  let hash = 0;
  for (let i = 0; i < roomId.length; i++) {
    const char = roomId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  // Further scramble to avoid patterns in hex strings
  hash = (hash ^ (hash >>> 16));
  const index = Math.abs(hash) % ROOM_COLORS.length;
  const color = ROOM_COLORS[index];
  logger.debug({ event: 'get_room_color', roomId: roomId.slice(0, 8), index, color }, 'Room color assigned');
  return color;
}

const URL_REGEX = /(https?:\/\/[^\s]+)/gi;

let MOTD = '';
let motdWatcher = null;

async function loadMotd() {
  try {
    MOTD = await fsp.readFile(motdPath, 'utf8');
    logger.info({ event: 'motd_reload', length: MOTD.length }, 'MOTD reloaded');
  } catch (err) {
    logger.warn({ event: 'motd_reload_failed', error: err.message }, 'MOTD failed to load');
    MOTD = '';
  }
}

function closeMotdWatcher() {
  try { motdWatcher?.close?.(); } catch {}
  motdWatcher = null;
}

function startMotdWatcher() {
  closeMotdWatcher();
  try {
    motdWatcher = fs.watch(motdPath, { persistent: false }, async (event) => {
      logger.info({ event: 'motd_watch_trigger', action: event }, 'MOTD file change detected');
      if (event === 'change' || event === 'rename') {
        await loadMotd();
        if (event === 'rename') setImmediate(startMotdWatcher);
      }
    });
  } catch {
    motdWatcher = null;
  }
}

(async () => {
  await loadMotd();
  startMotdWatcher();
})();

function getTimestamp() {
  return new Date().toISOString();
}

function normalizeIp(ip) {
  if (!ip) return '';
  const trimmed = String(ip).trim();
  if (trimmed.startsWith('::ffff:')) return trimmed.slice(7);
  return trimmed;
}

function getIpFromSocket(socket) {
  const remote =
    normalizeIp(socket.conn?.remoteAddress) ||
    normalizeIp(socket.request?.socket?.remoteAddress) ||
    normalizeIp(socket.handshake.address);

  const xff = socket.handshake.headers['x-forwarded-for'];
  if (xff && remote && TRUSTED_PROXY_IPS.has(remote)) {
    const forwarded = normalizeIp(xff.split(',')[0]);
    if (forwarded) return forwarded;
  }

  return remote || 'unknown';
}

class TokenBucket {
  constructor(ratePerSec, burst) {
    this.capacity = burst;
    this.tokens = burst;
    this.rate = ratePerSec;
    this.last = Date.now();
  }
  take(n = 1) {
    const now = Date.now();
    const elapsed = (now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.rate);
    if (this.tokens >= n) { this.tokens -= n; return true; }
    return false;
  }
}

function countUrls(text) {
  URL_REGEX.lastIndex = 0;
  return (text.match(URL_REGEX) || []).length;
}

function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text.normalize('NFC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHighlyRepetitive(text) {
  if (!text) return false;
  const freq = Object.create(null);
  for (let i = 0; i < text.length; i++) freq[text[i]] = (freq[text[i]] || 0) + 1;
  let maxCount = 0;
  for (const k in freq) if (freq[k] > maxCount) maxCount = freq[k];
  return text.length >= 12 && (maxCount / text.length) >= REPEAT_CHAR_THRESHOLD;
}

function emitSystem(socket, text) {
  socket.emit('chat message', { type: 'system', text, time: getTimestamp() });
}
function emitInfoToRoom(roomId, text) {
  io.to(roomId).emit('chat message', { type: 'info', text, time: getTimestamp() });
}

function sendNtfy(message, { title, tags, priority, click } = {}) {
  const topic = process.env.NTFY_TOPIC || 'ANONIEM-CHAT';
  if (!topic) return;

  const sanitizeHeader = (str) => str ? str.replace(/[^\x00-\x7F]/g, '') : undefined;

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      ...(title && { 'Title': sanitizeHeader(title) }),
      ...(tags && { 'Tags': sanitizeHeader(tags) }),
      ...(priority && { 'Priority': sanitizeHeader(priority) }),
      ...(click && { 'Click': sanitizeHeader(click) }),
    }
  };

  const req = https.request(`https://ntfy.sh/${topic}`, options, (res) => {
    res.on('data', () => {});
    res.on('end', () => {
      if (res.statusCode >= 400) {
        logger.error({ event: 'ntfy_error', statusCode: res.statusCode }, 'ntfy request failed');
      }
    });
  });

  req.on('error', (err) => {
    logger.error({ err, event: 'ntfy_error' }, 'Failed to send ntfy notification');
  });

  req.write(message);
  req.end();
}

const RESERVED_USERNAMES = new Set(['root', 'admin', 'moderator', 'system', 'server', 'owner']);

function sanitizeUsername(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.replace(/<[^>]*>/g, '');
  s = s.replace(/[\u0000-\u001F\u007F]/g, '');
  s = s.normalize('NFC').trim();
  s = s.replace(/[^A-Za-z0-9_.-]/g, '');
  if (s.length > MAX_USERNAME_LEN) s = s.slice(0, MAX_USERNAME_LEN);
  return s;
}

function isValidUsername(u, roomId) {
  if (!u) return { ok: false, err: 'Username required' };
  if (u.length < 1 || u.length > MAX_USERNAME_LEN) return { ok: false, err: `Must be 1–${MAX_USERNAME_LEN} chars` };
  if (!/^[A-Za-z0-9_.-]+$/.test(u)) return { ok: false, err: 'Letters, Digits, ._-'};
  const lower = u.toLowerCase();
  if (RESERVED_USERNAMES.has(lower)) return { ok: false, err: 'That name is reserved' };
  
  const roomUsers = roomToUsernames.get(roomId);
  if (roomUsers && roomUsers.has(lower)) return { ok: false, err: 'That name is taken in this room' };
  
  return { ok: true };
}

function recordUsernameAttempt(socket) {
  const ip = socketIp.get(socket.id);
  if (!ip) return 0;
  const now = Date.now();
  const arr = usernameAttempts.get(ip) || [];
  const fresh = arr.filter(x => now - x.ts <= USERNAME_ATTEMPT_WINDOW);
  fresh.push({ ts: now });
  usernameAttempts.set(ip, fresh);
  return fresh.length;
}

io.on('connection', (socket) => {
  const ip = getIpFromSocket(socket);

  if (io.engine.clientsCount > MAX_GLOBAL_USERS) {
    logger.warn({ event: 'server_full', ip, clientsCount: io.engine.clientsCount }, 'Server full, rejecting connection');
    socket.emit('server full', 'Server is full. Please try again later.');
    socket.disconnect(true);
    return;
  }

  logger.info({ event: 'connection', ip, socketId: socket.id }, 'Client connected');

  const curr = (ipConnCounts.get(ip) || 0) + 1;
  ipConnCounts.set(ip, curr);
  socketIp.set(socket.id, ip);

  if (curr > MAX_CONNECTIONS_PER_IP) {
    socket.emit('server full', 'Too many connections from your IP');
    socket.disconnect(true);
    ipConnCounts.set(ip, curr - 1);
    socketIp.delete(socket.id);
    return;
  }

  if (!rateLimiters.has(ip)) {
    rateLimiters.set(ip, new TokenBucket(RATE_LIMIT_RATE, RATE_LIMIT_BURST));
  }
  if (!lastMsgs.has(ip)) {
    lastMsgs.set(ip, { history: [] });
  }

  socket.on('join room', (data) => {
    try {
      const { username: proposedRaw, roomId } = data || {};
      
      if (socketToUsername.has(socket.id)) {
        emitSystem(socket, 'You are already in a room');
        return;
      }

      if (!roomId || typeof roomId !== 'string' || roomId.length !== 64) {
        socket.emit('join rejected', { reason: 'Invalid Room ID' });
        return;
      }

      const roomUsers = roomToUsernames.get(roomId) || new Set();
      if (roomUsers.size >= MAX_USERS_PER_ROOM) {
        socket.emit('join rejected', { reason: 'Room is full' });
        return;
      }

      const attempts = recordUsernameAttempt(socket);
      if (attempts > MAX_USERNAME_SET_ATTEMPTS) {
        emitSystem(socket, 'Too many join attempts. Please reconnect later.');
        socket.disconnect(true);
        return;
      }

      const cleaned = sanitizeUsername(String(proposedRaw || ''));
      const check = isValidUsername(cleaned, roomId);
      if (!check.ok) {
        socket.emit('join rejected', { reason: check.err });
        return;
      }

      const lower = cleaned.toLowerCase();
      if (!roomToUsernames.has(roomId)) {
        roomToUsernames.set(roomId, new Set());
      }
      roomToUsernames.get(roomId).add(lower);
      
      socketToUsername.set(socket.id, cleaned);
      socketToRoom.set(socket.id, roomId);
      socket.join(roomId);

      logger.info({ event: 'room_join', ip, username: cleaned, roomId }, 'User joined room');

      socket.emit('session', { username: cleaned, id: socket.id, roomId });

      sendNtfy(
        `${cleaned}\n${ip}\nTotal Sockets: ${io.engine.clientsCount}\nJoined Users: ${socketToUsername.size}\nActive Rooms: ${roomToUsernames.size}`,
        { 
          title: 'Anoniem Chat', 
          tags: 'incoming_envelope,bust_in_silhouette',
          priority: 'low'
        }
      );

      if (MOTD) socket.emit('chat message', { type: 'motd', text: MOTD });
      
      const usernamesInRoom = Array.from(roomToUsernames.get(roomId));
      const text = usernamesInRoom.length ? `Active in room: ${usernamesInRoom.join(', ')}` : 'You are alone';
      emitSystem(socket, text);

      emitInfoToRoom(roomId, `${cleaned} joined the room`);
      socket.emit('join accepted', { username: cleaned, roomId });
    } catch (err) {
      logger.error({ err, ip, event: 'join_room' }, 'Unhandled join room error');
    }
  });

  function onCmd(name, handler) {
    socket.on(name, () => {
      const ip = socketIp.get(socket.id);
      if (!ip) return;
      
      const now = Date.now();
      const cooldowns = ipCmdCooldowns.get(ip) || {};
      if (now - (cooldowns[name] || 0) < CMD_COOLDOWN_MS) {
        emitSystem(socket, `Slow down: "${name}" is on cooldown`);
        return;
      }
      cooldowns[name] = now;
      ipCmdCooldowns.set(ip, cooldowns);
      handler();
    });
  }

  onCmd('who', () => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) return;
    const roomUsers = roomToUsernames.get(roomId);
    const list = roomUsers ? Array.from(roomUsers).sort() : [];
    const text = list.length ? `In this room (${list.length}): ${list.join(', ')}` : 'No one is online';
    emitSystem(socket, text);
  });

  onCmd('id', () => {
    const u = socketToUsername.get(socket.id);
    const r = socketToRoom.get(socket.id);
    emitSystem(socket, u ? `You are ${u} in room ${r.slice(0, 8)}...` : 'Not joined');
  });

  onCmd('motd', () => {
    socket.emit('chat message', { type: 'motd', text: MOTD || 'No MOTD set' });
  });

  onCmd('clear chat', () => {
    socket.emit('clear chat');
    emitSystem(socket, `Chat wiped at ${getTimestamp()}`);
  });

  socket.on('change nickname', (newNick) => {
    const ip = socketIp.get(socket.id);
    const oldName = socketToUsername.get(socket.id);
    const roomId = socketToRoom.get(socket.id);

    if (!ip || !oldName || !roomId) {
      emitSystem(socket, 'Join a room first');
      return;
    }

    if (isMuted(ip)) {
      emitSystem(socket, 'You are currently muted');
      return;
    }

    // Use command cooldown logic
    const now = Date.now();
    const cooldowns = ipCmdCooldowns.get(ip) || {};
    if (now - (cooldowns['nick'] || 0) < CMD_COOLDOWN_MS * 2) {
      emitSystem(socket, 'Slow down: nickname change is on cooldown');
      return;
    }
    cooldowns['nick'] = now;
    ipCmdCooldowns.set(ip, cooldowns);

    const cleaned = sanitizeUsername(String(newNick || ''));
    const check = isValidUsername(cleaned, roomId);
    if (!check.ok) {
      emitSystem(socket, `Invalid name: ${check.err}`);
      return;
    }

    const roomUsers = roomToUsernames.get(roomId);
    if (roomUsers) {
      roomUsers.delete(oldName.toLowerCase());
      roomUsers.add(cleaned.toLowerCase());
    }

    socketToUsername.set(socket.id, cleaned);
    socket.emit('nickname updated', cleaned);
    socket.emit('session', { username: cleaned, id: socket.id, roomId });
    emitInfoToRoom(roomId, `${oldName} is now known as ${cleaned}`);
    logger.info({ event: 'nickname_change', ip, oldName, newName: cleaned, roomId });
  });

  socket.on('chat message', (msg) => {
    const user = socketToUsername.get(socket.id);
    const roomId = socketToRoom.get(socket.id);
    if (!user || !roomId) {
      emitSystem(socket, 'Join a room first');
      return;
    }

    const raw = (msg && typeof msg.text === 'string') ? msg.text : '';
    const text = normalizeText(raw);
    if (!text) return;

    if (text.length > MAX_MSG_LENGTH) {
      addStrike(socket, ip, `Message too long`);
      return;
    }

    if (isMuted(ip)) {
      emitSystem(socket, 'You are currently muted');
      return;
    }

    const bucket = rateLimiters.get(ip);
    if (!bucket || !bucket.take(1)) {
      addStrike(socket, ip, 'You are sending messages too fast');
      return;
    }

    // URL limiting is tricky with encrypted payloads, but we can check the raw base64 for suspicious patterns if needed.
    // However, since it's E2EE, we can't really check for URLs inside. 
    // We'll just rely on rate limiting and length.

    if (isHighlyRepetitive(text)) {
      addStrike(socket, ip, 'Message looks overly repetitive');
      return;
    }

    const lm = lastMsgs.get(ip);
    const now = Date.now();
    if (lm) {
      lm.history = lm.history.filter(x => now - x.ts <= DUP_WINDOW_MS);
      lm.history.push({ text, ts: now });
      const sameInWindow = lm.history.reduce((n, x) => n + (x.text === text), 0);
      if (sameInWindow >= DUP_MAX_SAME_TEXT) {
        addStrike(socket, ip, 'Repeated identical messages');
        return;
      }
    }

    const payload = {
      type: 'user',
      text,
      username: user,
      time: getTimestamp(),
    };

    recentMessages.push({
      roomId: roomId.slice(0, 8) + '...',
      roomColor: getRoomColor(roomId),
      username: user,
      text,
      time: payload.time
    });
    if (recentMessages.length > MAX_RECENT_MSGS) recentMessages.shift();

    io.to(roomId).emit('chat message', payload);
  });

  function addStrike(socket, ip, reason) {
    const username = socketToUsername.get(socket.id);
    const s = (strikes.get(ip) || 0) + 1;
    strikes.set(ip, s);
    emitSystem(socket, `${reason} (warning ${s}/${MAX_STRIKES_BEFORE_MUTE})`);
    logger.warn({ event: 'strike', username, ip, reason, strikeCount: s });
    if (s >= MAX_STRIKES_BEFORE_MUTE) {
      const until = Date.now() + TEMP_MUTE_MS;
      ipMuteUntil.set(ip, until);
      strikes.set(ip, 0);
      emitSystem(socket, `You are muted for ${Math.round(TEMP_MUTE_MS / 1000)}s`);
      logger.warn({ event: 'mute', username, ip, durationMs: TEMP_MUTE_MS }, 'User muted');
    }
  }

  function isMuted(ip) {
    const until = ipMuteUntil.get(ip) || 0;
    if (Date.now() < until) return true;
    if (until) ipMuteUntil.delete(ip);
    return false;
  }

  socket.on('disconnect', (reason) => {
    const name = socketToUsername.get(socket.id);
    const roomId = socketToRoom.get(socket.id);
    const ip = socketIp.get(socket.id);
    
    socketToUsername.delete(socket.id);
    socketToRoom.delete(socket.id);
    socketIp.delete(socket.id);

    if (roomId && name) {
      const roomUsers = roomToUsernames.get(roomId);
      if (roomUsers) {
        roomUsers.delete(name.toLowerCase());
        if (roomUsers.size === 0) {
          roomToUsernames.delete(roomId);
        }
      }
      emitInfoToRoom(roomId, `${name} left the room`);
    }

    if (ip) {
      const currentCount = ipConnCounts.get(ip);
      if (currentCount > 1) ipConnCounts.set(ip, currentCount - 1);
      else ipConnCounts.delete(ip);
    }

    logger.info({ event: 'disconnect', username: name, roomId, ip, reason }, 'Client disconnected');
  });
});

const PORT = process.env.PORT || 6000;

server.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT, host: '0.0.0.0' }, '✅ Chat server running');
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

server.on('error', (err) => {
  logger.error({ err, event: 'server_error' }, 'Server Error');
});

function shutdown(signal) {
  logger.warn({ signal }, 'Shutdown signal received');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10_000).unref(); // hard cap
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
