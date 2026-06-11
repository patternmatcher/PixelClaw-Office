import { normalizeStation } from './utils.js';
import { getTargetForStation, getStationSlots } from './motion/path-graph.js';

export const OFFICE_WIDTH = 512;
export const OFFICE_HEIGHT = 448;
export const OFFICE_BACKGROUND = '/assets/office/public-office.svg';

export const DECOR_DEFINITIONS = [
  { id: 'lounge-stool-a', kind: 'seat', variant: 'meeting-stool', x: 440, y: 336, width: 14, height: 14, tone: '#b8baaa', tone2: '#737769' },
  { id: 'lounge-stool-b', kind: 'seat', variant: 'meeting-stool', x: 454, y: 360, width: 14, height: 14, tone: '#b8baaa', tone2: '#737769' },
];

export const ROOM_ZONES = [
  {
    id: 'queued',
    label: 'Entry / Inbox',
    summary: 'Top-center arrival strip and inbox staging area.',
    stations: ['queued'],
    rect: { x: 214, y: 12, width: 114, height: 72 },
    color: 'rgba(219, 182, 93, 0.18)',
    poster: { x: 238, y: 18, width: 70, height: 22, tag: 'INBOX' },
    decor: [],
  },
  {
    id: 'executing',
    label: 'Terminal',
    summary: 'Upper workstation row for execution-heavy tasks.',
    stations: ['executing'],
    rect: { x: 32, y: 126, width: 250, height: 120 },
    color: 'rgba(225, 119, 107, 0.16)',
    poster: { x: 104, y: 132, width: 96, height: 22, tag: 'TERMINAL' },
    decor: [],
  },
  {
    id: 'writing',
    label: 'Dev Floor',
    summary: 'Lower workstation row for editing and writing.',
    stations: ['writing'],
    rect: { x: 32, y: 252, width: 250, height: 136 },
    color: 'rgba(152, 107, 232, 0.16)',
    poster: { x: 118, y: 258, width: 68, height: 22, tag: 'DEV' },
    decor: [],
  },
  {
    id: 'searching',
    label: 'Intel Lab',
    summary: 'Upper-right analysis room and research wall.',
    stations: ['searching'],
    rect: { x: 344, y: 76, width: 148, height: 118 },
    color: 'rgba(99, 202, 216, 0.14)',
    poster: { x: 380, y: 82, width: 74, height: 22, tag: 'INTEL' },
    decor: [],
  },
  {
    id: 'coordinating',
    label: 'Idea Nook',
    summary: 'Upper-right coordination nook for discussion and synthesis.',
    stations: ['coordinating', 'thinking'],
    rect: { x: 344, y: 138, width: 148, height: 74 },
    color: 'rgba(143, 157, 242, 0.18)',
    poster: { x: 378, y: 142, width: 80, height: 22, tag: 'IDEAS' },
    decor: [],
  },
  {
    id: 'responding',
    label: 'Comms Desk',
    summary: 'Reply and dispatch desk in the middle-right room.',
    stations: ['responding'],
    rect: { x: 344, y: 242, width: 148, height: 72 },
    color: 'rgba(110, 209, 130, 0.16)',
    poster: { x: 376, y: 246, width: 84, height: 22, tag: 'COMMS' },
    decor: [],
  },
  {
    id: 'idle',
    label: 'Lounge',
    summary: 'Small meeting lounge below comms with sofa and stools.',
    stations: ['idle'],
    rect: { x: 344, y: 320, width: 148, height: 62 },
    color: 'rgba(131, 181, 104, 0.18)',
    poster: { x: 378, y: 322, width: 80, height: 22, tag: 'LOUNGE' },
    decor: [],
  },
  {
    id: 'monitoring',
    label: 'Monitoring',
    summary: 'Lower-right watch post for heartbeats, status checks, and passive supervision.',
    stations: ['monitoring', 'reading'],
    rect: { x: 344, y: 384, width: 148, height: 54 },
    color: 'rgba(117, 184, 151, 0.2)',
    poster: { x: 368, y: 388, width: 102, height: 22, tag: 'MONITOR' },
    decor: [],
  },
];

const AGENT_ORDER = [
  'queued',
  'executing',
  'writing',
  'searching',
  'coordinating',
  'thinking',
  'responding',
  'monitoring',
  'reading',
  'idle',
];

function withScale(slot, scale) {
  return { ...slot, scale };
}

export function getRoomForStation(stationId) {
  const normalized = normalizeStation(stationId);
  return ROOM_ZONES.find(room => room.stations.includes(normalized)) || ROOM_ZONES.find(room => room.id === 'idle');
}

export function getStationCapacity(stationId) {
  return getStationSlots(stationId).length;
}

export function getSlot(entity, index = 0) {
  const target = getTargetForStation(entity.station || entity.state, index);
  const scale = entity.entityType === 'session' ? 0.82 : 1;
  return withScale({
    x: target.point.x,
    y: target.point.y,
    facing: target.point.facing || 'down',
    activity: target.point.activity || null,
  }, scale);
}

export function sortEntitiesForRender(entities) {
  return [...entities].sort((a, b) => {
    const aStation = normalizeStation(a.station || a.state);
    const bStation = normalizeStation(b.station || b.state);
    const aRank = AGENT_ORDER.indexOf(aStation);
    const bRank = AGENT_ORDER.indexOf(bStation);
    if (aRank !== bRank) return aRank - bRank;
    if (a.entityType !== b.entityType) return a.entityType === 'agent' ? -1 : 1;
    return String(a.displayName || a.agentId || a.sessionKey || a.entityId)
      .localeCompare(String(b.displayName || b.agentId || b.sessionKey || b.entityId));
  });
}
