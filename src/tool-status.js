const TOOL_STATUS = {
  read:             { state: 'reading',      label: 'Reading files',             station: 'reading' },
  Read:             { state: 'reading',      label: 'Reading files',             station: 'reading' },
  memory_search:    { state: 'searching',    label: 'Searching memory',          station: 'searching' },
  memory_get:       { state: 'reading',      label: 'Reading memory',            station: 'reading' },
  pdf:              { state: 'reading',      label: 'Analysing document',        station: 'reading' },
  image:            { state: 'reading',      label: 'Analysing image',           station: 'reading' },
  web_search:       { state: 'searching',    label: 'Searching the web',         station: 'searching' },
  web_fetch:        { state: 'searching',    label: 'Fetching web page',         station: 'searching' },
  browser:          { state: 'searching',    label: 'Browsing',                  station: 'searching' },
  write:            { state: 'writing',      label: 'Writing files',             station: 'writing' },
  Write:            { state: 'writing',      label: 'Writing files',             station: 'writing' },
  edit:             { state: 'writing',      label: 'Editing files',             station: 'writing' },
  Edit:             { state: 'writing',      label: 'Editing files',             station: 'writing' },
  tts:              { state: 'writing',      label: 'Generating speech',         station: 'writing' },
  canvas:           { state: 'writing',      label: 'Updating canvas',           station: 'writing' },
  exec:             { state: 'executing',    label: 'Running commands',          station: 'executing' },
  process:          { state: 'executing',    label: 'Managing process',          station: 'executing' },
  sessions_list:    { state: 'monitoring',   label: 'Checking sessions',         station: 'monitoring' },
  sessions_history: { state: 'reading',      label: 'Reading session history',   station: 'reading' },
  sessions_send:    { state: 'responding',   label: 'Messaging session',         station: 'responding' },
  sessions_spawn:   { state: 'coordinating', label: 'Spawning sub-agent',        station: 'coordinating' },
  subagents:        { state: 'coordinating', label: 'Managing sub-agents',       station: 'coordinating' },
  nodes:            { state: 'monitoring',   label: 'Checking devices',          station: 'monitoring' },
  message:          { state: 'responding',   label: 'Sending message',           station: 'responding' },
  session_status:   { state: 'monitoring',   label: 'Checking status',           station: 'monitoring' },
};

function getToolMeta(name) {
  return TOOL_STATUS[name] || {
    state: 'thinking',
    label: `Using ${name}`,
    station: 'thinking',
  };
}

module.exports = {
  TOOL_STATUS,
  getToolMeta,
};
