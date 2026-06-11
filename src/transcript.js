const fs = require('fs');
const path = require('path');
const { FILE_TAIL_BYTES, FILE_TAIL_LINES } = require('./config');
const { inspect } = require('node:util');
const { getToolMeta } = require('./tool-status');

const SESSION_HEADER_READ_BYTES = 16 * 1024;

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function statSafe(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function isoToMs(ts) {
  const n = new Date(ts).getTime();
  return Number.isFinite(n) ? n : 0;
}

function getAgentDirs(openclawDir) {
  try {
    return fs.readdirSync(openclawDir).filter(name => {
      try {
        return fs.statSync(path.join(openclawDir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function parseJsonLines(lines) {
  return lines
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function splitJsonlText(text) {
  const normalized = String(text || '');
  if (!normalized) {
    return { lines: [], remainder: '' };
  }

  const endsWithNewline = /\r?\n$/.test(normalized);
  const parts = normalized.split(/\r?\n/);

  if (endsWithNewline) {
    const lines = parts.filter(Boolean);
    return { lines, remainder: '' };
  }

  const remainder = parts.pop() || '';
  const lines = parts.filter(Boolean);
  return { lines, remainder };
}

function readChunk(filePath, start, length) {
  if (length <= 0) return Buffer.alloc(0);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

function readSessionHeader(filePath, previousHeader = null) {
  if (!filePath) return previousHeader || null;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.size) return null;
    const length = Math.min(stat.size, SESSION_HEADER_READ_BYTES);
    const buffer = readChunk(filePath, 0, length);
    const text = buffer.toString('utf8');
    const newline = text.indexOf('\n');
    const firstLine = (newline === -1 ? text : text.slice(0, newline)).trim();
    if (!firstLine) return null;
    const parsed = JSON.parse(firstLine);
    return parsed?.type === 'session' ? parsed : null;
  } catch {
    return previousHeader || null;
  }
}

function buildInitialTranscriptWindow(filePath, maxBytes = FILE_TAIL_BYTES, maxLines = FILE_TAIL_LINES, previousHeader = null) {
  const stat = statSafe(filePath);
  if (!stat?.size) {
    return {
      entries: [],
      parserState: {
        filePath,
        offset: 0,
        mtimeMs: stat?.mtimeMs || 0,
        remainder: '',
        entries: [],
        header: readSessionHeader(filePath, previousHeader),
        initialized: true,
        lastReadMode: 'initial-empty',
      },
      mode: 'initial-empty',
      bytesRead: 0,
    };
  }

  const start = Math.max(0, stat.size - maxBytes);
  const buffer = readChunk(filePath, start, stat.size - start);
  let text = buffer.toString('utf8');

  if (start > 0) {
    const firstNewline = text.indexOf('\n');
    text = firstNewline === -1 ? '' : text.slice(firstNewline + 1);
  }

  const { lines, remainder } = splitJsonlText(text);
  const entries = parseJsonLines(lines).slice(-maxLines);

  return {
    entries,
    parserState: {
      filePath,
      offset: stat.size,
      mtimeMs: stat.mtimeMs || 0,
      remainder,
      entries,
      header: readSessionHeader(filePath, previousHeader),
      initialized: true,
      lastReadMode: 'initial-tail',
    },
    mode: 'initial-tail',
    bytesRead: stat.size - start,
  };
}

function readTranscriptWindowIncremental(filePath, previousState = null, maxBytes = FILE_TAIL_BYTES, maxLines = FILE_TAIL_LINES) {
  const stat = statSafe(filePath);
  if (!stat) {
    return {
      entries: [],
      parserState: {
        filePath,
        offset: 0,
        mtimeMs: 0,
        remainder: '',
        entries: [],
        header: previousState?.header || null,
        initialized: true,
        lastReadMode: 'missing',
      },
      mode: 'missing',
      bytesRead: 0,
    };
  }

  const canIncrementallyReuse = previousState
    && previousState.initialized
    && previousState.filePath === filePath
    && stat.size >= (previousState.offset || 0);

  if (!canIncrementallyReuse) {
    return buildInitialTranscriptWindow(filePath, maxBytes, maxLines, previousState?.header || null);
  }

  if ((previousState.offset || 0) === stat.size && previousState.mtimeMs === stat.mtimeMs) {
    return {
      entries: previousState.entries || [],
      parserState: {
        ...previousState,
        lastReadMode: 'cache-hit',
      },
      mode: 'cache-hit',
      bytesRead: 0,
    };
  }

  const appendedBytes = stat.size - (previousState.offset || 0);
  if (appendedBytes > maxBytes) {
    return buildInitialTranscriptWindow(filePath, maxBytes, maxLines, previousState.header || null);
  }

  const buffer = readChunk(filePath, previousState.offset || 0, appendedBytes);
  const text = `${previousState.remainder || ''}${buffer.toString('utf8')}`;
  const { lines, remainder } = splitJsonlText(text);
  const parsedEntries = parseJsonLines(lines);
  const entries = [...(previousState.entries || []), ...parsedEntries].slice(-maxLines);

  return {
    entries,
    parserState: {
      ...previousState,
      filePath,
      offset: stat.size,
      mtimeMs: stat.mtimeMs || 0,
      remainder,
      entries,
      header: previousState.header || readSessionHeader(filePath, previousState.header || null),
      initialized: true,
      lastReadMode: parsedEntries.length ? 'incremental-append' : 'incremental-touch',
    },
    mode: parsedEntries.length ? 'incremental-append' : 'incremental-touch',
    bytesRead: appendedBytes,
  };
}

function tailLines(filePath, maxBytes = FILE_TAIL_BYTES, maxLines = FILE_TAIL_LINES) {
  return buildInitialTranscriptWindow(filePath, maxBytes, maxLines).entries;
}

function getSessionsIndexPath(openclawDir, agentName) {
  return path.join(openclawDir, agentName, 'sessions', 'sessions.json');
}

function getSessionsIndex(openclawDir, agentName) {
  return safeReadJson(getSessionsIndexPath(openclawDir, agentName)) || {};
}

function resolveSessionFile(openclawDir, agentName, candidate) {
  if (!candidate) return null;
  const sessionsDir = path.resolve(openclawDir, agentName, 'sessions');
  const resolved = path.resolve(String(candidate));
  if (resolved !== sessionsDir && !resolved.startsWith(`${sessionsDir}${path.sep}`)) return null;
  const stat = statSafe(resolved);
  if (!stat || !stat.isFile()) return null;
  return resolved;
}

function listSessions(openclawDir, agentName) {
  const sessionsIndexPath = getSessionsIndexPath(openclawDir, agentName);
  const sessionsIndex = getSessionsIndex(openclawDir, agentName);
  const entries = Object.entries(sessionsIndex)
    .map(([key, value]) => {
      const sessionFile = resolveSessionFile(openclawDir, agentName, value?.sessionFile);
      if (!sessionFile) return null;
      return {
        key,
        sessionId: value?.sessionId || key,
        sessionsIndexPath,
        ...value,
        sessionFile,
      };
    })
    .filter(Boolean);

  if (entries.length) {
    return entries.sort((a, b) => {
      const byTime = (b.updatedAt || 0) - (a.updatedAt || 0);
      if (Math.abs(byTime) > 1000) return byTime;
      const aMain = /:main$/i.test(a.key) ? 1 : 0;
      const bMain = /:main$/i.test(b.key) ? 1 : 0;
      return bMain - aMain;
    });
  }

  const sessionsDir = path.join(openclawDir, agentName, 'sessions');
  try {
    return fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl') && !f.includes('.reset') && !f.includes('.deleted.'))
      .map(f => ({
        key: f,
        sessionId: f,
        sessionFile: path.join(sessionsDir, f),
        updatedAt: statSafe(path.join(sessionsDir, f))?.mtimeMs || 0,
        deliveryContext: null,
        label: null,
        sessionsIndexPath,
      }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch {
    return [];
  }
}

function pickActiveSession(openclawDir, agentName) {
  return listSessions(openclawDir, agentName)[0] || null;
}

function buildUserPreview(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  const text = content
    .filter(item => item?.type === 'text')
    .map(item => item.text)
    .join('\n')
    .trim();

  if (!text) return 'Task received';
  return text.replace(/\s+/g, ' ').slice(0, 180);
}

function classifyTaskText(text = '') {
  const normalized = String(text).trim();
  if (!normalized) return { kind: 'task', text: 'Task received' };
  if (normalized.startsWith('System:')) return { kind: 'system', text: normalized };
  if (normalized.startsWith('[Queued messages while agent was busy]')) {
    return { kind: 'queued', text: normalized };
  }
  return { kind: 'user', text: normalized };
}

function deriveModelFromEntries(entries) {
  let modelProvider = null;
  let model = null;

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;

    if (entry.type === 'model_change') {
      modelProvider = entry.provider || modelProvider;
      model = entry.modelId || entry.model || model;
    }

    if (entry.type === 'custom' && entry.customType === 'model-snapshot' && entry.data) {
      modelProvider = entry.data.provider || modelProvider;
      model = entry.data.modelId || entry.data.model || model;
    }

    if (entry.type === 'message' && entry.message) {
      modelProvider = entry.message.provider || modelProvider;
      model = entry.message.model || model;
    }
  }

  return {
    provider: modelProvider,
    model,
  };
}

function maybePromoteMonitoring(event) {
  if (!event) return event;
  const haystack = `${event.label || ''} ${event.fullLabel || ''} ${event.tool || ''} ${event.inputPreview || ''} ${event.outputPreview || ''}`.toLowerCase();
  const looksLikeMonitoring = /(heartbeat|health ?check|healthcheck|monitor|monitoring|watch|watching|status|uptime|supervis|poll|gateway status|tail|follow|log)/.test(haystack);
  const monitorishTool = ['process', 'exec', 'session_status', 'nodes', 'sessions_list'].includes(event.tool);

  if (looksLikeMonitoring && monitorishTool) {
    return {
      ...event,
      state: 'monitoring',
      station: 'monitoring',
      label: event.label && event.label !== 'Running commands' && event.label !== 'Managing process'
        ? event.label
        : 'Monitoring',
    };
  }
  return event;
}

function compactPreview(value, limit = 220) {
  if (value == null) return '';
  const text = typeof value === 'string'
    ? value
    : inspect(value, { depth: 3, breakLength: 120, maxArrayLength: 20, maxStringLength: 160 });
  return text.replace(/\s+/g, ' ').trim().slice(0, limit);
}

function deriveStateFromTranscript(entries) {
  const activityLog = [];
  const pendingTools = new Map();
  let taskStart = null;
  let lastEvent = null;
  let lastUserTs = null;

  for (const entry of entries) {
    if (entry.type !== 'message' || !entry.message) continue;
    const message = entry.message;
    const ts = entry.timestamp;
    const tsMs = isoToMs(ts);

    if (message.role === 'user') {
      const preview = buildUserPreview(message);
      const classified = classifyTaskText(preview);
      taskStart = ts;
      lastUserTs = ts;
      const event = {
        ts,
        tsMs,
        kind: classified.kind,
        state: 'queued',
        station: 'queued',
        label: classified.kind === 'system'
          ? 'System task queued'
          : classified.kind === 'queued'
          ? 'Queued messages received'
          : preview,
        fullLabel: classified.text,
        confidence: classified.kind === 'system' ? 0.94 : 0.96,
        taskKind: classified.kind,
      };
      activityLog.push(event);
      lastEvent = event;
      continue;
    }

    if (message.role === 'assistant') {
      const content = Array.isArray(message.content) ? message.content : [];
      let hasToolCall = false;
      let hasText = false;
      let hasThinking = false;

      for (const item of content) {
        if (item?.type === 'toolCall') {
          hasToolCall = true;
          const meta = getToolMeta(item.name);
          const event = maybePromoteMonitoring({
            ts,
            tsMs,
            kind: 'toolCall',
            state: meta.state,
            station: meta.station,
            label: meta.label,
            tool: item.name,
            toolCallId: item.id,
            inputPreview: compactPreview(item.input),
            confidence: 0.99,
          });
          pendingTools.set(item.id, event);
          activityLog.push(event);
          lastEvent = event;
        }

        if (item?.type === 'thinking') {
          hasThinking = true;
          const event = {
            ts,
            tsMs,
            kind: 'thinking',
            state: 'thinking',
            station: 'thinking',
            label: 'Thinking',
            confidence: 0.83,
          };
          activityLog.push(event);
          if (!hasToolCall) lastEvent = event;
        }

        if (item?.type === 'text' && item.text?.trim()) {
          hasText = true;
        }
      }

      if (hasText && !hasToolCall) {
        const event = {
          ts,
          tsMs,
          kind: 'reply',
          state: 'responding',
          station: 'replying',
          label: 'Replying',
          confidence: hasThinking ? 0.8 : 0.98,
        };
        activityLog.push(event);
        lastEvent = event;
      }
      continue;
    }

    if (message.role === 'toolResult') {
      pendingTools.delete(message.toolCallId);
      const event = maybePromoteMonitoring({
        ts,
        tsMs,
        kind: 'toolResult',
        state: 'thinking',
        station: 'thinking',
        label: 'Processing result',
        tool: message.toolName,
        outputPreview: compactPreview(message.content || message.output || message.result),
        confidence: 0.92,
      });
      activityLog.push(event);
      lastEvent = event;
      continue;
    }
  }

  const activePending = [...pendingTools.values()].sort((a, b) => b.tsMs - a.tsMs)[0] || null;
  const modelMeta = deriveModelFromEntries(entries);

  if (activePending) {
    return {
      current: activePending,
      activityLog,
      taskStart,
      lastUserTs,
      pendingCount: pendingTools.size,
      modelMeta,
    };
  }

  return {
    current: lastEvent || {
      ts: null,
      tsMs: 0,
      kind: 'idle',
      state: 'idle',
      station: 'idle',
      label: 'Idle',
      confidence: 0.95,
    },
    activityLog,
    taskStart,
    lastUserTs,
    pendingCount: 0,
    modelMeta,
  };
}

module.exports = {
  safeReadJson,
  statSafe,
  isoToMs,
  getAgentDirs,
  tailLines,
  readSessionHeader,
  readTranscriptWindowIncremental,
  getSessionsIndexPath,
  getSessionsIndex,
  listSessions,
  pickActiveSession,
  buildUserPreview,
  classifyTaskText,
  deriveModelFromEntries,
  deriveStateFromTranscript,
};
