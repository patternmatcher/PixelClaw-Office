import { authFetch, authWebSocketUrl } from './auth.js';

export class LiveTransport {
  constructor({ store, healthLog = null }) {
    this.store = store;
    this.healthLog = healthLog;
    this.ws = null;
    this.pollHandle = null;
    this.stopped = false;
    this.health = {
      mode: 'boot',
      wsState: 'idle',
      lastSnapshotAt: 0,
      lastDeltaAt: 0,
      lastPollOkAt: 0,
      lastPollErrorAt: 0,
      lastWsMessageAt: 0,
      lastWsCloseAt: 0,
      lastWsErrorAt: 0,
      lastError: null,
    };
    window.__pixelOfficeTransport = this.health;
  }

  async start() {
    const snapshot = await authFetch('/api/status').then(response => response.json());
    if (this.stopped) return;
    this.health.mode = 'snapshot';
    this.health.lastSnapshotAt = Date.now();
    this.healthLog?.push('transport', 'Initial snapshot loaded.');
    this.store.applySnapshot(snapshot);
    this.connectWebSocket();
  }

  connectWebSocket() {
    if (this.stopped) return;
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.health.mode = 'websocket';
      this.health.wsState = 'connecting';
      this.ws = new WebSocket(authWebSocketUrl(`${protocol}//${window.location.host}`));
      this.ws.addEventListener('open', () => {
        if (this.stopped) return;
        this.health.wsState = 'open';
        this.health.lastError = null;
        if (this.pollHandle) {
          window.clearInterval(this.pollHandle);
          this.pollHandle = null;
        }
        this.healthLog?.push('transport', 'WebSocket connected.');
      });
      this.ws.addEventListener('message', event => {
        if (this.stopped) return;
        this.health.lastWsMessageAt = Date.now();
        const payload = JSON.parse(event.data);
        if (payload.type === 'snapshot') {
          this.health.lastSnapshotAt = Date.now();
          this.store.applySnapshot(payload);
        } else if (payload.type === 'delta') {
          this.health.lastDeltaAt = Date.now();
          this.store.applyDelta(payload);
        }
      });
      this.ws.addEventListener('close', () => {
        this.health.wsState = 'closed';
        this.health.lastWsCloseAt = Date.now();
        this.ws = null;
        if (this.stopped) return;
        this.healthLog?.push('transport', 'WebSocket closed; switching to polling.');
        this.startPolling();
      });
      this.ws.addEventListener('error', event => {
        if (this.stopped) return;
        this.health.wsState = 'error';
        this.health.lastWsErrorAt = Date.now();
        this.health.lastError = event?.message || 'websocket error';
        this.healthLog?.push('transport', 'WebSocket error.', this.health.lastError);
      });
    } catch (error) {
      this.health.wsState = 'error';
      this.health.lastError = error?.message || 'websocket bootstrap failed';
      this.healthLog?.push('transport', 'WebSocket bootstrap failed.', this.health.lastError);
      this.startPolling();
    }
  }

  startPolling() {
    if (this.stopped || this.pollHandle) return;
    this.health.mode = 'polling';
    this.healthLog?.push('transport', 'Polling started.');
    this.pollHandle = window.setInterval(async () => {
      if (this.stopped) return;
      try {
        const response = await authFetch(`/api/status/delta?since=${this.store.version || 0}`);
        const payload = await response.json();
        if (this.stopped) return;
        this.health.lastPollOkAt = Date.now();
        this.health.lastError = null;
        this.health.lastDeltaAt = Date.now();
        this.store.applyDelta(payload);
      } catch (error) {
        if (this.stopped) return;
        this.health.lastPollErrorAt = Date.now();
        this.health.lastError = error?.message || 'poll failed';
        this.healthLog?.push('transport', 'Polling error.', this.health.lastError);
      }
    }, 2500);
  }

  stop() {
    this.stopped = true;
    if (this.pollHandle) {
      window.clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch (error) {
        console.error('Pixel Office websocket close failed', error);
      }
      this.ws = null;
    }
    this.health.mode = 'stopped';
    this.health.wsState = 'closed';
  }
}
