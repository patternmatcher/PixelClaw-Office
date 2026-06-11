const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

const { execFileSync } = require('child_process');
const {
  PORT,
  HOST,
  OPENCLAW_DIR,
  OPENCLAW_HOME,
  OPENCLAW_STATE_DIR,
  OPENCLAW_CONFIG_PATH,
  OPENCLAW_PROFILE,
  BROADCAST_INTERVAL_MS,
  APP_META,
  DEMO_MODE,
  AUTH_TOKEN,
  ENABLE_LAYOUT_WRITE,
  ALLOW_UNAUTHENTICATED_NETWORK,
  ALLOW_UNSAFE_NETWORK_PRIVATE_MODE,
} = require('./src/config');
const { PrivacySanitizer, PRIVACY_MODE } = require('./src/privacy');
const { buildDemoGatewaySnapshot, buildDemoSnapshot } = require('./src/demo');

const logsDir = path.join(__dirname, 'logs');
const fatalLogPath = path.join(logsDir, 'pixel-office.fatal.log');

function appendFatalLog(kind, error) {
  try {
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const ts = new Date().toISOString();
    const text = error instanceof Error
      ? `${error.stack || error.message}`
      : typeof error === 'string'
        ? error
        : JSON.stringify(error, null, 2);
    fs.appendFileSync(fatalLogPath, `\n[${ts}] ${kind}\n${text}\n`, 'utf8');
  } catch {}
}

process.on('uncaughtException', error => {
  appendFatalLog('uncaughtException', error);
  console.error('Pixel Office uncaughtException', error);
});

process.on('unhandledRejection', error => {
  appendFatalLog('unhandledRejection', error);
  console.error('Pixel Office unhandledRejection', error);
});

const { StateEngine } = require('./src/state-engine');

const engine = new StateEngine({ openclawDir: OPENCLAW_DIR });
const privacy = new PrivacySanitizer();
engine.refreshAll({ force: true });

function sanitize(payload) {
  return privacy.isEnabled() ? privacy.sanitizePayload(payload) : payload;
}

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "connect-src 'self' ws: wss:",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; '));
  next();
});
const layoutOverridesPath = path.join(__dirname, 'layout-overrides.json');

function isLoopbackHost(value) {
  const host = String(value || '').trim().toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

function getRequestToken(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  if (req.headers['x-pixel-office-token']) return String(req.headers['x-pixel-office-token']).trim();
  try {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    return String(url.searchParams.get('token') || '').trim();
  } catch {
    return '';
  }
}

function isAuthorized(req) {
  if (!AUTH_TOKEN) return true;
  const token = getRequestToken(req);
  return Boolean(token) && token === AUTH_TOKEN;
}

function requireApiAuth(req, res, next) {
  if (isAuthorized(req)) return next();
  return res.status(401).json({
    ok: false,
    error: 'Pixel Office API token required.',
  });
}

app.use('/api', requireApiAuth);

function readLayoutOverrides() {
  try {
    if (!fs.existsSync(layoutOverridesPath)) return { decor: {} };
    const parsed = JSON.parse(fs.readFileSync(layoutOverridesPath, 'utf8'));
    return {
      decor: parsed?.decor && typeof parsed.decor === 'object' ? parsed.decor : {},
    };
  } catch {
    return { decor: {} };
  }
}

function writeLayoutOverrides(next) {
  const payload = {
    decor: next?.decor && typeof next.decor === 'object' ? next.decor : {},
  };
  fs.writeFileSync(layoutOverridesPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir, {
    etag: false,
    lastModified: false,
    maxAge: 0,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    },
  }));
}

app.get('/', (req, res) => {
  if (fs.existsSync(path.join(publicDir, 'index.html'))) {
    return res.sendFile(path.join(publicDir, 'index.html'));
  }

  return res.json({
    ok: true,
    app: 'pixel-office-agent-monitor',
    frontend: fs.existsSync(publicDir) ? 'present' : 'missing',
    message: fs.existsSync(publicDir)
      ? 'Frontend directory exists, but index.html is missing. Rebuild the UI or restore public/index.html.'
      : 'Frontend has been wiped. Rebuild against /api/status, /api/status/delta, /api/topology, /api/agents/:name/history, and /api/session-history?key=<sessionKey>.',
    meta: {
      ...APP_META,
      privacyMode: privacy.isEnabled() ? PRIVACY_MODE : 'off',
    },
  });
});

app.get('/api/status', (req, res) => {
  if (DEMO_MODE) return res.json(buildDemoSnapshot());
  engine.refreshAll();
  res.json(sanitize(engine.getSnapshot()));
});

app.get('/api/status/delta', (req, res) => {
  if (DEMO_MODE) return res.json(buildDemoSnapshot());
  engine.refreshAll();
  res.json(sanitize(engine.getDeltaSince(req.query.since)));
});

app.get('/api/agents/:agent/history', (req, res) => {
  if (DEMO_MODE) {
    return res.json({
      agent: req.params.agent,
      history: [],
      demoMode: true,
    });
  }
  engine.refreshAll();
  if (privacy.isEnabled() && !privacy.hasAgentAlias(req.params.agent)) {
    return res.status(404).json({
      ok: false,
      error: 'Unknown agent alias.',
    });
  }
  const rawAgentId = privacy.isEnabled()
    ? privacy.resolveRawAgentId(req.params.agent)
    : req.params.agent;
  res.json(sanitize({
    agent: rawAgentId,
    history: engine.getAgentHistory(rawAgentId, req.query.limit),
  }));
});

app.get('/api/topology', (req, res) => {
  if (DEMO_MODE) {
    const snapshot = buildDemoSnapshot();
    return res.json({
      version: snapshot.version,
      summary: snapshot.summary,
      topology: snapshot.topology,
    });
  }
  engine.refreshAll();
  res.json(sanitize({
    version: engine.version,
    summary: engine.buildSummary(),
    topology: engine.getTopology(),
  }));
});

app.get('/api/session-history', (req, res) => {
  if (DEMO_MODE) {
    return res.json({
      sessionKey: req.query.key || null,
      history: [],
      demoMode: true,
    });
  }
  engine.refreshAll();
  if (privacy.isEnabled() && !privacy.hasSessionAlias(req.query.key)) {
    return res.status(404).json({
      ok: false,
      error: 'Unknown session alias.',
    });
  }
  const rawSessionKey = privacy.isEnabled()
    ? privacy.resolveRawSessionKey(req.query.key)
    : req.query.key;
  res.json(sanitize({
    sessionKey: rawSessionKey || null,
    history: engine.getSessionHistory(rawSessionKey, req.query.limit),
  }));
});

app.get('/api/debug/sessions', (req, res) => {
  if (DEMO_MODE) {
    return res.status(403).json({
      ok: false,
      error: 'Debug session feed is disabled in demo mode.',
    });
  }
  if (privacy.isEnabled()) {
    return res.status(403).json({
      ok: false,
      error: 'Debug session feed is disabled in privacy mode.',
    });
  }
  engine.refreshAll();
  return res.json(engine.getDebugSessions());
});

app.get('/api/gateway', (req, res) => {
  if (DEMO_MODE) return res.json(buildDemoGatewaySnapshot());
  const snapshot = getGatewaySnapshot();
  res.json(privacy.isEnabled() ? privacy.sanitizeGatewaySnapshot(snapshot) : snapshot);
});

app.get('/api/layout-overrides', (req, res) => {
  res.json(readLayoutOverrides());
});

app.post('/api/layout-overrides', (req, res) => {
  if (DEMO_MODE || !ENABLE_LAYOUT_WRITE) {
    return res.status(403).json({
      ok: false,
      error: 'Layout writes are disabled. Set PIXEL_OFFICE_ENABLE_LAYOUT_WRITE=1 for a private local editor session.',
    });
  }
  const current = readLayoutOverrides();
  const body = req.body || {};
  const decor = body.decor && typeof body.decor === 'object' ? body.decor : current.decor;
  const saved = writeLayoutOverrides({ decor });
  res.json({ ok: true, overrides: saved });
});

let gatewayCache = {
  fetchedAt: null,
  ok: false,
  summary: {
    runtime: 'Gateway status unavailable',
    listening: null,
    dashboard: null,
    probe: null,
    service: null,
  },
  statusLines: ['Gateway status has not been queried yet.'],
  logFile: null,
  logTail: [],
  liveLog: ['Gateway status has not been queried yet.'],
};

let gatewayCacheAt = 0;
const GATEWAY_CACHE_MS = 2500;

function readGatewaySnapshot() {
  const logCandidates = process.platform === 'win32'
    ? [
        path.join('C:\\tmp', 'openclaw', `openclaw-${new Date().toISOString().slice(0, 10)}.log`),
        path.join(process.env.TEMP || '', 'openclaw', `openclaw-${new Date().toISOString().slice(0, 10)}.log`),
        path.join(process.env.LOCALAPPDATA || '', 'Temp', 'openclaw', `openclaw-${new Date().toISOString().slice(0, 10)}.log`),
      ]
    : [
        path.join('/tmp', 'openclaw', `openclaw-${new Date().toISOString().slice(0, 10)}.log`),
        path.join(OPENCLAW_STATE_DIR, 'logs', 'commands.log'),
        path.join(OPENCLAW_HOME, 'logs', 'commands.log'),
      ];

  const fileLogs = logCandidates.find(candidate => candidate && fs.existsSync(candidate)) || logCandidates[0] || null;
  const openclawExe = process.platform === 'win32'
    ? path.join(process.env.APPDATA || '', 'npm', 'openclaw.cmd')
    : 'openclaw';
  const openclawEnv = {
    ...process.env,
    OPENCLAW_PROFILE,
    OPENCLAW_STATE_DIR,
    OPENCLAW_CONFIG_PATH,
    PIXEL_OFFICE_OPENCLAW_STATE_DIR: OPENCLAW_STATE_DIR,
    PIXEL_OFFICE_OPENCLAW_CONFIG_PATH: OPENCLAW_CONFIG_PATH,
  };

  delete openclawEnv.OPENCLAW_HOME;
  delete openclawEnv.OPENCLAW_DIR;

  const readTail = filePath => {
    try {
      if (!filePath || !fs.existsSync(filePath)) return [];
      const text = fs.readFileSync(filePath, 'utf8');
      return text.split(/\r?\n/).filter(Boolean).slice(-120);
    } catch {
      return [];
    }
  };

  let statusText = '';
  let ok = true;
  try {
    if (process.platform === 'win32') {
      statusText = execFileSync(openclawExe, ['--profile', OPENCLAW_PROFILE, 'gateway', 'status'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 12000,
        env: openclawEnv,
      });
    } else {
      statusText = execFileSync(openclawExe, ['--profile', OPENCLAW_PROFILE, 'gateway', 'status'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 12000,
        env: openclawEnv,
      });
    }
  } catch (error) {
    ok = false;
    statusText = [error.stdout, error.stderr].filter(Boolean).join('\n') || String(error.message || error);
  }

  const lines = statusText.split(/\r?\n/).map(line => line.trimEnd()).filter(Boolean);
  const runtimeLine = lines.find(line => line.startsWith('Runtime:')) || (ok ? 'Runtime: unavailable' : 'Runtime: degraded');
  const listeningLine = lines.find(line => line.startsWith('Listening:')) || null;
  const dashboardLine = lines.find(line => line.startsWith('Dashboard:')) || null;
  const probeLine = lines.find(line => line.startsWith('Probe target:')) || null;
  const serviceLine = lines.find(line => line.startsWith('Service:')) || null;
  const logTail = readTail(fileLogs);

  return {
    ok,
    fetchedAt: new Date().toISOString(),
    summary: {
      runtime: runtimeLine,
      listening: listeningLine,
      dashboard: dashboardLine,
      probe: probeLine,
      service: serviceLine,
    },
    statusLines: lines.slice(0, 120),
    logFile: fileLogs,
    logTail,
    liveLog: logTail.length ? logTail : (lines.length ? lines.slice(-40) : ['Gateway feed unavailable.']),
  };
}

function getGatewaySnapshot() {
  const now = Date.now();
  if ((now - gatewayCacheAt) > GATEWAY_CACHE_MS) {
    gatewayCache = readGatewaySnapshot();
    gatewayCacheAt = now;
  }
  return gatewayCache;
}

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const MAX_WS_CLIENTS = Number.parseInt(process.env.PIXEL_OFFICE_MAX_WS_CLIENTS || '24', 10);
const MAX_WS_BUFFERED_BYTES = Number.parseInt(process.env.PIXEL_OFFICE_MAX_WS_BUFFERED_BYTES || '1048576', 10);

function sendJson(ws, payload) {
  if (ws.readyState === 1) {
    if (ws.bufferedAmount > MAX_WS_BUFFERED_BYTES) {
      ws.close(1008, 'slow client');
      return;
    }
    ws.send(JSON.stringify(sanitize(payload)));
  }
}

function broadcast(payload) {
  if (!payload) return;
  for (const client of wss.clients) {
    sendJson(client, payload);
  }
}

wss.on('connection', ws => {
  if (DEMO_MODE) {
    return sendJson(ws, buildDemoSnapshot());
  }
  engine.refreshAll();
  sendJson(ws, engine.getSnapshot());
});

server.on('upgrade', (req, socket, head) => {
  if (!isAuthorized(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  if (wss.clients.size >= MAX_WS_CLIENTS) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, ws => {
    wss.emit('connection', ws, req);
  });
});

function createWatchPatterns() {
  return [
    path.join(OPENCLAW_DIR, '*', 'sessions', '*.jsonl'),
    path.join(OPENCLAW_DIR, '*', 'sessions', 'sessions.json'),
  ];
}

function startWatching() {
  const watcher = chokidar.watch(createWatchPatterns(), {
    persistent: true,
    ignoreInitial: true,
    usePolling: true,
    interval: 220,
  });

  let debounce = null;
  const trigger = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      try {
        const delta = engine.refreshAll();
        if (
          delta.changedAgents.length ||
          delta.removedAgents.length ||
          delta.changedSessions.length ||
          delta.removedSessions.length ||
          delta.transitions.length
        ) {
          broadcast(delta);
        }
      } catch (error) {
        appendFatalLog('watchTrigger', error);
        console.error('Pixel Office watch trigger failed', error);
      }
    }, 45);
  };

  watcher.on('change', trigger);
  watcher.on('add', trigger);
  watcher.on('unlink', trigger);

  setInterval(() => {
    try {
      const delta = engine.refreshAll();
      if (
        delta.changedAgents.length ||
        delta.removedAgents.length ||
        delta.changedSessions.length ||
        delta.removedSessions.length ||
        delta.transitions.length
      ) {
        broadcast(delta);
      }
    } catch (error) {
      appendFatalLog('refreshInterval', error);
      console.error('Pixel Office refresh interval failed', error);
    }
  }, BROADCAST_INTERVAL_MS);
}

if (!DEMO_MODE) {
  startWatching();
}

server.listen(PORT, HOST, () => {
  const loopback = isLoopbackHost(HOST);
  if (!loopback && !AUTH_TOKEN && !ALLOW_UNAUTHENTICATED_NETWORK) {
    console.error('Refusing to run on a non-loopback host without PIXEL_OFFICE_AUTH_TOKEN.');
    server.close(() => process.exit(1));
    return;
  }

  if (!loopback && !privacy.isEnabled() && !ALLOW_UNSAFE_NETWORK_PRIVATE_MODE) {
    console.error('Refusing non-loopback private mode. Enable privacy aliases or set PIXEL_OFFICE_ALLOW_UNSAFE_NETWORK_PRIVATE_MODE=1.');
    server.close(() => process.exit(1));
    return;
  }

  console.log(`Agent Monitor backend running at http://${HOST}:${PORT}`);
  if (process.env.PIXEL_OFFICE_VERBOSE_PATHS === '1') {
    console.log(`Watching (read-only): ${OPENCLAW_DIR}`);
    console.log(`OpenClaw state dir: ${OPENCLAW_STATE_DIR}`);
    console.log(`OpenClaw config path: ${OPENCLAW_CONFIG_PATH}`);
  } else {
    console.log('Watching (read-only): configured OpenClaw state');
  }
  console.log(`OpenClaw profile: ${OPENCLAW_PROFILE}`);
  console.log(`Protocol: ${APP_META.protocol}`);
  console.log(`Privacy mode: ${privacy.isEnabled() ? PRIVACY_MODE : 'off'}`);
  console.log(`Demo mode: ${DEMO_MODE ? 'on' : 'off'}`);
  console.log(`API auth: ${AUTH_TOKEN ? 'required' : 'not configured'}`);

  try {
    if (DEMO_MODE) {
      gatewayCache = buildDemoGatewaySnapshot();
      gatewayCacheAt = Date.now();
      return;
    }
    gatewayCache = readGatewaySnapshot();
    gatewayCacheAt = Date.now();
  } catch (error) {
    gatewayCache = {
      ok: false,
      fetchedAt: new Date().toISOString(),
      summary: {
        runtime: 'Gateway status unavailable',
        listening: null,
        dashboard: null,
        probe: null,
        service: null,
      },
      statusLines: [String(error.message || error)],
      logFile: null,
      logTail: [],
      liveLog: [String(error.message || error)],
    };
    gatewayCacheAt = Date.now();
  }
});
