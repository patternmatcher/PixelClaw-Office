const crypto = require('crypto');

const PRIVACY_MODE = String(process.env.PIXEL_OFFICE_PRIVACY_MODE || 'aliases').trim().toLowerCase();
const PRIVACY_DISABLED_VALUES = new Set(['off', 'false', '0', 'none', 'disabled', 'full']);

function normalizeKind(kind = '') {
  const value = String(kind || '').toLowerCase();
  if (value === 'subagent') return 'child';
  if (value === 'acp') return 'acp';
  if (value === 'cron') return 'cron';
  if (value === 'main') return 'primary';
  if (value === 'direct') return 'direct';
  if (value === 'thread') return 'thread';
  if (value === 'group') return 'group';
  if (value === 'slash') return 'slash';
  return 'session';
}

class PrivacySanitizer {
  constructor({ mode = PRIVACY_MODE } = {}) {
    this.mode = mode;
    this.enabled = !PRIVACY_DISABLED_VALUES.has(this.mode);
    this.salt = process.env.PIXEL_OFFICE_PRIVACY_SALT
      || crypto.randomBytes(16).toString('hex');
    this.agentAliases = new Map();
    this.agentAliasesReverse = new Map();
    this.sessionAliases = new Map();
    this.sessionAliasesReverse = new Map();
  }

  isEnabled() {
    return this.enabled;
  }

  hash(value, namespace = 'default', length = 8) {
    return crypto
      .createHash('sha256')
      .update(`${this.salt}:${namespace}:${String(value || '')}`)
      .digest('hex')
      .slice(0, length);
  }

  getAgentAlias(rawAgentId) {
    if (!rawAgentId) return null;
    const raw = String(rawAgentId);
    if (!this.agentAliases.has(raw)) {
      const number = String(this.agentAliases.size + 1).padStart(2, '0');
      const alias = `agent-${number}`;
      this.agentAliases.set(raw, alias);
      this.agentAliasesReverse.set(alias, raw);
    }
    return this.agentAliases.get(raw);
  }

  resolveRawAgentId(maybeAlias) {
    if (!maybeAlias) return maybeAlias;
    const raw = this.agentAliasesReverse.get(String(maybeAlias));
    return raw || maybeAlias;
  }

  hasAgentAlias(maybeAlias) {
    if (!maybeAlias) return false;
    return this.agentAliasesReverse.has(String(maybeAlias));
  }

  getSessionAlias(rawSessionKey, kind = 'session') {
    if (!rawSessionKey) return null;
    const raw = String(rawSessionKey);
    if (!this.sessionAliases.has(raw)) {
      const alias = `${normalizeKind(kind)}-${this.hash(raw, 'session', 10)}`;
      this.sessionAliases.set(raw, alias);
      this.sessionAliasesReverse.set(alias, raw);
    }
    return this.sessionAliases.get(raw);
  }

  resolveRawSessionKey(maybeAlias) {
    if (!maybeAlias) return maybeAlias;
    const raw = this.sessionAliasesReverse.get(String(maybeAlias));
    return raw || maybeAlias;
  }

  hasSessionAlias(maybeAlias) {
    if (!maybeAlias) return false;
    return this.sessionAliasesReverse.has(String(maybeAlias));
  }

  getAgentDisplayName(rawAgentId) {
    const alias = this.getAgentAlias(rawAgentId);
    if (!alias) return 'Agent';
    return `Agent ${alias.split('-')[1] || alias}`;
  }

  getSessionDisplayName(snapshot) {
    const agentName = this.getAgentDisplayName(snapshot?.agentId);
    const kind = snapshot?.sessionKind || snapshot?.sourceSessionKind || 'session';
    const alias = this.getSessionAlias(snapshot?.sessionKey || snapshot?.sourceSessionKey || snapshot?.sessionId, kind);
    const suffix = alias ? alias.split('-').slice(1).join('-').slice(0, 6) : 'hidden';
    const kindLabel = {
      main: 'Primary session',
      subagent: 'Child session',
      acp: 'ACP session',
      cron: 'Cron session',
      direct: 'Direct session',
      group: 'Group session',
      thread: 'Thread session',
      slash: 'Slash session',
    }[kind] || 'Session';
    return `${agentName} / ${kindLabel} ${suffix}`;
  }

  mapEntityId(rawEntityId, snapshot = null) {
    if (!rawEntityId && !snapshot) return null;

    const raw = String(rawEntityId || snapshot?.entityId || '');
    if (raw.startsWith('agent:')) {
      const alias = this.getAgentAlias(raw.slice('agent:'.length));
      return alias ? `agent:${alias}` : null;
    }

    if (raw.startsWith('session:')) {
      const sessionKey = snapshot?.sessionKey || raw.slice('session:'.length);
      const kind = snapshot?.sessionKind || snapshot?.sourceSessionKind || 'session';
      const alias = this.getSessionAlias(sessionKey, kind);
      return alias ? `session:${alias}` : null;
    }

    if (snapshot?.entityType === 'agent' && snapshot?.agentId) {
      const alias = this.getAgentAlias(snapshot.agentId);
      return alias ? `agent:${alias}` : null;
    }

    if ((snapshot?.entityType === 'session' || snapshot?.sessionKey) && (snapshot?.sessionKey || snapshot?.sourceSessionKey)) {
      const alias = this.getSessionAlias(snapshot.sessionKey || snapshot.sourceSessionKey, snapshot.sessionKind || snapshot.sourceSessionKind);
      return alias ? `session:${alias}` : null;
    }

    return `entity-${this.hash(raw || JSON.stringify(snapshot || {}), 'entity')}`;
  }

  sanitizeHealth(health) {
    if (!health) return null;
    return {
      ...health,
      label: health?.state ? String(health.state).replaceAll('_', ' ') : (health?.label || 'unknown'),
      reasons: Array.isArray(health?.reasons)
        ? health.reasons.map(reason => String(reason).replaceAll('_', ' '))
        : [],
    };
  }

  sanitizeLiveness(liveness) {
    if (!liveness) return null;
    return {
      ...liveness,
      label: liveness?.state ? String(liveness.state).replaceAll('_', ' ') : (liveness?.label || 'unknown'),
      reasons: Array.isArray(liveness?.reasons)
        ? liveness.reasons.map(reason => String(reason).replaceAll('_', ' '))
        : [],
    };
  }

  sanitizeModelInfo(modelInfo) {
    if (!modelInfo) return null;
    return {
      redacted: true,
    };
  }

  sanitizeRuntimeInfo(runtimeInfo) {
    if (!runtimeInfo) return null;
    return {
      sandboxed: Boolean(runtimeInfo.sandboxed),
      sandboxMode: runtimeInfo.sandboxMode || null,
      redacted: true,
    };
  }

  sanitizeComms(comms) {
    if (!comms) return null;
    return {
      state: comms.state || 'unknown',
      canReply: comms.canReply ?? null,
      reason: comms.reason ? 'Hidden in privacy mode' : 'No direct transport evidence',
      lastOutboundOkAt: comms.lastOutboundOkAt || null,
      lastOutboundErrorAt: comms.lastOutboundErrorAt || null,
      lastOutboundError: comms.lastOutboundErrorAt ? 'Hidden in privacy mode' : null,
      redacted: true,
    };
  }

  sanitizeActivityLog(activityLog) {
    if (!Array.isArray(activityLog)) return [];
    return activityLog.map(item => ({
      ts: item?.ts || null,
      label: item?.tool ? `${item.tool} call` : (item?.kind ? `${item.kind} event` : 'activity event'),
      fullLabel: null,
      state: item?.state || null,
      kind: item?.kind || null,
      taskKind: item?.taskKind || null,
      tool: item?.tool || null,
    }));
  }

  sanitizeTransitionSummary(summary) {
    if (!summary) return null;
    return {
      entityType: summary.entityType || null,
      state: summary.state || null,
      station: summary.station || null,
      status: summary.status || null,
      tool: summary.tool || null,
      health: summary.health || null,
      sessionKind: summary.sessionKind || null,
      sourceSessionKey: summary.sourceSessionKey
        ? this.getSessionAlias(summary.sourceSessionKey, summary.sessionKind || 'session')
        : null,
    };
  }

  sanitizeTransition(transition) {
    if (!transition) return null;
    const sessionKind = transition?.to?.sessionKind || transition?.from?.sessionKind || 'session';
    return {
      id: transition.id || null,
      ts: transition.ts || null,
      entityType: transition.entityType || null,
      entityId: this.mapEntityId(transition.entityId, {
        entityId: transition.entityId,
        entityType: transition.entityType,
        sessionKey: transition.sessionKey,
        sessionKind,
        agentId: transition.agentId,
      }),
      agentId: transition.agentId ? this.getAgentAlias(transition.agentId) : null,
      displayName: transition.entityType === 'agent'
        ? this.getAgentDisplayName(transition.agentId)
        : this.getSessionDisplayName({
            agentId: transition.agentId,
            sessionKey: transition.sessionKey,
            sessionKind,
          }),
      sessionKey: transition.sessionKey ? this.getSessionAlias(transition.sessionKey, sessionKind) : null,
      transitionType: transition.transitionType || 'updated',
      from: this.sanitizeTransitionSummary(transition.from),
      to: this.sanitizeTransitionSummary(transition.to),
    };
  }

  sanitizeChildren(children, rawAgentId) {
    if (!Array.isArray(children)) return [];
    return children.map(child => ({
      entityId: this.mapEntityId(child?.entityId, {
        entityId: child?.entityId,
        entityType: 'session',
        sessionKey: child?.sessionKey,
        sessionKind: child?.sessionKind,
      }),
      sessionKey: child?.sessionKey ? this.getSessionAlias(child.sessionKey, child.sessionKind || 'session') : null,
      displayName: this.getSessionDisplayName({
        agentId: rawAgentId,
        sessionKey: child?.sessionKey,
        sessionKind: child?.sessionKind,
      }),
      sessionKind: child?.sessionKind || null,
      runtimeKind: child?.runtimeKind || null,
      state: child?.state || null,
      station: child?.station || null,
      health: child?.health || 'unknown',
    }));
  }

  sanitizeSnapshot(snapshot) {
    if (!snapshot) return null;

    const rawAgentId = snapshot.agentId || snapshot.name || null;
    const rawSessionKey = snapshot.sessionKey || snapshot.sourceSessionKey || null;
    const sessionKind = snapshot.sessionKind || snapshot.sourceSessionKind || 'session';
    const publicAgentId = rawAgentId ? this.getAgentAlias(rawAgentId) : null;
    const publicSessionKey = rawSessionKey ? this.getSessionAlias(rawSessionKey, sessionKind) : null;
    const publicEntityId = this.mapEntityId(snapshot.entityId, snapshot);

    return {
      ...snapshot,
      entityId: publicEntityId,
      name: snapshot.entityType === 'agent' ? publicAgentId : (snapshot.name || null),
      displayName: snapshot.entityType === 'agent'
        ? this.getAgentDisplayName(rawAgentId)
        : this.getSessionDisplayName({
            agentId: rawAgentId,
            sessionKey: rawSessionKey,
            sessionKind,
          }),
      agentId: publicAgentId,
      taskPreview: snapshot.taskPreview ? 'Task hidden in privacy mode' : null,
      taskFullText: snapshot.taskFullText ? 'Task hidden in privacy mode' : null,
      activityLog: this.sanitizeActivityLog(snapshot.activityLog),
      sessionFile: undefined,
      sessionId: snapshot.sessionId ? `sid-${this.hash(snapshot.sessionId, 'session-id', 10)}` : null,
      sessionKey: publicSessionKey,
      updatedAt: snapshot.updatedAt || null,
      deliveryContext: undefined,
      label: undefined,
      modelInfo: this.sanitizeModelInfo(snapshot.modelInfo),
      runtimeInfo: this.sanitizeRuntimeInfo(snapshot.runtimeInfo),
      transcriptHeader: undefined,
      sourceSessionKey: snapshot.sourceSessionKey
        ? this.getSessionAlias(snapshot.sourceSessionKey, snapshot.sourceSessionKind || sessionKind)
        : null,
      sourceSessionId: snapshot.sourceSessionId ? `sid-${this.hash(snapshot.sourceSessionId, 'source-session-id', 10)}` : null,
      primarySessionKey: snapshot.primarySessionKey
        ? this.getSessionAlias(snapshot.primarySessionKey, 'session')
        : null,
      visibleSessionKeys: Array.isArray(snapshot.visibleSessionKeys)
        ? snapshot.visibleSessionKeys.map(key => this.getSessionAlias(key, 'session')).filter(Boolean)
        : [],
      children: this.sanitizeChildren(snapshot.children, rawAgentId),
      health: this.sanitizeHealth(snapshot.health),
      liveness: this.sanitizeLiveness(snapshot.liveness),
      comms: this.sanitizeComms(snapshot.comms),
      transitions: Array.isArray(snapshot.transitions)
        ? snapshot.transitions.map(item => this.sanitizeTransition(item)).filter(Boolean)
        : [],
      spawnedBy: snapshot.spawnedBy ? this.getSessionAlias(snapshot.spawnedBy, 'session') : null,
      parentSessionKey: snapshot.parentSessionKey ? this.getSessionAlias(snapshot.parentSessionKey, 'session') : null,
    };
  }

  sanitizeSummary(summary) {
    if (!summary) return null;
    return {
      ...summary,
      modelCounts: {},
    };
  }

  sanitizeTopology(topology) {
    if (!topology) return null;
    return {
      ...topology,
      nodes: Array.isArray(topology.nodes)
        ? topology.nodes.map(node => ({
            ...node,
            id: this.mapEntityId(node.id, {
              entityId: node.id,
              entityType: node.type,
              agentId: node.agentId,
              sessionKey: node.sessionKey,
              sessionKind: node.sessionKind,
            }),
            refId: this.mapEntityId(node.refId, {
              entityId: node.refId,
              entityType: node.type,
              agentId: node.agentId,
              sessionKey: node.sessionKey,
              sessionKind: node.sessionKind,
            }),
            agentId: node.agentId ? this.getAgentAlias(node.agentId) : null,
            label: node.type === 'agent'
              ? this.getAgentDisplayName(node.agentId)
              : this.getSessionDisplayName({
                  agentId: node.agentId,
                  sessionKey: node.sessionKey,
                  sessionKind: node.sessionKind,
                }),
            sessionKey: node.sessionKey ? this.getSessionAlias(node.sessionKey, node.sessionKind || 'session') : null,
            model: null,
            provider: null,
          }))
        : [],
      edges: Array.isArray(topology.edges)
        ? topology.edges.map(edge => ({
            ...edge,
            from: this.mapEntityId(edge.from, { entityId: edge.from }),
            to: this.mapEntityId(edge.to, { entityId: edge.to }),
            agentId: edge.agentId ? this.getAgentAlias(edge.agentId) : null,
            sessionKey: edge.sessionKey ? this.getSessionAlias(edge.sessionKey, 'session') : null,
            parentSessionKey: edge.parentSessionKey ? this.getSessionAlias(edge.parentSessionKey, 'session') : null,
          }))
        : [],
      groups: Array.isArray(topology.groups)
        ? topology.groups.map(group => ({
            ...group,
            agentId: group.agentId ? this.getAgentAlias(group.agentId) : null,
            nodeId: this.mapEntityId(group.nodeId, { entityId: group.nodeId, entityType: 'agent', agentId: group.agentId }),
            primarySessionKey: group.primarySessionKey ? this.getSessionAlias(group.primarySessionKey, 'session') : null,
            sessionNodeIds: Array.isArray(group.sessionNodeIds)
              ? group.sessionNodeIds.map(id => this.mapEntityId(id, { entityId: id, entityType: 'session' })).filter(Boolean)
              : [],
          }))
        : [],
    };
  }

  sanitizeGatewaySnapshot(snapshot) {
    const ok = Boolean(snapshot?.ok);
    return {
      ok,
      fetchedAt: snapshot?.fetchedAt || null,
      summary: {
        runtime: ok ? 'Gateway status available' : 'Gateway status degraded',
        listening: 'Hidden in privacy mode',
        dashboard: 'Hidden in privacy mode',
        probe: null,
        service: ok ? 'Hidden in privacy mode' : 'Unavailable',
      },
      statusLines: ['Gateway detail hidden in privacy mode.'],
      logFile: null,
      logTail: [],
      liveLog: ['Gateway log hidden in privacy mode.'],
      privacyMode: true,
    };
  }

  sanitizePayload(payload) {
    if (!this.enabled || !payload || typeof payload !== 'object') {
      return payload;
    }

    if (payload.summary && payload.topology && Array.isArray(payload.agents) && Array.isArray(payload.sessions)) {
      return {
        ...payload,
        summary: this.sanitizeSummary(payload.summary),
        topology: this.sanitizeTopology(payload.topology),
        agents: payload.agents.map(item => this.sanitizeSnapshot(item)).filter(Boolean),
        sessions: payload.sessions.map(item => this.sanitizeSnapshot(item)).filter(Boolean),
        transitions: Array.isArray(payload.transitions)
          ? payload.transitions.map(item => this.sanitizeTransition(item)).filter(Boolean)
          : [],
      };
    }

    if (payload.summary && payload.topology && Array.isArray(payload.changedAgents) && Array.isArray(payload.changedSessions)) {
      return {
        ...payload,
        summary: this.sanitizeSummary(payload.summary),
        topology: this.sanitizeTopology(payload.topology),
        changedAgents: payload.changedAgents.map(item => this.sanitizeSnapshot(item)).filter(Boolean),
        removedAgents: Array.isArray(payload.removedAgents)
          ? payload.removedAgents.map(id => this.mapEntityId(id, { entityId: id, entityType: 'agent' })).filter(Boolean)
          : [],
        changedSessions: payload.changedSessions.map(item => this.sanitizeSnapshot(item)).filter(Boolean),
        removedSessions: Array.isArray(payload.removedSessions)
          ? payload.removedSessions.map(id => this.mapEntityId(id, { entityId: id, entityType: 'session' })).filter(Boolean)
          : [],
        transitions: Array.isArray(payload.transitions)
          ? payload.transitions.map(item => this.sanitizeTransition(item)).filter(Boolean)
          : [],
      };
    }

    if (payload.summary && payload.topology && !Array.isArray(payload.agents) && !Array.isArray(payload.changedAgents)) {
      return {
        ...payload,
        summary: this.sanitizeSummary(payload.summary),
        topology: this.sanitizeTopology(payload.topology),
      };
    }

    if (Array.isArray(payload)) {
      return payload.map(item => this.sanitizePayload(item));
    }

    if (payload.agent && Array.isArray(payload.history)) {
      return {
        agent: payload.agent ? this.getAgentAlias(payload.agent) : null,
        history: payload.history.map(item => this.sanitizeTransition(item)).filter(Boolean),
      };
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'sessionKey') && Array.isArray(payload.history)) {
      return {
        sessionKey: payload.sessionKey ? this.getSessionAlias(payload.sessionKey, 'session') : null,
        history: payload.history.map(item => this.sanitizeTransition(item)).filter(Boolean),
      };
    }

    return payload;
  }
}

module.exports = {
  PrivacySanitizer,
  PRIVACY_MODE,
};
