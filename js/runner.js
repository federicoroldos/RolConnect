// Runs one routine in a background tab (opened by background.js), saves the chat, then closes itself.

import { getSettings, isConfigured, getChats, saveChat, getRoutines, getMemories } from './storage.js';
import { runAgent, buildHistory } from './agent.js';
import { addToAgentGroup } from './tools.js';
import { addRun } from './routines.js';

const MAX_RUN_MS = 15 * 60000;
const id = new URLSearchParams(location.search).get('id');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const setStatus = (t) => (document.getElementById('status').textContent = t);

async function main() {
  const me = await chrome.tabs.getCurrent().catch(() => null);
  if (me) addToAgentGroup(me.id);

  let routine = (await getRoutines())[id];
  let chat = null;
  let am = null;
  let result = { status: 'error' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), MAX_RUN_MS);

  try {
    if (!routine) throw new Error('This routine no longer exists.');
    document.getElementById('name').textContent = routine.name;
    document.title = `${routine.name}`;
    const settings = await getSettings();
    if (!isConfigured(settings)) throw new Error('No account is connected in Rold Harness.');

    const chats = await getChats();
    if (routine.kind === 'heartbeat') {
      chat = chats[routine.chatId];
      if (!chat) throw new Error('The chat this routine continues was deleted.');
    } else {
      const now = Date.now();
      chat = { id: uid(), title: routine.name, created: now, updated: now, messages: [], routineId: routine.id };
    }

    const history = routine.kind === 'heartbeat' ? buildHistory(chat.messages) : [];
    const text = routine.kind === 'heartbeat' ? `[Routine “${routine.name}”] ${routine.instructions}` : routine.instructions;
    chat.messages.push({ role: 'user', text, ts: Date.now(), routine: true });
    am = {
      role: 'assistant', text: '', steps: [], sources: [], status: 'running',
      provider: settings.provider, model: settings.providers[settings.provider].model, ts: Date.now(),
    };
    chat.messages.push(am);

    let needsApproval = false;
    const seen = new Set();
    const ui = {
      step(s) { am.steps.push({ ...s }); setStatus(s.label); return am.steps.length - 1; },
      updateStep(i, patch) { Object.assign(am.steps[i], patch); },
      source(s) { if (s?.url && !seen.has(s.url)) { seen.add(s.url); am.sources.push({ title: s.title || s.url, url: s.url }); } },
      text(t) { am.text = t; },
      async confirm(desc) {
        needsApproval = true;
        am.steps.push({ kind: 'approval', label: `Needs your approval: ${desc}`, status: 'error' });
        return false;
      },
    };
    const memories = settings.memory?.enabled ? await getMemories(settings) : [];
    setStatus('Working');
    const out = await runAgent({
      settings, history, userText: text, ui, signal: ac.signal,
      mode: 'routine', pageInfo: null, sessionId: chat.id, memories, headless: true,
    });
    am.text = out || am.text || '_(No answer returned.)_';
    result = { status: needsApproval ? 'needs approval' : 'done' };
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'Stopped: the run took too long.' : e.message || String(e);
    if (am) am.error = msg;
    result = { status: 'error', note: msg };
  } finally {
    clearTimeout(timer);
    if (am) {
      am.status = 'done';
      am.steps.forEach((s) => s.status === 'running' && (s.status = 'error'));
    }
    if (chat && am) {
      chat.updated = Date.now();
      await saveChat(chat).catch(() => {});
    }
    // Record the run (re-read so edits made meanwhile are kept).
    const all = await getRoutines();
    const r = all[id];
    if (r) {
      addRun(r, { ...result, chatId: chat?.id });
      if (/deleted/.test(result.note || '')) r.active = false; // its chat is gone: pause it
      await chrome.storage.local.set({ routines: all });
    }
    const { routineRuns = {} } = await chrome.storage.session.get('routineRuns');
    delete routineRuns[id];
    await chrome.storage.session.set({ routineRuns });

    notify(routine, chat, am, result);
    setStatus(result.status === 'error' ? `Failed: ${result.note}` : 'Done');
    setTimeout(() => (me ? chrome.tabs.remove(me.id).catch(() => window.close()) : window.close()), 1500);
  }
}

function notify(routine, chat, am, result) {
  if (!chrome.notifications || !routine) return;
  const body =
    result.status === 'error' ? `Failed: ${result.note}` :
    (result.status === 'needs approval' ? 'Waiting for your approval. ' : '') +
      String(am?.text || '').replace(/[#*_`>\[\]]/g, '').replace(/\(https?:[^)]*\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
  chrome.notifications.create(`rold-harness-chat:${chat?.id || ''}:${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: routine.name,
    message: body || 'Routine finished.',
  });
}

main();
