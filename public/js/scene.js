import { DECOR_DEFINITIONS, OFFICE_BACKGROUND, OFFICE_HEIGHT, OFFICE_WIDTH, ROOM_ZONES } from './layout.js';
import { OFFICE_CONFIG } from './config/office-config.js';
import { esc, formatRelativeTime, hashString, normalizeStation, pick, truncate } from './utils.js';
import { getPoseKey, getSpriteProfile, resolveFrame } from './sprites/profiles.js';
import { MotionDebugOverlay } from './motion/debug-overlay.js';

const SHIRT_COLORS = ['#3f6ec9', '#5d9f62', '#c86d4e', '#8b67cf', '#cc8e35', '#3292a0'];
const HAIR_COLORS = ['#2b1d16', '#4a3324', '#6a4b2d', '#a06d44', '#272127'];
const SKIN_COLORS = ['#f2d0ae', '#e2ba94', '#c78e63', '#8f5d3b'];

const LABEL_OFFSETS = {
  executing: { dx: 0, dy: -8 },
  searching: { dx: 12, dy: 8 },
  coordinating: { dx: -12, dy: 10 },
  writing: { dx: 4, dy: 42, width: 54, height: 18 },
  responding: { dx: -10, dy: 8 },
};

function percentX(x) { return `${(x / OFFICE_WIDTH) * 100}%`; }
function percentY(y) { return `${(y / OFFICE_HEIGHT) * 100}%`; }
function percentW(w) { return `${(w / OFFICE_WIDTH) * 100}%`; }
function percentH(h) { return `${(h / OFFICE_HEIGHT) * 100}%`; }

function createWorkerNode() {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'worker';
  node.innerHTML = `
    <span class="worker__shadow"></span>
    <span class="worker__body">
      <span class="worker__head"></span>
      <span class="worker__hair"></span>
      <span class="worker__shirt"></span>
      <span class="worker__legs"></span>
      <span class="worker__badge"></span>
    </span>
    <span class="worker__sprite"></span>
  `;
  return node;
}

function decorateWorker(node, entity) {
  const seed = hashString(entity.entityId || entity.displayName || entity.agentId || entity.sessionKey);
  node.style.setProperty('--shirt', pick(SHIRT_COLORS, seed));
  node.style.setProperty('--hair', pick(HAIR_COLORS, seed >> 1));
  node.style.setProperty('--skin', pick(SKIN_COLORS, seed >> 2));
}

function describe(entity) {
  const subject = entity.displayName || entity.agentId || entity.sessionKey || entity.entityId;
  const status = entity.status || entity.station || entity.state;
  const activity = entity.tool ? `Tool: ${entity.tool}` : `Station: ${entity.station || entity.state}`;
  return `${subject}\n${truncate(status, 48)}\n${activity}\nUpdated ${formatRelativeTime(entity.lastSeen || entity.lastActivity)}`;
}

function createZoneNode(zone) {
  const node = document.createElement('div');
  node.className = `office-zone office-zone--${zone.id}`;
  node.style.left = percentX(zone.rect.x);
  node.style.top = percentY(zone.rect.y);
  node.style.width = percentW(zone.rect.width);
  node.style.height = percentH(zone.rect.height);
  node.style.setProperty('--zone-color', zone.color);
  return node;
}

function createSignNode(zone) {
  const poster = zone.poster || {
    x: zone.rect.x + 8,
    y: zone.rect.y + 6,
    width: Math.max(52, Math.min(zone.rect.width - 16, 72)),
    height: 20,
    tag: zone.label,
  };

  const offset = LABEL_OFFSETS[zone.id] || { dx: 0, dy: 0 };
  const width = offset.width || Math.max(48, Math.min(Math.round((poster.width || 68) * 0.84), 68));
  const height = offset.height || Math.min(poster.height || 18, 18);
  const left = Math.round(zone.rect.x + ((zone.rect.width - width) / 2) + offset.dx);
  const topBase = zone.rect.y < 40 ? 18 : 12;
  const top = Math.round(zone.rect.y + topBase + offset.dy);

  const node = document.createElement('div');
  node.className = 'room-sign room-sign--label';
  node.style.left = percentX(left);
  node.style.top = percentY(top);
  node.style.width = percentW(width);
  node.style.height = percentH(height);
  node.style.setProperty('--label-tint', zone.color || 'rgba(112, 148, 220, 0.18)');
  node.innerHTML = `<span class="room-sign__text room-sign__text--light">${esc(poster.tag || zone.label)}</span>`;
  return node;
}

function ensureViewChild(view, className, tagName = 'div', attributes = null) {
  let node = view.querySelector(`.${className}`);
  if (!node) {
    node = document.createElement(tagName);
    node.className = className;
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        if (value != null) node.setAttribute(key, value);
      }
    }
    view.appendChild(node);
  }
  return node;
}

function removeViewChild(view, className) {
  const node = view.querySelector(`.${className}`);
  if (node) node.remove();
}

function createDecorNode(definition) {
  const node = document.createElement('div');
  node.className = `room-decor room-decor--${definition.kind} ${definition.variant ? `room-decor--${definition.variant}` : ''}`.trim();
  node.style.left = percentX(definition.x);
  node.style.top = percentY(definition.y);
  node.style.width = percentW(definition.width);
  node.style.height = percentH(definition.height);
  if (definition.tone) node.style.setProperty('--decor-tone', definition.tone);
  if (definition.tone2) node.style.setProperty('--decor-tone-2', definition.tone2);
  return node;
}

function ensureOfficeViewStructure(view) {
  const bg = ensureViewChild(view, 'office-view__bg', 'img', { alt: 'Pixel office background' });
  bg.src = OFFICE_BACKGROUND;

  removeViewChild(view, 'office-view__labels');

  return {
    bg,
    zoneLayer: ensureViewChild(view, 'office-view__zones'),
    decorLayer: ensureViewChild(view, 'office-view__decor'),
    signLayer: ensureViewChild(view, 'office-view__signs'),
    debugLayer: ensureViewChild(view, 'office-view__debug'),
    workerLayer: ensureViewChild(view, 'office-view__workers'),
  };
}

function getAnimatedFrame(profile, poseKey) {
  const base = resolveFrame(profile, poseKey);
  if (!base) return null;
  if (profile?.id !== 'deployed-agent') return base;

  return base;
}

function applySpriteProfile(node, entity, actor = null) {
  const sprite = node.querySelector('.worker__sprite');
  const profile = getSpriteProfile(entity);
  const poseKey = getPoseKey(entity, actor);

  node.classList.remove('worker--sprite-mode', 'worker--sprite-crow', 'worker--sprite-human', 'worker--sprite-deployed-agent', 'worker--fallback-agent', 'worker--fallback-session');
  node.style.setProperty('--scale', '1');
  sprite.style.backgroundImage = 'none';
  sprite.style.backgroundSize = 'auto';
  sprite.style.backgroundPosition = '0 0';
  node.dataset.renderMode = 'fallback';
  node.dataset.pose = poseKey;

  if (!profile) return { mode: 'fallback', poseKey, profileId: null };
  if (profile.kind.startsWith('fallback')) {
    node.classList.add(profile.className || (entity.entityType === 'session' ? 'worker--fallback-session' : 'worker--fallback-agent'));
    return { mode: 'fallback', poseKey, profileId: profile.id || profile.kind || null };
  }

  const frame = getAnimatedFrame(profile, poseKey);
  if (!frame) {
    node.classList.add(entity.entityType === 'session' ? 'worker--fallback-session' : 'worker--fallback-agent');
    return { mode: 'fallback', poseKey, profileId: profile.id || null };
  }

  const [col, row] = frame;
  const xPercent = profile.grid.cols > 1 ? (col / (profile.grid.cols - 1)) * 100 : 0;
  const yPercent = profile.grid.rows > 1 ? (row / (profile.grid.rows - 1)) * 100 : 0;

  node.classList.add('worker--sprite-mode');
  if (profile.className) node.classList.add(profile.className);
  node.style.setProperty('--scale', String(profile.scale || 1));
  sprite.style.backgroundImage = `url(${profile.src})`;
  sprite.style.backgroundSize = `${profile.grid.cols * 100}% ${profile.grid.rows * 100}%`;
  sprite.style.backgroundPosition = `${xPercent}% ${yPercent}%`;
  node.dataset.renderMode = 'sprite';
  node.dataset.profile = profile.id || '';
  return { mode: 'sprite', poseKey, profileId: profile.id || null };
}

export class SceneRenderer {
  constructor({ root, onSelect, layoutEditor = null }) {
    this.root = root;
    this.onSelect = onSelect;
    this.layoutEditor = layoutEditor;
    this.workerNodes = new Map();
    this.zoneNodes = new Map();
    this.decorNodes = new Map();
    this.debugOverlay = new MotionDebugOverlay();
    this.init();
  }

  init() {
    const existingView = this.root.querySelector('.office-view');
    const view = existingView || document.createElement('div');

    if (!existingView) {
      view.className = 'office-view';
      this.root.replaceChildren(view);
    }

    const { zoneLayer, decorLayer, signLayer, debugLayer, workerLayer } = ensureOfficeViewStructure(view);

    this.view = view;
    this.zoneLayer = zoneLayer;
    this.decorLayer = decorLayer;
    this.signLayer = signLayer;
    this.debugLayer = debugLayer;
    this.workerLayer = workerLayer;
    this.zoneNodes.clear();
    this.workerNodes.clear();
    this.decorNodes.clear();
    this.zoneLayer.replaceChildren();
    this.decorLayer.replaceChildren();
    this.signLayer.replaceChildren();
    this.debugLayer.replaceChildren();
    this.workerLayer.replaceChildren();

    for (const zone of ROOM_ZONES) {
      const node = createZoneNode(zone);
      this.zoneLayer.appendChild(node);
      this.zoneNodes.set(zone.id, node);
      if (OFFICE_CONFIG.showRoomSigns !== false) {
        this.signLayer.appendChild(createSignNode(zone));
      }
    }

    this.renderDecor();
  }

  render(store, options = {}) {
    const entities = options.entities || store.getRenderableEntities();
    this.renderZones(store, entities);
    this.renderDecor();
    this.renderWorkers(store, options.motion || null, entities);
  }

  renderDecor() {
    for (const definition of DECOR_DEFINITIONS) {
      const resolved = this.layoutEditor?.applyDecorOverride(definition) || definition;
      let node = this.decorNodes.get(definition.id);
      if (!node) {
        node = createDecorNode(resolved);
        this.decorNodes.set(definition.id, node);
        this.decorLayer.appendChild(node);
      }
      node.style.left = percentX(resolved.x);
      node.style.top = percentY(resolved.y);
      node.style.width = percentW(resolved.width);
      node.style.height = percentH(resolved.height);
      node.classList.toggle('room-decor--editable', Boolean(this.layoutEditor?.isEnabled()));
      if (this.layoutEditor) this.layoutEditor.bindDecorNode(node, definition, this.view);
    }
  }

  renderZones(store, entities = null) {
    const counts = new Map();
    for (const entity of (entities || store.getRenderableEntities())) {
      const zone = ROOM_ZONES.find(room => room.stations.includes(entity.station || entity.state));
      if (!zone) continue;
      counts.set(zone.id, (counts.get(zone.id) || 0) + 1);
    }

    for (const zone of ROOM_ZONES) {
      const node = this.zoneNodes.get(zone.id);
      const count = counts.get(zone.id) || 0;
      node.classList.toggle('is-active', count > 0);
      node.style.setProperty('--intensity', count > 0 ? Math.min(0.72, 0.18 + (count * 0.08)) : 0.12);
    }
  }

  renderWorkers(store, motion = null, entities = null) {
    const renderEntities = entities || store.getRenderableEntities();
    const activeIds = new Set(renderEntities.map(entity => entity.entityId));
    const selectedId = store.selectedEntityId;

    for (const [id, node] of this.workerNodes.entries()) {
      if (!activeIds.has(id)) {
        node.remove();
        this.workerNodes.delete(id);
      }
    }

    for (const entity of renderEntities) {
      const actor = motion?.getActorState(entity) || null;
      const slot = actor || entity.renderSlot;
      const stationId = normalizeStation(entity.station || entity.state);
      let node = this.workerNodes.get(entity.entityId);
      if (!node) {
        node = createWorkerNode();
        decorateWorker(node, entity);
        this.workerNodes.set(entity.entityId, node);
        this.workerLayer.appendChild(node);
      }

      node.className = [
        'worker',
        `worker--${entity.entityType}`,
        `worker--${stationId}`,
        actor?.moving ? 'is-moving' : '',
        actor?.facing ? `worker--facing-${actor.facing}` : '',
        actor?.activity ? `worker--activity-${actor.activity}` : '',
        selectedId === entity.entityId ? 'is-selected' : '',
      ].filter(Boolean).join(' ');
      node.style.left = percentX(slot.x);
      node.style.top = percentY(slot.y);
      node.style.zIndex = String(Math.round((slot.y || 0) * 10));
      node.title = describe(entity);
      node.dataset.entityId = entity.entityId;
      node.dataset.entityType = entity.entityType;
      node.dataset.station = stationId;
      node.dataset.slotX = String(slot.x);
      node.dataset.slotY = String(slot.y);
      node.querySelector('.worker__badge').textContent = entity.entityType === 'agent'
        ? (entity.agentId || 'AG').slice(0, 2).toUpperCase()
        : (entity.sessionKind || 'SES').slice(0, 3).toUpperCase();
      node.onclick = () => {
        const rect = node.getBoundingClientRect();
        this.onSelect?.(entity.entityId, {
          x: rect.left + (rect.width / 2),
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });
      };
      const renderProfile = applySpriteProfile(node, entity, actor);
      node.dataset.renderProfile = renderProfile?.profileId || '';
      node.dataset.renderPose = renderProfile?.poseKey || '';
      node.dataset.renderState = renderProfile?.mode || 'fallback';
    }
  }
}
