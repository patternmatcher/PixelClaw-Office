const fs = require('fs');
const os = require('os');
const path = require('path');

function pickOpenClawStateDir() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const configPathCandidates = [
    process.env.PIXEL_OFFICE_OPENCLAW_CONFIG_PATH,
    process.env.OPENCLAW_CONFIG_PATH,
  ].filter(Boolean).map(candidate => path.dirname(candidate));

  const candidates = [
    process.env.PIXEL_OFFICE_OPENCLAW_STATE_DIR,
    process.env.OPENCLAW_STATE_DIR,
    ...configPathCandidates,
    process.env.OPENCLAW_HOME,
    path.join(homeDir, '.openclaw-work'),
    path.join(homeDir, '.openclaw'),
  ].filter(Boolean);

  return candidates.find(candidate => fs.existsSync(candidate))
    || process.env.PIXEL_OFFICE_OPENCLAW_STATE_DIR
    || process.env.OPENCLAW_STATE_DIR
    || configPathCandidates[0]
    || process.env.OPENCLAW_HOME
    || path.join(homeDir, '.openclaw-work');
}

const PORT = Number(process.env.PORT || 7823);
const HOST = String(process.env.HOST || '127.0.0.1').trim();
const DEMO_MODE = ['1', 'true', 'yes', 'on'].includes(String(process.env.PIXEL_OFFICE_DEMO_MODE || '').trim().toLowerCase());
const AUTH_TOKEN = String(process.env.PIXEL_OFFICE_AUTH_TOKEN || '').trim();
const ENABLE_LAYOUT_WRITE = ['1', 'true', 'yes', 'on'].includes(String(process.env.PIXEL_OFFICE_ENABLE_LAYOUT_WRITE || '').trim().toLowerCase());
const ALLOW_UNAUTHENTICATED_NETWORK = ['1', 'true', 'yes', 'on'].includes(String(process.env.PIXEL_OFFICE_ALLOW_UNAUTHENTICATED_NETWORK || '').trim().toLowerCase());
const ALLOW_UNSAFE_NETWORK_PRIVATE_MODE = ['1', 'true', 'yes', 'on'].includes(String(process.env.PIXEL_OFFICE_ALLOW_UNSAFE_NETWORK_PRIVATE_MODE || '').trim().toLowerCase());
const OPENCLAW_STATE_DIR = path.resolve(pickOpenClawStateDir());
const OPENCLAW_CONFIG_PATH = path.resolve(
  process.env.PIXEL_OFFICE_OPENCLAW_CONFIG_PATH
    || process.env.OPENCLAW_CONFIG_PATH
    || path.join(OPENCLAW_STATE_DIR, 'openclaw.json')
);
const OPENCLAW_DIR = path.resolve(process.env.OPENCLAW_DIR || path.join(OPENCLAW_STATE_DIR, 'agents'));
const OPENCLAW_PROFILE = String(
  process.env.PIXEL_OFFICE_OPENCLAW_PROFILE
    || process.env.OPENCLAW_PROFILE
    || 'work'
).trim();
const OPENCLAW_HOME = OPENCLAW_STATE_DIR;
const ACTIVE_WINDOW_MS = 15_000;
const BROADCAST_INTERVAL_MS = 350;
const FILE_TAIL_BYTES = 256 * 1024;
const FILE_TAIL_LINES = 300;
const TRANSITION_HISTORY_LIMIT = 50;
const RECENT_TRANSITIONS_LIMIT = 200;
const DELTA_LOG_LIMIT = 200;
const CHAT_SESSION_RETENTION_MS = 20 * 60_000;
const CRON_SESSION_RETENTION_MS = 90 * 60_000;
const SUBAGENT_SESSION_RETENTION_MS = 60 * 60_000;
const ACP_SESSION_RETENTION_MS = 6 * 60 * 60_000;

const APP_META = {
  readOnly: true,
  writesIntoOpenClaw: false,
  activeWindowMs: ACTIVE_WINDOW_MS,
  version: '3.2.0',
  protocol: 'delta-v3',
  demoMode: DEMO_MODE,
};

module.exports = {
  PORT,
  HOST,
  DEMO_MODE,
  AUTH_TOKEN,
  ENABLE_LAYOUT_WRITE,
  ALLOW_UNAUTHENTICATED_NETWORK,
  ALLOW_UNSAFE_NETWORK_PRIVATE_MODE,
  OPENCLAW_STATE_DIR,
  OPENCLAW_CONFIG_PATH,
  OPENCLAW_HOME,
  OPENCLAW_DIR,
  OPENCLAW_PROFILE,
  ACTIVE_WINDOW_MS,
  BROADCAST_INTERVAL_MS,
  FILE_TAIL_BYTES,
  FILE_TAIL_LINES,
  TRANSITION_HISTORY_LIMIT,
  RECENT_TRANSITIONS_LIMIT,
  DELTA_LOG_LIMIT,
  CHAT_SESSION_RETENTION_MS,
  CRON_SESSION_RETENTION_MS,
  SUBAGENT_SESSION_RETENTION_MS,
  ACP_SESSION_RETENTION_MS,
  APP_META,
};
