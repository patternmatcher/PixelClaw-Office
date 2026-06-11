import { normalizeStation } from './utils.js';
import { getSlot, getStationCapacity, sortEntitiesForRender } from './layout.js';

const SESSION_STALE_CUTOFF_SEC = 30 * 60;

function isOfficeResident(entity) {
  const agentId = String(entity?.agentId || '').toLowerCase();
  return agentId === 'main' || agentId === 'work';
}

function isTransientSubagentLike(entity) {
  if (!entity) return false;
  if (entity.entityType === 'session') return true;
  const agentId = String(entity.agentId || '').toLowerCase();
  const sourceSessionKind = String(entity.sourceSessionKind || '').toLowerCase();
  const runtimeKind = String(entity.runtimeInfo?.runtimeKind || '').toLowerCase();
  const hasNoDirectComms = !entity.runtimeInfo?.channel && !entity.runtimeInfo?.provider;
  return (
    sourceSessionKind === 'acp'
    || runtimeKind === 'acp'
    || ((agentId === 'claude' || agentId === 'codex') && hasNoDirectComms)
  );
}

function isFreshEnoughForOffice(entity) {
  if (!entity) return false;
  const station = normalizeStation(entity.station || entity.state);
  const hasActiveWork = Number(entity.activeSessionCount || 0) > 0 || Number(entity.visibleSessionCount || 0) > 0;
  if (hasActiveWork) return true;
  if (station && station !== 'idle') return true;

  const ageSec = Number(entity.sessionAgeSec);
  if (Number.isFinite(ageSec)) return ageSec <= SESSION_STALE_CUTOFF_SEC;

  const lastTouch = entity.lastSeen || entity.lastActivity || entity.updatedAt || null;
  const lastTouchMs = lastTouch ? new Date(lastTouch).getTime() : Number.NaN;
  if (Number.isFinite(lastTouchMs)) {
    return (Date.now() - lastTouchMs) <= (SESSION_STALE_CUTOFF_SEC * 1000);
  }

  return false;
}

function isVisibleInOffice(entity) {
  if (!entity) return false;
  if (isOfficeResident(entity)) return true;
  if (isTransientSubagentLike(entity)) return isFreshEnoughForOffice(entity);
  return true;
}

export class Store {
  constructor() {
    this.version = 0;
    this.serverTime = null;
    this.summary = {};
    this.topology = { nodes: [], edges: [], groups: [] };
    this.agents = new Map();
    this.sessions = new Map();
    this.transitions = [];
    this.selectedEntityId = null;
    this.listeners = new Set();
    this.stationAssignments = new Map();
    this.previousStations = new Map();
    this.stationSince = new Map();
    this.selectionAnchor = null;
    this.detailOpen = false;
    this.renderCache = { key: null, entities: [] };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  select(entityId, anchor = null) {
    this.selectedEntityId = entityId;
    this.selectionAnchor = entityId ? anchor : null;
    this.detailOpen = Boolean(entityId);
    this.emit();
  }

  applySnapshot(snapshot) {
    this.version = snapshot.version || 0;
    this.serverTime = snapshot.serverTime || null;
    this.summary = snapshot.summary || {};
    this.topology = snapshot.topology || { nodes: [], edges: [], groups: [] };
    this.transitions = snapshot.transitions || [];
    this.capturePreviousStations();
    this.agents = new Map((snapshot.agents || []).map(agent => [agent.entityId || `agent:${agent.agentId}`, agent]));
    this.sessions = new Map((snapshot.sessions || []).map(session => [session.entityId || `session:${session.sessionKey}`, session]));
    this.invalidateRenderCache();
    this.ensureSelection();
    this.emit();
  }

  applyDelta(delta) {
    this.version = delta.version || this.version;
    this.serverTime = delta.serverTime || this.serverTime;
    this.summary = delta.summary || this.summary;
    this.topology = delta.topology || this.topology;
    this.transitions = delta.transitions || this.transitions;

    this.capturePreviousStations();

    for (const agent of delta.changedAgents || []) {
      this.agents.set(agent.entityId || `agent:${agent.agentId}`, agent);
    }
    for (const id of delta.removedAgents || []) {
      this.agents.delete(id);
    }
    for (const session of delta.changedSessions || []) {
      this.sessions.set(session.entityId || `session:${session.sessionKey}`, session);
    }
    for (const id of delta.removedSessions || []) {
      this.sessions.delete(id);
    }

    this.invalidateRenderCache();
    this.ensureSelection();
    this.emit();
  }

  capturePreviousStations() {
    const now = Date.now();
    const next = new Map();
    for (const entity of this.agents.values()) {
      next.set(entity.entityId || `agent:${entity.agentId}`, normalizeStation(entity.station || entity.state));
    }
    for (const entity of this.sessions.values()) {
      next.set(entity.entityId || `session:${entity.sessionKey}`, normalizeStation(entity.station || entity.state));
    }

    for (const [entityId, station] of next.entries()) {
      const previousStation = this.previousStations.get(entityId);
      if (!this.stationSince.has(entityId)) {
        this.stationSince.set(entityId, now);
      } else if (previousStation && previousStation !== station) {
        this.stationSince.set(entityId, now);
      }
    }

    for (const entityId of [...this.stationSince.keys()]) {
      if (!next.has(entityId)) this.stationSince.delete(entityId);
    }

    this.previousStations = next;
  }

  ensureSelection() {
    const existing = this.getEntityById(this.selectedEntityId);
    if (existing) return;

    if (this.detailOpen) {
      this.selectedEntityId = null;
      this.selectionAnchor = null;
      this.detailOpen = false;
      return;
    }

    const entities = this.getRenderableEntities();
    const preferred = entities.find(entity => normalizeStation(entity.station || entity.state) !== 'idle')
      || entities.find(entity => entity.entityType === 'agent')
      || entities[0]
      || null;

    this.selectedEntityId = preferred?.entityId || null;
  }

  getEntityById(entityId) {
    if (!entityId) return null;
    if (this.agents.has(entityId)) return { ...this.agents.get(entityId), entityType: 'agent' };
    if (this.sessions.has(entityId)) return { ...this.sessions.get(entityId), entityType: 'session' };
    return null;
  }

  getSelectedEntity() {
    return this.getEntityById(this.selectedEntityId);
  }

  getStationDurationSec(entityId) {
    if (!entityId) return 0;
    const since = this.stationSince.get(entityId);
    if (!since) return 0;
    return Math.max(0, Math.round((Date.now() - since) / 1000));
  }

  invalidateRenderCache() {
    this.renderCache = { key: null, entities: [] };
  }

  getRenderCacheKey() {
    const parts = [];

    for (const entity of this.agents.values()) {
      parts.push([
        entity.entityId || `agent:${entity.agentId}`,
        normalizeStation(entity.station || entity.state),
        entity.displayName || entity.agentId || '',
      ].join('|'));
    }

    for (const entity of this.sessions.values()) {
      parts.push([
        entity.entityId || `session:${entity.sessionKey}`,
        normalizeStation(entity.station || entity.state),
        entity.displayName || entity.sessionKey || '',
      ].join('|'));
    }

    return parts.sort().join('||');
  }

  getRenderableEntities() {
    const cacheKey = this.getRenderCacheKey();
    if (this.renderCache.key === cacheKey) {
      return this.renderCache.entities;
    }

    const all = [
      ...this.agents.values().map(entity => ({ ...entity, entityType: 'agent' })),
      ...this.sessions.values().map(entity => ({ ...entity, entityType: 'session' })),
    ].filter(isVisibleInOffice);

    const sorted = sortEntitiesForRender(all);
    const grouped = new Map();
    for (const entity of sorted) {
      const station = normalizeStation(entity.station || entity.state);
      const list = grouped.get(station) || [];
      list.push(entity);
      grouped.set(station, list);
    }

    const nextAssignments = new Map();
    const entities = [];

    for (const [station, list] of grouped.entries()) {
      const capacity = Math.max(1, getStationCapacity(station));
      const previous = this.stationAssignments.get(station) || new Map();
      const assignedSlots = new Set();
      const stationAssignments = new Map();

      for (const entity of list) {
        const prevIndex = previous.get(entity.entityId);
        const previousStation = this.previousStations.get(entity.entityId);
        const sameBroadStation = previousStation === station;

        if (sameBroadStation && prevIndex != null && prevIndex < capacity && !assignedSlots.has(prevIndex)) {
          stationAssignments.set(entity.entityId, prevIndex);
          assignedSlots.add(prevIndex);
        }
      }

      let nextIndex = 0;
      for (const entity of list) {
        if (stationAssignments.has(entity.entityId)) continue;
        while (assignedSlots.has(nextIndex % capacity)) nextIndex += 1;
        const slotIndex = nextIndex % capacity;
        stationAssignments.set(entity.entityId, slotIndex);
        assignedSlots.add(slotIndex);
        nextIndex += 1;
      }

      nextAssignments.set(station, stationAssignments);

      for (const entity of list) {
        const renderIndex = stationAssignments.get(entity.entityId) || 0;
        entities.push({
          ...entity,
          renderIndex,
          renderSlot: getSlot(entity, renderIndex),
        });
      }
    }

    this.stationAssignments = nextAssignments;
    this.renderCache = { key: cacheKey, entities };
    return entities;
  }
}
