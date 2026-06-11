import { authFetch } from './auth.js';

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function kv(label, value, tone = '') {
  return `<div class="gateway-kv ${tone}"><span>${esc(label)}</span><strong>${esc(value || '—')}</strong></div>`;
}

function chip(label, value, tone = '') {
  return `<div class="gateway-chip ${tone}"><span>${esc(label)}</span><strong>${esc(value || '—')}</strong></div>`;
}

function formatTime(value) {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function classify(summary, data) {
  const runtime = String(summary.runtime || '').toLowerCase();
  const lines = Array.isArray(data.statusLines) ? data.statusLines.join('\n').toLowerCase() : '';
  if (data.ok === false) return { label: 'degraded', tone: 'is-warn' };
  if (runtime.includes('unavailable') || runtime.includes('degraded')) return { label: 'degraded', tone: 'is-warn' };
  if (lines.includes('restarting') || lines.includes('not installed') || lines.includes('service unit not found')) return { label: 'unstable', tone: 'is-warn' };
  return { label: 'online', tone: 'is-ok' };
}

let lastLogSignature = '';

export async function renderGatewayPanel(elements, healthLog = null) {
  if (!elements?.summary || !elements?.log) return;

  const terminal = elements.log.closest('.gateway-card__terminal');

  try {
    const response = await authFetch('/api/gateway', { cache: 'no-store' });
    const data = await response.json();
    healthLog?.push('gateway', 'Gateway snapshot refreshed.', data?.summary?.runtime || null);

    const summary = data.summary || {};
    const state = classify(summary, data);
    const statusLines = Array.isArray(data.statusLines) ? data.statusLines : [];
    const logLines = Array.isArray(data.liveLog) && data.liveLog.length
      ? data.liveLog.slice(-160)
      : (statusLines.length ? statusLines.slice(-60) : ['No gateway log output yet.']);

    const warningLines = statusLines.filter(line => /warn|error|degraded|restart|not installed|service/i.test(line)).slice(-3);

    elements.summary.innerHTML = [
      kv('State', state.label, state.tone),
      kv('Runtime', summary.runtime, state.tone),
      kv('Listening', summary.listening || summary.probe || 'not reported'),
      kv('Dashboard', summary.dashboard || 'not reported'),
    ].join('');

    if (elements.meta) {
      elements.meta.innerHTML = [
        chip('service', summary.service || 'unknown', /not installed|unit not found/i.test(summary.service || '') ? 'is-warn' : ''),
        chip('snapshot', formatTime(data.fetchedAt), 'is-dim'),
        chip('log file', data.logFile ? data.logFile.split(/[\\/]/).pop() : 'none', 'is-dim'),
        ...(warningLines.length ? warningLines.map(line => chip('warn', line, 'is-warn')) : []),
      ].join('');
    }

    if (elements.loghead) {
      elements.loghead.innerHTML = `<div class="gateway-loghead__label">raw gateway log / tail -f gateway</div><div class="gateway-loghead__state ${state.tone}">${esc(state.label)}</div>`;
    }

    const nextLogText = logLines.join('\n') || 'No gateway log output yet.';
    const nextSignature = `${data.fetchedAt || ''}:${nextLogText}`;

    if (lastLogSignature !== nextSignature) {
      const shouldStick = Math.abs((elements.log.scrollHeight - elements.log.clientHeight) - elements.log.scrollTop) < 24;
      elements.log.innerHTML = `<pre>${esc(nextLogText)}</pre>`;
      if (shouldStick) {
        elements.log.scrollTop = elements.log.scrollHeight;
      }
      lastLogSignature = nextSignature;
    }

    if (terminal) {
      const hasScroll = elements.log.scrollHeight > (elements.log.clientHeight + 6);
      const atBottom = Math.abs((elements.log.scrollHeight - elements.log.clientHeight) - elements.log.scrollTop) < 24;
      const isScrolled = elements.log.scrollTop > 8;
      terminal.classList.toggle('is-scrollable', hasScroll);
      terminal.classList.toggle('is-at-bottom', atBottom);
      terminal.classList.toggle('is-scrolled', isScrolled);
    }
  } catch (error) {
    healthLog?.push('gateway', 'Gateway fetch failed.', error?.message || null);
    elements.summary.innerHTML = [
      kv('State', 'offline', 'is-warn'),
      kv('Runtime', 'unavailable', 'is-warn'),
      kv('Listening', 'unavailable'),
      kv('Dashboard', 'unavailable'),
    ].join('');

    if (elements.meta) {
      elements.meta.innerHTML = chip('warn', error.message || 'Gateway feed unavailable.', 'is-warn');
    }

    if (elements.loghead) {
      elements.loghead.innerHTML = `<div class="gateway-loghead__label">raw gateway log / tail -f gateway</div><div class="gateway-loghead__state is-warn">offline</div>`;
    }

    elements.log.innerHTML = `<pre>${esc(error.message || 'Gateway feed unavailable.')}</pre>`;

    if (terminal) {
      terminal.classList.remove('is-scrollable', 'is-scrolled', 'is-at-bottom');
    }
  }
}
