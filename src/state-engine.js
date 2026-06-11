const {
  APP_META,
  ACTIVE_WINDOW_MS,
  FILE_TAIL_BYTES,
  FILE_TAIL_LINES,
  TRANSITION_HISTORY_LIMIT,
  RECENT_TRANSITIONS_LIMIT,
  DELTA_LOG_LIMIT,
  CHAT_SESSION_RETENTION_MS,
  CRON_SESSION_RETENTION_MS,
  SUBAGENT_SESSION_RETENTION_MS,
  ACP_SESSION_RETENTION_MS,
} = require('./config');
const {
  statSafe,
  getAgentDirs,
  listSessions,
  readTranscriptWindowIncremental,
  deriveStateFromTranscript,
} = require('./transcript');
const {
  decorateSessionMeta,
  pickPrimarySession,
  shouldExposeSessionEntity,
  countKinds,
} = require('./session-meta');

function iso(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const VISIBILITY_CONFIG = {
  CHAT_SESSION_RETENTION_MS,
  CRON_SESSION_RETENTION_MS,
  SUBAGENT_SESSION_RETENTION_MS,
  ACP_SESSION_RETENTION_MS,
};

const LIVE_EVENT_WINDOW_MS = 30_000;
const QUIET_FILE_TOUCH_WINDOW_MS = 120_000;
const QUIET_LOCK_WINDOW_MS = 90_000;
const STALE_WINDOW_MS = 5 * 60_000;

function deriveComms(entity) {
  const runtime = entity?.runtimeInfo || {};
  const delivery = entity?.deliveryContext || {};
  const provider = runtime.provider || runtime.channel || entity?.channel || null;
  const accountId = runtime.accountId || delivery.accountId || null;
  const chatId = delivery.chat_id || delivery.chatId || null;
  const lastSeen = entity?.lastSeen || entity?.lastActivity || null;
  const statusText = String(entity?.status || '').toLowerCase();
  const healthState = String(entity?.health?.state || 'unknown').toLowerCase();
  const tool = String(entity?.tool || '').toLowerCase();
  const pendingCount = Number(entity?.pendingCount || 0);
  const lastEventAgeSec = Number(entity?.lastEventAgeSec || 0);
  const lastEventKind = String(entity?.lastEventKind || '').toLowerCase();
  const taskKind = String(entity?.taskKind || '').toLowerCase();

  if (!provider) {
    return {
      state: 'unknown',
      canReply: null,
      provider: null,
      accountId,
      chatId,
      reason: 'No direct transport evidence',
      lastOutboundOkAt: null,
      lastOutboundErrorAt: null,
      lastOutboundError: null,
    };
  }

  if ((taskKind === 'system' || lastEventKind === 'system') && provider && lastEventAgeSec <= 600) {
    return {
      state: 'degraded',
      canReply: true,
      provider,
      accountId,
      chatId,
      reason: 'System startup / post-compact recovery in progress',
      lastOutboundOkAt: lastSeen,
      lastOutboundErrorAt: null,
      lastOutboundError: null,
    };
  }

  if (healthState === 'stuck') {
    return {
      state: 'blocked',
      canReply: false,
      provider,
      accountId,
      chatId,
      reason: tool === 'process' ? 'Waiting on process poll - cannot reply' : 'Agent looks stuck',
      lastOutboundOkAt: null,
      lastOutboundErrorAt: lastSeen,
      lastOutboundError: tool === 'process' ? 'Long-running process polling' : 'Session appears stuck',
    };
  }

  if (tool === 'process' && provider && (pendingCount > 0 || lastEventAgeSec > 45)) {
    return {
      state: 'blocked',
      canReply: false,
      provider,
      accountId,
      chatId,
      reason: 'Busy polling a live process - reply path blocked',
      lastOutboundOkAt: null,
      lastOutboundErrorAt: lastSeen,
      lastOutboundError: 'Active process wait',
    };
  }

  if (healthState === 'stale' || healthState === 'slow') {
    return {
      state: 'degraded',
      canReply: true,
      provider,
      accountId,
      chatId,
      reason: healthState === 'slow' ? 'Reply path may be slow' : 'Recent activity is stale',
      lastOutboundOkAt: lastSeen,
      lastOutboundErrorAt: null,
      lastOutboundError: null,
    };
  }

  if (healthState === 'idle') {
    return {
      state: 'degraded',
      canReply: true,
      provider,
      accountId,
      chatId,
      reason: `${provider} detected - reply not yet verified`,
      lastOutboundOkAt: lastSeen,
      lastOutboundErrorAt: null,
      lastOutboundError: null,
    };
  }

  if (statusText.includes('error') || statusText.includes('failed') || statusText.includes('blocked')) {
    return {
      state: 'blocked',
      canReply: false,
      provider,
      accountId,
      chatId,
      reason: entity?.status || 'Reply blocked',
      lastOutboundOkAt: null,
      lastOutboundErrorAt: lastSeen,
      lastOutboundError: entity?.status || 'Reply blocked',
    };
  }

  return {
    state: 'ok',
    canReply: true,
    provider,
    accountId,
    chatId,
    reason: 'Reply path looks healthy',
    lastOutboundOkAt: lastSeen,
    lastOutboundErrorAt: null,
    lastOutboundError: null,
  };
}

const HEALTH_SEVERITY = {
  unknown: 0,
  idle: 1,
  healthy: 2,
  slow: 3,
  stale: 4,
  stuck: 5,
};

function summarizeEvent(event) {
  if (!event) return null;
  return {
    ts: event.ts,
    label: event.label,
    fullLabel: event.fullLabel || event.label,
    state: event.state,
    kind: event.kind,
    taskKind: event.taskKind || null,
    tool: event.tool || null,
  };
}

function summarizeForTransition(snapshot) {
  if (!snapshot) return null;
  return {
    entityType: snapshot.entityType,
    state: snapshot.state,
    station: snapshot.station,
    status: snapshot.status,
    tool: snapshot.tool || null,
    health: snapshot.health?.state || 'unknown',
    sessionKind: snapshot.sessionKind || null,
    sourceSessionKey: snapshot.sourceSessionKey || snapshot.sessionKey || null,
  };
}

function pickWorstHealth(snapshots) {
  let worst = null;
  for (const snapshot of snapshots) {
    const state = snapshot?.health?.state || 'unknown';
    const severity = HEALTH_SEVERITY[state] || 0;
    if (!worst || severity > worst.severity) {
      worst = { severity, snapshot };
    }
  }
  return worst?.snapshot || null;
}

function countBy(items, valueFn) {
  const counts = {};
  for (const item of items) {
    const value = valueFn(item);
    if (!value) continue;
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function mergeModelInfo(sessionModelInfo, transcriptModelMeta) {
  const provider = transcriptModelMeta?.provider || sessionModelInfo?.provider || null;
  const model = transcriptModelMeta?.model || sessionModelInfo?.model || null;
  const source = transcriptModelMeta?.provider || transcriptModelMeta?.model
    ? 'transcript'
    : sessionModelInfo?.source || null;

  return {
    provider,
    model,
    providerOverride: sessionModelInfo?.providerOverride || null,
    modelOverride: sessionModelInfo?.modelOverride || null,
    authProfile: sessionModelInfo?.authProfile || null,
    source,
  };
}

function deriveLiveness({ current, sessionFile, sessionMeta, sessionStat, now, lastEventAgeMs, sessionAgeMs, state, pendingCount }) {
  const sessionFileMtimeMs = sessionStat?.mtimeMs || 0;
  const updatedAtMs = Number(sessionMeta?.updatedAt || 0);
  const lockFile = sessionFile ? `${sessionFile}.lock` : null;
  const lockStat = lockFile ? statSafe(lockFile) : null;
  const lockMtimeMs = lockStat?.mtimeMs || 0;
  const lastFileTouchMs = Math.max(sessionFileMtimeMs, updatedAtMs, lockMtimeMs);
  const lastFileTouchAgeMs = lastFileTouchMs ? Math.max(0, now - lastFileTouchMs) : Number.MAX_SAFE_INTEGER;
  const hasRecentLock = Boolean(lockMtimeMs) && (now - lockMtimeMs) <= QUIET_LOCK_WINDOW_MS;
  const hasRecentFileTouch = Boolean(lastFileTouchMs) && lastFileTouchAgeMs <= QUIET_FILE_TOUCH_WINDOW_MS;
  const hasRecentEvent = Number.isFinite(lastEventAgeMs) && lastEventAgeMs <= LIVE_EVENT_WINDOW_MS;
  const isExplicitlyActive = current?.kind === 'toolCall' || (pendingCount || 0) > 0 || state !== 'idle';

  let livenessState = 'idle';
  let label = 'Idle';
  const reasons = [];

  if (hasRecentEvent || isExplicitlyActive) {
    livenessState = 'active';
    label = 'Active';
    if (hasRecentEvent) reasons.push('recent_event');
    if (current?.kind === 'toolCall') reasons.push('tool_call');
    if ((pendingCount || 0) > 0) reasons.push('pending_work');
    if (state !== 'idle' && !hasRecentEvent && current?.kind !== 'toolCall') reasons.push('non_idle_state');
  } else if (hasRecentFileTouch || hasRecentLock) {
    livenessState = 'quiet';
    label = 'Quiet';
    if (hasRecentFileTouch) reasons.push('recent_file_touch');
    if (hasRecentLock) reasons.push('recent_lock');
    if (current?.kind && current.kind !== 'idle') reasons.push(`last_event_${current.kind}`);
  } else if (Number.isFinite(sessionAgeMs) && sessionAgeMs >= STALE_WINDOW_MS) {
    livenessState = 'stale';
    label = 'Stale';
    reasons.push('no_recent_event_or_file_touch');
  } else {
    livenessState = 'idle';
    label = 'Idle';
    reasons.push('within_retention_no_recent_activity');
  }

  return {
    state: livenessState,
    label,
    reasons,
    lastEventAt: current?.ts || null,
    lastEventAgeSec: Number.isFinite(lastEventAgeMs) ? Math.round(lastEventAgeMs / 1000) : null,
    lastFileTouchAt: lastFileTouchMs ? new Date(lastFileTouchMs).toISOString() : null,
    lastFileTouchAgeSec: Number.isFinite(lastFileTouchAgeMs) ? Math.round(lastFileTouchAgeMs / 1000) : null,
    lockPresent: Boolean(lockStat),
    lockMtimeAt: lockMtimeMs ? new Date(lockMtimeMs).toISOString() : null,
  };
}

class StateEngine {
  constructor(options = {}) {
    this.openclawDir = options.openclawDir;
    this.fileTailBytes = options.fileTailBytes || FILE_TAIL_BYTES;
    this.fileTailLines = options.fileTailLines || FILE_TAIL_LINES;

    this.agentRecords = new Map();
    this.sessionRecords = new Map();
    this.sessionCache = new Map();

    this.recentTransitions = [];
    this.deltaLog = [];
    this.version = 0;
    this.transitionSeq = 0;
  }

  readTranscriptState(sessionMeta, previousParserState = null, { force = false } = {}) {
    const result = readTranscriptWindowIncremental(
      sessionMeta.sessionFile,
      force ? null : previousParserState,
      this.fileTailBytes,
      this.fileTailLines,
    );

    return {
      transcriptState: deriveStateFromTranscript(result.entries),
      parserState: result.parserState,
      readMode: result.mode,
      bytesRead: result.bytesRead,
    };
  }

  buildEmptyAgentState(agentId) {
    return {
      entityType: 'agent',
      entityId: `agent:${agentId}`,
      name: agentId,
      displayName: agentId,
      agentId,
      readOnly: true,
      status: 'No active session',
      state: 'idle',
      station: 'idle',
      confidence: 0.8,
      tool: null,
      lastActivity: null,
      lastEventKind: 'idle',
      lastEventAgeSec: null,
      lastSeen: null,
      sessionAgeSec: null,
      taskStart: null,
      pendingCount: 0,
      taskPreview: null,
      taskFullText: null,
      taskKind: null,
      activityLog: [],
      sourceSessionKey: null,
      sourceSessionKind: null,
      sourceSessionId: null,
      primarySessionKey: null,
      visibleSessionCount: 0,
      activeSessionCount: 0,
      childSessionCount: 0,
      visibleSessionKeys: [],
      sessionStats: {},
      modelInfo: null,
      runtimeInfo: null,
      children: [],
      health: {
        state: 'idle',
        label: 'No active session',
        score: 1,
      },
      comms: {
        state: 'unknown',
        canReply: null,
        provider: null,
        accountId: null,
        chatId: null,
        reason: 'No active reply channel',
        lastOutboundOkAt: null,
        lastOutboundErrorAt: null,
        lastOutboundError: null,
      },
      transitionCount: 0,
      transitions: [],
    };
  }

  computeHealth({ current, state, lastEventAgeMs, sessionAgeMs, pendingCount }) {
    if (state === 'idle') {
      return {
        state: 'idle',
        label: 'Idle',
        score: 1,
      };
    }

    if (current?.kind === 'toolCall' || pendingCount > 0) {
      if (sessionAgeMs > 10 * 60_000) {
        return {
          state: 'stuck',
          label: 'Tool call looks stuck',
          score: 0.2,
        };
      }
      if (sessionAgeMs > 2 * 60_000) {
        return {
          state: 'slow',
          label: 'Long-running tool call',
          score: 0.6,
        };
      }
      return {
        state: 'healthy',
        label: 'Active tool call',
        score: 0.95,
      };
    }

    if (state === 'queued' && lastEventAgeMs > ACTIVE_WINDOW_MS) {
      return {
        state: 'stale',
        label: 'Queue state is stale',
        score: 0.5,
      };
    }

    if (state !== 'idle' && sessionAgeMs > 5 * 60_000) {
      return {
        state: 'stale',
        label: 'No recent activity',
        score: 0.55,
      };
    }

    return {
      state: 'healthy',
      label: 'Healthy',
      score: 0.92,
    };
  }

  finalizeState(agentId, sessionMeta, transcriptState, parserState) {
    const now = Date.now();
    const sessionFile = sessionMeta?.sessionFile || null;
    const sessionStat = sessionFile ? statSafe(sessionFile) : null;
    const sessionMtimeMs = sessionStat?.mtimeMs || 0;

    const current = transcriptState.current;
    const lastEventAgeMs = current.tsMs ? now - current.tsMs : Number.MAX_SAFE_INTEGER;
    const lastSeenMs = Math.max(current.tsMs || 0, sessionMtimeMs || 0, sessionMeta?.updatedAt || 0);
    const sessionAgeMs = lastSeenMs ? now - lastSeenMs : Number.MAX_SAFE_INTEGER;

    let state = current.state;
    let station = current.station;
    let status = current.label;
    let confidence = current.confidence || 0.7;

    if (current.kind === 'reply' && lastEventAgeMs > 7_000) {
      state = 'idle';
      station = 'idle';
      status = 'Idle — waiting for input';
      confidence = 0.98;
    }

    if (state === 'thinking' && lastEventAgeMs > ACTIVE_WINDOW_MS) {
      state = 'idle';
      station = 'idle';
      status = 'Idle';
      confidence = 0.9;
    }

    if (state === 'queued' && lastEventAgeMs > ACTIVE_WINDOW_MS) {
      state = 'idle';
      station = 'idle';
      status = 'Idle';
      confidence = 0.88;
    }

    if (current.kind === 'toolCall') {
      confidence = 0.99;
    }

    if (
      state === 'executing'
      && current.kind === 'toolCall'
      && current.tool === 'exec'
      && lastEventAgeMs < 4_000
    ) {
      state = 'thinking';
      station = 'thinking';
      status = 'Processing command';
      confidence = 0.86;
    }

    if (
      current.kind === 'toolCall'
      && current.tool === 'process'
      && lastEventAgeMs > 60_000
    ) {
      state = sessionAgeMs > ACTIVE_WINDOW_MS ? 'idle' : 'monitoring';
      station = sessionAgeMs > ACTIVE_WINDOW_MS ? 'idle' : 'monitoring';
      status = sessionAgeMs > ACTIVE_WINDOW_MS ? 'Idle' : 'Monitoring process';
      confidence = Math.max(confidence, 0.9);
    }

    if (sessionAgeMs > ACTIVE_WINDOW_MS && current.kind !== 'toolCall') {
      state = 'idle';
      station = 'idle';
      status = 'Idle';
      confidence = 0.96;
    }

    if (current.kind === 'task' && lastEventAgeMs <= ACTIVE_WINDOW_MS) {
      state = 'queued';
      station = 'queued';
      status = 'Task received';
      confidence = 0.95;
    }

    if (['task', 'user', 'queued', 'system'].includes(current.kind) && lastEventAgeMs <= ACTIVE_WINDOW_MS) {
      state = 'queued';
      station = 'queued';
      status = current.kind === 'system'
        ? 'System task queued'
        : current.kind === 'queued'
        ? 'Queued messages received'
        : 'Task received';
      confidence = current.kind === 'system' ? 0.94 : 0.96;
    }

    const activityLog = transcriptState.activityLog
      .slice(-12)
      .reverse()
      .map(summarizeEvent);

    const latestTask = [...transcriptState.activityLog]
      .reverse()
      .find(event => ['task', 'user', 'queued', 'system'].includes(event.kind)) || null;

    const health = this.computeHealth({
      current,
      state,
      lastEventAgeMs,
      sessionAgeMs,
      pendingCount: transcriptState.pendingCount,
    });

    const liveness = deriveLiveness({
      current,
      sessionFile,
      sessionMeta,
      sessionStat,
      now,
      lastEventAgeMs,
      sessionAgeMs,
      state,
      pendingCount: transcriptState.pendingCount,
    });

    return {
      name: agentId,
      readOnly: true,
      status,
      state,
      station,
      confidence,
      tool: current.tool || null,
      lastActivity: current.ts || null,
      lastEventKind: current.kind,
      lastEventAgeSec: current.tsMs ? Math.round(lastEventAgeMs / 1000) : null,
      lastSeen: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
      sessionAgeSec: Number.isFinite(sessionAgeMs) ? Math.round(sessionAgeMs / 1000) : null,
      taskStart: transcriptState.taskStart || null,
      pendingCount: transcriptState.pendingCount,
      taskPreview: latestTask?.label || null,
      taskFullText: latestTask?.fullLabel || latestTask?.label || null,
      taskKind: latestTask?.taskKind || latestTask?.kind || null,
      activityLog,
      sessionFile,
      sessionId: sessionMeta?.sessionId || null,
      sessionKey: sessionMeta?.sessionKey || sessionMeta?.key || null,
      updatedAt: sessionMeta?.updatedAt || null,
      deliveryContext: sessionMeta?.deliveryContext || null,
      label: sessionMeta?.label || null,
      modelInfo: mergeModelInfo(sessionMeta?.modelInfo || null, transcriptState.modelMeta || null),
      runtimeInfo: sessionMeta?.runtimeInfo || null,
      transcriptHeader: parserState?.header || null,
      health,
      liveness,
      comms: deriveComms({
        runtimeInfo: sessionMeta?.runtimeInfo || null,
        deliveryContext: sessionMeta?.deliveryContext || null,
        channel: sessionMeta?.channel || null,
        status,
        health,
        tool: current.tool || null,
        pendingCount: transcriptState.pendingCount,
        lastEventAgeSec: current.tsMs ? Math.round(lastEventAgeMs / 1000) : null,
        lastEventKind: current.kind || null,
        taskKind: latestTask?.taskKind || latestTask?.kind || null,
        lastSeen: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
        lastActivity: current.ts || null,
      }),
      transitionCount: 0,
      transitions: [],
    };
  }

  analyzeSession(sessionMeta, { force = false } = {}) {
    const previous = this.sessionCache.get(sessionMeta.entityId);
    const { transcriptState, parserState } = this.readTranscriptState(
      sessionMeta,
      previous?.parserState || null,
      { force },
    );

    const baseSnapshot = this.finalizeState(sessionMeta.agentId, sessionMeta, transcriptState, parserState);

    const snapshot = {
      ...baseSnapshot,
      entityType: 'session',
      entityId: sessionMeta.entityId,
      displayName: sessionMeta.displayName,
      agentId: sessionMeta.agentId,
      sessionKey: sessionMeta.sessionKey,
      sessionKind: sessionMeta.sessionKind,
      runtimeKind: sessionMeta.runtimeKind,
      channel: sessionMeta.channel,
      spawnDepth: sessionMeta.spawnDepth,
      spawnedBy: sessionMeta.spawnedBy || parserState?.header?.parentSession || null,
      parentSessionKey: sessionMeta.parentSessionKey || parserState?.header?.parentSession || null,
      isAuxiliary: sessionMeta.isAuxiliary,
      sourceSessionKey: sessionMeta.sessionKey,
      sourceSessionKind: sessionMeta.sessionKind,
    };

    this.sessionCache.set(sessionMeta.entityId, {
      parserState,
      transcriptState,
      snapshot,
      sessionMeta,
    });

    return snapshot;
  }

  buildAgentAggregate(agentId, primarySnapshot, allSessionSnapshots, visibleSessionSnapshots) {
    if (!primarySnapshot) {
      return this.buildEmptyAgentState(agentId);
    }

    const worstHealthSnapshot = pickWorstHealth([primarySnapshot, ...visibleSessionSnapshots]);
    const health = worstHealthSnapshot && worstHealthSnapshot.entityId !== primarySnapshot.entityId
      ? {
          ...worstHealthSnapshot.health,
          label: `Child session issue - ${worstHealthSnapshot.displayName}`,
        }
      : primarySnapshot.health;

    const activeSessions = allSessionSnapshots.filter(snapshot => snapshot.state !== 'idle' || (snapshot.pendingCount || 0) > 0);
    const childSessions = visibleSessionSnapshots.filter(snapshot => snapshot.isAuxiliary);

    return {
      entityType: 'agent',
      entityId: `agent:${agentId}`,
      name: agentId,
      displayName: agentId,
      agentId,
      readOnly: true,
      status: primarySnapshot.status,
      state: primarySnapshot.state,
      station: primarySnapshot.station,
      confidence: primarySnapshot.confidence,
      tool: primarySnapshot.tool,
      lastActivity: primarySnapshot.lastActivity,
      lastEventKind: primarySnapshot.lastEventKind,
      lastEventAgeSec: primarySnapshot.lastEventAgeSec,
      lastSeen: primarySnapshot.lastSeen,
      sessionAgeSec: primarySnapshot.sessionAgeSec,
      taskStart: primarySnapshot.taskStart,
      pendingCount: primarySnapshot.pendingCount,
      taskPreview: primarySnapshot.taskPreview,
      taskFullText: primarySnapshot.taskFullText,
      taskKind: primarySnapshot.taskKind,
      activityLog: primarySnapshot.activityLog,
      sourceSessionKey: primarySnapshot.sessionKey,
      sourceSessionKind: primarySnapshot.sessionKind,
      sourceSessionId: primarySnapshot.sessionId,
      primarySessionKey: primarySnapshot.sessionKey,
      visibleSessionCount: visibleSessionSnapshots.length,
      activeSessionCount: activeSessions.length,
      childSessionCount: childSessions.length,
      visibleSessionKeys: visibleSessionSnapshots.map(snapshot => snapshot.sessionKey),
      sessionStats: countKinds(allSessionSnapshots),
      modelInfo: primarySnapshot.modelInfo || null,
      runtimeInfo: primarySnapshot.runtimeInfo || null,
      children: visibleSessionSnapshots.map(snapshot => ({
        entityId: snapshot.entityId,
        sessionKey: snapshot.sessionKey,
        displayName: snapshot.displayName,
        sessionKind: snapshot.sessionKind,
        runtimeKind: snapshot.runtimeKind,
        state: snapshot.state,
        station: snapshot.station,
        health: snapshot.health?.state || 'unknown',
      })),
      health,
      liveness: primarySnapshot.liveness || null,
      comms: primarySnapshot.comms || deriveComms(primarySnapshot),
      transitionCount: 0,
      transitions: [],
    };
  }

  getComparable(snapshot) {
    const head = snapshot?.activityLog?.[0] || null;
    return JSON.stringify({
      entityType: snapshot?.entityType || null,
      state: snapshot?.state || null,
      station: snapshot?.station || null,
      status: snapshot?.status || null,
      tool: snapshot?.tool || null,
      pendingCount: snapshot?.pendingCount || 0,
      taskFullText: snapshot?.taskFullText || null,
      taskKind: snapshot?.taskKind || null,
      lastEventKind: snapshot?.lastEventKind || null,
      healthState: snapshot?.health?.state || null,
      healthLabel: snapshot?.health?.label || null,
      liveness: snapshot?.liveness ? {
        state: snapshot.liveness.state || null,
        label: snapshot.liveness.label || null,
        lastEventAgeSec: snapshot.liveness.lastEventAgeSec ?? null,
        lastFileTouchAgeSec: snapshot.liveness.lastFileTouchAgeSec ?? null,
        lockPresent: Boolean(snapshot.liveness.lockPresent),
      } : null,
      sessionId: snapshot?.sessionId || null,
      sessionKey: snapshot?.sessionKey || null,
      sessionKind: snapshot?.sessionKind || null,
      parentSessionKey: snapshot?.parentSessionKey || null,
      spawnedBy: snapshot?.spawnedBy || null,
      sourceSessionKey: snapshot?.sourceSessionKey || null,
      visibleSessionCount: snapshot?.visibleSessionCount || 0,
      activeSessionCount: snapshot?.activeSessionCount || 0,
      childSessionCount: snapshot?.childSessionCount || 0,
      sessionStats: snapshot?.sessionStats || null,
      modelInfo: snapshot?.modelInfo ? {
        provider: snapshot.modelInfo.provider || null,
        model: snapshot.modelInfo.model || null,
        providerOverride: snapshot.modelInfo.providerOverride || null,
        modelOverride: snapshot.modelInfo.modelOverride || null,
      } : null,
      runtimeInfo: snapshot?.runtimeInfo ? {
        provider: snapshot.runtimeInfo.provider || null,
        channel: snapshot.runtimeInfo.channel || null,
        accountId: snapshot.runtimeInfo.accountId || null,
        chatType: snapshot.runtimeInfo.chatType || null,
        sandboxed: Boolean(snapshot.runtimeInfo.sandboxed),
      } : null,
      comms: snapshot?.comms ? {
        state: snapshot.comms.state || null,
        canReply: snapshot.comms.canReply,
        provider: snapshot.comms.provider || null,
        accountId: snapshot.comms.accountId || null,
        chatId: snapshot.comms.chatId || null,
        reason: snapshot.comms.reason || null,
      } : null,
      children: Array.isArray(snapshot?.children)
        ? snapshot.children.map(child => `${child.entityId}:${child.state}:${child.health}`)
        : null,
      head: head ? {
        ts: head.ts || null,
        label: head.label || null,
        state: head.state || null,
        kind: head.kind || null,
      } : null,
    });
  }

  deriveTransitionType(previousSnapshot, nextSnapshot) {
    if (!previousSnapshot && nextSnapshot) return 'appeared';
    if (previousSnapshot && !nextSnapshot) return 'disappeared';
    if (!previousSnapshot || !nextSnapshot) return 'updated';
    if (previousSnapshot.sourceSessionKey !== nextSnapshot.sourceSessionKey) return 'session_switched';
    if (previousSnapshot.station !== nextSnapshot.station) return 'station_changed';
    if (previousSnapshot.state !== nextSnapshot.state) return 'state_changed';
    if ((previousSnapshot.health?.state || null) !== (nextSnapshot.health?.state || null)) return 'health_changed';
    if ((previousSnapshot.modelInfo?.provider || null) !== (nextSnapshot.modelInfo?.provider || null)) return 'model_changed';
    if ((previousSnapshot.modelInfo?.model || null) !== (nextSnapshot.modelInfo?.model || null)) return 'model_changed';
    return 'updated';
  }

  buildTransition(entityType, previousSnapshot, nextSnapshot) {
    const snapshot = nextSnapshot || previousSnapshot;
    return {
      id: ++this.transitionSeq,
      ts: new Date().toISOString(),
      entityType,
      entityId: snapshot?.entityId || null,
      agentId: snapshot?.agentId || snapshot?.name || null,
      displayName: snapshot?.displayName || snapshot?.name || null,
      sessionKey: snapshot?.sessionKey || snapshot?.sourceSessionKey || null,
      transitionType: this.deriveTransitionType(previousSnapshot, nextSnapshot),
      from: summarizeForTransition(previousSnapshot),
      to: summarizeForTransition(nextSnapshot),
    };
  }

  commitRecord(store, entityType, id, snapshot) {
    const previousRecord = store.get(id);
    const previousSnapshot = previousRecord?.snapshot || null;
    const previousHistory = previousRecord?.history || [];
    const changed = !previousSnapshot || this.getComparable(previousSnapshot) !== this.getComparable(snapshot);

    let history = previousHistory.slice();
    let transition = null;

    if (changed) {
      transition = this.buildTransition(entityType, previousSnapshot, snapshot);
      if (previousSnapshot) {
        history.push(transition);
        history = history.slice(-TRANSITION_HISTORY_LIMIT);
        this.recentTransitions.push(transition);
        this.recentTransitions = this.recentTransitions.slice(-RECENT_TRANSITIONS_LIMIT);
      }
    }

    const enrichedSnapshot = {
      ...snapshot,
      transitionCount: history.length,
      transitions: history.slice(-10).reverse(),
    };

    store.set(id, {
      snapshot: enrichedSnapshot,
      history,
    });

    return {
      changed,
      transition,
      snapshot: enrichedSnapshot,
    };
  }

  removeMissingRecords(store, validIds) {
    const removed = [];
    for (const [id] of store.entries()) {
      if (!validIds.has(id)) {
        store.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }

  buildSummary() {
    const agents = [...this.agentRecords.values()].map(record => record.snapshot);
    const sessions = [...this.sessionRecords.values()].map(record => record.snapshot);
    return {
      agentCount: agents.length,
      visibleSessionCount: sessions.length,
      activeSessionCount: sessions.filter(snapshot => snapshot.state !== 'idle' || (snapshot.pendingCount || 0) > 0).length,
      subagentCount: sessions.filter(snapshot => snapshot.sessionKind === 'subagent').length,
      acpCount: sessions.filter(snapshot => snapshot.sessionKind === 'acp').length,
      cronCount: sessions.filter(snapshot => snapshot.sessionKind === 'cron').length,
      stuckCount: sessions.filter(snapshot => snapshot.health?.state === 'stuck').length,
      slowCount: sessions.filter(snapshot => snapshot.health?.state === 'slow').length,
      sessionKindCounts: countBy(sessions, snapshot => snapshot.sessionKind),
      runtimeKindCounts: countBy(sessions, snapshot => snapshot.runtimeKind),
      modelCounts: countBy(
        [...agents, ...sessions],
        snapshot => snapshot.modelInfo?.provider && snapshot.modelInfo?.model
          ? `${snapshot.modelInfo.provider}/${snapshot.modelInfo.model}`
          : null,
      ),
    };
  }

  getDebugSessions() {
    const agentIds = getAgentDirs(this.openclawDir).sort((a, b) => a.localeCompare(b));
    const now = Date.now();
    const agents = [];

    for (const agentId of agentIds) {
      const rawSessions = listSessions(this.openclawDir, agentId).map(meta => decorateSessionMeta(agentId, meta));
      const analyzed = rawSessions.map(sessionMeta => {
        const snapshot = this.analyzeSession(sessionMeta, { force: false });
        return { sessionMeta, snapshot };
      });

      const primarySnapshot = pickPrimarySession(analyzed.map(item => item.snapshot));

      const sessions = analyzed.map(({ sessionMeta, snapshot }) => {
        const visibility = shouldExposeSessionEntity(snapshot, primarySnapshot?.sessionKey || null, VISIBILITY_CONFIG);
        const parserCache = this.sessionCache.get(sessionMeta.entityId) || null;
        const parserState = parserCache?.parserState || null;
        const transcriptState = parserCache?.transcriptState || null;
        const sessionFileStat = snapshot.sessionFile ? statSafe(snapshot.sessionFile) : null;
        const sessionFileMtimeMs = sessionFileStat?.mtimeMs || 0;
        const lastActivityMs = snapshot.lastActivity ? new Date(snapshot.lastActivity).getTime() : 0;
        const updatedAtMs = Number(snapshot.updatedAt || 0);
        const lastSeenMs = snapshot.lastSeen ? new Date(snapshot.lastSeen).getTime() : 0;
        const freshnessSource = Math.max(lastActivityMs || 0, sessionFileMtimeMs || 0, updatedAtMs || 0, lastSeenMs || 0);

        return {
          entityId: snapshot.entityId,
          agentId,
          displayName: snapshot.displayName,
          sessionKey: snapshot.sessionKey,
          sessionId: snapshot.sessionId || null,
          sessionFile: snapshot.sessionFile || null,
          sessionKind: snapshot.sessionKind,
          runtimeKind: snapshot.runtimeKind,
          channel: snapshot.channel || null,
          spawnDepth: snapshot.spawnDepth,
          spawnedBy: snapshot.spawnedBy || null,
          parentSessionKey: snapshot.parentSessionKey || null,
          isAuxiliary: Boolean(snapshot.isAuxiliary),
          isPrimary: snapshot.sessionKey === (primarySnapshot?.sessionKey || null),
          visible: Boolean(visibility.expose),
          visibilityReason: visibility.reason,
          visibilityContext: {
            isActive: Boolean(visibility.isActive),
            ageMs: visibility.ageMs,
            retentionMs: visibility.retentionMs,
            primarySessionKey: primarySnapshot?.sessionKey || null,
          },
          state: snapshot.state,
          station: snapshot.station,
          status: snapshot.status,
          pendingCount: snapshot.pendingCount || 0,
          health: snapshot.health || null,
          liveness: snapshot.liveness || null,
          taskKind: snapshot.taskKind || null,
          tool: snapshot.tool || null,
          freshness: {
            sessionAgeSec: snapshot.sessionAgeSec ?? null,
            lastEventKind: snapshot.lastEventKind || null,
            lastEventAgeSec: snapshot.lastEventAgeSec ?? null,
            lastActivity: snapshot.lastActivity || null,
            lastSeen: snapshot.lastSeen || null,
            updatedAt: updatedAtMs ? iso(updatedAtMs) : null,
            sessionFileMtime: sessionFileMtimeMs ? iso(sessionFileMtimeMs) : null,
            chosenFreshnessAt: freshnessSource ? iso(freshnessSource) : null,
          },
          modelInfo: snapshot.modelInfo || null,
          runtimeInfo: snapshot.runtimeInfo || null,
          parser: {
            readMode: parserState?.lastReadMode || null,
            offset: parserState?.offset || 0,
            mtimeMs: parserState?.mtimeMs || 0,
            header: parserState?.header || null,
            transcriptEntries: Array.isArray(parserState?.entries) ? parserState.entries.length : 0,
          },
          transcript: {
            pendingCount: transcriptState?.pendingCount || 0,
            taskStart: transcriptState?.taskStart || null,
            lastUserTs: transcriptState?.lastUserTs || null,
            current: transcriptState?.current || null,
            recentActivity: Array.isArray(transcriptState?.activityLog)
              ? transcriptState.activityLog.slice(-8)
              : [],
          },
        };
      }).sort((a, b) => {
        if (a.visible !== b.visible) return Number(b.visible) - Number(a.visible);
        if (a.isPrimary !== b.isPrimary) return Number(b.isPrimary) - Number(a.isPrimary);
        return String(a.displayName || a.sessionKey || '').localeCompare(String(b.displayName || b.sessionKey || ''));
      });

      agents.push({
        agentId,
        primarySessionKey: primarySnapshot?.sessionKey || null,
        primaryEntityId: primarySnapshot?.entityId || null,
        counts: {
          discovered: sessions.length,
          visible: sessions.filter(session => session.visible).length,
          active: sessions.filter(session => session.visibilityContext?.isActive).length,
          auxiliary: sessions.filter(session => session.isAuxiliary).length,
          byKind: countKinds(sessions.map(session => ({ sessionKind: session.sessionKind }))),
        },
        sessions,
      });
    }

    return {
      generatedAt: new Date(now).toISOString(),
      version: this.version,
      visibilityConfig: VISIBILITY_CONFIG,
      agents,
    };
  }

  buildTopology() {
    const agents = [...this.agentRecords.values()].map(record => record.snapshot).sort((a, b) => a.agentId.localeCompare(b.agentId));
    const sessions = [...this.sessionRecords.values()].map(record => record.snapshot).sort((a, b) => a.displayName.localeCompare(b.displayName));

    const agentNodeById = new Map(agents.map(agent => [agent.entityId, agent]));
    const agentNodeByPrimarySession = new Map(
      agents
        .filter(agent => agent.primarySessionKey)
        .map(agent => [agent.primarySessionKey, agent.entityId]),
    );
    const sessionNodeByKey = new Map(sessions.map(session => [session.sessionKey, session.entityId]));

    const nodes = [
      ...agents.map(agent => ({
        id: agent.entityId,
        type: 'agent',
        refId: agent.entityId,
        agentId: agent.agentId,
        label: agent.displayName,
        state: agent.state,
        station: agent.station,
        model: agent.modelInfo?.model || null,
        provider: agent.modelInfo?.provider || null,
      })),
      ...sessions.map(session => ({
        id: session.entityId,
        type: 'session',
        refId: session.entityId,
        agentId: session.agentId,
        label: session.displayName,
        state: session.state,
        station: session.station,
        sessionKey: session.sessionKey,
        sessionKind: session.sessionKind,
        runtimeKind: session.runtimeKind,
        spawnDepth: session.spawnDepth,
        model: session.modelInfo?.model || null,
        provider: session.modelInfo?.provider || null,
      })),
    ];

    const edges = sessions.map(session => {
      let from = `agent:${session.agentId}`;
      let type = session.isAuxiliary ? 'auxiliary' : 'session';

      if (session.parentSessionKey && sessionNodeByKey.has(session.parentSessionKey)) {
        from = sessionNodeByKey.get(session.parentSessionKey);
        type = 'spawned';
      } else if (session.spawnedBy && sessionNodeByKey.has(session.spawnedBy)) {
        from = sessionNodeByKey.get(session.spawnedBy);
        type = 'spawned';
      } else if (session.spawnedBy && agentNodeByPrimarySession.has(session.spawnedBy)) {
        from = agentNodeByPrimarySession.get(session.spawnedBy);
        type = 'spawned';
      } else if (agentNodeById.has(`agent:${session.agentId}`)) {
        from = `agent:${session.agentId}`;
      }

      return {
        from,
        to: session.entityId,
        type,
        agentId: session.agentId,
        sessionKey: session.sessionKey,
        parentSessionKey: session.parentSessionKey || session.spawnedBy || null,
      };
    });

    const groups = agents.map(agent => ({
      agentId: agent.agentId,
      nodeId: agent.entityId,
      primarySessionKey: agent.primarySessionKey || null,
      sessionNodeIds: sessions
        .filter(session => session.agentId === agent.agentId)
        .map(session => session.entityId),
    }));

    return {
      version: this.version,
      generatedAt: new Date().toISOString(),
      nodes,
      edges,
      groups,
    };
  }

  refreshAll({ force = false } = {}) {
    const agentIds = getAgentDirs(this.openclawDir).sort((a, b) => a.localeCompare(b));
    const validAgentRecordIds = new Set();
    const validSessionRecordIds = new Set();
    const validCacheIds = new Set();

    const changedAgents = [];
    const changedSessions = [];
    const transitions = [];

    for (const agentId of agentIds) {
      const rawSessions = listSessions(this.openclawDir, agentId).map(meta => decorateSessionMeta(agentId, meta));
      const allSessionSnapshots = rawSessions.map(sessionMeta => {
        validCacheIds.add(sessionMeta.entityId);
        return this.analyzeSession(sessionMeta, { force });
      });

      const primarySnapshot = pickPrimarySession(allSessionSnapshots);
      const visibleSessionSnapshots = allSessionSnapshots.filter(snapshot =>
        shouldExposeSessionEntity(snapshot, primarySnapshot?.sessionKey || null, VISIBILITY_CONFIG).expose,
      );

      for (const sessionSnapshot of visibleSessionSnapshots) {
        validSessionRecordIds.add(sessionSnapshot.entityId);
        const result = this.commitRecord(this.sessionRecords, 'session', sessionSnapshot.entityId, sessionSnapshot);
        if (result.changed) changedSessions.push(result.snapshot);
        if (result.transition) transitions.push(result.transition);
      }

      const agentSnapshot = this.buildAgentAggregate(agentId, primarySnapshot, allSessionSnapshots, visibleSessionSnapshots);
      validAgentRecordIds.add(agentSnapshot.entityId);
      const agentResult = this.commitRecord(this.agentRecords, 'agent', agentSnapshot.entityId, agentSnapshot);
      if (agentResult.changed) changedAgents.push(agentResult.snapshot);
      if (agentResult.transition) transitions.push(agentResult.transition);
    }

    const removedAgents = this.removeMissingRecords(this.agentRecords, validAgentRecordIds);
    const removedSessions = this.removeMissingRecords(this.sessionRecords, validSessionRecordIds);

    for (const cacheId of [...this.sessionCache.keys()]) {
      if (!validCacheIds.has(cacheId)) this.sessionCache.delete(cacheId);
    }

    const hasChanges = changedAgents.length || changedSessions.length || removedAgents.length || removedSessions.length;
    const serverTime = new Date().toISOString();
    const summary = this.buildSummary();
    const topology = this.buildTopology();

    if (hasChanges) {
      this.version += 1;
      topology.version = this.version;
      const delta = {
        type: 'delta',
        version: this.version,
        meta: APP_META,
        serverTime,
        summary,
        topology,
        changedAgents,
        removedAgents,
        changedSessions,
        removedSessions,
        transitions,
      };
      this.deltaLog.push(delta);
      this.deltaLog = this.deltaLog.slice(-DELTA_LOG_LIMIT);
      return delta;
    }

    topology.version = this.version;
    return {
      type: 'delta',
      version: this.version,
      meta: APP_META,
      serverTime,
      summary,
      topology,
      changedAgents: [],
      removedAgents: [],
      changedSessions: [],
      removedSessions: [],
      transitions: [],
    };
  }

  getSnapshot() {
    return {
      type: 'snapshot',
      version: this.version,
      meta: APP_META,
      serverTime: new Date().toISOString(),
      summary: this.buildSummary(),
      topology: this.buildTopology(),
      agents: [...this.agentRecords.values()]
        .map(record => record.snapshot)
        .sort((a, b) => a.agentId.localeCompare(b.agentId)),
      sessions: [...this.sessionRecords.values()]
        .map(record => record.snapshot)
        .sort((a, b) => {
          const aAge = a.sessionAgeSec ?? Number.MAX_SAFE_INTEGER;
          const bAge = b.sessionAgeSec ?? Number.MAX_SAFE_INTEGER;
          if (aAge !== bAge) return aAge - bAge;
          return a.displayName.localeCompare(b.displayName);
        }),
      transitions: this.recentTransitions.slice(-20).reverse(),
    };
  }

  getDeltaSince(version) {
    const requested = Number(version) || 0;
    const currentTopology = this.buildTopology();
    const currentSummary = this.buildSummary();

    const deltas = this.deltaLog.filter(delta => delta.version > requested);
    if (!deltas.length) {
      return {
        type: 'delta',
        version: this.version,
        meta: APP_META,
        serverTime: new Date().toISOString(),
        summary: currentSummary,
        topology: currentTopology,
        changedAgents: [],
        removedAgents: [],
        changedSessions: [],
        removedSessions: [],
        transitions: [],
      };
    }

    const changedAgents = new Map();
    const changedSessions = new Map();
    const removedAgents = new Set();
    const removedSessions = new Set();
    const transitions = [];

    for (const delta of deltas) {
      for (const agent of delta.changedAgents) {
        changedAgents.set(agent.entityId, agent);
        removedAgents.delete(agent.entityId);
      }
      for (const session of delta.changedSessions) {
        changedSessions.set(session.entityId, session);
        removedSessions.delete(session.entityId);
      }
      for (const id of delta.removedAgents) {
        removedAgents.add(id);
        changedAgents.delete(id);
      }
      for (const id of delta.removedSessions) {
        removedSessions.add(id);
        changedSessions.delete(id);
      }
      transitions.push(...delta.transitions);
    }

    return {
      type: 'delta',
      version: this.version,
      meta: APP_META,
      serverTime: new Date().toISOString(),
      summary: currentSummary,
      topology: currentTopology,
      changedAgents: [...changedAgents.values()].sort((a, b) => a.agentId.localeCompare(b.agentId)),
      removedAgents: [...removedAgents].sort((a, b) => a.localeCompare(b)),
      changedSessions: [...changedSessions.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
      removedSessions: [...removedSessions].sort((a, b) => a.localeCompare(b)),
      transitions: transitions.slice(-20),
    };
  }

  getAgentHistory(agentId, limit = 20) {
    const record = this.agentRecords.get(`agent:${agentId}`);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, TRANSITION_HISTORY_LIMIT));
    return (record?.history || []).slice(-safeLimit).reverse();
  }

  getSessionHistory(sessionKey, limit = 20) {
    const record = this.sessionRecords.get(`session:${sessionKey}`);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, TRANSITION_HISTORY_LIMIT));
    return (record?.history || []).slice(-safeLimit).reverse();
  }

  getTopology() {
    return this.buildTopology();
  }
}

module.exports = {
  StateEngine,
};
