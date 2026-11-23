import {
  PROVIDERS, getSettings, saveSettings, isConfigured, hasCredentials, getChats, saveChat, deleteChat, clearChats,
  getMemories, saveMemories, getRoutines, saveRoutine, deleteRoutine, getReads, clearReads,
} from './storage.js';
import { renderMarkdown, esc } from './markdown.js';
import { runAgent, listModels, modelAllowed, effortOptions, pickEffort, effortKey, chosenEffort, buildHistory, userPrompt, complete } from './agent.js';
import { currentPageInfo } from './tools.js';
import { connectChatGPT } from './oauth.js';
import { DAYS, normalizeSchedule, nextRunTime, describeSchedule } from './routines.js';

const MODE = document.body.dataset.mode; // 'newtab' | 'side'
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------------------------------------------------------------------------
// Icons (inline SVG, stroke = currentColor)

const ic = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const ICONS = {
  search: ic('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  read: ic('<path d="M4 5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M14 3v5h5M8 13h8M8 17h5"/>'),
  tab: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5"/>'),
  screen: ic('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  click: ic('<path d="m9 9 5 12 1.8-5.2L21 14z"/><path d="M7.2 2.2 8 5.1M5.1 8 2.2 7.2M14 4.1 12 6.2M6.2 12l-2.1 2"/>'),
  type: ic('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  think: ic('<path d="M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3zM9.5 21h5"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>'),
  send: ic('<path d="M12 19V5M5 12l7-7 7 7"/>', 'stroke-width="2.2"'),
  stop: '<svg viewBox="0 0 24 24" width="14" height="14"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>',
  gear: ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  menu: ic('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  sidebar: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
  trash: ic('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  copy: ic('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  retry: ic('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  check: ic('<path d="m5 12 5 5 9-10"/>'),
  x: ic('<path d="M6 6l12 12M18 6 6 18"/>'),
  chevron: ic('<path d="m6 9 6 6 6-6"/>'),
  gauge: ic('<path d="M4.5 18.5a9 9 0 1 1 15 0"/><path d="m12 14 4-5"/><circle cx="12" cy="14" r="1.2"/>'),
  page: ic('<path d="M4 5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M14 3v5h5"/>'),
  key: ic('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 8.8-8.8M16 7l3 3M18.5 4.5l2 2"/>'),
  external: ic('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  pause: ic('<path d="M9 5v14M15 5v14"/>', 'stroke-width="2.4"'),
  play: ic('<path d="M7 5v14l11-7z"/>'),
  shield: ic('<path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6z"/>'),
  approval: ic('<path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6z"/><path d="m9 12 2 2 4-4"/>'),
  steer: ic('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  memory: ic('<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>'),
  routine: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  wait: ic('<path d="M6 3h12M6 21h12M8 3v3.5c0 1.2.6 2.3 1.6 3L12 12l2.4-2.5c1-.7 1.6-1.8 1.6-3V3M8 21v-3.5c0-1.2.6-2.3 1.6-3L12 12l2.4 2.5c1 .7 1.6 1.8 1.6 3V21"/>'),
  sliders: ic('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  chip: ic('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>'),
  compose: ic('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  globe: ic('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  alert: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.01"/>'),
  display: ic('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
  spinner: ic('<path d="M12 3a9 9 0 1 0 9 9"/>', 'class="spin"'),
  code: ic('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>'),
  todo: ic('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>'),
  ask: ic('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M10 10a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.7M12 16h.01"/>'),
  delegate: ic('<circle cx="12" cy="6" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M12 8.5v3M12 11.5 6.5 16M12 11.5l5.5 4.5"/>'),
  file: ic('<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>'),
  attach: ic('<path d="m20 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>'),
  image: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
  broom: ic('<path d="M14 4 9.5 12M6 12h9l1.5 8H4.5z"/><path d="M8.5 16v4M12 16v4"/>'),
};
ICONS.clock = ICONS.routine;

const PERMISSIONS = { read: 'Read only', guard: 'Ask before acting', full: 'Full access' };

// ---------------------------------------------------------------------------
// State

let settings;
let chats = {};
let chat = null; // current chat
// Every chat can have its own task running; tasks keep going while you look at other chats or tabs.
const runs = new Map(); // chatId → { controller, chat, idx, agentTabs, lastAgentFocus, paused, pauseReason, resume, steer, confirm, paint }
const queues = {}; // chatId → follow-ups waiting for that chat's task to finish
let controller = null; // the current chat's task (mirrors runs)
let run = null;
let queue = [];

function syncRun() {
  run = (chat && runs.get(chat.id)) || null;
  controller = run?.controller || null;
  queue = chat ? (queues[chat.id] ||= []) : [];
}
let includePage = true;
let pageInfo = null;

// ---------------------------------------------------------------------------
// Shell

const PLACEHOLDER = MODE === 'side' ? 'Ask about this page or anything' : 'Ask anything, search the web, or enter a URL';
const SEARCH_PLACEHOLDER = "Search with your browser's search engine";
let inputMode = 'chat'; // 'chat' sends to the agent, 'search' hands the text to the browser's search engine

function shell() {
  $('#root').innerHTML = `
  <div class="app ${MODE}">
    <aside class="sidebar" id="sidebar">
      <div class="sb-head">
        <span class="brand">Rold</span>
        <button class="icon-btn" id="collapseSidebar" title="Hide sidebar">${ICONS.sidebar}</button>
      </div>
      <nav class="sb-nav">
        <button class="row-btn strong" id="newChat">${ICONS.compose}<span>New chat</span></button>
        <button class="row-btn" id="searchChats">${ICONS.search}<span>Search</span></button>
        <label class="sb-search" id="searchRow" hidden>${ICONS.search}<input id="chatSearch" placeholder="Search chats" autocomplete="off" spellcheck="false"></label>
        <button class="row-btn" id="openRoutines">${ICONS.routine}<span>Routines</span></button>
      </nav>
      <div class="chat-list" id="chatList"></div>
      <button class="row-btn" id="openSettings">${ICONS.sliders}<span>Settings</span></button>
    </aside>
    <div class="scrim" id="scrim"></div>
    <main class="main is-empty" id="main">
      <header class="topbar">
        <button class="icon-btn" id="showSidebar" title="Chats">${MODE === 'side' ? ICONS.menu : ICONS.sidebar}</button>
        <div class="topbar-title"><button type="button" class="title-btn" id="topTitle"></button></div>
      </header>
      <div class="sheet">
      <div class="scroller" id="scroller">
        <section class="hero" id="hero">
          <h1 class="greeting" id="greeting"></h1>
        </section>
        <div class="thread" id="thread"></div>
      </div>
      <div class="composer-wrap">
        <form class="composer" id="composer">
          <div class="ctx-row" id="ctxRow"></div>
          <div class="queue-row" id="queueRow"></div>
          <div class="attach-row" id="attachRow"></div>
          <textarea id="input" rows="1" placeholder="${PLACEHOLDER}" autocomplete="off"></textarea>
          <div class="composer-bar">
            <button type="button" class="icon-btn attach-btn" id="attachBtn" title="Attach files or images">${ICONS.attach}</button>
            <input type="file" id="fileInput" multiple hidden>
            <div class="tool-wrap">
              <button type="button" class="tool-btn" id="modelPill" title="Model"></button>
              <div class="popover" id="modelMenu" hidden></div>
            </div>
            <div class="tool-wrap" id="effortWrap" hidden>
              <button type="button" class="tool-btn" id="effortPill"></button>
              <div class="popover effort-menu" id="effortMenu" hidden></div>
            </div>
            <div class="tool-wrap">
              <button type="button" class="tool-btn" id="permPill"></button>
              <div class="popover perm-menu" id="permMenu" hidden></div>
            </div>
            <span class="spacer"></span>
            <div class="mode-switch" id="modeSwitch" role="radiogroup" aria-label="Send to" title="Switch with Tab">
              <span class="ms-thumb"></span>
              <button type="button" role="radio" aria-checked="true" data-im="chat">Chat</button>
              <button type="button" role="radio" aria-checked="false" data-im="search">Search</button>
            </div>
            <button type="button" class="icon-btn" id="pauseBtn" title="Pause and take over" hidden>${ICONS.pause}</button>
            <button type="submit" class="send-btn" id="sendBtn" title="Send (Enter)">${ICONS.send}</button>
          </div>
        </form>
      </div>
      </div>
    </main>
    <div class="modal" id="settingsModal" hidden></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Helpers

function favicon(url) {
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);
}
function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme === 'system' ? '' : settings.theme;
}
function autosize() {
  const ta = $('#input');
  ta.style.height = 'auto';
  const full = ta.scrollHeight + ta.offsetHeight - ta.clientHeight; // include the underline
  ta.style.height = Math.min(full, 220) + 'px';
  ta.style.overflowY = full > 220 ? 'auto' : 'hidden';
}
function scrollToBottom(force = false) {
  const sc = $('#scroller');
  const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160;
  if (force || near) sc.scrollTop = sc.scrollHeight;
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

// Greetings: a pool per time of day, plus a few for particular days. One is picked when the
// time of day changes (not on every tick), and never the same one twice in a row.
const GREETINGS = {
  night: [
    'Burning the midnight oil?',
    "Still up? What's on your mind?",
    'Late night rabbit hole?',
    'What are we looking into tonight?',
    "Can't sleep? Let's find something out.",
    'Quiet hours. What do you need?',
    "What's keeping you up?",
    'One more thing before bed?',
    'Night owl mode. Where to?',
    'The internet never sleeps. What are we digging into?',
  ],
  early: [
    "Early start. What's first?",
    "Good morning. What's on the list?",
    'Up before everyone. What do you need?',
    'Coffee and a question?',
    'What are we looking into this morning?',
    'Fresh day. Where do we start?',
    'Morning. What should we check first?',
    'Quiet morning. What can I dig up?',
  ],
  morning: [
    'Good morning. What are we working on?',
    'What are we looking into this morning?',
    'Morning. Where should we start?',
    "What's on today's list?",
    'Any questions before lunch?',
    'What should we tackle first?',
    "Ready when you are. What's the plan?",
    "What's the first thing on your mind?",
    "Morning momentum. What's next?",
    'What are we figuring out today?',
  ],
  midday: [
    'Lunch break research?',
    "Good afternoon. What's next?",
    'Halfway through the day. What do you need?',
    'What are we looking into this afternoon?',
    'Midday check in. What can I find?',
    'Something to read over lunch?',
    "What's on the afternoon agenda?",
    'Quick question over lunch?',
  ],
  afternoon: [
    'What are we looking into this afternoon?',
    "Good afternoon. What's on your mind?",
    'Afternoon. Where should we dig?',
    'What can I take off your plate?',
    'Need a hand with something?',
    "What's left on today's list?",
    'Afternoon slump? Hand me the busywork.',
    'What are we figuring out next?',
    "Let's knock something out. What is it?",
    'Curious about something?',
  ],
  evening: [
    'Good evening. What are we looking into?',
    "Evening. What's on your mind?",
    'Winding down or just getting started?',
    'What should we look up tonight?',
    'Planning tomorrow or exploring tonight?',
    'What are we looking into tonight?',
    'Anything you meant to look up today?',
    'Relaxed evening research?',
    'Deciding on dinner, or something else?',
    'What caught your eye today?',
  ],
  monday: ["Monday. Let's get ahead of the week.", 'New week, new questions. Where to?'],
  friday: ["Friday afternoon. What's left before the weekend?", 'Almost the weekend. What do we need?'],
  weekend: ['Weekend mode. What are we exploring?', "Slow weekend? Let's find something interesting.", 'Any weekend plans to look up?'],
  side: [
    'What can I help with on this page?',
    'Want a summary of this page?',
    'Questions about this page?',
    'What should I do on this page?',
    'Need something from this page?',
    'What do you want to know about this?',
    'Want me to dig into this page?',
  ],
};

function greetingPool(d = new Date()) {
  if (MODE === 'side') return { slot: 'side', pool: GREETINGS.side };
  const h = d.getHours();
  const day = d.getDay(); // 0 Sunday … 6 Saturday
  const part = h < 5 || h >= 22 ? 'night' : h < 8 ? 'early' : h < 12 ? 'morning' : h < 14 ? 'midday' : h < 18 ? 'afternoon' : 'evening';
  const pool = [...GREETINGS[part]];
  if (day === 1 && (part === 'early' || part === 'morning')) pool.push(...GREETINGS.monday);
  if (day === 5 && (part === 'afternoon' || part === 'evening')) pool.push(...GREETINGS.friday);
  if ((day === 0 || day === 6) && part !== 'night') pool.push(...GREETINGS.weekend);
  return { slot: `${part}-${day}`, pool };
}

let greetingSlot = '';
function tickClock() {
  const { slot, pool } = greetingPool();
  if (slot === greetingSlot) return;
  greetingSlot = slot;
  let last = '';
  try { last = localStorage.getItem('rh-greeting') || ''; } catch {}
  const options = pool.length > 1 ? pool.filter((g) => g !== last) : pool;
  const text = options[Math.floor(Math.random() * options.length)];
  try { localStorage.setItem('rh-greeting', text); } catch {}
  $('#greeting').textContent = text;
}

// ---------------------------------------------------------------------------
// Sidebar / chats

let chatFilter = '';

function renderChatList() {
  const q = chatFilter.trim().toLowerCase();
  const list = Object.values(chats)
    .filter((c) => !q || (c.title || 'New chat').toLowerCase().includes(q))
    .sort((a, b) => b.updated - a.updated);
  const groups = {};
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const c of list) {
    const g = c.updated >= startOfDay ? 'Today' : c.updated >= startOfDay - 86400000 ? 'Yesterday' : c.updated >= startOfDay - 7 * 86400000 ? 'Last 7 days' : 'Older';
    (groups[g] ||= []).push(c);
  }
  $('#chatList').innerHTML = list.length
    ? Object.entries(groups)
        .map(([g, cs]) => `<div class="cl-group">${g}</div>` + cs
          .map((c) => `<div class="cl-item ${chat?.id === c.id ? 'active' : ''}" data-id="${c.id}">${chatBadge(c)}<span>${esc(c.title || 'New chat')}</span><button class="cl-del" data-del="${c.id}" title="Delete">${ICONS.trash}</button></div>`)
          .join(''))
        .join('')
    : `<div class="cl-empty">${q ? 'No chats match.' : 'Your chats will show up here.'}</div>`;
}

function chatBadge(c) {
  const r = runs.get(c.id);
  if (r?.confirm) return `<span class="cl-ic warn" title="Waiting for your approval">${ICONS.shield}</span>`;
  if (r) return `<span class="cl-ic" title="Working">${ICONS.spinner}</span>`;
  return c.routineId ? `<span class="cl-ic" title="Routine">${ICONS.routine}</span>` : '<span class="cl-ic"></span>';
}

function showChat(c) {
  chat = c;
  syncRun();
  renderThread();
  renderChatList();
  renderQueue();
  updateSendBtn();
  closeSidebarOverlay();
}

function openChat(id) {
  showChat(chats[id] || null);
}

function newChat() {
  showChat(null);
  $('#input').focus();
}

function closeSidebarOverlay() {
  $('.app').classList.remove('sidebar-open');
}

// ---------------------------------------------------------------------------
// Thread rendering

function stepSummary(steps) {
  const n = (k) => steps.filter((s) => s.kind === k).length;
  const parts = [];
  const plural = (k, one, many) => (n(k) === 1 ? one : many.replace('#', n(k)));
  if (n('search')) parts.push(plural('search', 'Searched once', 'Searched # times'));
  if (n('read')) parts.push(plural('read', 'read 1 page', 'read # pages'));
  const acts = n('tab') + n('click') + n('type') + n('wait') + n('screen') + n('code');
  if (acts) parts.push(`${acts} browser action${acts > 1 ? 's' : ''}`);
  const helpers = steps.filter((s) => s.kind === 'delegate').length;
  if (helpers) parts.push(helpers === 1 ? 'used helpers' : `used helpers ${helpers} times`);
  if (n('ask')) parts.push(plural('ask', 'asked you once', 'asked you # times'));
  if (n('file')) parts.push(plural('file', 'saved a file', 'saved # files'));
  if (n('memory')) parts.push('updated memory');
  if (n('routine')) parts.push('managed routines');
  const text = parts.join(', ') || `${steps.length} step${steps.length > 1 ? 's' : ''}`;
  return text[0].toUpperCase() + text.slice(1);
}

// "0:07" from the start of the answer; long runs read "12:04".
function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function duration(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function renderSteps(m) {
  if (!m.steps?.length) return '';
  const running = m.status === 'running';
  const took = !running && m.doneAt && m.ts ? ` in ${duration(m.doneAt - m.ts)}` : '';
  return `<details class="activity ${running ? 'live' : ''}" ${running || m.showSteps ? 'open' : ''}>
    <summary>${ICONS.check}<span>${esc(stepSummary(m.steps) + took)}</span><span class="chev">${ICONS.chevron}</span></summary>
    <ol class="steps">${m.steps
      .map((s) => `<li class="step ${s.status} k-${s.kind}">
        <span class="step-ic">${s.status === 'running' ? ICONS.spinner : s.status === 'error' ? ICONS.x : ICONS[s.kind] || ICONS.think}</span>
        <span class="step-body"><span class="step-label">${esc(s.kind === 'think' ? s.label.slice(0, 400) : s.label)}</span>${s.detail ? `<span class="step-detail">${esc(String(s.detail).slice(0, 200))}</span>` : ''}</span>
        ${s.at && m.ts ? `<span class="step-time">${clock(s.at - m.ts)}</span>` : ''}
      </li>`)
      .join('')}</ol>
  </details>`;
}

function renderSources(m) {
  if (!m.sources?.length) return '';
  const shown = m.sources.slice(0, 6);
  return `<div class="sources"><div class="sources-title">Sources</div>${shown
    .map((s) => `<a class="source" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="${esc(s.url)}">
      <img src="${esc(favicon(s.url))}" alt="" width="16" height="16"><span>${esc(s.title && s.title !== s.url ? s.title : hostOf(s.url))}</span></a>`)
    .join('')}${m.sources.length > shown.length ? `<span class="source more">${m.sources.length - shown.length} more</span>` : ''}</div>`;
}

function notice(icon, title, text, buttons = '', cls = '') {
  return `<div class="notice ${cls}">${icon}<div class="notice-text"><strong>${title}</strong>${text ? `<span>${esc(text)}</span>` : ''}</div>${buttons ? `<div class="notice-btns">${buttons}</div>` : ''}</div>`;
}

const isImageSrc = (s) => typeof s === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(s);

function fileChips(files, removable = false) {
  return (files || [])
    .map((f, i) => `<span class="file-chip" title="${esc(f.name)}">${f.image && isImageSrc(f.src) ? `<img src="${esc(f.src)}" alt="">` : ICONS.page}<span class="fc-name">${esc(f.name)}</span>${
      removable ? `<button type="button" class="x-btn" data-unattach="${i}" title="Remove">${ICONS.x}</button>` : ''
    }</span>`)
    .join('');
}

function renderTodos(m) {
  if (!m.todos?.length) return '';
  const done = m.todos.filter((t) => t.status === 'done').length;
  const mark = { done: ICONS.check, in_progress: ICONS.spinner, blocked: ICONS.x };
  return `<div class="todos"><div class="todos-head">${ICONS.todo}<span>Checklist</span><span class="todos-count">${done}/${m.todos.length}</span></div>
    <ul>${m.todos.map((t) => `<li class="todo t-${esc(t.status)}"><span class="todo-box">${mark[t.status] || ''}</span><span>${esc(t.text)}</span></li>`).join('')}</ul></div>`;
}

function renderShots(m) {
  const list = (m.images || []).filter(isImageSrc);
  if (!list.length) return '';
  return `<div class="shots">${list.map((src, i) => `<button type="button" class="shot" data-shot="${i}" title="Open full size"><img src="${esc(src)}" alt="Screenshot"></button>`).join('')}</div>`;
}

function askCard(q) {
  const opts = (q.options || []).map((o, i) => `<button type="button" class="btn ${i === 0 ? 'primary' : ''} small" data-ask-opt="${i}">${esc(o)}</button>`).join('');
  return `<div class="ask-card">${ICONS.ask}<div class="ask-body"><strong>${esc(q.question)}</strong>${opts ? `<div class="ask-opts">${opts}</div>` : ''}${
    q.allowText !== false ? `<div class="ask-input"><input class="ask-text" placeholder="Type an answer" value="${esc(q.draft || '')}" autocomplete="off"><button type="button" class="btn small" data-ask-send>Send</button></div>` : ''
  }<button type="button" class="btn link small ask-skip" data-ask-skip>Skip, use your judgment</button></div></div>`;
}

function messageHTML(m, idx) {
  if (m.role === 'user') {
    const files = fileChips(m.files);
    return `<div class="msg user prompt" data-idx="${idx}">${files ? `<div class="msg-files">${files}</div>` : ''}${esc(m.text)}</div>`;
  }
  const paused = m.status === 'running' && run?.idx === idx && run.paused;
  const body = m.error
    ? notice(ICONS.alert, 'Something went wrong', m.error, '', 'err')
    : m.text
      ? `<div class="md">${renderMarkdown(m.text)}</div>`
      : m.status === 'running' && !m.steps?.length && !paused
        ? `<div class="working">${ICONS.spinner}<span>Working</span></div>`
        : '';
  const confirming = run?.idx === idx && run.confirm;
  const asking = run?.idx === idx && run.ask;
  return `<div class="msg assistant ${m.status === 'running' ? 'running' : ''}" data-idx="${idx}">
    <div class="msg-main">
      ${renderSteps(m)}
      ${renderTodos(m)}
      ${paused ? notice(ICONS.pause, 'Paused', run.pauseReason, `<button type="button" class="btn primary small act" data-act="resume">${ICONS.play}Resume</button>`) : ''}
      ${renderSources(m)}
      ${body}
      ${renderShots(m)}
      <div class="confirm-slot">${confirming ? notice(ICONS.shield, 'Approve this action?', run.confirm.text,
        '<button type="button" class="btn" data-v="0">Deny</button><button type="button" class="btn primary" data-v="1">Approve</button>', 'confirm-card') : ''}${asking ? askCard(run.ask) : ''}</div>
      ${m.status !== 'running' ? `<div class="msg-actions">
        ${m.text ? `<button class="act" data-act="copy" title="Copy">${ICONS.copy}</button>` : ''}
        <button class="act" data-act="retry" title="Regenerate">${ICONS.retry}</button>
        <span class="meta" title="${esc(PROVIDERS[m.provider]?.label || '')}">${esc(m.model || '')}</span>
      </div>` : ''}
    </div>
  </div>`;
}

// The title at the top: a started chat's title is a button that turns into a text field.
function renderTopTitle() {
  const t = $('#topTitle');
  const editable = !!chat?.messages?.length;
  t.textContent = chat?.title || (MODE === 'side' ? 'Rold' : '');
  t.disabled = !editable;
  t.title = editable ? 'Rename chat' : '';
  t.hidden = !t.textContent;
}

function editTitle() {
  if (!chat?.messages?.length || $('.title-input')) return;
  const target = chat;
  const btn = $('#topTitle');
  const input = document.createElement('input');
  input.className = 'title-input';
  input.value = target.title || '';
  input.maxLength = 120;
  input.setAttribute('aria-label', 'Chat title');
  input.spellcheck = false;
  btn.hidden = true;
  btn.after(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const text = input.value.trim().replace(/\s+/g, ' ');
    input.remove();
    if (save && text && text !== target.title) {
      target.title = text;
      await saveChat(target);
      chats[target.id] = target;
      renderChatList();
    }
    if (chat === target) renderTopTitle();
    else btn.hidden = !btn.textContent;
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

function renderThread() {
  const msgs = chat?.messages || [];
  $('#main').classList.toggle('is-empty', !msgs.length);
  // Chat/Search only applies to a new chat; a started one always sends to the agent.
  if (msgs.length && inputMode === 'search') setInputMode('chat');
  $('#thread').innerHTML = msgs.map(messageHTML).join('');
  mountVisuals($('#thread'));
  renderTopTitle();
  scrollToBottom(true);
}

function rerenderMessage(idx) {
  const el = $(`.msg[data-idx="${idx}"]`);
  if (!el) return renderThread();
  const m = chat.messages[idx];
  const tmp = document.createElement('div');
  tmp.innerHTML = messageHTML(m, idx);
  const fresh = tmp.firstElementChild;
  const focused = document.activeElement?.matches?.('.ask-text') && el.contains(document.activeElement);
  el.replaceWith(fresh);
  mountVisuals(fresh);
  if (focused) $('.ask-text', fresh)?.focus();
  scrollToBottom();
}

// ```visual blocks render in a sandboxed page (visual.html) that has no extension access.
function visualTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const t = document.documentElement.dataset.theme;
  return {
    theme: { '--text': v('--text'), '--muted': v('--text-2'), '--accent': v('--accent'), '--accent-soft': v('--accent-soft'), '--line': v('--line'), '--bg': v('--raised') || v('--bg') },
    dark: t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches,
    font: getComputedStyle(document.body).fontFamily,
  };
}

function mountVisuals(root) {
  $$('.visual-host:not([data-ready])', root).forEach((host) => {
    host.dataset.ready = '1';
    const src = $('.visual-src', host)?.value || '';
    const f = document.createElement('iframe');
    f.className = 'visual-frame';
    f.setAttribute('sandbox', 'allow-scripts allow-popups');
    f.title = 'Visual';
    f.addEventListener('load', () => {
      const t = visualTheme();
      f.style.colorScheme = t.dark ? 'dark' : 'light'; // must match the frame's own scheme, or it paints an opaque background
      f.contentWindow?.postMessage({ type: 'rold-visual', html: src, ...t }, '*');
    });
    f.src = chrome.runtime.getURL('visual.html');
    $('.visual-loading', host)?.remove();
    host.append(f);
  });
}

window.addEventListener('message', (e) => {
  if (e.data?.type !== 'rold-visual-size') return;
  const f = $$('.visual-frame').find((x) => x.contentWindow === e.source);
  if (f) f.style.height = `${Math.min(Math.max(Number(e.data.h) || 0, 24), 1400)}px`;
});

// ---------------------------------------------------------------------------
// Model pill + menu

function renderModelPill() {
  const key = settings.provider;
  const p = PROVIDERS[key];
  const cfg = settings.providers[key];
  const model = cfg.model || 'Choose a model';
  const signedIn = hasCredentials(cfg);
  $('#modelPill').innerHTML = `${ICONS.chip}<span class="t-main${cfg.model ? '' : ' t-empty'}">${esc(model)}</span><span class="t-sub">${p.label}</span>${signedIn ? '' : '<span class="t-warn">Sign in</span>'}`;
  $('#modelPill').title = cfg.model ? `Model: ${model} on ${p.label}` : `No model chosen on ${p.label}`;
  renderEffortPill();
}

const EFFORT_LABEL = { default: 'Auto', none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };

function currentEffortOptions() {
  return effortOptions(settings.providers[settings.provider]);
}

function renderEffortPill() {
  const opts = currentEffortOptions();
  $('#effortWrap').hidden = !opts.length || !isConfigured(settings);
  const cur = pickEffort(chosenEffort(settings), opts) || 'default';
  $('#effortPill').innerHTML = `${ICONS.gauge}<span class="t-label">${EFFORT_LABEL[cur] || cur}</span>`;
  $('#effortPill').title = `Thinking effort: ${EFFORT_LABEL[cur] || cur}`;
  renderPermPill();
}

function renderPermPill() {
  const p = settings.permission in PERMISSIONS ? settings.permission : 'guard';
  $('#permPill').innerHTML = `${ICONS.shield}<span class="t-label">${PERMISSIONS[p]}</span>`;
  $('#permPill').title = `Permissions: ${PERMISSIONS[p]}`;
  $('#permPill').dataset.level = p;
}

function renderPermMenu() {
  $('#permMenu').innerHTML = Object.entries(PERMISSIONS)
    .map(([v, label]) => `<button type="button" class="mm-item ${v === settings.permission ? 'active' : ''}" data-perm="${v}">
      <span class="mm-text"><span class="mm-name">${label}</span></span>${v === settings.permission ? ICONS.check : ''}</button>`)
    .join('');
}

function togglePermMenu(show) {
  const menu = $('#permMenu');
  const open = show ?? menu.hidden;
  if (open) { closeMenus('permMenu'); renderPermMenu(); }
  menu.hidden = !open;
}

const MENUS = ['modelMenu', 'effortMenu', 'permMenu'];
function closeMenus(except) {
  MENUS.forEach((id) => id !== except && ($('#' + id).hidden = true));
}

function renderEffortMenu() {
  const opts = currentEffortOptions();
  const cur = pickEffort(chosenEffort(settings), opts) || 'default';
  $('#effortMenu').innerHTML = `${['default', ...opts]
    .map((v) => `<button type="button" class="mm-item ${v === cur ? 'active' : ''}" data-effort="${v}">
      <span class="mm-text"><span class="mm-name">${EFFORT_LABEL[v] || v}</span></span>
      ${v === cur ? ICONS.check : ''}</button>`)
    .join('')}`;
}

function toggleEffortMenu(show) {
  const menu = $('#effortMenu');
  const open = show ?? menu.hidden;
  if (open) { closeMenus('effortMenu'); renderEffortMenu(); }
  menu.hidden = !open;
}

function modelOptions(cfg) {
  const list = [...(cfg.models || [])];
  if (cfg.model && !list.includes(cfg.model)) list.unshift(cfg.model);
  if (!list.length) return `<option value="" disabled selected>${hasCredentials(cfg) ? 'No models loaded yet' : 'oauth' in cfg ? 'Sign in to load models' : 'Add your API key to load models'}</option>`;
  const none = cfg.model ? '' : '<option value="" disabled selected>Choose a model</option>';
  return none + list.map((m) => `<option value="${esc(m)}" ${m === cfg.model ? 'selected' : ''}>${esc(m)}</option>`).join('');
}

function renderModelMenu() {
  const items = Object.entries(PROVIDERS)
    .map(([key, p]) => {
      const cfg = settings.providers[key];
      const sub = !hasCredentials(cfg) ? 'Not connected' : cfg.model ? '' : 'No model chosen';
      return `<button type="button" class="mm-item ${settings.provider === key ? 'active' : ''}" data-provider="${key}">
        <span class="mm-text"><span class="mm-name">${p.label} <span class="plan">(${p.plan})</span></span>${sub ? `<span class="mm-sub">${sub}</span>` : ''}</span>
        ${settings.provider === key ? ICONS.check : ''}
      </button>`;
    })
    .join('');
  const cfg = settings.providers[settings.provider];
  $('#modelMenu').innerHTML = `
    <div class="mm-title">Provider</div>${items}
    <div class="mm-title">Model</div>
    <div class="mm-model">
      <select id="mmModel">${modelOptions(cfg)}</select>
    </div>
    <button type="button" class="mm-manage" id="mmManage">${ICONS.key}<span>Accounts and settings</span></button>`;
}

function toggleModelMenu(show) {
  const menu = $('#modelMenu');
  const open = show ?? menu.hidden;
  if (open) { closeMenus('modelMenu'); renderModelMenu(); }
  menu.hidden = !open;
}

// ---------------------------------------------------------------------------
// Context row (side panel: current page chip)

async function refreshPageInfo() {
  if (MODE !== 'side') return;
  pageInfo = await currentPageInfo();
  const row = $('#ctxRow');
  if (!pageInfo) { row.innerHTML = ''; return; }
  const img = `<img src="${esc(favicon(pageInfo.url))}" width="14" height="14" alt="">`;
  row.title = pageInfo.url;
  row.innerHTML = includePage
    ? `${img}<span class="ctx-title">${esc(pageInfo.title || hostOf(pageInfo.url))}</span><span class="ctx-host">${esc(hostOf(pageInfo.url))}</span><button type="button" class="x-btn" data-ctx="remove" title="Leave this page out">${ICONS.x}</button>`
    : `<button type="button" class="ctx-add" data-ctx="add" title="Include this page">${ICONS.plus}<span class="ctx-title">Include ${esc(pageInfo.title || hostOf(pageInfo.url))}</span></button>`;
}

function renderQueue() {
  $('#queueRow').innerHTML = queue
    .map((q, i) => `<div class="queued"><span class="q-label">Queued</span><span class="q-text">${esc(q)}</span><button type="button" class="x-btn" data-unqueue="${i}" title="Remove">${ICONS.x}</button></div>`)
    .join('');
}

// ---------------------------------------------------------------------------
// Confirmation card for browser actions

// The card lives in the run's state, so it survives switching chats and shows again when you come back.
function confirmAction(r, text) {
  return new Promise((resolve) => {
    const m = r.chat.messages[r.idx];
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      r.confirm = null;
      m.waiting = false;
      r.paint();
      renderChatList();
      resolve(v);
    };
    r.confirm = { text, done };
    m.waiting = true;
    r.paint();
    renderChatList();
    if (chat === r.chat) scrollToBottom(true);
    notifyApproval(r, text);
    r.controller.signal.addEventListener('abort', () => done(false), { once: true });
  });
}

// When you're looking at another chat or tab, a notification tells you the agent is waiting.
let myTabId = null;
chrome.tabs.getCurrent?.().then((t) => { myTabId = t?.id ?? null; }).catch(() => {});

// Questions from the agent (ask_user) wait here the same way approvals do.
function askUser(r, q) {
  return new Promise((resolve) => {
    const m = r.chat.messages[r.idx];
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      r.ask = null;
      m.waiting = false;
      r.paint();
      renderChatList();
      if (r === run) updateSendBtn();
      resolve(v);
    };
    r.ask = { ...q, draft: '', done };
    m.waiting = true;
    r.paint();
    renderChatList();
    if (r === run) updateSendBtn();
    if (chat === r.chat) scrollToBottom(true);
    notifyApproval(r, q.question, 'Question');
    r.controller.signal.addEventListener('abort', () => done(null), { once: true });
  });
}

function notifyApproval(r, text, kind = 'Approve') {
  if (!document.hidden && chat === r.chat) return;
  chrome.notifications?.create(`rold-approve:${r.chat.id}:${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: `${kind}: ${r.chat.title || 'Rold'}`,
    message: text,
    priority: 2,
  }, () => void chrome.runtime.lastError);
}

chrome.notifications?.onClicked.addListener((nid) => {
  const [prefix, chatId] = nid.split(':');
  if (prefix !== 'rold-approve' || !runs.has(chatId)) return;
  chrome.notifications.clear(nid);
  if (myTabId != null) {
    chrome.tabs.update(myTabId, { active: true }).then((t) => chrome.windows.update(t.windowId, { focused: true })).catch(() => {});
  }
  openChat(chatId);
});

// ---------------------------------------------------------------------------
// Sending

function looksLikeUrl(s) {
  return /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(s) && !/\s/.test(s);
}

// While a task runs, the send button stops it (empty box) or steers / queues a follow-up (text typed).
function updateSendBtn() {
  const running = !!controller;
  const hasText = !!$('#input').value.trim() || (!running && attachments.length > 0);
  const searching = inputMode === 'search';
  const stop = running && !hasText;
  const queueMode = settings.followUp === 'queue';
  $('#sendBtn').innerHTML = stop ? ICONS.stop : searching ? ICONS.search : ICONS.send;
  $('#sendBtn').classList.toggle('stop', stop);
  $('#sendBtn').title = stop ? 'Stop' : searching ? 'Search (Enter)' : running ? (queueMode ? 'Queue' : 'Steer') : 'Send (Enter)';
  $('#input').placeholder = searching ? SEARCH_PLACEHOLDER : run?.ask ? 'Type your answer' : running ? (queueMode ? 'Queue a follow-up' : 'Steer the agent') : PLACEHOLDER;
  $('#pauseBtn').hidden = !running;
  $('#pauseBtn').innerHTML = run?.paused ? ICONS.play : ICONS.pause;
  $('#pauseBtn').title = run?.paused ? 'Resume' : 'Pause and take over';
}
const setRunning = updateSendBtn;

function pauseRun(reason) {
  if (!run || run.paused) return;
  run.paused = true;
  run.pauseReason = reason;
  run.paint();
  updateSendBtn();
}

function resumeRun() {
  if (!run?.paused) return;
  run.paused = false;
  const r = run.resume;
  run.resume = null;
  run.paint();
  updateSendBtn();
  r?.();
}

function followUp(text) {
  $('#input').value = '';
  autosize();
  if (run?.ask) { run.ask.done(text); updateSendBtn(); return; } // a typed reply answers the open question
  if (settings.followUp === 'queue' || !run) {
    queue.push(text);
    renderQueue();
  } else {
    run.steer.push(text);
    const am = run.chat.messages[run.idx];
    am.steps.push({ kind: 'steer', label: text, status: 'running', at: Date.now() });
    run.paint();
    if (run.paused) resumeRun();
  }
  updateSendBtn();
}

function setInputMode(mode) {
  inputMode = mode;
  const sw = $('#modeSwitch');
  sw.classList.toggle('is-search', mode === 'search');
  $$('[data-im]', sw).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.im === mode)));
  updateSendBtn();
}

// Search mode: the browser's own search engine runs the query, in this tab on the new tab page.
// A new tab is used from the side panel, or when leaving would stop tasks running here.
async function webSearch(text) {
  text = text.trim();
  if (!text) return;
  const disposition = MODE === 'newtab' && !runs.size ? 'CURRENT_TAB' : 'NEW_TAB';
  $('#input').value = '';
  autosize();
  updateSendBtn();
  try {
    await chrome.search.query({ text, disposition });
  } catch (err) {
    toast(`Could not search: ${err.message}`);
  }
}

// target: the chat to run in (defaults to the one on screen). Runs keep going when you switch away.
async function send(text, { regenerate = false, target = null, files = null } = {}) {
  text = text.trim();
  const own = !regenerate && !target; // typed in the composer: takes the pending attachments
  if (!files && own) files = attachments.length ? attachments.slice() : null;
  if (!text && files?.length) text = files.length === 1 ? 'Take a look at the attached file.' : 'Take a look at the attached files.';
  if (!text) return;
  let thisChat = target || chat;
  if (thisChat && runs.has(thisChat.id)) return;

  if (MODE === 'newtab' && own && !files?.length && looksLikeUrl(text)) {
    const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    // Leaving this page would stop the tasks running in it, so open the site in a new tab instead.
    if (runs.size) { chrome.tabs.create({ url }); $('#input').value = ''; autosize(); updateSendBtn(); }
    else location.href = url;
    return;
  }
  if (!isConfigured(settings)) {
    if (hasCredentials(settings.providers[settings.provider])) {
      setTimeout(() => toggleModelMenu(true)); // after the click that sent closes menus
      toast('Choose a model first.');
    } else {
      openSettings(settings.provider);
      toast(`Connect ${PROVIDERS[settings.provider].label} first.`);
    }
    return;
  }

  if (!thisChat) {
    thisChat = { id: uid(), title: text.slice(0, 60), created: Date.now(), updated: Date.now(), messages: [] };
    chats[thisChat.id] = thisChat;
    chat = thisChat;
  }
  const onScreen = () => chat === thisChat;

  const msgs = thisChat.messages;
  const history = buildHistory(msgs);

  if (!regenerate) msgs.push({ role: 'user', text, ts: Date.now(), ...(files?.length ? { files } : {}) });
  if (own && files?.length) { attachments = []; renderAttachments(); }
  const userMsg = msgs[msgs.length - 1];
  const images = (userMsg.files || [])
    .filter((f) => f.image && isImageSrc(f.src))
    .map((f) => ({ mediaType: f.src.slice(5, f.src.indexOf(';')), data: f.src.slice(f.src.indexOf(',') + 1) }));
  const am = {
    role: 'assistant', text: '', steps: [], sources: [], status: 'running',
    provider: settings.provider, model: settings.providers[settings.provider].model, ts: Date.now(),
  };
  msgs.push(am);
  const idx = msgs.length - 1;
  if (!target) { $('#input').value = ''; autosize(); }

  const ctrl = new AbortController();
  const signal = ctrl.signal;
  const thisRun = {
    controller: ctrl, chat: thisChat, idx, agentTabs: new Set(), lastAgentFocus: 0,
    paused: false, pauseReason: '', resume: null, steer: [], confirm: null,
    paint: () => { if (onScreen()) rerenderMessage(idx); },
  };
  runs.set(thisChat.id, thisRun);
  if (onScreen()) { syncRun(); renderThread(); updateSendBtn(); }
  renderChatList();

  // Keeps the browser from freezing this page while it sits in a background tab.
  let release;
  const held = new Promise((res) => { release = res; });
  navigator.locks?.request(`rold-run-${thisChat.id}`, () => held).catch(() => {});

  const seen = new Set();
  const paint = thisRun.paint;
  const ui = {
    // Holds the agent before its next step while the user has paused it.
    gate: () => (thisRun.paused && !signal.aborted
      ? new Promise((res) => { thisRun.resume = res; signal.addEventListener('abort', res, { once: true }); })
      : Promise.resolve()),
    takeSteer() {
      if (!thisRun.steer.length) return [];
      const out = thisRun.steer.splice(0);
      am.steers = [...(am.steers || []), ...out];
      am.steps.forEach((s) => s.kind === 'steer' && s.status === 'running' && (s.status = 'done'));
      paint();
      return out;
    },
    step(s) {
      am.steps.push({ at: Date.now(), ...s });
      paint();
      return am.steps.length - 1;
    },
    updateStep(i, patch) {
      Object.assign(am.steps[i], patch);
      paint();
    },
    source(s) {
      if (!s?.url || seen.has(s.url)) return;
      seen.add(s.url);
      am.sources.push({ title: s.title || s.url, url: s.url });
      paint();
    },
    text(t) {
      am.text = t;
      paint();
    },
    confirm: (desc) => confirmAction(thisRun, desc),
    ask: (q) => askUser(thisRun, q),
    // What the agent did this turn, replayed in later turns so it remembers its work.
    log(entry) {
      (am.log ||= []).push(entry);
      if (am.log.length > 150) am.log.splice(0, am.log.length - 150);
    },
    todos(list) {
      am.todos = list;
      paint();
    },
    image(img) {
      am.images = [...(am.images || []), `data:${img.mediaType};base64,${img.data}`].slice(-4);
      paint();
    },
  };

  if (MODE === 'side') await refreshPageInfo();
  try {
    const memories = settings.memory?.enabled ? await getMemories(settings) : [];
    const out = await runAgent({
      settings,
      history,
      userText: userPrompt(userMsg),
      images,
      ui,
      signal,
      mode: MODE,
      pageInfo: MODE === 'side' && includePage ? pageInfo : null,
      sessionId: thisChat.id,
      memories,
      run: thisRun,
    });
    am.text = out || am.text || '_(No answer returned.)_';
  } catch (e) {
    if (e.name === 'AbortError') am.text = (am.text ? am.text + '\n\n' : '') + '_Stopped._';
    else am.error = e.message || String(e);
  } finally {
    release();
    // Follow-ups the agent never got to read run next, as their own messages.
    const q = (queues[thisChat.id] ||= []);
    q.unshift(...thisRun.steer.splice(0));
    am.steps = am.steps.filter((s) => !(s.kind === 'steer' && s.status === 'running'));
    am.status = 'done';
    am.doneAt = Date.now();
    am.waiting = false;
    am.steps.forEach((s) => s.status === 'running' && (s.status = 'error'));
    runs.delete(thisChat.id);
    thisChat.updated = Date.now();
    if (onScreen()) { syncRun(); paint(); updateSendBtn(); renderQueue(); }
    renderChatList();
    if (chats[thisChat.id]) saveChat(thisChat).catch((err) => toast('Could not save chat: ' + err.message));
    // Queued follow-ups run next, even if you're looking at another chat.
    if (q.length && !signal.aborted && chats[thisChat.id]) {
      setTimeout(() => {
        if (runs.has(thisChat.id) || !q.length) return;
        const next = q.shift();
        if (onScreen()) renderQueue();
        send(next, { target: thisChat });
      }, 0);
    }
  }
}

function regenerate() {
  if (!chat || controller) return;
  const msgs = chat.messages;
  if (msgs[msgs.length - 1]?.role === 'assistant') msgs.pop();
  const lastUser = msgs[msgs.length - 1];
  if (lastUser?.role === 'user') send(lastUser.text, { regenerate: true, files: lastUser.files || null });
}

// ---------------------------------------------------------------------------
// Attachments: text files are inlined into the message, images are shrunk and sent to the model.

let attachments = []; // [{ name, text } | { name, image: true, src }]
const MAX_ATTACH = 6;
const MAX_FILE_TEXT = 150000;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|mjs|ts|tsx|jsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sh|ps1|bat|sql|ya?ml|toml|ini|cfg|conf|log|srt|vtt|ics|svg|tex|rst)$/i;

function renderAttachments() {
  const row = $('#attachRow');
  if (!row) return;
  row.innerHTML = fileChips(attachments, true);
  updateSendBtn();
}

async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL('image/jpeg', 0.85);
}

async function addFiles(list) {
  for (const file of [...list]) {
    if (attachments.length >= MAX_ATTACH) { toast(`Up to ${MAX_ATTACH} attachments per message.`); break; }
    const name = file.name || (file.type.startsWith('image/') ? 'Pasted image' : 'Pasted file');
    try {
      if (file.type.startsWith('image/')) {
        attachments.push({ name, image: true, src: await shrinkImage(file) });
      } else if (file.type.startsWith('text/') || /json|xml|javascript|csv|yaml|calendar/.test(file.type) || TEXT_EXT.test(name)) {
        if (file.size > 5_000_000) { toast(`${name} is too big to attach.`); continue; }
        let text = await file.text();
        if (text.length > MAX_FILE_TEXT) text = text.slice(0, MAX_FILE_TEXT) + `\n[truncated, ${text.length.toLocaleString()} characters in total]`;
        attachments.push({ name, text });
      } else {
        toast(`${name}: only text files and images can be attached for now.`);
      }
    } catch (err) {
      toast(`Could not attach ${name}: ${err.message}`);
    }
  }
  renderAttachments();
}

// ---------------------------------------------------------------------------
// Settings modal

const PLAN_NAME = { free: 'Free', plus: 'Plus', pro: 'Pro', team: 'Business', business: 'Business', enterprise: 'Enterprise', edu: 'Edu' };

// Sign-in providers (ChatGPT) get an account row instead of an API key field.
function accountField(key) {
  const p = PROVIDERS[key];
  const o = settings.providers[key].oauth;
  const plan = o?.plan ? PLAN_NAME[o.plan] || o.plan : '';
  return `<div class="field"><span>Account</span>
      <div class="key-row acct-row">${o?.access
        ? `<span class="acct-name">${esc(o.label || `Signed in to ${p.label}`)}${plan ? ` <span class="plan">(${esc(plan)})</span>` : ''}</span>
           <button type="button" class="btn small" data-signout>Sign out</button>`
        : `<button type="button" class="btn" data-signin>Sign in with ${esc(p.label)}</button>`}</div>
    </div>`;
}

function providerPane(key) {
  const p = PROVIDERS[key];
  const cfg = settings.providers[key];
  return `<div class="pane" data-pane="${key}">
    ${p.oauth ? accountField(key) : `<label class="field"><span>API key</span>
      <div class="key-row"><input data-f="apiKey" type="password" value="${esc(cfg.apiKey || '')}" placeholder="${esc(p.keyHint)}" spellcheck="false" autocomplete="off">
      <button type="button" class="btn small" data-showkey>Show</button></div>
    </label>`}
    <label class="field"><span>Model</span>
      <div class="key-row"><select data-f="model">${modelOptions(cfg)}</select>
      <button type="button" class="btn small" data-loadmodels title="Reload the model list">Refresh</button></div>
    </label>
    <div class="pane-actions">
      <button type="button" class="btn primary" data-use>Use ${esc(p.label)}</button>
      ${p.keyUrl ? `<a class="btn link" href="${p.keyUrl}" target="_blank" rel="noopener">Get a key${ICONS.external}</a>` : ''}
      <span class="status" data-status></span>
    </div>
  </div>`;
}

function openSettings(tab = settings.provider) {
  const m = $('#settingsModal');
  m.innerHTML = `<div class="dialog" role="dialog" aria-label="Settings">
    <div class="dlg-head"><h2>Settings</h2><button class="icon-btn" data-close title="Close">${ICONS.x}</button></div>
    <div class="dlg-body">
      <h3>${ICONS.key}Accounts</h3>
      <section class="set-card">
      <div class="tabs">${Object.entries(PROVIDERS)
        .map(([k, p]) => `<button type="button" class="tab ${k === tab ? 'active' : ''}" data-tab="${k}">${p.label} <span class="plan">(${p.plan})</span>${isConfigured(settings, k) ? `<span class="ok" title="Connected">${ICONS.check}</span>` : ''}</button>`)
        .join('')}</div>
      <div class="panes">${Object.keys(PROVIDERS).map(providerPane).join('')}</div>
      </section>

      <h3>${ICONS.shield}Agent</h3>
      <section class="set-card">
      <label class="field row"><span>Permissions</span>
        <select data-g="permission">${Object.entries(PERMISSIONS).map(([v, l]) => `<option value="${v}" ${settings.permission === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field row"><span>Messages sent while it works</span>
        <select data-g="followUp"><option value="steer" ${settings.followUp !== 'queue' ? 'selected' : ''}>Steer</option><option value="queue" ${settings.followUp === 'queue' ? 'selected' : ''}>Queue</option></select></label>
      <label class="field row"><span>Computer use</span>
        <input type="checkbox" class="switch" data-g="computerUse" ${settings.computerUse ? 'checked' : ''}></label>
      <label class="field row"><span>Use the provider's built-in web search</span>
        <input type="checkbox" class="switch" data-g="nativeSearch" ${settings.nativeSearch ? 'checked' : ''}></label>
      <label class="field row"><span>Bookmarks<small>Search and add bookmarks</small></span>
        <input type="checkbox" class="switch" data-x="bookmarks" ${settings.extras?.bookmarks && chrome.bookmarks ? 'checked' : ''}></label>
      <label class="field row"><span>Recently closed tabs<small>Find and reopen closed tabs</small></span>
        <input type="checkbox" class="switch" data-x="sessions" ${settings.extras?.sessions && chrome.sessions ? 'checked' : ''}></label>
      </section>

      <h3>${ICONS.memory}Memory</h3>
      <section class="set-card">
      <label class="field row"><span>Memory</span>
        <input type="checkbox" class="switch" data-m="enabled" ${settings.memory.enabled ? 'checked' : ''}></label>
      <label class="field row"><span>Use browsing history</span>
        <input type="checkbox" class="switch" data-m="history" ${settings.memory.history ? 'checked' : ''}></label>
      <label class="field row"><span>Keep task memories</span>
        <select data-m="retention">${[['never', 'Never forget'], ['30d', '30 days'], ['90d', '90 days']]
          .map(([v, l]) => `<option value="${v}" ${settings.memory.retention === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="field row"><span>Remember pages it reads<small id="readsCount">So it can find them again in later chats</small></span>
        <span class="row-ctl"><button type="button" class="btn small" data-clearreads>Clear</button>
        <input type="checkbox" class="switch" data-m="reads" ${settings.memory.reads !== false ? 'checked' : ''}></span></div>
      <div class="mem-list" id="memList"></div>
      <div class="key-row mem-add"><input id="memNew" placeholder="Add a memory" autocomplete="off">
        <button type="button" class="btn small" data-memadd>Add</button>
        <button type="button" class="btn small" data-memtidy title="Merge duplicates and drop outdated memories">${ICONS.broom}<span>Tidy up</span></button></div>
      </section>

      <h3>${ICONS.display}Appearance and data</h3>
      <section class="set-card">
      <label class="field row"><span>Theme</span>
        <select data-g="theme">${[['system', 'Match the system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}" ${settings.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="field row"><span>Chat history</span>
        <button type="button" class="btn danger small" data-clear>Delete all chats</button></div>
      </section>
    </div>
  </div>`;
  m.hidden = false;
  showPane(tab);
  renderMemories();
  getReads().then((list) => {
    const el = $('#readsCount');
    if (el && list.length) el.textContent = `${list.length} page${list.length === 1 ? '' : 's'} remembered`;
  }).catch(() => {});
  // Fill in model lists for connected accounts that have no list yet.
  for (const k of Object.keys(PROVIDERS)) {
    const c = settings.providers[k];
    if (hasCredentials(c) && modelsStale(k, c)) loadModels(k);
  }
}

function openRoutines() {
  const m = $('#settingsModal');
  m.innerHTML = `<div class="dialog" role="dialog" aria-label="Routines">
    <div class="dlg-head"><h2>Routines</h2><button class="icon-btn" data-close title="Close">${ICONS.x}</button></div>
    <div class="dlg-body">
      <section class="set-card r-card">
      <div class="routine-list" id="routineList"></div>
      <div id="routineForm"></div>
      <button type="button" class="btn small r-new" data-rnew>${ICONS.plus}<span>New routine</span></button>
      </section>
    </div>
  </div>`;
  m.hidden = false;
  renderRoutines();
}

function refreshTabDots() {
  $$('#settingsModal .tab').forEach((t) => {
    const on = isConfigured(settings, t.dataset.tab);
    const dot = $('.ok', t);
    if (on && !dot) t.insertAdjacentHTML('beforeend', `<span class="ok" title="Connected">${ICONS.check}</span>`);
    if (!on && dot) dot.remove();
  });
}

async function signIn(pane) {
  const key = pane.dataset.pane;
  const cfg = settings.providers[key];
  const btn = $('[data-signin]', pane);
  const status = (cls, text) => { const s = $('[data-status]', pane); if (s) { s.className = `status ${cls}`; s.textContent = text; } };
  if (btn) btn.disabled = true;
  status('', `Finish signing in to ${PROVIDERS[key].label} in the new tab`);
  try {
    cfg.oauth = await connectChatGPT();
    cfg.models = [];
    cfg.efforts = {};
    await saveSettings(settings);
    toast(`Signed in to ${PROVIDERS[key].label}${cfg.oauth.label ? ` as ${cfg.oauth.label}` : ''}.`);
    if (!$('#settingsModal').hidden) openSettings(key); // redraws the pane and loads the models
    else loadModels(key);
  } catch (err) {
    status('bad', err.message || 'Sign-in failed.');
    if (btn) btn.disabled = false;
  }
}

async function signOut(pane) {
  const key = pane.dataset.pane;
  const cfg = settings.providers[key];
  cfg.oauth = null;
  cfg.models = [];
  cfg.efforts = {};
  cfg.model = '';
  await saveSettings(settings);
  renderModelPill();
  toast(`Signed out of ${PROVIDERS[key].label}.`);
  openSettings(key);
}

function modelsStale(key, cfg) {
  const list = cfg.models || [];
  return !list.length || !cfg.efforts || !list.every((m) => modelAllowed(key, m)) || !modelAllowed(key, cfg.model);
}

// Load the provider's model list (runs automatically when a key is entered).
const loadSeq = {};
async function loadModels(key) {
  const cfg = settings.providers[key];
  const pane = () => $(`#settingsModal .pane[data-pane="${key}"]`);
  const setStatus = (cls, text) => {
    const s = pane() && $('[data-status]', pane());
    if (s) { s.className = `status ${cls}`; s.textContent = text; }
  };
  if (!hasCredentials(cfg)) { setStatus('', ''); return false; }
  const seq = (loadSeq[key] = (loadSeq[key] || 0) + 1);
  setStatus('', 'Loading models');
  let ok = false;
  try {
    const models = await listModels(key, cfg);
    if (seq !== loadSeq[key]) return false; // a newer load (newer key) won
    cfg.models = models;
    if (!models.includes(cfg.model)) cfg.model = ''; // never pick one for the user
    setStatus('good', `Connected, ${models.length} models`);
    // First connected account: start using it right away.
    if (!hasCredentials(settings.providers[settings.provider])) settings.provider = key;
    ok = true;
  } catch (err) {
    if (seq !== loadSeq[key]) return false;
    setStatus('bad', err.message);
  }
  await saveSettings(settings);
  const p = pane();
  if (p) {
    $('[data-f="model"]', p).innerHTML = modelOptions(cfg);
    refreshTabDots();
  }
  renderModelPill();
  return ok;
}

// ---- Memory (Settings) ----

async function renderMemories() {
  const el = $('#memList');
  if (!el) return;
  const list = (await getMemories(settings)).sort((a, b) => (b.updated || b.created) - (a.updated || a.created));
  el.innerHTML = list
    .map((m) => `<div class="mem-item" data-mid="${esc(m.id)}">
      <span class="mem-kind">${m.kind === 'episodic' ? 'Task' : 'Fact'}</span>
      <input class="mem-text" value="${esc(m.text)}" spellcheck="false">
      <button type="button" class="icon-btn" data-memdel="${esc(m.id)}" title="Forget">${ICONS.trash}</button></div>`)
    .join('');
}

async function updateMemories(fn) {
  await saveMemories(fn(await getMemories(settings)));
  renderMemories();
}

const TIDY_SYSTEM = `You clean up the saved memories of a personal browsing assistant. You get them as a JSON array of {id, kind, text}.
Return only a JSON array of the memories to keep, as {id, kind, text}:
- Merge duplicates and near duplicates into one memory (keep the id of one of them).
- When two memories conflict, keep the newer-sounding or more specific one.
- Drop memories that are clearly outdated, trivial or empty. Keep anything that could still matter.
- Keep each text short, factual and in the same language it was written in. Do not invent anything.
- kind stays "core" for lasting facts about the user and "episodic" for notes about past tasks.
Reply with the JSON array only, no other text.`;

async function tidyMemories(btn) {
  const list = await getMemories(settings);
  if (list.length < 3) return toast('Nothing to tidy yet.');
  if (!isConfigured(settings)) return toast('Connect a model first.');
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Tidying…';
  try {
    const out = await complete({
      settings,
      system: TIDY_SYSTEM,
      prompt: JSON.stringify(list.map((m) => ({ id: m.id, kind: m.kind, text: m.text }))),
    });
    let parsed = null;
    try { parsed = JSON.parse(String(out).match(/\[[\s\S]*\]/)?.[0] || ''); } catch {}
    if (!Array.isArray(parsed)) throw new Error('the model did not return a list.');
    const byId = Object.fromEntries(list.map((m) => [m.id, m]));
    const now = Date.now();
    const used = new Set();
    const next = parsed
      .filter((x) => x && typeof x.text === 'string' && x.text.trim())
      .slice(0, 400)
      .map((x) => {
        const old = byId[x.id] && !used.has(x.id) ? byId[x.id] : null;
        if (old) used.add(old.id);
        const text = x.text.trim().slice(0, 600);
        return {
          ...(old || {}), id: old ? old.id : 'm' + uid(), kind: x.kind === 'episodic' ? 'episodic' : 'core', text,
          created: old?.created || now, updated: old && old.text === text ? old.updated || now : now,
        };
      });
    if (!next.length) throw new Error('the model returned an empty list.');
    if (!confirm(`Tidy up memories: ${list.length} now, ${next.length} after merging duplicates and dropping outdated ones. Apply?`)) return;
    await saveMemories(next);
    renderMemories();
    toast(`Memories tidied: ${list.length} → ${next.length}.`);
  } catch (err) {
    toast('Could not tidy memories: ' + (err.message || err));
  } finally {
    btn.disabled = false;
    btn.innerHTML = label;
  }
}

// ---- Routines ----

const fmtWhen = (ts) => new Date(ts).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function renderRoutines() {
  const el = $('#routineList');
  if (!el) return;
  const list = Object.values(await getRoutines()).sort((a, b) => a.created - b.created);
  if (!list.length) {
    el.innerHTML = '<p class="r-empty">No routines yet. Add one here, or ask in a chat to do something on a schedule.</p>';
    return;
  }
  el.innerHTML = list
    .map((r) => `<div class="routine ${r.active ? '' : 'paused'}" data-rid="${esc(r.id)}">
      <div class="r-head">
        <div class="r-main"><span class="r-name">${esc(r.name)}</span>
          <span class="r-sched">${esc(describeSchedule(r.schedule))}${r.kind === 'heartbeat' ? ', same chat' : ''}. ${r.active ? (r.nextRun ? `Next ${esc(fmtWhen(r.nextRun))}` : 'Scheduled') : 'Paused'}</span></div>
        <div class="r-btns">
          <button type="button" class="icon-btn" data-rrun title="Run now">${ICONS.play}</button>
          <button type="button" class="icon-btn" data-rtoggle title="${r.active ? 'Pause' : 'Resume'}">${r.active ? ICONS.pause : ICONS.retry}</button>
          <button type="button" class="icon-btn" data-redit title="Edit">${ICONS.compose}</button>
          <button type="button" class="icon-btn" data-rdel title="Delete">${ICONS.trash}</button>
        </div>
      </div>
      ${r.runs?.length ? `<div class="r-runs">${r.runs.slice(0, 5)
        .map((x) => `<button type="button" class="r-run s-${esc(String(x.status).replace(/\s+/g, '-'))}" ${x.chatId ? `data-rchat="${esc(x.chatId)}"` : 'disabled'} title="${esc(x.note || '')}">${esc(String(x.status)[0].toUpperCase() + String(x.status).slice(1))} ${esc(fmtWhen(x.ts))}</button>`)
        .join('')}</div>` : ''}
    </div>`)
    .join('');
}

const localInput = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function routineForm(r) {
  const s = normalizeSchedule(r?.schedule || { type: 'daily', time: '09:00' });
  const opt = (v, l, cur) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`;
  const at = localInput(s.type === 'once' && s.at ? s.at : Date.now() + 3600000);
  return `<div class="routine-form" data-rform="${esc(r?.id || '')}">
    <label class="field"><span>Name</span><input data-r="name" value="${esc(r?.name || '')}" autocomplete="off"></label>
    <label class="field"><span>Instructions</span><textarea data-r="instructions" rows="3">${esc(r?.instructions || '')}</textarea></label>
    <div class="field"><span>Schedule</span>
      <div class="key-row r-sched-row">
        <select data-r="type">${opt('interval', 'Every', s.type)}${opt('daily', 'Daily', s.type)}${opt('weekdays', 'Weekdays', s.type)}${opt('weekly', 'Weekly', s.type)}${opt('once', 'Once', s.type)}</select>
        <select data-r="day" ${s.type === 'weekly' ? '' : 'hidden'}>${DAYS.map((d, i) => opt(i, d, s.day ?? 1)).join('')}</select>
        <input data-r="time" type="time" value="${s.time || '09:00'}" ${s.type === 'interval' || s.type === 'once' ? 'hidden' : ''}>
        <input data-r="at" type="datetime-local" value="${at}" ${s.type === 'once' ? '' : 'hidden'}>
        <select data-r="minutes" ${s.type === 'interval' ? '' : 'hidden'}>${[[15, '15 minutes'], [30, '30 minutes'], [60, 'hour'], [120, '2 hours'], [180, '3 hours'], [360, '6 hours'], [720, '12 hours']]
          .map(([v, l]) => opt(v, l, s.minutes || 60)).join('')}</select>
      </div>
    </div>
    <div class="pane-actions"><button type="button" class="btn primary small" data-rsave>Save</button><button type="button" class="btn small" data-rcancel>Cancel</button><span class="status" data-rstatus></span></div>
  </div>`;
}

async function saveRoutineForm(form) {
  const v = (k) => $(`[data-r="${k}"]`, form).value.trim();
  const name = v('name');
  const instructions = v('instructions');
  if (!name || !instructions) {
    const s = $('[data-rstatus]', form);
    s.className = 'status bad';
    s.textContent = 'Add a name and instructions.';
    return;
  }
  const atTs = new Date(v('at')).getTime();
  const schedule = normalizeSchedule({ type: v('type'), time: v('time'), day: v('day'), minutes: v('minutes'), at: Number.isFinite(atTs) ? atTs : undefined });
  const existing = form.dataset.rform ? (await getRoutines())[form.dataset.rform] : null;
  const r = existing
    ? { ...existing, name, instructions, schedule, ...(schedule.type === 'once' ? { active: true } : {}), nextRun: existing.active || schedule.type === 'once' ? nextRunTime(schedule) : existing.nextRun }
    : { id: 'r' + uid(), name, instructions, kind: 'cron', schedule, active: true, created: Date.now(), nextRun: nextRunTime(schedule), runs: [] };
  await saveRoutine(r);
  $('#routineForm').innerHTML = '';
  renderRoutines();
}

function showPane(key) {
  $$('#settingsModal .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === key));
  $$('#settingsModal .pane').forEach((p) => (p.hidden = p.dataset.pane !== key));
}

const loadTimers = {};

function bindSettings() {
  const m = $('#settingsModal');
  m.addEventListener('click', async (e) => {
    if (e.target === m || e.target.closest('[data-close]')) { m.hidden = true; renderModelPill(); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) return showPane(tab.dataset.tab);

    // Memory
    if (e.target.closest('[data-memadd]')) {
      const inp = $('#memNew');
      const text = inp.value.trim();
      if (!text) return;
      inp.value = '';
      return updateMemories((l) => [...l, { id: 'm' + uid(), text, kind: 'core', created: Date.now(), updated: Date.now() }]);
    }
    const memDel = e.target.closest('[data-memdel]');
    if (memDel) return updateMemories((l) => l.filter((x) => x.id !== memDel.dataset.memdel));
    const tidy = e.target.closest('[data-memtidy]');
    if (tidy) return tidyMemories(tidy);
    if (e.target.closest('[data-clearreads]')) {
      if (!confirm('Forget the pages Rold has read? This cannot be undone.')) return;
      await clearReads();
      const el = $('#readsCount');
      if (el) el.textContent = 'So it can find them again in later chats';
      return toast('Past reads cleared.');
    }

    // Routines
    if (e.target.closest('[data-rnew]')) {
      $('#routineForm').innerHTML = routineForm(null);
      return $('#routineForm [data-r="name"]').focus();
    }
    if (e.target.closest('[data-rcancel]')) { $('#routineForm').innerHTML = ''; return; }
    if (e.target.closest('[data-rsave]')) return saveRoutineForm(e.target.closest('.routine-form'));
    const rchat = e.target.closest('[data-rchat]');
    if (rchat) {
      chats = await getChats();
      if (!chats[rchat.dataset.rchat]) return toast('That chat was deleted.');
      m.hidden = true;
      renderModelPill();
      return openChat(rchat.dataset.rchat);
    }
    const rEl = e.target.closest('[data-rid]');
    if (rEl) {
      const id = rEl.dataset.rid;
      const r = (await getRoutines())[id];
      if (!r) return renderRoutines();
      if (e.target.closest('[data-rrun]')) {
        const res = await chrome.runtime.sendMessage({ type: 'runRoutine', id }).catch((err) => ({ ok: false, error: err.message }));
        toast(res?.ok ? `Running “${r.name}”` : res?.error || 'Could not start the routine.');
        return renderRoutines();
      }
      if (e.target.closest('[data-rtoggle]')) {
        await saveRoutine({ ...r, active: !r.active, nextRun: !r.active ? nextRunTime(r.schedule) : r.nextRun });
        return renderRoutines();
      }
      if (e.target.closest('[data-redit]')) { $('#routineForm').innerHTML = routineForm(r); return; }
      if (e.target.closest('[data-rdel]')) {
        if (!confirm(`Delete the routine “${r.name}”?`)) return;
        await deleteRoutine(id);
        return renderRoutines();
      }
    }

    const pane = e.target.closest('.pane');
    if (e.target.closest('[data-showkey]')) {
      const inp = $('[data-f="apiKey"]', pane);
      inp.type = inp.type === 'password' ? 'text' : 'password';
      e.target.closest('[data-showkey]').textContent = inp.type === 'password' ? 'Show' : 'Hide';
      return;
    }
    if (e.target.closest('[data-loadmodels]')) return loadModels(pane.dataset.pane);
    if (e.target.closest('[data-signin]')) return signIn(pane);
    if (e.target.closest('[data-signout]')) return signOut(pane);
    if (e.target.closest('[data-use]')) {
      const key = pane.dataset.pane;
      const cfg = settings.providers[key];
      if (!isConfigured(settings, key)) {
        const s = $('[data-status]', pane);
        s.className = 'status bad';
        s.textContent = hasCredentials(cfg) ? 'Choose a model first.' : PROVIDERS[key].oauth ? 'Sign in first.' : 'Add your API key first.';
        return;
      }
      settings.provider = key;
      renderModelPill();
      toast(`Using ${cfg.model} on ${PROVIDERS[key].label}`);
      return saveSettings(settings);
    }
    if (e.target.closest('[data-clear]')) {
      if (!confirm('Delete all chats? This cannot be undone.')) return;
      runs.forEach((r) => r.controller.abort());
      for (const k in queues) delete queues[k];
      await clearChats();
      chats = {};
      newChat();
      toast('All chats deleted.');
    }
  });

  // Memory edits save when the field loses focus.
  m.addEventListener('change', (e) => {
    const t = e.target.closest('.mem-text');
    if (!t) return;
    const id = t.closest('[data-mid]').dataset.mid;
    const text = t.value.trim();
    updateMemories((l) => (text ? l.map((x) => (x.id === id ? { ...x, text, updated: Date.now() } : x)) : l.filter((x) => x.id !== id)));
  });

  m.addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    const g = e.target.dataset.g;
    const mk = e.target.dataset.m;
    if (e.target.dataset.r === 'type') {
      const form = e.target.closest('.routine-form');
      const type = e.target.value;
      $('[data-r="day"]', form).hidden = type !== 'weekly';
      $('[data-r="time"]', form).hidden = type === 'interval' || type === 'once';
      $('[data-r="minutes"]', form).hidden = type !== 'interval';
      $('[data-r="at"]', form).hidden = type !== 'once';
      return;
    }
    const xk = e.target.dataset.x;
    if (xk) {
      // Bookmarks and recently closed tabs are optional permissions, asked for on this click.
      const on = e.target.checked;
      const perm = { permissions: [xk] };
      (on ? chrome.permissions.request(perm) : chrome.permissions.remove(perm).then(() => false))
        .then((granted) => {
          settings.extras = { ...settings.extras, [xk]: !!granted };
          e.target.checked = !!granted;
          saveSettings(settings);
          if (on && !granted) toast('Edge did not grant that permission.');
        }, (err) => { e.target.checked = false; toast(err.message); });
      return;
    }
    if (mk) {
      const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      settings.memory = { ...settings.memory, [mk]: val };
      if (mk === 'history' && val) {
        // Browsing history is an optional permission: ask Edge for it now (needs this click).
        chrome.permissions.request({ permissions: ['history'] }).then((granted) => {
          if (granted) return;
          settings.memory = { ...settings.memory, history: false };
          e.target.checked = false;
          saveSettings(settings);
        }, () => {});
      }
      if (mk === 'retention') getMemories(settings).then(renderMemories);
      saveSettings(settings);
      return;
    }
    if (f) {
      const key = e.target.closest('.pane').dataset.pane;
      settings.providers[key][f] = e.target.value.trim();
      if (f === 'apiKey') {
        // Auto-load the model list shortly after a key is typed or pasted.
        clearTimeout(loadTimers[key]);
        loadTimers[key] = setTimeout(() => loadModels(key), 600);
      }
      refreshTabDots();
    } else if (g) {
      settings[g] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (g === 'theme') applyTheme();
    } else return;
    saveSettings(settings);
    renderModelPill();
  });
}

// ---------------------------------------------------------------------------
// Events

function bind() {
  $('#topTitle').addEventListener('click', editTitle);
  const input = $('#input');
  input.addEventListener('input', () => { autosize(); updateSendBtn(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing && !chat?.messages?.length) {
      e.preventDefault();
      setInputMode(inputMode === 'chat' ? 'search' : 'chat');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      // While working, Enter on an empty box does nothing (the button stops the task).
      if (controller && !input.value.trim()) return;
      $('#composer').requestSubmit();
    }
  });
  $('#modeSwitch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-im]');
    if (b) { setInputMode(b.dataset.im); input.focus(); }
  });
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (inputMode === 'search' && text) return webSearch(text);
    if (controller) {
      if (text) followUp(text);
      else controller.abort();
    } else send(input.value);
  });
  $('#pauseBtn').addEventListener('click', () => {
    if (run?.paused) resumeRun();
    else pauseRun('You have control of the browser. The agent waits until you resume.');
  });
  $('#queueRow').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unqueue]');
    if (!b) return;
    queue.splice(+b.dataset.unqueue, 1);
    renderQueue();
  });
  // Closing or leaving this page would stop the tasks running in it.
  window.addEventListener('beforeunload', (e) => {
    if (runs.size) { e.preventDefault(); e.returnValue = ''; }
  });

  // Attachments: paperclip, paste and drop.
  $('#attachBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; input.focus(); });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  });
  const composer = $('#composer');
  composer.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    composer.classList.add('dropping');
  });
  composer.addEventListener('dragleave', (e) => { if (!composer.contains(e.relatedTarget)) composer.classList.remove('dropping'); });
  composer.addEventListener('drop', (e) => {
    composer.classList.remove('dropping');
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  });
  $('#attachRow').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unattach]');
    if (!b) return;
    attachments.splice(+b.dataset.unattach, 1);
    renderAttachments();
  });

  // Answers to the agent's questions.
  $('#thread').addEventListener('input', (e) => {
    if (e.target.matches('.ask-text') && run?.ask) run.ask.draft = e.target.value;
  });
  $('#thread').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || !e.target.matches('.ask-text')) return;
    e.preventDefault();
    const v = e.target.value.trim();
    if (v && run?.ask) run.ask.done(v);
  });

  $('#thread').addEventListener('click', (e) => {
    const cv = e.target.closest('.confirm-card [data-v]');
    if (cv) { run?.confirm?.done(cv.dataset.v === '1'); return; }
    if (run?.ask) {
      const opt = e.target.closest('[data-ask-opt]');
      if (opt) return run.ask.done(run.ask.options[+opt.dataset.askOpt]);
      if (e.target.closest('[data-ask-send]')) {
        const v = $('.ask-card .ask-text')?.value.trim();
        if (v) run.ask.done(v);
        return;
      }
      if (e.target.closest('[data-ask-skip]')) return run.ask.done(null);
    }
    const copyDraft = e.target.closest('.copy-draft');
    if (copyDraft) {
      navigator.clipboard.writeText($('.draft-text', copyDraft.closest('.draft')).value);
      copyDraft.textContent = 'Copied';
      setTimeout(() => (copyDraft.textContent = 'Copy'), 1200);
      return;
    }
    const shot = e.target.closest('.shot');
    if (shot) {
      // Data URLs can't open as a page, so the screenshot opens as a blob.
      fetch($('img', shot).src).then((r) => r.blob()).then((b) => window.open(URL.createObjectURL(b), '_blank')).catch(() => {});
      return;
    }
    const copyCode = e.target.closest('.copy-code');
    if (copyCode) {
      navigator.clipboard.writeText($('code', copyCode.parentElement).textContent);
      copyCode.textContent = 'Copied';
      setTimeout(() => (copyCode.textContent = 'Copy'), 1200);
      return;
    }
    const act = e.target.closest('.act');
    if (!act) return;
    const idx = +act.closest('.msg').dataset.idx;
    if (act.dataset.act === 'resume') return resumeRun();
    if (act.dataset.act === 'copy') {
      navigator.clipboard.writeText(chat.messages[idx].text);
      toast('Copied');
    } else if (act.dataset.act === 'retry') regenerate();
  });
  $('#thread').addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.matches?.('details.activity')) return;
    const idx = +d.closest('.msg').dataset.idx;
    const m = chat?.messages[idx];
    if (m && m.status !== 'running') m.showSteps = d.open;
  }, true);

  $('#chatList').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const id = del.dataset.del;
      runs.get(id)?.controller.abort();
      delete queues[id];
      await deleteChat(id);
      delete chats[id];
      if (chat?.id === id) newChat();
      else renderChatList();
      return;
    }
    const item = e.target.closest('.cl-item');
    if (item) openChat(item.dataset.id);
  });

  $('#newChat').addEventListener('click', newChat);
  $('#searchChats').addEventListener('click', () => {
    const row = $('#searchRow');
    row.hidden = !row.hidden;
    $('#searchChats').hidden = !row.hidden;
    if (!row.hidden) $('#chatSearch').focus();
  });
  $('#chatSearch').addEventListener('input', (e) => { chatFilter = e.target.value; renderChatList(); });
  $('#chatSearch').addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    chatFilter = e.target.value = '';
    $('#searchRow').hidden = true;
    $('#searchChats').hidden = false;
    renderChatList();
  });
  $('#chatSearch').addEventListener('blur', (e) => {
    if (e.target.value) return;
    $('#searchRow').hidden = true;
    $('#searchChats').hidden = false;
  });
  $('#openRoutines').addEventListener('click', () => {
    openRoutines();
    closeSidebarOverlay();
  });
  $('#openSettings').addEventListener('click', () => openSettings());
  $('#collapseSidebar').addEventListener('click', () => {
    $('.app').classList.add('sidebar-collapsed');
    $('.app').classList.remove('sidebar-open');
    try { localStorage.setItem('rold.sidebar', 'collapsed'); } catch {}
  });
  $('#showSidebar').addEventListener('click', () => {
    const app = $('.app');
    if (MODE === 'side' || window.innerWidth < 860) app.classList.toggle('sidebar-open');
    else {
      app.classList.remove('sidebar-collapsed');
      try { localStorage.setItem('rold.sidebar', 'open'); } catch {}
    }
  });
  $('#scrim').addEventListener('click', closeSidebarOverlay);

  $('#scroller').addEventListener('scroll', (e) => {
    $('.main').classList.toggle('scrolled', e.target.scrollTop > 4);
  }, { passive: true });
  $('#modelPill').addEventListener('click', (e) => { e.stopPropagation(); toggleModelMenu(); });
  $('#modelMenu').addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('[data-provider]');
    if (item) {
      const key = item.dataset.provider;
      if (!hasCredentials(settings.providers[key])) { toggleModelMenu(false); return openSettings(key); }
      settings.provider = key;
      saveSettings(settings);
      renderModelPill();
      renderModelMenu();
      return;
    }
    if (e.target.closest('#mmManage')) { toggleModelMenu(false); openSettings(); }
  });
  $('#modelMenu').addEventListener('change', (e) => {
    if (e.target.id !== 'mmModel') return;
    settings.providers[settings.provider].model = e.target.value.trim();
    saveSettings(settings);
    renderModelPill();
    renderModelMenu();
  });
  $('#effortPill').addEventListener('click', (e) => { e.stopPropagation(); toggleEffortMenu(); });
  $('#effortMenu').addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('[data-effort]');
    if (!item) return;
    const k = effortKey(settings.provider, settings.providers[settings.provider].model);
    settings.effortByModel = { ...settings.effortByModel };
    if (item.dataset.effort === 'default') delete settings.effortByModel[k];
    else settings.effortByModel[k] = item.dataset.effort;
    saveSettings(settings);
    renderEffortPill();
    toggleEffortMenu(false);
  });
  $('#permPill').addEventListener('click', (e) => { e.stopPropagation(); togglePermMenu(); });
  $('#permMenu').addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('[data-perm]');
    if (!item) return;
    settings.permission = item.dataset.perm;
    saveSettings(settings);
    renderPermPill();
    togglePermMenu(false);
  });
  document.addEventListener('click', () => closeMenus());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#settingsModal').hidden) { $('#settingsModal').hidden = true; renderModelPill(); }
      else if (MENUS.some((id) => !$('#' + id).hidden)) closeMenus();
      else if (controller) controller.abort();
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); newChat(); }
  });

  $('#ctxRow').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ctx]');
    if (b) { includePage = b.dataset.ctx === 'add'; refreshPageInfo(); }
  });

  bindSettings();

  if (MODE === 'side') {
    chrome.tabs.onActivated.addListener(refreshPageInfo);
    chrome.tabs.onUpdated.addListener((id, info) => { if (info.title || info.status === 'complete') refreshPageInfo(); });
    chrome.windows.onFocusChanged.addListener(refreshPageInfo);
    chrome.storage.session.onChanged.addListener((changes) => { if (changes.pendingPrompt?.newValue) consumePending(); });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings?.newValue && !runs.size && $('#settingsModal').hidden) {
      getSettings().then((s) => { settings = s; applyTheme(); renderModelPill(); });
    }
    if (changes.chats && !runs.size) {
      getChats().then((c) => { chats = c; if (chat && c[chat.id] && chat.updated < c[chat.id].updated) { chat = c[chat.id]; renderThread(); } renderChatList(); });
    }
    if (changes.routines && !$('#settingsModal').hidden) renderRoutines();
    if (changes.memories && !$('#settingsModal').hidden && !document.activeElement?.matches('.mem-text')) renderMemories();
  });
}

async function consumePending() {
  const { pendingPrompt } = await chrome.storage.session.get('pendingPrompt');
  if (!pendingPrompt || Date.now() - pendingPrompt.ts > 60000) return;
  await chrome.storage.session.remove('pendingPrompt');
  newChat();
  send(pendingPrompt.text);
}

// ---------------------------------------------------------------------------

async function init() {
  shell();
  settings = await getSettings();
  chats = await getChats();
  applyTheme();
  try {
    if ((localStorage.getItem('rold.sidebar') ?? localStorage.getItem('rold-harness.sidebar')) === 'collapsed' || MODE === 'side') $('.app').classList.add('sidebar-collapsed');
  } catch {}
  tickClock();
  setInterval(tickClock, 15000);
  renderModelPill();
  renderChatList();
  renderThread();
  bind();
  // Routine notifications open newtab.html#chat=<id>.
  const fromHash = /^#chat=(.+)$/.exec(location.hash);
  if (fromHash && chats[fromHash[1]]) openChat(fromHash[1]);
  await refreshPageInfo();
  if (MODE === 'side') consumePending();
  // Refresh model lists saved before effort info existed, quietly in the background.
  for (const k of Object.keys(PROVIDERS)) {
    const c = settings.providers[k];
    if (hasCredentials(c) && modelsStale(k, c)) loadModels(k);
  }
  if (!Object.keys(PROVIDERS).some((k) => hasCredentials(settings.providers[k]))) {
    setTimeout(() => openSettings('opencode'), 300);
  }
  $('#input').focus();
}

init();
