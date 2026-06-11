function isoOffset(minutesAgo) {
  return new Date(Date.now() - (minutesAgo * 60_000)).toISOString();
}

const agent = (id, displayName, station, status, model, extras = {}) => ({
  entityType: 'agent',
  entityId: `agent:${id}`,
  agentId: id,
  displayName,
  state: station,
  station,
  status,
  lastSeen: isoOffset(extras.lastSeenMin ?? 2),
  lastActivity: isoOffset(extras.lastActivityMin ?? 2),
  visibleSessionCount: extras.visibleSessionCount ?? 1,
  activeSessionCount: extras.activeSessionCount ?? 1,
  childSessionCount: extras.childSessionCount ?? 0,
  subagentCount: extras.subagentCount ?? 0,
  sessionAgeSec: extras.sessionAgeSec ?? 840,
  health: { state: extras.health || 'ok', reasons: [] },
  liveness: { state: extras.liveness || 'active', reasons: [] },
  comms: {
    state: extras.commsState || 'ok',
    provider: extras.provider || 'local',
    reason: extras.commsReason || 'demo feed',
  },
  modelInfo: {
    provider: 'demo',
    model,
  },
  runtimeInfo: {
    runtimeKind: extras.runtimeKind || 'local',
    sandboxed: true,
    sandboxMode: 'read-only',
  },
  activityLog: [
    { ts: isoOffset(1), kind: 'status', state: station, tool: extras.tool || null },
  ],
});

const session = (id, parent, displayName, station, status, extras = {}) => ({
  entityType: 'session',
  entityId: `session:${id}`,
  sessionKey: id,
  sessionId: id,
  agentId: parent,
  displayName,
  sessionKind: extras.sessionKind || 'subagent',
  runtimeKind: extras.runtimeKind || 'subagent',
  sourceSessionKind: extras.sessionKind || 'subagent',
  state: station,
  station,
  status,
  lastSeen: isoOffset(extras.lastSeenMin ?? 4),
  lastActivity: isoOffset(extras.lastActivityMin ?? 4),
  sessionAgeSec: extras.sessionAgeSec ?? 360,
  pendingCount: extras.pendingCount || 0,
  tool: extras.tool || null,
  health: { state: extras.health || 'ok', reasons: [] },
  liveness: { state: extras.liveness || 'active', reasons: [] },
  modelInfo: {
    provider: 'demo',
    model: extras.model || 'agent-worker',
  },
  runtimeInfo: {
    runtimeKind: extras.runtimeKind || 'subagent',
    sandboxed: true,
    sandboxMode: 'read-only',
  },
  activityLog: [
    { ts: isoOffset(2), kind: 'tool', state: station, tool: extras.tool || null },
  ],
});

function buildDemoAgents() {
  return [
    agent('orchestrator', 'Orchestrator', 'coordinating', 'Routing work across the office', 'gpt-5.5', {
      childSessionCount: 3,
      subagentCount: 3,
      tool: 'planner',
    }),
    agent('builder', 'Builder', 'writing', 'Editing a feature branch', 'gpt-5.3-codex', {
      tool: 'editor',
      sessionAgeSec: 1260,
    }),
    agent('research', 'Research', 'searching', 'Collecting source material', 'gpt-5.2', {
      tool: 'search',
    }),
    agent('ops', 'Ops', 'monitoring', 'Watching health checks', 'gpt-5.4-mini', {
      visibleSessionCount: 0,
      activeSessionCount: 0,
      commsState: 'degraded',
      commsReason: 'demo watch mode',
    }),
  ];
}

function buildDemoSessions() {
  return [
    session('demo-worker-ui', 'builder', 'UI Worker', 'executing', 'Running visual checks', {
      tool: 'playwright',
      model: 'worker-browser',
    }),
    session('demo-worker-copy', 'orchestrator', 'Copy Worker', 'writing', 'Drafting README guidance', {
      tool: 'editor',
      model: 'worker-docs',
    }),
    session('demo-worker-security', 'ops', 'Release Worker', 'monitoring', 'Reviewing release settings', {
      tool: 'audit',
      model: 'worker-security',
    }),
    session('demo-worker-inbox', 'orchestrator', 'Inbox Worker', 'queued', 'Waiting for a task', {
      model: 'worker-queue',
      lastSeenMin: 7,
      sessionAgeSec: 720,
    }),
  ];
}

function buildTopology(agents, sessions) {
  return {
    version: Date.now(),
    generatedAt: new Date().toISOString(),
    nodes: [
      ...agents.map(item => ({
        id: item.entityId,
        type: 'agent',
        refId: item.entityId,
        agentId: item.agentId,
        label: item.displayName,
        state: item.state,
        station: item.station,
        model: item.modelInfo.model,
        provider: item.modelInfo.provider,
      })),
      ...sessions.map(item => ({
        id: item.entityId,
        type: 'session',
        refId: item.entityId,
        agentId: item.agentId,
        label: item.displayName,
        state: item.state,
        station: item.station,
        model: item.modelInfo.model,
        provider: item.modelInfo.provider,
      })),
    ],
    edges: sessions.map(item => ({
      from: `agent:${item.agentId}`,
      to: item.entityId,
      kind: 'owns',
    })),
    groups: agents.map(item => ({
      agentId: item.agentId,
      nodeId: item.entityId,
      primarySessionKey: null,
      sessionNodeIds: sessions.filter(sessionItem => sessionItem.agentId === item.agentId).map(sessionItem => sessionItem.entityId),
    })),
  };
}

function buildSummary(agents, sessions) {
  return {
    agentCount: agents.length,
    visibleSessionCount: sessions.length,
    activeSessionCount: sessions.filter(item => item.station !== 'idle').length,
    subagentCount: sessions.filter(item => item.sessionKind === 'subagent').length,
    acpCount: 0,
    cronCount: 0,
    stuckCount: 0,
    slowCount: 0,
    sessionKindCounts: { subagent: sessions.length },
    runtimeKindCounts: { local: agents.length, subagent: sessions.length },
    modelCounts: agents.reduce((acc, item) => {
      acc[item.modelInfo.model] = (acc[item.modelInfo.model] || 0) + 1;
      return acc;
    }, {}),
  };
}

function buildDemoTransitions(agents, sessions) {
  return [...agents, ...sessions].slice(0, 8).map((item, index) => ({
    id: `demo-transition-${index + 1}`,
    ts: isoOffset(index + 1),
    entityType: item.entityType,
    entityId: item.entityId,
    agentId: item.agentId,
    displayName: item.displayName,
    transitionType: 'updated',
    to: {
      entityType: item.entityType,
      state: item.state,
      station: item.station,
      status: item.status,
      tool: item.tool || null,
      health: item.health?.state || 'ok',
      sessionKind: item.sessionKind || null,
    },
  }));
}

function buildDemoSnapshot() {
  const agents = buildDemoAgents();
  const sessions = buildDemoSessions();
  return {
    type: 'snapshot',
    version: Date.now(),
    meta: {
      readOnly: true,
      writesIntoOpenClaw: false,
      activeWindowMs: 15000,
      version: 'demo',
      protocol: 'delta-v3',
      demoMode: true,
    },
    serverTime: new Date().toISOString(),
    summary: buildSummary(agents, sessions),
    topology: buildTopology(agents, sessions),
    agents,
    sessions,
    transitions: buildDemoTransitions(agents, sessions),
  };
}

function buildDemoGatewaySnapshot() {
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    summary: {
      runtime: 'Runtime: demo',
      listening: 'Listening: local demo feed',
      dashboard: 'Dashboard: http://127.0.0.1:7823',
      probe: 'Probe target: demo fixture',
      service: 'Service: pixel-office demo',
    },
    statusLines: [
      'Runtime: demo',
      'Listening: local demo feed',
      'Dashboard: http://127.0.0.1:7823',
      'Service: pixel-office demo',
    ],
    logFile: null,
    logTail: [],
    liveLog: [
      '[demo] orchestrator delegated UI verification',
      '[demo] builder entered Dev Floor',
      '[demo] release worker reviewed dashboard defaults',
      '[demo] ops monitor reports healthy',
    ],
  };
}

module.exports = {
  buildDemoGatewaySnapshot,
  buildDemoSnapshot,
};
