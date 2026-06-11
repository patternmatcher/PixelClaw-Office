import { normalizeStation } from '../utils.js';

export const GRAPH_NODES = {
  leftNorth: {
    x: 47,
    y: 113
  },
  topAisleWest: {
    x: 177,
    y: 136
  },
  topAisleEast: {
    x: 264,
    y: 132
  },
  corridorNorth: {
    x: 280,
    y: 141
  },
  midAisleWest: {
    x: 50,
    y: 135
  },
  midAisleEast: {
    x: 270,
    y: 147
  },
  corridorMid: {
    x: 264,
    y: 149
  },
  lowAisleWest: {
    x: 50,
    y: 336
  },
  lowAisleEast: {
    x: 272,
    y: 327
  },
  corridorSouth: {
    x: 282,
    y: 348
  },
  bottomFloor: {
    x: 172,
    y: 357
  },
  entry: {
    x: 244,
    y: 108
  },
  loungeDoor: {
    x: 350,
    y: 348
  },
  loungeCore: {
    x: 392,
    y: 359
  },
  monitorDoor: {
    x: 370,
    y: 423
  },
  monitorCore: {
    x: 419,
    y: 411
  },
  commsDoor: {
    x: 267,
    y: 290
  },
  commsCore: {
    x: 320,
    y: 274
  },
  nookDoor: {
    x: 314,
    y: 140
  },
  nookCore: {
    x: 314,
    y: 139
  }
};

export const GRAPH_EDGES = {
  leftNorth: [],
  topAisleWest: ['topAisleEast', 'midAisleWest', 'entry'],
  topAisleEast: ['topAisleWest', 'midAisleEast', 'corridorNorth'],
  corridorNorth: ['topAisleEast', 'corridorMid', 'nookDoor'],
  midAisleWest: ['topAisleWest', 'midAisleEast', 'lowAisleWest'],
  midAisleEast: ['topAisleEast', 'midAisleWest', 'lowAisleEast', 'corridorMid'],
  corridorMid: ['corridorNorth', 'midAisleEast', 'corridorSouth', 'commsDoor'],
  lowAisleWest: ['midAisleWest', 'lowAisleEast', 'bottomFloor'],
  lowAisleEast: ['midAisleEast', 'lowAisleWest', 'corridorSouth'],
  corridorSouth: ['corridorMid', 'lowAisleEast', 'bottomFloor', 'monitorDoor', 'loungeDoor'],
  bottomFloor: ['lowAisleWest', 'corridorSouth'],
  entry: ['topAisleWest'],
  loungeDoor: ['corridorSouth', 'loungeCore'],
  loungeCore: ['loungeDoor'],
  monitorDoor: ['corridorSouth', 'monitorCore'],
  monitorCore: ['monitorDoor'],
  commsDoor: ['corridorMid', 'commsCore'],
  commsCore: ['commsDoor'],
  nookDoor: ['corridorNorth', 'nookCore'],
  nookCore: ['nookDoor'],
};

export const STATION_TARGETS = {
  idle: {
    slots: [
      {
        approachNode: 'bottomFloor',
        approach: {
          x: 116,
          y: 362
        },
        use: {
          x: 108,
          y: 350,
          facing: 'up',
          activity: 'idle'
        }
      },
      {
        approachNode: 'bottomFloor',
        approach: {
          x: 168,
          y: 362
        },
        use: {
          x: 164,
          y: 350,
          facing: 'up',
          activity: 'idle'
        }
      },
      {
        approachNode: 'bottomFloor',
        approach: {
          x: 373,
          y: 337
        },
        use: {
          x: 448,
          y: 363,
          facing: 'up',
          activity: 'idle'
        }
      },
      {
        approachNode: 'bottomFloor',
        approach: {
          x: 400,
          y: 340
        },
        use: {
          x: 444,
          y: 342,
          facing: 'up',
          activity: 'idle'
        }
      }
    ]
  },
  queued: {
    slots: [
      {
        approachNode: 'entry',
        approach: {
          x: 240,
          y: 123
        },
        use: {
          x: 245,
          y: 108,
          facing: 'right',
          activity: 'waiting'
        }
      },
      {
        approachNode: 'entry',
        approach: {
          x: 238,
          y: 116
        },
        use: {
          x: 254,
          y: 105,
          facing: 'right',
          activity: 'waiting'
        }
      },
      {
        approachNode: 'entry',
        approach: {
          x: 266,
          y: 116
        },
        use: {
          x: 251,
          y: 113,
          facing: 'left',
          activity: 'waiting'
        }
      },
      {
        approachNode: 'entry',
        approach: {
          x: 257,
          y: 129
        },
        use: {
          x: 231,
          y: 103,
          facing: 'left',
          activity: 'triaging'
        }
      }
    ]
  },
  reading: {
    slots: [
      {
        approachNode: 'monitorCore',
        approach: {
          x: 384,
          y: 402
        },
        use: {
          x: 392,
          y: 396,
          facing: 'right',
          activity: 'reading'
        }
      },
      {
        approachNode: 'monitorCore',
        approach: {
          x: 408,
          y: 408
        },
        use: {
          x: 408,
          y: 400,
          facing: 'up',
          activity: 'reading'
        }
      },
      {
        approachNode: 'monitorCore',
        approach: {
          x: 432,
          y: 402
        },
        use: {
          x: 424,
          y: 396,
          facing: 'left',
          activity: 'reviewing'
        }
      }
    ]
  },
  monitoring: {
    slots: [
      {
        approachNode: 'monitorCore',
        approach: {
          x: 382,
          y: 394
        },
        use: {
          x: 390,
          y: 390,
          facing: 'right',
          activity: 'monitoring'
        }
      },
      {
        approachNode: 'monitorCore',
        approach: {
          x: 402,
          y: 398
        },
        use: {
          x: 402,
          y: 392,
          facing: 'up',
          activity: 'watching'
        }
      },
      {
        approachNode: 'monitorCore',
        approach: {
          x: 422,
          y: 394
        },
        use: {
          x: 414,
          y: 390,
          facing: 'left',
          activity: 'checking'
        }
      }
    ]
  },
  coordinating: {
    slots: [
      {
        approachNode: 'nookCore',
        approach: {
          x: 306,
          y: 146
        },
        use: {
          x: 388,
          y: 112,
          facing: 'right',
          activity: 'talking'
        }
      },
      {
        approachNode: 'nookCore',
        approach: {
          x: 309,
          y: 138
        },
        use: {
          x: 406,
          y: 126,
          facing: 'up',
          activity: 'talking'
        }
      },
      {
        approachNode: 'nookCore',
        approach: {
          x: 313,
          y: 142
        },
        use: {
          x: 424,
          y: 112,
          facing: 'left',
          activity: 'planning'
        }
      }
    ]
  },
  thinking: {
    slots: [
      {
        approachNode: 'nookCore',
        approach: {
          x: 306,
          y: 145
        },
        use: {
          x: 390,
          y: 130,
          facing: 'right',
          activity: 'thinking'
        }
      },
      {
        approachNode: 'nookCore',
        approach: {
          x: 311,
          y: 140
        },
        use: {
          x: 408,
          y: 136,
          facing: 'up',
          activity: 'thinking'
        }
      },
      {
        approachNode: 'nookCore',
        approach: {
          x: 316,
          y: 142
        },
        use: {
          x: 424,
          y: 126,
          facing: 'left',
          activity: 'thinking'
        }
      }
    ]
  },
  executing: {
    slots: [
      {
        approachNode: 'midAisleWest',
        approach: {
          x: 55,
          y: 222
        },
        use: {
          x: 106,
          y: 198,
          facing: 'up',
          activity: 'typing'
        }
      },
      {
        approachNode: 'midAisleWest',
        approach: {
          x: 66,
          y: 224
        },
        use: {
          x: 202,
          y: 201,
          facing: 'up',
          activity: 'typing'
        }
      },
      {
        approachNode: 'midAisleEast',
        approach: {
          x: 258,
          y: 215
        },
        use: {
          x: 224,
          y: 203,
          facing: 'up',
          activity: 'typing'
        }
      },
      {
        approachNode: 'midAisleWest',
        approach: {
          x: 63,
          y: 222
        },
        use: {
          x: 106,
          y: 214,
          facing: 'down',
          activity: 'working'
        }
      },
      {
        approachNode: 'midAisleWest',
        approach: {
          x: 54,
          y: 218
        },
        use: {
          x: 202,
          y: 216,
          facing: 'down',
          activity: 'working'
        }
      },
      {
        approachNode: 'midAisleEast',
        approach: {
          x: 259,
          y: 225
        },
        use: {
          x: 224,
          y: 218,
          facing: 'down',
          activity: 'working'
        }
      }
    ]
  },
  searching: {
    slots: [
      {
        approachNode: 'nookCore',
        approach: {
          x: 306,
          y: 142
        },
        use: {
          x: 389,
          y: 122,
          facing: 'right',
          activity: 'researching'
        }
      },
      {
        approachNode: 'nookCore',
        approach: {
          x: 311,
          y: 142
        },
        use: {
          x: 407,
          y: 118,
          facing: 'up',
          activity: 'reading'
        }
      },
      {
        approachNode: 'nookCore',
        approach: {
          x: 316,
          y: 147
        },
        use: {
          x: 424,
          y: 120,
          facing: 'left',
          activity: 'researching'
        }
      }
    ]
  },
  writing: {
    slots: [
      {
        approachNode: 'lowAisleWest',
        approach: {
          x: 123,
          y: 329
        },
        use: {
          x: 98,
          y: 313,
          facing: 'down',
          activity: 'typing'
        }
      },
      {
        approachNode: 'lowAisleWest',
        approach: {
          x: 129,
          y: 323
        },
        use: {
          x: 122,
          y: 313,
          facing: 'down',
          activity: 'typing'
        }
      },
      {
        approachNode: 'lowAisleEast',
        approach: {
          x: 213,
          y: 310
        },
        use: {
          x: 202,
          y: 313,
          facing: 'down',
          activity: 'typing'
        }
      },
      {
        approachNode: 'bottomFloor',
        approach: {
          x: 90,
          y: 360
        },
        use: {
          x: 90,
          y: 350,
          facing: 'up',
          activity: 'writing'
        }
      },
      {
        approachNode: 'bottomFloor',
        approach: {
          x: 168,
          y: 360
        },
        use: {
          x: 168,
          y: 350,
          facing: 'up',
          activity: 'writing'
        }
      },
      {
        approachNode: 'bottomFloor',
        approach: {
          x: 190,
          y: 318
        },
        use: {
          x: 206,
          y: 304,
          facing: 'up',
          activity: 'writing'
        }
      }
    ]
  },
  responding: {
    slots: [
      {
        approachNode: 'commsCore',
        approach: {
          x: 289,
          y: 270
        },
        use: {
          x: 370,
          y: 271,
          facing: 'right',
          activity: 'replying'
        }
      },
      {
        approachNode: 'commsCore',
        approach: {
          x: 292,
          y: 266
        },
        use: {
          x: 386,
          y: 278,
          facing: 'up',
          activity: 'replying'
        }
      },
      {
        approachNode: 'commsCore',
        approach: {
          x: 284,
          y: 284
        },
        use: {
          x: 402,
          y: 271,
          facing: 'left',
          activity: 'replying'
        }
      },
      {
        approachNode: 'commsDoor',
        approach: {
          x: 286,
          y: 271
        },
        use: {
          x: 392,
          y: 286,
          facing: 'right',
          activity: 'dispatching'
        }
      }
    ]
  }
};


export function getStationSlots(stationId) {
  const normalized = normalizeStation(stationId || 'idle');
  return (STATION_TARGETS[normalized] || STATION_TARGETS.idle).slots;
}

export function getTargetForStation(stationId, index = 0) {
  const normalized = normalizeStation(stationId || 'idle');
  const slots = getStationSlots(normalized);
  const safeIndex = ((index % slots.length) + slots.length) % slots.length;
  const slot = slots[safeIndex] || slots[0];
  return {
    stationId: normalized,
    slotIndex: safeIndex,
    approachNode: slot.approachNode,
    approach: slot.approach,
    point: slot.use,
  };
}

function isMainFloorPoint(point) {
  return point.x <= 332;
}

function getNodeGroup(nodeId) {
  if (['loungeDoor', 'loungeCore'].includes(nodeId)) return 'lounge';
  if (['monitorDoor', 'monitorCore'].includes(nodeId)) return 'monitoring';
  if (['commsDoor', 'commsCore'].includes(nodeId)) return 'comms';
  if (['nookDoor', 'nookCore'].includes(nodeId)) return 'nook';
  return 'main';
}

function shouldForceMainCorridor(startId, endId) {
  const startGroup = getNodeGroup(startId);
  const endGroup = getNodeGroup(endId);
  if (startGroup === 'nook' || endGroup === 'nook') return true;
  return startGroup !== endGroup && startGroup !== 'main' && endGroup !== 'main';
}

export function getNearestNodeId(point, options = {}) {
  const { target = null, preferredStartNode = null } = options;
  if (preferredStartNode && GRAPH_NODES[preferredStartNode]) {
    const preferred = GRAPH_NODES[preferredStartNode];
    const dx = preferred.x - point.x;
    const dy = preferred.y - point.y;
    if (Math.hypot(dx, dy) <= 90) {
      return preferredStartNode;
    }
  }
  const targetGroup = target?.approachNode ? getNodeGroup(target.approachNode) : null;
  let bestId = 'entry';
  let bestDistance = Number.MAX_SAFE_INTEGER;

  for (const [id, node] of Object.entries(GRAPH_NODES)) {
    const group = getNodeGroup(id);

    if (targetGroup && group !== 'main' && group !== targetGroup) continue;
    if (!targetGroup && group !== 'main') continue;
    if (isMainFloorPoint(point) && group !== 'main') continue;

    const dx = node.x - point.x;
    const dy = node.y - point.y;
    let distance = Math.hypot(dx, dy);

    if (point.y > 180 && id === 'topAisleWest') distance += 140;
    if (point.y > 200 && id === 'topAisleEast') distance += 90;
    if (point.y < 170 && id === 'midAisleWest') distance += 60;
    if (point.y < 170 && id === 'midAisleEast') distance += 40;

    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = id;
    }
  }

  return bestId;
}

export function solveRoute(startId, endId) {
  if (!startId || !endId || startId === endId) {
    return [startId].filter(Boolean);
  }

  const queue = [[startId]];
  const seen = new Set([startId]);

  while (queue.length) {
    const path = queue.shift();
    const current = path[path.length - 1];
    const neighbors = GRAPH_EDGES[current] || [];

    for (const next of neighbors) {
      if (seen.has(next)) continue;
      const nextPath = [...path, next];
      if (next === endId) return nextPath;
      seen.add(next);
      queue.push(nextPath);
    }
  }

  return [startId, endId];
}

const FINAL_HOP_MAX_DISTANCE = 28;

export function buildPathPoints(currentPoint, target, options = {}) {
  const { preferredStartNode = null } = options;
  const startNode = getNearestNodeId(currentPoint, { target, preferredStartNode });
  const endNode = target.approachNode || getNearestNodeId(target.approach || target.point, { target });

  let route;
  if (shouldForceMainCorridor(startNode, endNode)) {
    const startDoor = `${getNodeGroup(startNode)}Door`;
    const endDoor = `${getNodeGroup(endNode)}Door`;
    route = [
      ...solveRoute(startNode, startDoor),
      ...solveRoute(startDoor, endDoor).slice(1),
      ...solveRoute(endDoor, endNode).slice(1),
    ];
  } else {
    route = solveRoute(startNode, endNode);
  }

  const dedupedRoute = route.filter((nodeId, index) => index === 0 || route[index - 1] !== nodeId);
  const points = dedupedRoute
    .map(nodeId => GRAPH_NODES[nodeId])
    .filter(Boolean)
    .map(node => ({ x: node.x, y: node.y }));

  const approach = target.approach || target.point;
  const last = points[points.length - 1];
  if (!last || last.x !== approach.x || last.y !== approach.y) {
    points.push({ x: approach.x, y: approach.y });
  }

  const finalDx = target.point.x - approach.x;
  const finalDy = target.point.y - approach.y;
  const finalHopDistance = Math.hypot(finalDx, finalDy);
  if ((approach.x !== target.point.x || approach.y !== target.point.y) && finalHopDistance <= FINAL_HOP_MAX_DISTANCE) {
    points.push({ x: target.point.x, y: target.point.y });
  }

  return points;
}
