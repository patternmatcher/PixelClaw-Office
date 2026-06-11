function getSessionKind(sessionKey = '') {
  const key = String(sessionKey || '');
  if (/^agent:[^:]+:subagent:/i.test(key)) return 'subagent';
  if (/^agent:[^:]+:acp:/i.test(key)) return 'acp';
  if (/^agent:[^:]+:cron:/i.test(key)) return 'cron';
  if (/^agent:[^:]+:main$/i.test(key)) return 'main';
  if (/:slash:/i.test(key)) return 'slash';
  if (/:topic:/i.test(key) || /:thread:/i.test(key)) return 'thread';
  if (/:group:/i.test(key)) return 'group';
  if (/:direct:/i.test(key)) return 'direct';
  return 'session';
}

function getRuntimeKind(sessionKind) {
  if (sessionKind === 'subagent') return 'subagent';
  if (sessionKind === 'acp') return 'acp';
  if (sessionKind === 'cron') return 'cron';
  return 'chat';
}

function getChannel(sessionKey = '', deliveryContext = null) {
  if (deliveryContext?.channel) return deliveryContext.channel;
  const key = String(sessionKey || '');
  for (const channel of ['telegram', 'discord', 'slack', 'whatsapp', 'signal', 'matrix', 'imessage']) {
    if (key.includes(`:${channel}:`)) return channel;
  }
  return null;
}

function getSpawnDepth(sessionKey = '', rawSpawnDepth = null) {
  if (Number.isFinite(Number(rawSpawnDepth))) return Number(rawSpawnDepth);
  const matches = String(sessionKey || '').match(/:subagent:/gi);
  return matches ? matches.length : 0;
}

function getParentSessionKey(sessionKey = '', spawnedBy = null) {
  if (spawnedBy) return spawnedBy;
  const key = String(sessionKey || '');
  const matches = key.match(/:subagent:/gi);
  const subagentDepth = matches ? matches.length : 0;
  if (subagentDepth > 1) {
    return key.replace(/:subagent:[^:]+$/i, '');
  }
  return null;
}

function getShortId(value = '') {
  const raw = String(value || '');
  const parts = raw.split(':');
  const tail = parts[parts.length - 1] || raw;
  return tail.slice(0, 8);
}

function isAuxiliarySessionKind(sessionKind) {
  return ['subagent', 'acp', 'cron'].includes(sessionKind);
}

function getSessionPriority(meta) {
  const kind = meta.sessionKind;
  if (kind === 'main') return 6;
  if (kind === 'direct') return 5;
  if (kind === 'thread') return 4;
  if (kind === 'group') return 3;
  if (kind === 'slash') return 2;
  if (kind === 'session') return 1;
  return 0;
}

function pickPrimarySession(snapshots) {
  const primaryCandidates = snapshots.filter(snapshot => !snapshot.isAuxiliary);
  const candidates = primaryCandidates.length ? primaryCandidates : snapshots.slice();
  if (!candidates.length) return null;

  const sorted = candidates.slice().sort((a, b) => {
    const aAge = a.sessionAgeSec ?? Number.MAX_SAFE_INTEGER;
    const bAge = b.sessionAgeSec ?? Number.MAX_SAFE_INTEGER;
    if (aAge !== bAge) return aAge - bAge;

    const aPending = a.pendingCount || 0;
    const bPending = b.pendingCount || 0;
    if (aPending !== bPending) return bPending - aPending;

    const aPriority = getSessionPriority(a);
    const bPriority = getSessionPriority(b);
    if (aPriority !== bPriority) return bPriority - aPriority;

    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  return sorted[0] || null;
}

function shouldExposeSessionEntity(snapshot, primarySessionKey, config) {
  const sessionKind = snapshot.sessionKind;
  const isPrimary = snapshot.sessionKey === primarySessionKey;
  const ageMs = (snapshot.sessionAgeSec ?? Number.MAX_SAFE_INTEGER) * 1000;
  const isActive = snapshot.state !== 'idle' || (snapshot.pendingCount || 0) > 0;

  if (isPrimary && !snapshot.isAuxiliary) {
    return {
      expose: false,
      reason: 'primary_non_aux_session_hidden',
      ageMs,
      isActive,
      retentionMs: null,
    };
  }
  if (isActive) {
    return {
      expose: true,
      reason: 'active_session',
      ageMs,
      isActive,
      retentionMs: null,
    };
  }

  let retentionMs = config.CHAT_SESSION_RETENTION_MS;
  if (sessionKind === 'acp') retentionMs = config.ACP_SESSION_RETENTION_MS;
  else if (sessionKind === 'subagent') retentionMs = config.SUBAGENT_SESSION_RETENTION_MS;
  else if (sessionKind === 'cron') retentionMs = config.CRON_SESSION_RETENTION_MS;

  return {
    expose: ageMs <= retentionMs,
    reason: ageMs <= retentionMs ? 'retention_window' : 'retention_expired',
    ageMs,
    isActive,
    retentionMs,
  };
}

function buildSessionDisplayName(meta) {
  const label = meta.label ? String(meta.label).trim() : '';
  const externalName = meta.displayName ? String(meta.displayName).trim() : '';
  const subject = meta.subject ? String(meta.subject).trim() : '';

  if (label) return `${meta.agentId} - ${label}`;
  if (externalName && !/^agent[:\-]/i.test(externalName)) return `${meta.agentId} - ${externalName}`;
  if (subject) return `${meta.agentId} - ${subject}`;

  if (meta.sessionKind === 'main') return meta.agentId;
  if (meta.sessionKind === 'subagent') return `${meta.agentId} - subagent ${meta.shortId}`;
  if (meta.sessionKind === 'acp') return `${meta.agentId} - ACP ${meta.shortId}`;
  if (meta.sessionKind === 'cron') return `${meta.agentId} - cron ${meta.shortId}`;
  if (meta.sessionKind === 'direct') return `${meta.agentId} - direct`;
  if (meta.sessionKind === 'group') return `${meta.agentId} - group`;
  if (meta.sessionKind === 'thread') return `${meta.agentId} - thread`;
  if (meta.sessionKind === 'slash') return `${meta.agentId} - slash`;
  return `${meta.agentId} - session`;
}

function extractModelInfo(raw) {
  const provider = raw.modelProvider || raw.providerOverride || raw.systemPromptReport?.provider || null;
  const model = raw.model || raw.modelOverride || raw.systemPromptReport?.model || null;

  let source = null;
  if (raw.model || raw.modelProvider) source = 'session-store';
  else if (raw.modelOverride || raw.providerOverride) source = 'override';
  else if (raw.systemPromptReport?.model || raw.systemPromptReport?.provider) source = 'system-prompt-report';

  return {
    provider,
    model,
    providerOverride: raw.providerOverride || null,
    modelOverride: raw.modelOverride || null,
    authProfile: raw.authProfileOverride || null,
    source,
  };
}

function extractRuntimeInfo(raw, sessionKind, channel) {
  const sandbox = raw.systemPromptReport?.sandbox || null;
  return {
    runtimeKind: getRuntimeKind(sessionKind),
    provider: raw.origin?.provider || channel || raw.lastChannel || null,
    surface: raw.origin?.surface || null,
    channel,
    accountId: raw.deliveryContext?.accountId || raw.lastAccountId || raw.origin?.accountId || null,
    chatType: raw.chatType || raw.origin?.chatType || null,
    sandboxed: Boolean(sandbox?.sandboxed),
    sandboxMode: sandbox?.mode || null,
    workspaceDir: raw.systemPromptReport?.workspaceDir || null,
  };
}

function decorateSessionMeta(agentId, raw) {
  const sessionKey = raw.key || raw.sessionKey || raw.sessionId;
  const sessionKind = getSessionKind(sessionKey);
  const channel = getChannel(sessionKey, raw.deliveryContext);
  const spawnDepth = getSpawnDepth(sessionKey, raw.spawnDepth);
  const spawnedBy = raw.spawnedBy || null;
  const parentSessionKey = getParentSessionKey(sessionKey, spawnedBy);
  const shortId = getShortId(sessionKey || raw.sessionId);
  const modelInfo = extractModelInfo(raw);
  const runtimeInfo = extractRuntimeInfo(raw, sessionKind, channel);

  return {
    ...raw,
    agentId,
    sessionKey,
    sessionKind,
    runtimeKind: getRuntimeKind(sessionKind),
    channel,
    spawnDepth,
    spawnedBy,
    parentSessionKey,
    shortId,
    modelInfo,
    runtimeInfo,
    isAuxiliary: isAuxiliarySessionKind(sessionKind),
    displayName: buildSessionDisplayName({
      ...raw,
      agentId,
      sessionKind,
      shortId,
    }),
    entityId: `session:${sessionKey}`,
  };
}

function countKinds(snapshots) {
  const counts = {};
  for (const snapshot of snapshots) {
    counts[snapshot.sessionKind] = (counts[snapshot.sessionKind] || 0) + 1;
  }
  return counts;
}

module.exports = {
  getSessionKind,
  getRuntimeKind,
  getChannel,
  getSpawnDepth,
  getParentSessionKey,
  getShortId,
  isAuxiliarySessionKind,
  pickPrimarySession,
  shouldExposeSessionEntity,
  buildSessionDisplayName,
  extractModelInfo,
  extractRuntimeInfo,
  decorateSessionMeta,
  countKinds,
};
