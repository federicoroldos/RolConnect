// Settings + chat persistence (chrome.storage.local — never synced).

export const PROVIDERS = {
  opencode: {
    label: 'OpenCode Zen',
    plan: 'pay per use',
    vendor: 'OpenCode Zen',
    keyUrl: 'https://opencode.ai/zen',
    keyHint: 'Zen API key',
    color: '#8b8b8b',
  },
  opencodego: {
    label: 'OpenCode Go',
    plan: 'subscription',
    vendor: 'OpenCode Go',
    keyUrl: 'https://opencode.ai/console/go',
    keyHint: 'Go API key',
    color: '#e8b04b',
  },
};

const DEFAULTS = {
  provider: 'opencode',
  providers: {
    opencode: { apiKey: '', model: '', models: [], apis: {} },
    opencodego: { apiKey: '', model: '', models: [], apis: {} },
  },
  effortByModel: {},
  nativeSearch: true,
  computerUse: true, // screenshots + real mouse/keyboard input through the debugger
  permission: 'guard', // 'read' | 'guard' | 'full'
  followUp: 'steer', // messages sent while the agent works: 'steer' | 'queue'
  memory: { enabled: true, history: false, retention: 'never' }, // retention: 'never' | '30d' | '90d'
  theme: 'system',
};

function merge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    for (const k of Object.keys(over || {})) out[k] = k in base ? merge(base[k], over[k]) : over[k];
    return out;
  }
  return over === undefined ? base : over;
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = merge(DEFAULTS, settings || {});
  let cleaned = false;
  for (const key of ['custom', 'anthropic', 'openai']) {
    if (!s.providers[key]) continue;
    delete s.providers[key]; // removed providers
    cleaned = true;
  }
  if (!PROVIDERS[s.provider]) s.provider = 'opencode';
  if (cleaned) {
    try { await chrome.storage.local.set({ settings: s }); } catch {}
  }
  // Older versions had two toggles instead of permission levels.
  if (!settings?.permission) s.permission = settings?.browserControl === false ? 'read' : settings?.confirmActions === false ? 'full' : 'guard';
  delete s.browserControl;
  delete s.confirmActions;
  return s;
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

export function hasCredentials(cfg) {
  return !!cfg?.apiKey;
}

export function isConfigured(settings, key = settings.provider) {
  const p = settings.providers[key];
  if (!p) return false;
  return !!(hasCredentials(p) && p.model);
}

// ---- chats ----
const MAX_CHATS = 200;

export async function getChats() {
  const { chats } = await chrome.storage.local.get('chats');
  return chats || {};
}

export async function saveChat(chat) {
  const chats = await getChats();
  chats[chat.id] = chat;
  const ids = Object.keys(chats).sort((a, b) => (chats[b].updated || 0) - (chats[a].updated || 0));
  for (const id of ids.slice(MAX_CHATS)) delete chats[id];
  await chrome.storage.local.set({ chats });
}

export async function deleteChat(id) {
  const chats = await getChats();
  delete chats[id];
  await chrome.storage.local.set({ chats });
  // A chat's routines go with it.
  const routines = await getRoutines();
  const left = Object.fromEntries(Object.entries(routines).filter(([, r]) => r.chatId !== id));
  if (Object.keys(left).length !== Object.keys(routines).length) await chrome.storage.local.set({ routines: left });
}

export async function clearChats() {
  await chrome.storage.local.set({ chats: {} });
  const routines = await getRoutines();
  await chrome.storage.local.set({ routines: Object.fromEntries(Object.entries(routines).filter(([, r]) => !r.chatId)) });
}

// ---- memory (stays on this device) ----
const DAY = 86400000;

export async function getMemories(settings) {
  const { memories } = await chrome.storage.local.get('memories');
  let list = Array.isArray(memories) ? memories : [];
  const days = { '30d': 30, '90d': 90 }[settings?.memory?.retention];
  if (days) {
    const cutoff = Date.now() - days * DAY;
    const kept = list.filter((m) => m.kind !== 'episodic' || (m.updated || m.created) >= cutoff);
    if (kept.length !== list.length) {
      list = kept;
      await chrome.storage.local.set({ memories: list });
    }
  }
  return list;
}

export async function saveMemories(list) {
  await chrome.storage.local.set({ memories: list });
}

// ---- routines ----
export async function getRoutines() {
  const { routines } = await chrome.storage.local.get('routines');
  return routines || {};
}

export async function saveRoutine(r) {
  const all = await getRoutines();
  all[r.id] = r;
  await chrome.storage.local.set({ routines: all });
}

export async function deleteRoutine(id) {
  const all = await getRoutines();
  delete all[id];
  await chrome.storage.local.set({ routines: all });
}
