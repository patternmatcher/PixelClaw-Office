import { formatRelativeTime, normalizeStation, truncate } from './utils.js';

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function stationName(entity) {
  return normalizeStation(entity.station || entity.state || 'idle');
}

function taskText(entity) {
  return entity.taskFullText || entity.taskPreview || entity.status || 'No task detail';
}

function lastStations(entity) {
  const transitions = Array.isArray(entity.transitions) ? entity.transitions : [];
  const stations = [];

  for (const item of transitions) {
    const fromStation = item?.from?.station;
    if (fromStation && fromStation !== stationName(entity) && !stations.includes(fromStation)) {
      stations.push(fromStation);
    }
    if (stations.length >= 2) break;
  }

  return stations;
}

function recentTools(entity) {
  const log = Array.isArray(entity.activityLog) ? entity.activityLog : [];
  const tools = [];
  for (const item of log) {
    if (!item?.tool) continue;
    tools.push(item);
    if (tools.length >= 5) break;
  }
  return tools;
}

function renderSummary(entity) {
  const recentStationList = lastStations(entity);
  const kindLabel = entity.entityType === 'agent' ? 'Agent' : (entity.sessionKind === 'subagent' ? 'Child session' : 'Session');
  const lastEvent = formatRelativeTime(entity.liveness?.lastEventAt || entity.lastActivity);
  const lastTouch = formatRelativeTime(entity.liveness?.lastFileTouchAt || entity.lastSeen || entity.lastActivity);
  const station = stationName(entity);
  const livenessLabel = entity.liveness?.label || 'Unknown';
  const livenessReason = Array.isArray(entity.liveness?.reasons) && entity.liveness.reasons.length
    ? entity.liveness.reasons.join(', ').replaceAll('_', ' ')
    : 'No extra liveness signals';

  return `
    <div class="detail-card__meta-grid">
      <div class="detail-chip"><span>Type</span><strong>${esc(kindLabel)}</strong></div>
      <div class="detail-chip"><span>State</span><strong>${esc(livenessLabel)}</strong></div>
      <div class="detail-chip"><span>Last event</span><strong>${esc(lastEvent)}</strong></div>
      <div class="detail-chip"><span>Last file touch</span><strong>${esc(lastTouch)}</strong></div>
      <div class="detail-chip"><span>Current mode</span><strong>${esc(station)}</strong></div>
      <div class="detail-chip"><span>Health</span><strong>${esc(entity.health?.label || entity.health?.state || 'unknown')}</strong></div>
      <div class="detail-chip detail-chip--wide"><span>Liveness signal</span><strong>${esc(livenessReason)}</strong></div>
      <div class="detail-chip detail-chip--wide"><span>Recent path</span><strong>${esc(recentStationList.length ? recentStationList.join(' → ') : 'No recent moves')}</strong></div>
    </div>
  `;
}

function renderToolCalls(entity) {
  const tools = recentTools(entity);
  if (!tools.length) {
    return '<div class="detail-empty">No recent tool calls.</div>';
  }

  return `
    <ul class="detail-list">
      ${tools.map(item => `
        <li class="detail-list__item">
          <div>
            <strong>${esc(item.tool)}</strong>
            <span>${esc(truncate(item.label || item.fullLabel || item.state || 'Tool call', 68))}</span>
          </div>
          <time>${esc(formatRelativeTime(item.ts))}</time>
        </li>
      `).join('')}
    </ul>
  `;
}

function renderTaskInsight(entity) {
  const exact = taskText(entity);
  const tool = entity.tool || 'none';
  const pending = entity.pendingCount || 0;
  return `
    <div class="detail-card__task">
      <div class="detail-chip"><span>Current tool</span><strong>${esc(tool)}</strong></div>
      <div class="detail-chip"><span>Pending</span><strong>${esc(String(pending))}</strong></div>
      <div class="detail-card__task-body">${esc(exact)}</div>
    </div>
  `;
}

function commsLabel(comms) {
  const tone = comms?.state || 'unknown';
  const reason = String(comms?.reason || '').toLowerCase();

  if (tone === 'blocked') {
    if (reason.includes('process')) return 'sending blocked';
    if (reason.includes('stuck')) return 'reply blocked';
    return 'blocked';
  }

  if (tone === 'degraded') {
    if (reason.includes('startup') || reason.includes('post-compact')) return 'startup-gated';
    if (reason.includes('slow')) return 'sending slow';
    if (reason.includes('stale')) return 'sending stale';
    if (reason.includes('reply not yet verified')) return 'sending unverified';
    return 'degraded';
  }

  if (tone === 'ok') return 'sending ok';
  return 'transport unknown';
}

function renderComms(entity) {
  const comms = entity.comms || {};
  const state = comms.state || 'unknown';
  const provider = comms.provider || 'unknown';
  const account = comms.accountId || 'n/a';
  const reason = comms.reason || 'No direct transport evidence';
  const label = commsLabel(comms);
  const lastOk = formatRelativeTime(comms.lastOutboundOkAt);
  const lastErr = comms.lastOutboundErrorAt ? formatRelativeTime(comms.lastOutboundErrorAt) : 'none';

  return `
    <div class="detail-card__comms detail-card__comms--${esc(state)}">
      <div class="detail-card__comms-light" aria-hidden="true"></div>
      <div class="detail-card__comms-copy">
        <strong>${esc(label)}</strong>
        <span>${esc(reason)}</span>
      </div>
      <div class="detail-card__meta-grid">
        <div class="detail-chip"><span>Provider</span><strong>${esc(provider)}</strong></div>
        <div class="detail-chip"><span>Account</span><strong>${esc(account)}</strong></div>
        <div class="detail-chip"><span>Last OK</span><strong>${esc(lastOk)}</strong></div>
        <div class="detail-chip"><span>Last fail</span><strong>${esc(lastErr)}</strong></div>
      </div>
    </div>
  `;
}

function pinDetailCardWithinViewport(root) {
  if (!root) return;
  const card = root.querySelector('.detail-card');
  if (!card) return;

  const margin = 12;
  const maxLeft = Math.max(margin, window.innerWidth - card.offsetWidth - margin);
  const maxTop = Math.max(margin, window.innerHeight - card.offsetHeight - margin);
  const currentLeft = Number(root.dataset.dragLeft || root.style.left.replace('px', '') || margin);
  const currentTop = Number(root.dataset.dragTop || root.style.top.replace('px', '') || margin);
  const nextLeft = Math.max(margin, Math.min(currentLeft, maxLeft));
  const nextTop = Math.max(margin, Math.min(currentTop, maxTop));
  root.dataset.dragLeft = String(nextLeft);
  root.dataset.dragTop = String(nextTop);
  root.style.left = `${nextLeft}px`;
  root.style.top = `${nextTop}px`;
}

export function renderDetailCard(store, root) {
  const entity = store.getSelectedEntity();
  if (!entity || !store.detailOpen) {
    root.innerHTML = '';
    root.classList.remove('is-open');
    root.removeAttribute('style');
    return;
  }

  const title = entity.displayName || entity.agentId || entity.sessionKey || entity.entityId;
  const subtitle = entity.entityType === 'agent'
    ? (entity.childSessionCount ? `${entity.childSessionCount} child session${entity.childSessionCount === 1 ? '' : 's'}` : 'Primary agent')
    : (entity.parentSessionKey ? `spawned by ${entity.parentSessionKey}` : (entity.sessionKey || 'session'));

  const anchor = store.selectionAnchor || { x: window.innerWidth * 0.28, y: window.innerHeight * 0.48 };
  const bubbleWidth = Math.min(420, window.innerWidth - 24);
  const left = Math.max(12, Math.min(anchor.x - (bubbleWidth * 0.42), window.innerWidth - bubbleWidth - 12));
  const top = Math.max(12, Math.min(anchor.y - 24 - 380, window.innerHeight - 280));
  const tailX = Math.max(34, Math.min(anchor.x - left, bubbleWidth - 34));

  if (!root.dataset.dragLeft || !root.dataset.dragTop || root.dataset.anchorEntity !== entity.entityId) {
    root.dataset.dragLeft = String(left);
    root.dataset.dragTop = String(top);
    root.dataset.anchorEntity = entity.entityId;
  }

  root.style.left = `${root.dataset.dragLeft}px`;
  root.style.top = `${root.dataset.dragTop}px`;
  root.style.bottom = 'auto';
  root.style.setProperty('--tail-x', `${tailX}px`);
  root.style.setProperty('--tail-drop', `${Math.max(28, Math.min(180, anchor.y - top + 8))}px`);

  root.innerHTML = `
    <section class="detail-card detail-card--window is-open" aria-label="Selected worker detail">
      <button class="detail-card__close" type="button" aria-label="Close detail card">×</button>
      <header class="detail-card__header detail-card__drag-handle">
        <div>
          <p class="detail-card__eyebrow">Selected worker</p>
          <h3 title="${esc(title)}">${esc(title)}</h3>
          <p class="detail-card__subtitle" title="${esc(subtitle)}">${esc(truncate(subtitle, 72))}</p>
        </div>
        <span class="detail-card__pill detail-card__pill--${entity.entityType === 'agent' ? 'agent' : 'session'}">${esc(entity.entityType === 'agent' ? 'agent' : 'child')}</span>
      </header>
      <section class="detail-card__section">
        <h4>Current task</h4>
        ${renderTaskInsight(entity)}
      </section>
      <section class="detail-card__section">
        <h4>Quick read</h4>
        ${renderSummary(entity)}
      </section>
      <section class="detail-card__section">
        <h4>Reply path</h4>
        ${renderComms(entity)}
      </section>
      <section class="detail-card__section">
        <h4>Last tool calls</h4>
        ${renderToolCalls(entity)}
      </section>
    </section>
  `;

  root.classList.add('is-open');
  pinDetailCardWithinViewport(root);
  root.querySelector('.detail-card__close')?.addEventListener('click', () => store.select(null));

  const handle = root.querySelector('.detail-card__drag-handle');
  if (handle) {
    handle.onpointerdown = event => {
      if (event.target.closest('.detail-card__close')) return;
      event.preventDefault();
      const startLeft = Number(root.dataset.dragLeft || left);
      const startTop = Number(root.dataset.dragTop || top);
      const dx = event.clientX - startLeft;
      const dy = event.clientY - startTop;

      const move = moveEvent => {
        const maxLeft = Math.max(12, window.innerWidth - root.offsetWidth - 12);
        const maxTop = Math.max(12, window.innerHeight - root.offsetHeight - 12);
        const nextLeft = Math.max(12, Math.min(moveEvent.clientX - dx, maxLeft));
        const nextTop = Math.max(12, Math.min(moveEvent.clientY - dy, maxTop));
        root.dataset.dragLeft = String(nextLeft);
        root.dataset.dragTop = String(nextTop);
        root.style.left = `${nextLeft}px`;
        root.style.top = `${nextTop}px`;
      };

      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
    };
  }
}