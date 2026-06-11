import { getRoomForStation } from './layout.js';
import { OFFICE_CONFIG } from './config/office-config.js';
import { esc, formatRelativeTime, normalizeStation, truncate } from './utils.js';

function cardTitle(label, value, tone) {
  return `
    <div class="mini-stat mini-stat--${tone}">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderStats(store, root) {
  const activeAgents = [...store.agents.values()].filter(agent => normalizeStation(agent.station || agent.state) !== 'idle').length;
  root.innerHTML = [
    cardTitle('Agents', store.summary.agentCount ?? 0, 'primary'),
    cardTitle('Sessions', store.summary.visibleSessionCount ?? 0, 'secondary'),
    cardTitle('Active', store.summary.activeSessionCount ?? 0, 'accent'),
    cardTitle('Subagents', store.summary.subagentCount ?? 0, 'warn'),
    cardTitle('Active agts', activeAgents, 'primary'),
    cardTitle('Version', store.version || 0, 'secondary'),
  ].join('');
}

function formatModel(entity) {
  if (entity.modelInfo?.model) return entity.modelInfo.model;
  if (entity.modelInfo?.provider) return entity.modelInfo.provider;
  return 'n/a';
}

function getFocusAgents(store) {
  const agents = [...store.agents.values()];
  const max = Math.max(1, Number(OFFICE_CONFIG.maxFocusCards || 4));
  const preferred = (OFFICE_CONFIG.focusAgentIds || [])
    .map(agentId => agents.find(agent => agent.agentId === agentId))
    .filter(Boolean);

  if (preferred.length) return preferred.slice(0, max);
  return agents.slice(0, max);
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

function renderCommsTraffic(entity) {
  const comms = entity.comms || { state: 'unknown', reason: 'No direct transport evidence' };
  const provider = comms.provider || 'unknown';
  const tone = comms.state || 'unknown';
  const label = commsLabel(comms);
  return `
    <div class="focus-card__comms focus-card__comms--${esc(tone)}" title="${esc(comms.reason || provider)}">
      <span class="focus-card__comms-light" aria-hidden="true"></span>
      <div class="focus-card__comms-copy">
        <strong>${esc(label)}</strong>
        <small>${esc(truncate(`${provider} — ${comms.reason || 'No direct transport evidence'}`, 44))}</small>
      </div>
    </div>
  `;
}

function formatSessionAge(ageSec) {
  const sec = Number(ageSec || 0);
  if (!Number.isFinite(sec) || sec <= 0) return 'fresh';
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = (sec / 3600).toFixed(hrNeedsDecimal(sec) ? 1 : 0);
  return `${hr}h`;
}

function hrNeedsDecimal(sec) {
  return sec < 10 * 3600;
}

function deriveContextRisk(entity) {
  const ageSec = Number(entity.sessionAgeSec || 0);
  const pending = Number(entity.pendingCount || 0);
  const tool = String(entity.tool || '').toLowerCase();
  const taskKind = String(entity.taskKind || '').toLowerCase();
  const lastEventKind = String(entity.lastEventKind || '').toLowerCase();
  const model = String(entity.modelInfo?.model || '').toLowerCase();
  const provider = String(entity.modelInfo?.provider || '').toLowerCase();

  if (taskKind === 'system' || lastEventKind === 'system') {
    return {
      tone: 'degraded',
      label: 'startup-gated',
      detail: 'post-compact / startup recovery',
    };
  }

  if (tool === 'process' && pending > 0) {
    return {
      tone: 'blocked',
      label: 'reply-blocked',
      detail: 'live process polling',
    };
  }

  const bigContextModel = /(gpt-5|gpt-4\.1|claude|gemini|qwen|deepseek)/.test(`${provider} ${model}`);

  if (ageSec >= 90 * 60) {
    return {
      tone: 'blocked',
      label: 'very high',
      detail: 'long session age',
    };
  }

  if (ageSec >= 60 * 60) {
    return {
      tone: 'degraded',
      label: 'high',
      detail: bigContextModel ? 'older session, likely nearing compaction' : 'older session',
    };
  }

  if (ageSec >= 30 * 60) {
    return {
      tone: 'degraded',
      label: 'medium',
      detail: bigContextModel ? 'session building context' : 'session maturing',
    };
  }

  return {
    tone: 'ok',
    label: 'low',
    detail: 'fresh context window',
  };
}

function renderContextWindow(entity) {
  const risk = deriveContextRisk(entity);
  const model = formatModel(entity);
  const sessionAge = formatSessionAge(entity.sessionAgeSec);
  return `
    <div class="focus-card__context focus-card__context--${esc(risk.tone)}" title="Heuristic only — derived from session age/state, not real token telemetry">
      <span class="focus-card__context-light" aria-hidden="true"></span>
      <div class="focus-card__context-copy">
        <strong>ctx ${esc(risk.label)}</strong>
        <small>${esc(truncate(`${sessionAge} old · ${model} · ${risk.detail}`, 48))}</small>
      </div>
    </div>
  `;
}

function renderFocusAgentCard(entity, selectedEntityId) {
  const model = formatModel(entity);
  const modelFull = entity.modelInfo?.provider && entity.modelInfo?.model
    ? `${entity.modelInfo.provider}/${entity.modelInfo.model}`
    : model;
  const station = normalizeStation(entity.station || entity.state);
  const room = getRoomForStation(station).label;
  const health = entity.health?.state || 'unknown';
  const seen = formatRelativeTime(entity.lastSeen || entity.lastActivity);
  const selected = selectedEntityId === entity.entityId ? ' focus-card--selected' : '';

  return `
    <article class="focus-card focus-card--agent${esc(selected)}">
      <header>
        <h3>${esc(entity.displayName || entity.agentId || entity.sessionKey || entity.entityId)}</h3>
        <span class="pill pill--agent">agent</span>
      </header>
      <p class="focus-card__status" title="${esc(entity.status || station)}">${esc(truncate(entity.status || station, 52))}</p>
      ${renderCommsTraffic(entity)}
      ${renderContextWindow(entity)}
      <dl class="focus-card__meta">
        <div><dt>Room</dt><dd title="${esc(room)}">${esc(room)}</dd></div>
        <div><dt>Station</dt><dd title="${esc(station)}">${esc(station)}</dd></div>
        <div><dt>Health</dt><dd title="${esc(health)}">${esc(health)}</dd></div>
        <div><dt>Seen</dt><dd title="${esc(seen)}">${esc(seen)}</dd></div>
      </dl>
      <small class="focus-card__model" title="${esc(modelFull)}">${esc(truncate(model, 28))}</small>
    </article>
  `;
}

function renderFocus(store, root) {
  const focusAgents = getFocusAgents(store);
  if (!focusAgents.length) {
    root.innerHTML = '<div class="empty-state">No worker selected yet.</div>';
    return;
  }

  root.innerHTML = `
    <div class="focus-stack">
      ${focusAgents.map(entity => renderFocusAgentCard(entity, store.selectedEntityId)).join('')}
    </div>
  `;
}

export function renderPanels(store, elements) {
  renderStats(store, elements.statsGrid);
  renderFocus(store, elements.focusPanel);
}
