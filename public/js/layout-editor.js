const STORAGE_KEY = 'pixel-office-layout-edit-enabled';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

import { authFetch } from './auth.js';

export class LayoutEditor {
  constructor({ officeWidth, officeHeight, onChange }) {
    this.officeWidth = officeWidth;
    this.officeHeight = officeHeight;
    this.onChange = onChange;
    this.enabled = window.localStorage.getItem(STORAGE_KEY) === '1';
    this.overrides = { decor: {} };
    this.drag = null;
  }

  async load() {
    try {
      const response = await authFetch('/api/layout-overrides', { cache: 'no-store' });
      const data = await response.json();
      this.overrides = {
        decor: data?.decor && typeof data.decor === 'object' ? data.decor : {},
      };
    } catch {
      this.overrides = { decor: {} };
    }
  }

  isEnabled() {
    return this.enabled;
  }

  toggle() {
    this.enabled = !this.enabled;
    window.localStorage.setItem(STORAGE_KEY, this.enabled ? '1' : '0');
    return this.enabled;
  }

  getDecorOverride(id) {
    return this.overrides?.decor?.[id] || null;
  }

  applyDecorOverride(definition) {
    const override = this.getDecorOverride(definition.id);
    return override ? { ...definition, ...override } : definition;
  }

  async persist() {
    await authFetch('/api/layout-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.overrides),
    });
  }

  bindDecorNode(node, definition, view) {
    node.dataset.decorId = definition.id;
    node.classList.toggle('room-decor--editable', this.enabled);
    node.classList.toggle('is-layout-editing', this.enabled);
    if (!this.enabled) {
      node.onpointerdown = null;
      return;
    }

    node.onpointerdown = event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const rect = view.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const base = this.applyDecorOverride(definition);
      const startLeft = base.x;
      const startTop = base.y;

      const onMove = moveEvent => {
        const dx = ((moveEvent.clientX - startX) / rect.width) * this.officeWidth;
        const dy = ((moveEvent.clientY - startY) / rect.height) * this.officeHeight;
        const nextX = clamp(Math.round(startLeft + dx), 0, this.officeWidth - (definition.width || 1));
        const nextY = clamp(Math.round(startTop + dy), 0, this.officeHeight - (definition.height || 1));
        this.overrides.decor[definition.id] = { x: nextX, y: nextY };
        this.onChange?.();
      };

      const onUp = async () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        await this.persist();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    };
  }
}
