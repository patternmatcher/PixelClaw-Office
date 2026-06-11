import { esc, truncate } from './utils.js';

function fmtTs(ts) {
  if (!ts) return '--:--:--';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export class HealthLog {
  constructor({ root }) {
    this.root = root;
    this.entries = [];
    this.maxEntries = 80;
    this.visible = false;
    this.boundKey = event => this.onKey(event);
    window.__pixelOfficeLog = this;
  }

  init() {
    if (!this.root) return;
    window.addEventListener('keydown', this.boundKey);
    this.push('boot', 'Health log ready. Press Ctrl+Shift+H to toggle.');
    this.render();
  }

  onKey(event) {
    if (!(event.ctrlKey && event.shiftKey && String(event.key || '').toLowerCase() === 'h')) return;
    event.preventDefault();
    this.visible = !this.visible;
    this.root.classList.toggle('health-log--hidden', !this.visible);
    this.push('ui', this.visible ? 'Health log opened.' : 'Health log hidden.');
    this.render();
  }

  push(kind, message, meta = null) {
    this.entries.unshift({
      ts: Date.now(),
      kind: kind || 'info',
      message: String(message || ''),
      meta,
    });
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }
    this.render();
  }

  render() {
    if (!this.root) return;
    const lines = this.entries.map(entry => {
      const meta = entry.meta ? ` · ${truncate(typeof entry.meta === 'string' ? entry.meta : JSON.stringify(entry.meta), 120)}` : '';
      return `
        <div class="health-log__row health-log__row--${esc(entry.kind)}">
          <time>${esc(fmtTs(entry.ts))}</time>
          <strong>${esc(entry.kind)}</strong>
          <span>${esc(truncate(entry.message, 140))}${esc(meta)}</span>
        </div>
      `;
    }).join('');

    this.root.innerHTML = `
      <div class="health-log__head">
        <strong>Frontend health log</strong>
        <span>Ctrl+Shift+H</span>
      </div>
      <div class="health-log__body">${lines || '<div class="health-log__empty">No events yet.</div>'}</div>
    `;
  }
}
