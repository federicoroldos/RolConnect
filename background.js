// Rold background service worker: side panel wiring, context menus and routines.

import { getRoutines, getChats } from './js/storage.js';
import { nextRunTime, addRun } from './js/routines.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'rold-ask-selection',
      title: 'Ask Rold about “%s”',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'rold-summarize-page',
      title: 'Summarize this page with Rold',
      contexts: ['page'],
    });
  });
  syncAlarms();
});

chrome.runtime.onStartup.addListener(syncAlarms);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id == null) return;
  // sidePanel.open must be called synchronously inside the user gesture.
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});

  let text = '';
  if (info.menuItemId === 'rold-ask-selection' && info.selectionText) {
    text = `Explain this, from the page I'm on ("${tab.title || tab.url}"):\n\n> ${info.selectionText.trim()}`;
  } else if (info.menuItemId === 'rold-summarize-page') {
    text = 'Summarize the page I am on. Lead with the key points, then anything notable.';
  }
  if (text) chrome.storage.session.set({ pendingPrompt: { text, ts: Date.now() } });
});

// ---------------------------------------------------------------------------
// Routines: one alarm per active routine, at its next run time.

const ALARM = 'routine:';
const STALE_RUN_MS = 20 * 60000;

async function syncAlarms() {
  const routines = await getRoutines();
  const alarms = (await chrome.alarms.getAll()).filter((a) => a.name.startsWith(ALARM));
  const now = Date.now();
  let changed = false;
  for (const a of alarms) {
    if (!routines[a.name.slice(ALARM.length)]?.active) await chrome.alarms.clear(a.name);
  }
  for (const r of Object.values(routines)) {
    if (!r.active) continue;
    // Runs missed while the browser was closed are skipped; the schedule picks up from now.
    if (!r.nextRun || r.nextRun < now - 60000) {
      r.nextRun = nextRunTime(r.schedule, now);
      changed = true;
    }
    const a = alarms.find((x) => x.name === ALARM + r.id);
    if (!a || Math.abs(a.scheduledTime - r.nextRun) > 1000) {
      await chrome.alarms.create(ALARM + r.id, { when: Math.max(r.nextRun, now + 1000) });
    }
  }
  if (changed) await chrome.storage.local.set({ routines });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.routines) syncAlarms();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith(ALARM)) return;
  const id = alarm.name.slice(ALARM.length);
  const routines = await getRoutines();
  const r = routines[id];
  if (!r?.active) return;
  r.nextRun = nextRunTime(r.schedule, Date.now());
  await launch(r);
  if (r.schedule?.type === 'once') r.active = false; // one-time check-ins run once
  await chrome.storage.local.set({ routines });
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'runRoutine') return;
  (async () => {
    const routines = await getRoutines();
    const r = routines[msg.id];
    if (!r) return reply({ ok: false, error: 'Routine not found.' });
    const started = await launch(r);
    await chrome.storage.local.set({ routines });
    reply({ ok: started, error: started ? '' : r.runs?.[0]?.note });
  })();
  return true; // async reply
});

// Opens the runner tab for a routine. Returns false when the run was skipped.
async function launch(r) {
  const { routineRuns = {} } = await chrome.storage.session.get('routineRuns');
  if (routineRuns[r.id] && Date.now() - routineRuns[r.id] < STALE_RUN_MS) {
    addRun(r, { status: 'skipped', note: 'The previous run was still going.' });
    return false;
  }
  if (r.kind === 'heartbeat') {
    const chats = await getChats();
    if (!chats[r.chatId]) {
      r.active = false;
      addRun(r, { status: 'paused', note: 'The chat this routine continues is unavailable.' });
      return false;
    }
  }
  routineRuns[r.id] = Date.now();
  await chrome.storage.session.set({ routineRuns });
  const url = chrome.runtime.getURL(`routine.html?id=${encodeURIComponent(r.id)}`);
  try {
    await chrome.tabs.create({ url, active: false });
  } catch {
    await chrome.windows.create({ url, focused: false, state: 'minimized' }); // no browser window open
  }
  return true;
}

// Clicking a routine notification opens its chat.
chrome.notifications?.onClicked.addListener((nid) => {
  const [prefix, chatId] = nid.split(':');
  if (prefix !== 'rold-chat') return;
  chrome.tabs.create({ url: chrome.runtime.getURL(`newtab.html${chatId ? `#chat=${chatId}` : ''}`) });
  chrome.notifications.clear(nid);
});
