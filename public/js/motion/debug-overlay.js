import { OFFICE_HEIGHT, OFFICE_WIDTH } from '../layout.js';
import { GRAPH_EDGES, GRAPH_NODES, STATION_TARGETS } from './path-graph.js';

function percentX(x) {
  return `${(x / OFFICE_WIDTH) * 100}%`;
}

function percentY(y) {
  return `${(y / OFFICE_HEIGHT) * 100}%`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lineStyle(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  return {
    left: percentX(from.x),
    top: percentY(from.y),
    width: percentX(length),
    transform: `rotate(${angle}deg)`,
  };
}

function deepCloneTargets() {
  return Object.fromEntries(
    Object.entries(STATION_TARGETS).map(([stationId, config]) => [stationId, {
      ...config,
      slots: config.slots.map(slot => ({
        ...slot,
        approach: { ...slot.approach },
        use: { ...slot.use },
      })),
    }]),
  );
}

function formatObject(value, indent = 0) {
  const pad = '  '.repeat(indent);
  const nextPad = '  '.repeat(indent + 1);

  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[/n${value.map(item => `${nextPad}${formatObject(item, indent + 1)}`).join(',/n')}/n${pad}]`.replaceAll('/n', '\n');
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    return `{/n${entries.map(([key, entryValue]) => `${nextPad}${key}: ${formatObject(entryValue, indent + 1)}`).join(',/n')}/n${pad}}`.replaceAll('/n', '\n');
  }

  if (typeof value === 'string') return `'${value}'`;
  return String(value);
}

export class MotionDebugOverlay {
  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.enabled = params.has('debugPathing');
    this.editEnabled = params.has('editPathing');
    this.root = null;
    this.panel = null;
    this.motionEngine = null;
    this.drag = null;
    this.selection = null;
    this.graphNodes = Object.fromEntries(
      Object.entries(GRAPH_NODES).map(([id, point]) => [id, { ...point }]),
    );
    this.stationTargets = deepCloneTargets();
    this.edgeKeys = new Set();
    this.boundMove = event => this.onPointerMove(event);
    this.boundUp = () => this.onPointerUp();
  }

  attach(root, motionEngine = null) {
    if (!this.enabled || !root) return;
    this.root = root;
    this.motionEngine = motionEngine;
    if (this.editEnabled) {
      this.ensurePanel();
    }
    this.render();
  }

  ensurePanel() {
    if (this.panel) return;

    this.panel = document.createElement('aside');
    this.panel.className = 'path-debug__panel';
    this.panel.innerHTML = `
      <div class="path-debug__panel-head">
        <strong>Pathing editor</strong>
        <button type="button" class="path-debug__export">Export</button>
      </div>
      <div class="path-debug__panel-body">
        <div><span>Selected</span><strong data-field="label">None</strong></div>
        <div><span>Type</span><strong data-field="type">-</strong></div>
        <div><span>X</span><strong data-field="x">-</strong></div>
        <div><span>Y</span><strong data-field="y">-</strong></div>
      </div>
      <div class="path-debug__controls">
        <label>
          <span>Same-station retarget</span>
          <select class="path-debug__retarget-policy">
            <option value="always">always</option>
            <option value="distance-only">distance-only</option>
            <option value="never">never</option>
          </select>
        </label>
        <label>
          <span>Retarget distance</span>
          <input class="path-debug__retarget-distance" type="number" min="0" step="1" />
        </label>
      </div>
      <textarea class="path-debug__output" spellcheck="false" placeholder="Exported config appears here"></textarea>
    `;

    this.panel.querySelector('.path-debug__export')?.addEventListener('click', async () => {
      const output = this.exportConfig();
      const textarea = this.panel.querySelector('.path-debug__output');
      if (textarea) textarea.value = output;
      try {
        await navigator.clipboard.writeText(output);
      } catch {}
    });

    const policySelect = this.panel.querySelector('.path-debug__retarget-policy');
    const distanceInput = this.panel.querySelector('.path-debug__retarget-distance');
    if (policySelect && this.motionEngine) {
      policySelect.value = this.motionEngine.config?.sameStationRetargetPolicy || 'distance-only';
      policySelect.addEventListener('change', () => {
        this.motionEngine?.setConfig({ sameStationRetargetPolicy: policySelect.value });
      });
    }
    if (distanceInput && this.motionEngine) {
      distanceInput.value = String(this.motionEngine.config?.sameStationRetargetDistance || 18);
      distanceInput.addEventListener('change', () => {
        const value = Number(distanceInput.value);
        this.motionEngine?.setConfig({ sameStationRetargetDistance: Number.isFinite(value) ? value : 18 });
      });
    }

    document.body.appendChild(this.panel);
    this.updatePanel();
  }

  updatePanel() {
    if (!this.panel) return;
    const fields = {
      label: this.selection?.label || 'None',
      type: this.selection?.type || '-',
      x: this.selection ? String(Math.round(this.selection.target.x)) : '-',
      y: this.selection ? String(Math.round(this.selection.target.y)) : '-',
    };

    for (const [key, value] of Object.entries(fields)) {
      const node = this.panel.querySelector(`[data-field="${key}"]`);
      if (node) node.textContent = value;
    }
  }

  exportConfig() {
    return [
      'export const GRAPH_NODES = ' + formatObject(this.graphNodes, 0) + ';',
      '',
      'export const STATION_TARGETS = ' + formatObject(this.stationTargets, 0) + ';',
    ].join('\n');
  }

  clearSelection() {
    this.selection = null;
    this.updatePanel();
    this.render();
  }

  setSelection(selection) {
    this.selection = selection;
    this.updatePanel();
    this.render();
  }

  makeDraggable(element, selectionFactory) {
    if (!this.editEnabled) return;
    element.style.pointerEvents = 'auto';
    element.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
      const selection = selectionFactory();
      this.drag = selection;
      this.setSelection(selection);
      window.addEventListener('pointermove', this.boundMove);
      window.addEventListener('pointerup', this.boundUp, { once: true });
    });
  }

  onPointerMove(event) {
    if (!this.drag || !this.root) return;
    const rect = this.root.getBoundingClientRect();
    const x = clamp(((event.clientX - rect.left) / rect.width) * OFFICE_WIDTH, 0, OFFICE_WIDTH);
    const y = clamp(((event.clientY - rect.top) / rect.height) * OFFICE_HEIGHT, 0, OFFICE_HEIGHT);
    this.drag.target.x = Math.round(x);
    this.drag.target.y = Math.round(y);
    this.updatePanel();
    this.render();
  }

  onPointerUp() {
    this.drag = null;
    window.removeEventListener('pointermove', this.boundMove);
  }

  render() {
    if (!this.enabled || !this.root) return;

    this.root.replaceChildren();
    this.edgeKeys.clear();

    const selectedSlotKey = this.selection?.slotKey || (this.selection?.type === 'approach' || this.selection?.type === 'use' ? this.selection.id : null);

    for (const [fromId, targets] of Object.entries(GRAPH_EDGES)) {
      const from = this.graphNodes[fromId];
      if (!from) continue;
      for (const toId of targets) {
        const to = this.graphNodes[toId];
        if (!to) continue;
        const key = [fromId, toId].sort().join('::');
        if (this.edgeKeys.has(key)) continue;
        this.edgeKeys.add(key);

        const line = document.createElement('div');
        line.className = 'path-debug__edge';
        Object.assign(line.style, lineStyle(from, to));
        this.root.appendChild(line);
      }
    }

    for (const [stationId, config] of Object.entries(this.stationTargets)) {
      config.slots.forEach((slot, index) => {
        const slotKey = `${stationId}:${index}`;
        const approachNode = this.graphNodes[slot.approachNode];
        if (approachNode) {
          const ingress = document.createElement('div');
          ingress.className = 'path-debug__edge path-debug__edge--ingress';
          if (selectedSlotKey === slotKey) ingress.classList.add('is-selected');
          Object.assign(ingress.style, lineStyle(approachNode, slot.approach));
          this.root.appendChild(ingress);
        }

        const finalStep = document.createElement('div');
        finalStep.className = 'path-debug__edge path-debug__edge--final';
        if (selectedSlotKey === slotKey) finalStep.classList.add('is-selected');
        Object.assign(finalStep.style, lineStyle(slot.approach, slot.use));
        this.root.appendChild(finalStep);
      });
    }

    for (const [id, point] of Object.entries(this.graphNodes)) {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'path-debug__node';
      if (this.selection?.type === 'node' && this.selection.id === id) {
        node.classList.add('is-selected');
      }
      node.style.left = percentX(point.x);
      node.style.top = percentY(point.y);
      node.title = `${id} (${point.x}, ${point.y})`;
      node.textContent = id;
      node.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        this.setSelection({ type: 'node', id, label: id, target: point });
      });
      this.makeDraggable(node, () => ({ type: 'node', id, label: id, target: point }));
      this.root.appendChild(node);
    }

    for (const [stationId, config] of Object.entries(this.stationTargets)) {
      config.slots.forEach((slot, index) => {
        const approach = document.createElement('button');
        approach.type = 'button';
        approach.className = 'path-debug__anchor path-debug__anchor--approach';
        if (this.selection?.type === 'approach' && this.selection.id === `${stationId}:${index}`) {
          approach.classList.add('is-selected');
        }
        approach.style.left = percentX(slot.approach.x);
        approach.style.top = percentY(slot.approach.y);
        approach.title = `${stationId}[${index}] approach (${slot.approach.x}, ${slot.approach.y}) via ${slot.approachNode}`;
        approach.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          this.setSelection({ type: 'approach', id: `${stationId}:${index}`, slotKey: `${stationId}:${index}`, label: `${stationId}[${index}] approach`, target: slot.approach });
        });
        this.makeDraggable(approach, () => ({ type: 'approach', id: `${stationId}:${index}`, slotKey: `${stationId}:${index}`, label: `${stationId}[${index}] approach`, target: slot.approach }));
        this.root.appendChild(approach);

        const use = document.createElement('button');
        use.type = 'button';
        use.className = 'path-debug__anchor path-debug__anchor--use';
        if (this.selection?.type === 'use' && this.selection.id === `${stationId}:${index}`) {
          use.classList.add('is-selected');
        }
        use.style.left = percentX(slot.use.x);
        use.style.top = percentY(slot.use.y);
        use.title = `${stationId}[${index}] use (${slot.use.x}, ${slot.use.y})`;
        use.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          this.setSelection({ type: 'use', id: `${stationId}:${index}`, slotKey: `${stationId}:${index}`, label: `${stationId}[${index}] use`, target: slot.use });
        });
        this.makeDraggable(use, () => ({ type: 'use', id: `${stationId}:${index}`, slotKey: `${stationId}:${index}`, label: `${stationId}[${index}] use`, target: slot.use }));
        this.root.appendChild(use);
      });
    }

    if (this.editEnabled) {
      this.root.onclick = () => this.clearSelection();
    }
  }
}
