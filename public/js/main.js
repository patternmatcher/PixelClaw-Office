import { Store } from './store.js';
import { LiveTransport } from './transport.js';
import { SceneRenderer } from './scene.js';
import { renderPanels } from './panels.js';
import { MotionEngine } from './motion/motion-engine.js';
import { renderDetailCard } from './detail-card.js';
import { renderGatewayPanel } from './gateway-panel.js';
import { LayoutEditor } from './layout-editor.js';
import { HealthLog } from './health-log.js';
import { OFFICE_HEIGHT, OFFICE_WIDTH } from './layout.js';

async function init() {
  const store = new Store();
  const motion = new MotionEngine();
  const healthLog = new HealthLog({ root: document.getElementById('health-log') });
  healthLog.init();
  healthLog.push('boot', 'Pixel Office init started.');

  const layoutEditor = new LayoutEditor({
    officeWidth: OFFICE_WIDTH,
    officeHeight: OFFICE_HEIGHT,
    onChange: () => scene.render(store, { motion }),
  });
  await layoutEditor.load();

  const scene = new SceneRenderer({
    root: document.getElementById('office-stage'),
    onSelect: (entityId, anchor) => store.select(entityId, anchor),
    layoutEditor,
  });
  scene.debugOverlay.attach(scene.debugLayer, motion);

  const panelElements = {
    statsGrid: document.getElementById('stats-grid'),
    focusPanel: document.getElementById('focus-panel'),
  };

  const detailRoot = document.getElementById('detail-card-root');
  const layoutToggle = document.getElementById('layout-edit-toggle');
  const updateLayoutToggle = () => {
    if (!layoutToggle) return;
    const enabled = layoutEditor.isEnabled();
    layoutToggle.textContent = `Layout edit: ${enabled ? 'on' : 'off'}`;
    layoutToggle.classList.toggle('is-active', enabled);
  };
  updateLayoutToggle();
  layoutToggle?.addEventListener('click', () => {
    layoutEditor.toggle();
    updateLayoutToggle();
    scene.render(store, { motion });
  });

  const gatewayElements = {
    summary: document.getElementById('gateway-summary'),
    meta: document.getElementById('gateway-meta'),
    loghead: document.getElementById('gateway-loghead'),
    log: document.getElementById('gateway-log'),
  };

  let gatewayRefreshInFlight = false;
  let lastGatewayRefresh = 0;
  const maybeRefreshGateway = () => {
    const now = Date.now();
    if (gatewayRefreshInFlight || (now - lastGatewayRefresh) < 3000) return;
    gatewayRefreshInFlight = true;
    renderGatewayPanel(gatewayElements, healthLog)
      .catch(error => {
        console.error('Gateway panel refresh failed', error);
        healthLog.push('gateway', 'Gateway panel refresh failed.', error?.message || null);
      })
      .finally(() => {
        gatewayRefreshInFlight = false;
        lastGatewayRefresh = Date.now();
      });
  };

  const renderInfoPanels = () => {
    renderPanels(store, panelElements);
    renderDetailCard(store, detailRoot);
  };

  const syncScene = () => {
    const visibleEntities = store.getRenderableEntities();
    motion.sync(visibleEntities);
    scene.render(store, { motion, entities: visibleEntities });

    if (!visibleEntities.some(entity => entity.entityType === 'session')) {
      document.querySelectorAll('.worker[data-entity-type="session"]').forEach(node => node.remove());
      for (const [id, node] of scene.workerNodes.entries()) {
        if (!visibleEntities.some(entity => entity.entityId === id)) {
          node.remove();
          scene.workerNodes.delete(id);
        }
      }
      for (const id of [...motion.actors.keys()]) {
        if (String(id).startsWith('session:')) {
          motion.actors.delete(id);
        }
      }
    }

    renderInfoPanels();
    maybeRefreshGateway();
  };

  store.subscribe(syncScene);
  syncScene();
  setInterval(() => {
    renderInfoPanels();
  }, 15000);
  setInterval(() => {
    maybeRefreshGateway();
  }, 3000);

  const animate = timeMs => {
    motion.tick(timeMs);
    if (motion.hasActiveMotion()) {
      scene.render(store, { motion });
    }
    requestAnimationFrame(animate);
  };

  requestAnimationFrame(animate);

  window.__pixelOfficeWorkers = () => ({
    visibleEntities: store.getRenderableEntities(),
    workerNodes: [...scene.workerNodes.keys()],
    motionActors: [...motion.actors.keys()],
    domWorkers: [...document.querySelectorAll('.worker')].map(node => ({
      entityId: node.dataset.entityId || null,
      entityType: node.dataset.entityType || null,
      station: node.dataset.station || null,
      profile: node.dataset.renderProfile || null,
      state: node.dataset.renderState || null,
    })),
  });
  window.__pixelOfficeWorkersJson = () => JSON.stringify(window.__pixelOfficeWorkers(), null, 2);
  window.__pixelOfficeMotionConfig = () => ({ ...motion.config });
  window.__setPixelOfficeMotionConfig = nextConfig => motion.setConfig(nextConfig || {});
  window.__pixelOfficeDomWorkersJson = () => JSON.stringify([
    ...document.querySelectorAll('.worker')
  ].map(node => ({
    entityId: node.dataset.entityId || null,
    entityType: node.dataset.entityType || null,
    station: node.dataset.station || null,
    profile: node.dataset.renderProfile || null,
    state: node.dataset.renderState || null,
    cls: node.className || null,
  })), null, 2);

  const transport = new LiveTransport({ store, healthLog });
  await transport.start();
  healthLog.push('boot', 'Transport started.');
}

init().catch(error => {
  console.error('Pixel Office failed to initialize', error);
});
