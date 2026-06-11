import { buildPathPoints, getTargetForStation } from './path-graph.js';

const TARGET_EPSILON = 2;
const RETARGET_DISTANCE_EPSILON = 18;

const MOVE_SPEED = {
  agent: 116,
  session: 139,
};

const DEFAULT_MOTION_CONFIG = {
  sameStationRetargetPolicy: 'distance-only',
  sameStationRetargetDistance: RETARGET_DISTANCE_EPSILON,
};

function stepTowards(current, target, step) {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const d = Math.hypot(dx, dy) || 1;
  if (d <= step) {
    return { x: target.x, y: target.y, done: true };
  }
  return {
    x: current.x + (dx / d) * step,
    y: current.y + (dy / d) * step,
    done: false,
  };
}

export class MotionEngine {
  constructor(config = {}) {
    this.actors = new Map();
    this.lastTime = null;
    this.config = { ...DEFAULT_MOTION_CONFIG, ...config };
  }

  setConfig(nextConfig = {}) {
    this.config = { ...this.config, ...nextConfig };
  }

  hasActiveMotion() {
    for (const actor of this.actors.values()) {
      if (actor?.moving) return true;
    }
    return false;
  }

  sync(entities) {
    const active = new Set();

    for (const entity of entities) {
      const target = getTargetForStation(entity.station || entity.state, entity.renderIndex || 0);
      let actor = this.actors.get(entity.entityId);
      if (!actor) {
        actor = {
          entityId: entity.entityId,
          entityType: entity.entityType,
          x: target.point.x,
          y: target.point.y,
          target,
          path: [],
          pathIndex: 0,
          moving: false,
          pathNode: target.approachNode || null,
          scale: entity.entityType === 'session' ? 0.82 : 1,
          facing: target.point.facing || 'down',
          activity: target.point.activity || null,
        };
        this.actors.set(entity.entityId, actor);
      }

      actor.entityType = entity.entityType;
      actor.scale = entity.entityType === 'session' ? 0.82 : 1;
      actor.activity = target.point.activity || actor.activity || null;

      if (!actor.moving && target.point.facing) {
        actor.facing = target.point.facing;
      }

      const previousTarget = actor.target || null;
      const targetPointDistance = previousTarget
        ? Math.hypot((previousTarget.point.x || 0) - target.point.x, (previousTarget.point.y || 0) - target.point.y)
        : Infinity;
      const stationChanged = !previousTarget || previousTarget.stationId !== target.stationId;
      const sameStationPolicy = this.config.sameStationRetargetPolicy || 'distance-only';
      const sameStationDistance = Number(this.config.sameStationRetargetDistance || RETARGET_DISTANCE_EPSILON);
      let targetChanged = !previousTarget || stationChanged;

      if (!targetChanged) {
        if (sameStationPolicy === 'always') {
          targetChanged = targetPointDistance > 0;
        } else if (sameStationPolicy === 'distance-only') {
          targetChanged = targetPointDistance > sameStationDistance;
        } else if (sameStationPolicy === 'never') {
          targetChanged = false;
        }
      }

      if (targetChanged) {
        const dx = target.point.x - actor.x;
        const dy = target.point.y - actor.y;
        const distanceToTarget = Math.hypot(dx, dy);
        const alreadySettled = distanceToTarget <= TARGET_EPSILON;

        actor.target = target;

        if (alreadySettled) {
          actor.path = [];
          actor.pathIndex = 0;
          actor.moving = false;
          actor.pathNode = target.approachNode || actor.pathNode || null;
          actor.x = target.point.x;
          actor.y = target.point.y;
          actor.facing = target.point.facing || actor.facing || 'down';
        } else {
          const preferredStartNode = previousTarget?.approachNode || actor.pathNode || null;
          actor.path = buildPathPoints({ x: actor.x, y: actor.y }, target, { preferredStartNode });
          actor.pathIndex = 0;
          actor.moving = actor.path.length > 0;
          actor.pathNode = preferredStartNode;
        }
      } else {
        actor.target = {
          ...target,
          point: {
            ...target.point,
            x: previousTarget?.point?.x ?? target.point.x,
            y: previousTarget?.point?.y ?? target.point.y,
          },
        };
        if (!actor.moving && target.point.facing) {
          actor.facing = target.point.facing;
        }
        actor.activity = target.point.activity || actor.activity || null;
      }

      active.add(entity.entityId);
    }

    for (const id of [...this.actors.keys()]) {
      if (!active.has(id)) {
        this.actors.delete(id);
      }
    }
  }

  tick(timeMs) {
    if (this.lastTime == null) {
      this.lastTime = timeMs;
      return;
    }

    const dt = Math.min(0.05, (timeMs - this.lastTime) / 1000);
    this.lastTime = timeMs;

    for (const actor of this.actors.values()) {
      if (!actor.moving || !actor.path.length) continue;

      const nextPoint = actor.path[actor.pathIndex];
      if (!nextPoint) {
        actor.moving = false;
        continue;
      }

      const speed = MOVE_SPEED[actor.entityType || 'agent'] || MOVE_SPEED.agent;
      const dx = nextPoint.x - actor.x;
      const dy = nextPoint.y - actor.y;
      if (Math.abs(dx) > Math.abs(dy)) {
        actor.facing = dx >= 0 ? 'right' : 'left';
      } else if (Math.abs(dy) > 0.5) {
        actor.facing = dy >= 0 ? 'down' : 'up';
      }

      const next = stepTowards(actor, nextPoint, speed * dt);
      actor.x = next.x;
      actor.y = next.y;

      if (next.done) {
        actor.pathIndex += 1;
        if (actor.pathIndex >= actor.path.length) {
          actor.moving = false;
          actor.pathNode = actor.target.approachNode || actor.pathNode || null;
          actor.x = actor.target.point.x;
          actor.y = actor.target.point.y;
          actor.facing = actor.target.point.facing || actor.facing || 'down';
        }
      }
    }
  }

  getActorState(entity) {
    const actor = this.actors.get(entity.entityId);
    if (!actor) return null;
    return {
      x: actor.x,
      y: actor.y,
      moving: actor.moving,
      target: actor.target,
      scale: actor.scale,
      facing: actor.facing || 'down',
      activity: actor.activity || null,
    };
  }
}
