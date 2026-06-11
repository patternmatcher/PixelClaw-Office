export const CUSTOM_SPRITE_PROFILES = {
  // Example:
  // "designer": {
  //   id: "designer",
  //   kind: "hero",
  //   src: "/assets/characters/designer.png",
  //   grid: { cols: 4, rows: 5 },
  //   scale: 1.05,
  //   className: "worker--sprite-human",
  //   states: {
  //     idle: { frame: [1, 0] },
  //     moving: { frame: [1, 0] },
  //     writing: { frame: [1, 3] },
  //     executing: { frame: [1, 2] },
  //     searching: { frame: [1, 3] },
  //     coordinating: { frame: [1, 4] },
  //     responding: { frame: [1, 2] },
  //     monitoring: { frame: [1, 1] }
  //   }
  // }
};

export const CUSTOM_AGENT_SPRITES = {
  // Match agent ids or display names after lowercasing.
  // "designer": "designer",
  // "content-agent": "designer"
};

export const CUSTOM_SESSION_SPRITES = {
  // Match session kind or runtime kind.
  // "subagent": "deployed-agent"
};

export const CUSTOM_SPRITE_RULES = [
  // Example:
  // {
  //   profile: "designer",
  //   match: { entityType: "agent", station: "writing" }
  // }
];
