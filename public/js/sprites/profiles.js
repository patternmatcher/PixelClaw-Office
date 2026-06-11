import { normalizeStation } from '../utils.js';
import {
  CUSTOM_AGENT_SPRITES,
  CUSTOM_SESSION_SPRITES,
  CUSTOM_SPRITE_PROFILES,
  CUSTOM_SPRITE_RULES,
} from './custom-config.js';

const BUILT_IN_HERO_PROFILES = {
  main: {
    id: 'main',
    kind: 'hero',
    src: '/assets/characters/research-crow.png',
    grid: { cols: 4, rows: 5 },
    anchor: { x: 0.5, y: 1 },
    scale: 1.2,
    className: 'worker--sprite-crow',
    states: {
      idle: { frame: [1, 4] },
      queued: { frame: [0, 4] },
      reading: { frame: [2, 4] },
      thinking: { frame: [1, 4] },
      coordinating: { frame: [1, 3] },
      searching: { frame: [0, 3] },
      responding: { frame: [2, 3] },
      executing: { frame: [1, 4] },
      writing: { frame: [2, 4] },
      moving: { frame: [1, 4] },
    },
  },
  work: {
    id: 'work',
    kind: 'hero',
    src: '/assets/characters/work-human.png',
    grid: { cols: 4, rows: 5 },
    anchor: { x: 0.5, y: 1 },
    scale: 1.08,
    className: 'worker--sprite-human',
    states: {
      idle: { frame: [1, 0] },
      queued: { frame: [1, 2] },
      reading: { frame: [1, 1] },
      thinking: { frame: [1, 1] },
      coordinating: { frame: [1, 4] },
      searching: { frame: [1, 3] },
      responding: { frame: [1, 2] },
      executing: { frame: [1, 2] },
      writing: { frame: [1, 3] },
      moving: { frame: [1, 0] },
    },
  },
};

const DEPLOYED_SPRITE_PROFILE = {
  id: 'deployed-agent',
  kind: 'hero',
  src: '/assets/characters/deployed-agent.png',
  grid: { cols: 1, rows: 1 },
  anchor: { x: 0.5, y: 1 },
  scale: 1,
  className: 'worker--sprite-deployed-agent',
  states: {
    idle: { frame: [0, 0] },
    queued: { frame: [0, 0] },
    reading: { frame: [0, 0] },
    thinking: { frame: [0, 0] },
    coordinating: { frame: [0, 0] },
    searching: { frame: [0, 0] },
    responding: { frame: [0, 0] },
    executing: { frame: [0, 0] },
    writing: { frame: [0, 0] },
    moving: { frame: [0, 0] },
  },
};

const FALLBACK_PROFILES = {
  agent: {
    kind: 'fallback-agent',
    className: 'worker--fallback-agent',
    scale: 1,
  },
  session: {
    kind: 'fallback-session',
    className: 'worker--fallback-session',
    scale: 1,
  },
};

const ALL_SPRITE_PROFILES = {
  ...BUILT_IN_HERO_PROFILES,
  [DEPLOYED_SPRITE_PROFILE.id]: DEPLOYED_SPRITE_PROFILE,
  ...(CUSTOM_SPRITE_PROFILES || {}),
};

function key(value) {
  return String(value || '').trim().toLowerCase();
}

function getProfile(profileId) {
  return ALL_SPRITE_PROFILES[profileId] || ALL_SPRITE_PROFILES[key(profileId)] || null;
}

function matchesRule(entity, rule) {
  if (!entity || !rule?.match) return false;
  const match = rule.match;
  return Object.entries(match).every(([field, expected]) => {
    const actual = field === 'station'
      ? normalizeStation(entity.station || entity.state)
      : key(entity[field]);
    const values = Array.isArray(expected) ? expected : [expected];
    return values.map(key).includes(key(actual));
  });
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

export function getSpriteProfile(entity) {
  const rule = (CUSTOM_SPRITE_RULES || []).find(item => matchesRule(entity, item));
  if (rule) {
    const profile = getProfile(rule.profile);
    if (profile) return profile;
  }

  if (entity.entityType === 'agent') {
    const agentId = key(entity.agentId);
    const displayName = key(entity.displayName);
    const profileId = CUSTOM_AGENT_SPRITES?.[agentId] || CUSTOM_AGENT_SPRITES?.[displayName] || agentId;
    const profile = getProfile(profileId);
    if (profile) return profile;
  }

  if (isTransientSubagentLike(entity)) {
    const sessionKind = key(entity.sessionKind || entity.sourceSessionKind);
    const runtimeKind = key(entity.runtimeKind || entity.runtimeInfo?.runtimeKind);
    const profileId = CUSTOM_SESSION_SPRITES?.[sessionKind] || CUSTOM_SESSION_SPRITES?.[runtimeKind] || DEPLOYED_SPRITE_PROFILE.id;
    return getProfile(profileId) || DEPLOYED_SPRITE_PROFILE;
  }

  if (entity.entityType === 'session') {
    return FALLBACK_PROFILES.session;
  }

  return FALLBACK_PROFILES.agent;
}

export function getPoseKey(entity, actor) {
  if (actor?.moving) return 'moving';

  const activity = actor?.activity || null;
  if (activity === 'sitting' || activity === 'coffee' || activity === 'waiting') return 'idle';
  if (activity === 'reading' || activity === 'reviewing') return 'reading';
  if (activity === 'thinking' || activity === 'planning') return 'thinking';
  if (activity === 'talking') return 'coordinating';
  if (activity === 'researching') return 'searching';
  if (activity === 'replying' || activity === 'dispatching' || activity === 'triaging') return 'responding';
  if (activity === 'typing' || activity === 'working') return 'executing';
  if (activity === 'writing') return 'writing';

  return normalizeStation(entity.station || entity.state || 'idle');
}

export function resolveFrame(profile, poseKey) {
  if (!profile?.states) return null;
  return profile.states[poseKey]?.frame || profile.states.idle?.frame || null;
}
