// Agent tools: web search, page reading, tab control, memory, history and routines.
// Every tool returns { content: string, sources?: [{title,url}], detail?: string }.

import { getMemories, saveMemories, saveRoutine } from './storage.js';
import { normalizeSchedule, nextRunTime, describeSchedule } from './routines.js';

const MAX_TEXT = 15000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXT_ORIGIN = chrome.runtime.getURL('');
const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Tabs the agent opens live in their own tab group, which the user can take over at any time.
export const AGENT_GROUP = 'RolConnect';
export async function addToAgentGroup(tabId, ctx) {
  ctx?.run?.agentTabs?.add(tabId);
  if (!chrome.tabs.group || !chrome.tabGroups) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    const [g] = await chrome.tabGroups.query({ windowId: tab.windowId, title: AGENT_GROUP });
    if (g) await chrome.tabs.group({ groupId: g.id, tabIds: [tabId] });
    else {
      const id = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: tab.windowId } });
      await chrome.tabGroups.update(id, { title: AGENT_GROUP, color: 'purple' });
    }
  } catch {}
}

async function openAgentTab(url, ctx, active = false) {
  if (active && ctx?.run) ctx.run.lastAgentFocus = Date.now();
  const tab = await chrome.tabs.create({ url, active });
  await addToAgentGroup(tab.id, ctx);
  return tab;
}

// Crucial actions wait for the user's approval in Guard mode (send, pay, delete, submit…).
const CRUCIAL = /\b(send|submit|post|publish|tweet|reply|comment|pay|buy|purchase|order|checkout|check out|confirm|delete|remove|unsubscribe|transfer|book|reserve|donate|sign up|subscribe|save|apply|enviar|publicar|responder|comentar|pagar|comprar|pedir|confirmar|eliminar|borrar|quitar|suscribir|reservar|guardar|aplicar|donar)\b/i;

async function approve(ctx, text, crucial) {
  if (!crucial || ctx.permission === 'full') return true;
  return ctx.confirm(text);
}

const CONSEQUENTIAL = {
  type: 'boolean',
  description: 'true if this sends, posts, pays, buys, books, deletes, submits a form or changes settings.',
};

// ---------------------------------------------------------------------------
// Injected / shared page functions (must be self-contained: they are serialized
// by chrome.scripting.executeScript).

function readPage(maxLen, docArg) {
  const doc = docArg || document;
  const live = !docArg;
  const title = (doc.title || '').trim();
  const url = live ? location.href : '';
  const main = doc.querySelector('article, main, [role="main"]');
  const root = main && (main.textContent || '').trim().length > 400 ? main : doc.body;
  if (!root) return { title, url, text: '' };
  let text;
  if (live && root.innerText) {
    text = root.innerText;
  } else {
    const clone = root.cloneNode(true);
    clone
      .querySelectorAll('script,style,noscript,svg,canvas,iframe,template,nav,footer,aside,form,[aria-hidden="true"],[hidden]')
      .forEach((e) => e.remove());
    const BLOCK = /^(P|DIV|SECTION|ARTICLE|LI|UL|OL|TR|TABLE|PRE|BLOCKQUOTE|BR|HR|DT|DD|DL|FIGCAPTION|FIGURE|HEADER|MAIN|H[1-6])$/;
    const parts = [];
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) parts.push(c.nodeValue);
        else if (c.nodeType === 1) {
          const tag = c.tagName;
          if (/^H[1-6]$/.test(tag)) parts.push('\n\n' + '#'.repeat(+tag[1]) + ' ');
          else if (tag === 'LI') parts.push('\n- ');
          else if (BLOCK.test(tag)) parts.push('\n');
          walk(c);
          if (BLOCK.test(tag)) parts.push('\n');
        }
      }
    })(clone);
    text = parts.join('');
  }
  text = text
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const total = text.length;
  if (total > maxLen) text = text.slice(0, maxLen) + `\n\n…[truncated — ${total} characters total]`;
  return { title, url, text };
}

function collectElements(limit) {
  const sel = [
    'a[href]', 'button', 'input:not([type=hidden])', 'textarea', 'select', 'summary',
    '[role=button]', '[role=link]', '[role=tab]', '[role=menuitem]', '[role=checkbox]',
    '[role=option]', '[role=textbox]', '[role=combobox]', '[contenteditable="true"]',
  ].join(',');
  document.querySelectorAll('[data-rolconnect-id]').forEach((e) => e.removeAttribute('data-rolconnect-id'));
  const out = [];
  let id = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none' || el.disabled) continue;
    const raw =
      el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') ||
      el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('name') || '';
    const label = String(raw).trim().replace(/\s+/g, ' ').slice(0, 80);
    const tag = el.tagName.toLowerCase();
    const type = tag === 'input' ? el.type : '';
    id++;
    el.setAttribute('data-rolconnect-id', String(id));
    const inView = r.bottom > 0 && r.top < innerHeight;
    let line = `[${id}] ${tag}${type ? `(${type})` : ''} "${label}"`;
    if (tag === 'a' && el.href) line += ` -> ${el.href.slice(0, 120)}`;
    if (!inView) line += ' (offscreen)';
    out.push(line);
    if (out.length >= limit) break;
  }
  return { title: document.title, url: location.href, elements: out };
}

// id == null describes the focused element.
function describeElement(id) {
  const el = id == null ? document.activeElement : document.querySelector(`[data-rolconnect-id="${id}"]`);
  if (!el || el === document.body) return null;
  const raw = el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('name') || '';
  const isSearch = (e) =>
    !!e && (e.type === 'search' || e.getAttribute('role') === 'searchbox' ||
      /search|buscar|query|^q$/i.test(`${e.name || ''} ${e.getAttribute('placeholder') || ''} ${e.getAttribute('aria-label') || ''}`));
  const form = el.form || el.closest('form');
  return {
    tag: el.tagName.toLowerCase(),
    type: el.type || '',
    label: String(raw).trim().replace(/\s+/g, ' ').slice(0, 80),
    password: el.type === 'password' || /cc-|one-time-code/.test(el.autocomplete || '') || /card|cvc|cvv/i.test(el.name || ''),
    submit: (el.tagName === 'BUTTON' && !!form && (el.getAttribute('type') || 'submit') === 'submit') || (el.tagName === 'INPUT' && el.type === 'submit'),
    multiline: el.tagName === 'TEXTAREA' || el.isContentEditable,
    search: isSearch(el) || !!el.closest('[role=search]') || !!form?.querySelector('input[type=search],[role=searchbox],input[name=q]'),
  };
}

function pressKey(id, key) {
  const el = id == null ? document.activeElement || document.body : document.querySelector(`[data-rolconnect-id="${id}"]`);
  if (!el) return { ok: false, error: 'Element not found — call get_page_elements again.' };
  if (id != null) { el.scrollIntoView({ block: 'center' }); el.focus?.(); }
  const codes = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ' ': 32, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, PageUp: 33, PageDown: 34, Home: 36, End: 35 };
  const opts = { key, code: key === ' ' ? 'Space' : key, keyCode: codes[key] || 0, which: codes[key] || 0, bubbles: true, cancelable: true };
  const notCancelled = el.dispatchEvent(new KeyboardEvent('keydown', opts));
  if (key === 'Enter' || key === ' ') el.dispatchEvent(new KeyboardEvent('keypress', opts));
  el.dispatchEvent(new KeyboardEvent('keyup', opts));
  if (notCancelled) {
    if (key === 'Enter' && el.form && el.tagName === 'INPUT') el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
    else if (['PageDown', 'PageUp', 'Home', 'End', ' '].includes(key) && !el.isContentEditable && !/INPUT|TEXTAREA|SELECT/.test(el.tagName)) {
      const h = innerHeight * 0.85;
      if (key === 'Home') scrollTo(0, 0);
      else if (key === 'End') scrollTo(0, document.documentElement.scrollHeight);
      else scrollBy(0, key === 'PageUp' ? -h : h);
    }
  }
  return { ok: true };
}

function clickElement(id) {
  const el = document.querySelector(`[data-rolconnect-id="${id}"]`);
  if (!el) return { ok: false, error: 'Element not found — call get_page_elements again (the page may have changed).' };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  if (el.focus) el.focus();
  el.click();
  return { ok: true };
}

function typeIntoElement(id, text, submit) {
  const el = document.querySelector(`[data-rolconnect-id="${id}"]`);
  if (!el) return { ok: false, error: 'Element not found — call get_page_elements again.' };
  if (el.type === 'password') return { ok: false, error: 'Typing into password fields is not allowed. Ask the user to do it.' };
  el.scrollIntoView({ block: 'center' });
  el.focus();
  if (el.isContentEditable) {
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, text);
  } else if (el.tagName === 'SELECT') {
    // Pick the option by value or by visible text.
    const want = String(text).trim().toLowerCase();
    const opt = [...el.options].find((o) => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want) ||
      [...el.options].find((o) => o.text.toLowerCase().includes(want));
    if (!opt) return { ok: false, error: `No option matching "${text}". Options: ${[...el.options].map((o) => o.text.trim()).join(' | ').slice(0, 500)}` };
    el.value = opt.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (submit) {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    const notCancelled = el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
    if (notCancelled && el.form) {
      if (el.form.requestSubmit) el.form.requestSubmit();
      else el.form.submit();
    }
  }
  return { ok: true };
}

function scrollPage(direction) {
  const amount = Math.round(innerHeight * 0.85);
  if (direction === 'top') scrollTo(0, 0);
  else if (direction === 'bottom') scrollTo(0, document.documentElement.scrollHeight);
  else scrollBy(0, direction === 'up' ? -amount : amount);
  return { y: Math.round(scrollY), max: document.documentElement.scrollHeight - innerHeight };
}

function bingResultsInPage(limit) {
  const out = [];
  for (const li of document.querySelectorAll('li.b_algo')) {
    const a = li.querySelector('h2 a');
    if (!a) continue;
    const snip = li.querySelector('.b_caption p, .b_lineclamp2, .b_lineclamp3, .b_paractl, p');
    out.push({ title: a.textContent.trim(), url: a.href, snippet: snip ? snip.textContent.trim() : '' });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tab helpers

function isWebUrl(u) {
  return /^(https?|file):/i.test(u || '');
}

function normalizeUrl(u) {
  u = String(u || '').trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  const x = new URL(u);
  if (!['http:', 'https:'].includes(x.protocol)) throw new Error('Only http(s) URLs are allowed.');
  return x.href;
}

function waitForTab(tabId, timeout = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    const timer = setTimeout(finish, timeout);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => t.status === 'complete' && finish(), finish);
  });
}

async function targetTab(tabId) {
  if (tabId != null && tabId !== '') {
    try {
      return await chrome.tabs.get(Number(tabId));
    } catch {
      throw new Error(`No tab with id ${tabId}. Use list_tabs to see open tabs.`);
    }
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active && isWebUrl(active.url)) return active;
  const tabs = (await chrome.tabs.query({})).filter((t) => isWebUrl(t.url));
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  if (!tabs.length) throw new Error('There is no open web page tab.');
  return tabs[0];
}

async function inject(tabId, func, args = []) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return res ? res.result : undefined;
  } catch (e) {
    throw new Error(`Can't access this tab (${e.message}). Browser-internal pages and the add-ons store are off limits.`);
  }
}

async function readViaTab(url, ctx) {
  const tab = await openAgentTab(url, ctx);
  try {
    await waitForTab(tab.id, 20000);
    if (ctx?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await sleep(900);
    return await inject(tab.id, readPage, [MAX_TEXT]);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

const host = (u) => {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
};

// ---------------------------------------------------------------------------
// Web search: DuckDuckGo HTML → Bing HTML → Bing in a background tab.

async function fetchDoc(url, signal, init = {}) {
  const res = await fetch(url, { credentials: 'omit', signal, ...init });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new DOMParser().parseFromString(await res.text(), 'text/html');
}

function decodeDdg(href) {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    if (u.pathname === '/l/' && u.searchParams.get('uddg')) return u.searchParams.get('uddg');
    return u.href;
  } catch {
    return href;
  }
}

async function searchDdg(query, limit, signal) {
  const doc = await fetchDoc('https://html.duckduckgo.com/html/', signal, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: query, kl: 'wt-wt' }).toString(),
  });
  const out = [];
  for (const el of doc.querySelectorAll('.result')) {
    if (el.classList.contains('result--ad')) continue;
    const a = el.querySelector('a.result__a');
    if (!a) continue;
    const url = decodeDdg(a.getAttribute('href'));
    if (!/^https?:/.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
    out.push({ title: a.textContent.trim(), url, snippet: el.querySelector('.result__snippet')?.textContent.trim() || '' });
    if (out.length >= limit) break;
  }
  return out;
}

function decodeBing(href) {
  try {
    const u = new URL(href);
    if (/bing\.com$/.test(u.hostname) && u.pathname.startsWith('/ck/a')) {
      const p = u.searchParams.get('u');
      if (p && p.startsWith('a1')) {
        const b64 = p.slice(2).replace(/-/g, '+').replace(/_/g, '/');
        return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
      }
    }
    return href;
  } catch {
    return href;
  }
}

async function searchBing(query, limit, signal) {
  const doc = await fetchDoc(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`, signal);
  const out = [];
  for (const li of doc.querySelectorAll('li.b_algo')) {
    const a = li.querySelector('h2 a');
    if (!a) continue;
    const url = decodeBing(a.getAttribute('href') || '');
    if (!/^https?:/.test(url)) continue;
    const snip = li.querySelector('.b_caption p, .b_lineclamp2, .b_lineclamp3, .b_paractl, p');
    out.push({ title: a.textContent.trim(), url, snippet: snip ? snip.textContent.trim() : '' });
    if (out.length >= limit) break;
  }
  return out;
}

async function searchBingTab(query, limit, ctx) {
  const tab = await openAgentTab(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, ctx);
  try {
    await waitForTab(tab.id, 15000);
    await sleep(600);
    const res = await inject(tab.id, bingResultsInPage, [limit]);
    return (res || []).map((r) => ({ ...r, url: decodeBing(r.url) }));
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Tool definitions

const str = (description) => ({ type: 'string', description });
const int = (description) => ({ type: 'integer', description });
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

const TAB_ID = int("Tab id from list_tabs. Omit to use the user's current tab.");

export const TOOLS = [
  {
    name: 'web_search',
    kind: 'search',
    clientSearch: true, // replaced by the provider's native search when available
    description:
      'Search the web. Returns titles, URLs and snippets. Use specific queries; run several searches for broad questions, then read_url the best results.',
    parameters: obj({ query: str('The search query.'), max_results: int('Number of results, 1-15 (default 8).') }, ['query']),
    label: (a) => `Searching “${a.query}”`,
    async run({ query, max_results }, ctx) {
      const limit = Math.max(1, Math.min(15, max_results || 8));
      let results = [];
      const errors = [];
      for (const engine of [searchDdg, searchBing]) {
        try {
          results = await engine(query, limit, ctx.signal);
          if (results.length) break;
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          errors.push(e.message);
        }
      }
      if (!results.length) {
        try { results = await searchBingTab(query, limit, ctx); } catch (e) { errors.push(e.message); }
      }
      if (!results.length) return { content: `No results for "${query}".${errors.length ? ' Errors: ' + errors.join('; ') : ''}` };
      return {
        content: results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n'),
        sources: results.map(({ title, url }) => ({ title, url })),
        detail: `${results.length} results`,
      };
    },
  },
  {
    name: 'read_url',
    kind: 'read',
    description:
      'Fetch a web page or document by URL and return its readable text. Use it on search results and links to get full details before answering.',
    parameters: obj({ url: str('Absolute http(s) URL.') }, ['url']),
    label: (a) => `Reading ${host(a.url)}`,
    async run({ url }, ctx) {
      url = normalizeUrl(url);
      let page = null;
      try {
        const res = await fetch(url, { credentials: 'omit', signal: ctx.signal, redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const type = res.headers.get('content-type') || '';
        if (/pdf/i.test(type)) {
          page = null; // fall through to tab: Edge's PDF viewer isn't scriptable; report instead
          return { content: `The URL is a PDF (${url}). PDFs can't be read by this tool; try another source or an HTML version.` };
        }
        const body = await res.text();
        if (/html|xml/i.test(type) || /^\s*</.test(body)) {
          const doc = new DOMParser().parseFromString(body, 'text/html');
          page = readPage(MAX_TEXT, doc);
          page.url = res.url || url;
        } else {
          page = { title: url, url: res.url || url, text: body.slice(0, MAX_TEXT) };
        }
      } catch (e) {
        if (e.name === 'AbortError') throw e;
      }
      if (!page || page.text.length < 400) {
        try {
          const viaTab = await readViaTab(url, ctx);
          if (viaTab && (!page || viaTab.text.length > page.text.length)) page = viaTab;
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          if (!page) throw e;
        }
      }
      if (!page || !page.text) return { content: `Could not extract any text from ${url}.` };
      return {
        content: `Title: ${page.title}\nURL: ${page.url || url}\n\n${page.text}`,
        sources: [{ title: page.title || host(url), url: page.url || url }],
        detail: `${page.text.length.toLocaleString()} chars`,
      };
    },
  },
  {
    name: 'list_tabs',
    kind: 'tab',
    description: 'List the open browser tabs (id, title, URL, whether active).',
    parameters: obj({}),
    label: () => 'Looking at open tabs',
    async run() {
      const tabs = (await chrome.tabs.query({})).filter((t) => !(t.url || '').startsWith(EXT_ORIGIN));
      return {
        content: tabs.map((t) => `id=${t.id}${t.active ? ' (active)' : ''} | ${t.title} | ${t.url}`).join('\n') || 'No tabs.',
        detail: `${tabs.length} tabs`,
      };
    },
  },
  {
    name: 'read_tab',
    kind: 'read',
    description:
      "Read the visible text of an open tab, including pages the user is logged into. Defaults to the user's current tab — use this when they say \"this page\".",
    parameters: obj({ tab_id: TAB_ID }),
    label: () => 'Reading your tab',
    async run({ tab_id }) {
      const tab = await targetTab(tab_id);
      const page = await inject(tab.id, readPage, [MAX_TEXT]);
      return {
        content: `Tab id=${tab.id}\nTitle: ${page.title}\nURL: ${page.url}\n\n${page.text || '(no text)'}`,
        sources: [{ title: page.title || host(page.url), url: page.url }],
        detail: page.title,
      };
    },
  },
  {
    name: 'open_tab',
    kind: 'tab',
    browserControl: true,
    description: 'Open a URL in a new tab in your "RolConnect" tab group and wait for it to load. Returns the new tab id. Opens in the background unless active=true.',
    parameters: obj({ url: str('Absolute http(s) URL.'), active: { type: 'boolean', description: 'Switch to the tab (default false).' } }, ['url']),
    label: (a) => `Opening ${host(a.url)}`,
    async run({ url, active }, ctx) {
      const tab = await openAgentTab(normalizeUrl(url), ctx, !!active);
      await waitForTab(tab.id);
      const t = await chrome.tabs.get(tab.id);
      return { content: `Opened tab id=${t.id}: ${t.title} — ${t.url}` };
    },
  },
  {
    name: 'navigate_tab',
    kind: 'tab',
    browserControl: true,
    description: 'Navigate an existing tab to a URL, or go back/forward. Defaults to the current tab.',
    parameters: obj({ tab_id: TAB_ID, url: str('URL, or "back" / "forward".') }, ['url']),
    label: (a) => (a.url === 'back' || a.url === 'forward' ? `Going ${a.url}` : `Navigating to ${host(a.url)}`),
    async run({ tab_id, url }) {
      const tab = await targetTab(tab_id);
      if (url === 'back') await chrome.tabs.goBack(tab.id);
      else if (url === 'forward') await chrome.tabs.goForward(tab.id);
      else await chrome.tabs.update(tab.id, { url: normalizeUrl(url) });
      await sleep(400);
      await waitForTab(tab.id);
      const t = await chrome.tabs.get(tab.id);
      return { content: `Tab id=${t.id} is now at: ${t.title} — ${t.url}` };
    },
  },
  {
    name: 'get_page_elements',
    kind: 'tab',
    browserControl: true,
    description:
      'List the interactive elements (links, buttons, inputs) on a tab, each with a numeric id. Call before click_element/type_text and again after the page changes.',
    parameters: obj({ tab_id: TAB_ID }),
    label: () => 'Scanning page controls',
    async run({ tab_id }) {
      const tab = await targetTab(tab_id);
      const r = await inject(tab.id, collectElements, [250]);
      return {
        content: `Tab id=${tab.id} | ${r.title} | ${r.url}\n${r.elements.join('\n') || '(no interactive elements)'}`,
        detail: `${r.elements.length} elements`,
      };
    },
  },
  {
    name: 'click_element',
    kind: 'click',
    browserControl: true,
    description: 'Click an element by its id from get_page_elements. Set consequential=true for clicks that send, post, pay, buy, delete or submit.',
    parameters: obj({ tab_id: TAB_ID, element_id: int('Element id from get_page_elements.'), consequential: CONSEQUENTIAL }, ['element_id']),
    label: (a) => `Clicking element ${a.element_id}`,
    async run({ tab_id, element_id, consequential }, ctx) {
      const tab = await targetTab(tab_id);
      const d = await inject(tab.id, describeElement, [element_id]);
      if (!d) return { content: 'Element not found — call get_page_elements again.', isError: true };
      const crucial = !!consequential || (!d.search && (d.submit || CRUCIAL.test(d.label)));
      const ok = await approve(ctx, `Click ${d.tag} “${d.label || '(no label)'}” on ${host(tab.url)}`, crucial);
      if (!ok) return { content: 'The user did not approve this click. Do not retry it; ask them how to proceed.', isError: true };
      const r = await inject(tab.id, clickElement, [element_id]);
      if (!r?.ok) return { content: r?.error || 'Click failed.', isError: true };
      await sleep(1200);
      await waitForTab(tab.id, 10000);
      const t = await chrome.tabs.get(tab.id);
      return { content: `Clicked. Tab is now: ${t.title} — ${t.url}`, detail: d.label };
    },
  },
  {
    name: 'type_text',
    kind: 'type',
    browserControl: true,
    description: 'Type text into an input, textarea or editable area by its id from get_page_elements (for a <select>, pass the option text). Optionally press Enter / submit afterwards.',
    parameters: obj(
      {
        tab_id: TAB_ID,
        element_id: int('Element id from get_page_elements.'),
        text: str('Text to enter (replaces the current value).'),
        submit: { type: 'boolean', description: 'Press Enter / submit the form afterwards.' },
        consequential: CONSEQUENTIAL,
      },
      ['element_id', 'text'],
    ),
    label: (a) => `Typing “${String(a.text || '').slice(0, 40)}”`,
    async run({ tab_id, element_id, text, submit, consequential }, ctx) {
      const tab = await targetTab(tab_id);
      const d = await inject(tab.id, describeElement, [element_id]);
      if (!d) return { content: 'Element not found — call get_page_elements again.', isError: true };
      if (d.password) return { content: 'Refused: that looks like a password, one-time code or payment field. Ask the user to fill it in.', isError: true };
      const crucial = !!consequential || (!!submit && !d.search);
      const ok = await approve(ctx, `Type “${text}” into “${d.label || d.tag}”${submit ? ' and submit' : ''} on ${host(tab.url)}`, crucial);
      if (!ok) return { content: 'The user did not approve this. Do not retry it; ask them how to proceed.', isError: true };
      const r = await inject(tab.id, typeIntoElement, [element_id, String(text), !!submit]);
      if (!r?.ok) return { content: r?.error || 'Typing failed.', isError: true };
      if (submit) { await sleep(1200); await waitForTab(tab.id, 10000); }
      const t = await chrome.tabs.get(tab.id);
      return { content: `Done. Tab is now: ${t.title} — ${t.url}` };
    },
  },
  {
    name: 'scroll_page',
    kind: 'tab',
    browserControl: true,
    description: 'Scroll a tab (useful before get_page_elements on long or lazy-loading pages).',
    parameters: obj({ tab_id: TAB_ID, direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'] } }, ['direction']),
    label: (a) => `Scrolling ${a.direction}`,
    async run({ tab_id, direction }) {
      const tab = await targetTab(tab_id);
      const r = await inject(tab.id, scrollPage, [direction]);
      await sleep(500);
      return { content: `Scrolled ${direction}. Position ${r.y}/${r.max}px.` };
    },
  },
  {
    name: 'press_key',
    kind: 'type',
    browserControl: true,
    description: 'Press a key on a tab: on an element from get_page_elements, or on whatever is focused. Use for Enter, Escape, Tab, arrows, PageDown etc.',
    parameters: obj(
      {
        tab_id: TAB_ID,
        key: { type: 'string', enum: ['Enter', 'Escape', 'Tab', 'Backspace', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'] },
        element_id: int('Element id from get_page_elements (optional).'),
        consequential: CONSEQUENTIAL,
      },
      ['key'],
    ),
    label: (a) => `Pressing ${a.key}`,
    async run({ tab_id, key, element_id, consequential }, ctx) {
      const tab = await targetTab(tab_id);
      const k = key === 'Space' ? ' ' : key;
      const id = element_id == null || element_id === '' ? null : element_id;
      const d = await inject(tab.id, describeElement, [id]);
      const crucial = !!consequential || (k === 'Enter' && !!d && !d.search && (d.multiline || d.submit || d.tag === 'input'));
      const ok = await approve(ctx, `Press ${key}${d?.label ? ` on “${d.label}”` : ''} on ${host(tab.url)}`, crucial);
      if (!ok) return { content: 'The user did not approve this. Do not retry it; ask them how to proceed.', isError: true };
      const r = await inject(tab.id, pressKey, [id, k]);
      if (!r?.ok) return { content: r?.error || 'Key press failed.', isError: true };
      await sleep(k === 'Enter' ? 1200 : 300);
      if (k === 'Enter') await waitForTab(tab.id, 10000);
      const t = await chrome.tabs.get(tab.id);
      return { content: `Pressed ${key}. Tab is now: ${t.title} — ${t.url}` };
    },
  },
  {
    name: 'wait',
    kind: 'wait',
    browserControl: true,
    description: 'Wait a few seconds for a page to finish loading or updating.',
    parameters: obj({ seconds: int('1-30 (default 3).') }),
    label: (a) => `Waiting ${Math.max(1, Math.min(30, a.seconds || 3))}s`,
    async run({ seconds }, ctx) {
      const s = Math.max(1, Math.min(30, seconds || 3));
      for (let i = 0; i < s * 4 && !ctx.signal?.aborted; i++) await sleep(250);
      return { content: `Waited ${s} seconds.` };
    },
  },
  {
    name: 'close_tab',
    kind: 'tab',
    browserControl: true,
    description: 'Close a tab you opened during this task.',
    parameters: obj({ tab_id: int('Tab id.') }, ['tab_id']),
    label: () => 'Closing a tab',
    async run({ tab_id }, ctx) {
      const id = Number(tab_id);
      if (!ctx.run?.agentTabs?.has(id)) return { content: 'You can only close tabs you opened during this task.', isError: true };
      await chrome.tabs.remove(id).catch(() => {});
      ctx.run.agentTabs.delete(id);
      return { content: `Closed tab ${id}.` };
    },
  },
  {
    name: 'request_approval',
    kind: 'approval',
    description: 'Ask the user to approve a specific action before you do it (for anything risky or that you are unsure they want). Returns approved or declined.',
    parameters: obj({ action: str('What you are about to do, in one sentence.') }, ['action']),
    label: (a) => `Asking: ${String(a.action || '').slice(0, 80)}`,
    async run({ action }, ctx) {
      const ok = await ctx.confirm(String(action || 'Continue?'));
      return { content: ok ? 'Approved by the user.' : 'Declined by the user. Do not do it; ask how to proceed.', detail: ok ? 'Approved' : 'Declined' };
    },
  },
  {
    name: 'search_history',
    kind: 'search',
    needsHistory: true,
    description: "Search the user's browsing history (titles and URLs) to find pages they visited before.",
    parameters: obj({ query: str('Words to look for (empty = most recent).'), days: int('How far back, in days (default 30).'), max_results: int('1-50 (default 20).') }),
    label: (a) => (a.query ? `Searching history for “${a.query}”` : 'Looking at recent history'),
    async run({ query, days, max_results }) {
      if (!chrome.history) return { content: 'Browsing history access is turned off.', isError: true };
      const items = await chrome.history.search({
        text: String(query || ''),
        startTime: Date.now() - Math.max(1, Math.min(365, days || 30)) * 86400000,
        maxResults: Math.max(1, Math.min(50, max_results || 20)),
      });
      const list = items.filter((i) => isWebUrl(i.url));
      return {
        content: list.map((i) => `${new Date(i.lastVisitTime).toLocaleString()} | ${i.title || '(no title)'} | ${i.url}`).join('\n') || 'Nothing found.',
        detail: `${list.length} pages`,
      };
    },
  },
  {
    name: 'save_memory',
    kind: 'memory',
    needsMemory: true,
    description:
      'Remember something for future chats (stored on this device; the user can see and edit it). kind "fact" = lasting info about the user (preferences, name, location, projects); kind "task" = a notable outcome of a task. Never store secrets.',
    parameters: obj({ text: str('One short, self-contained sentence.'), kind: { type: 'string', enum: ['fact', 'task'] } }, ['text']),
    label: (a) => `Remembering: ${String(a.text || '').slice(0, 60)}`,
    async run({ text, kind }, ctx) {
      text = String(text || '').trim().slice(0, 500);
      if (!text) return { content: 'Nothing to save.', isError: true };
      const list = await getMemories(ctx.settings);
      if (list.some((m) => m.text.toLowerCase() === text.toLowerCase())) return { content: 'Already remembered.' };
      const m = { id: uid('m'), text, kind: kind === 'task' ? 'episodic' : 'core', created: Date.now(), updated: Date.now() };
      await saveMemories([...list, m]);
      return { content: `Saved memory ${m.id}.`, detail: 'Saved' };
    },
  },
  {
    name: 'forget_memory',
    kind: 'memory',
    needsMemory: true,
    description: 'Delete a memory that is wrong or that the user wants forgotten, by its id.',
    parameters: obj({ id: str('Memory id, e.g. m1abc.') }, ['id']),
    label: () => 'Forgetting a memory',
    async run({ id }, ctx) {
      const list = await getMemories(ctx.settings);
      const left = list.filter((m) => m.id !== id);
      if (left.length === list.length) return { content: `No memory with id ${id}.`, isError: true };
      await saveMemories(left);
      return { content: `Forgot ${id}.` };
    },
  },
  {
    name: 'create_routine',
    kind: 'routine',
    interactive: true,
    description:
      'Schedule a recurring task. Use when the user wants something done regularly ("every morning", "check daily", "weekly summary"). By default each run starts a new chat; set continue_this_chat=true to wake this chat instead. The user must approve.',
    parameters: obj(
      {
        name: str('Short name.'),
        instructions: str('Complete, self-contained instructions for each run (runs do not see this chat).'),
        schedule: { type: 'string', enum: ['interval', 'daily', 'weekdays', 'weekly'] },
        time: str('Local time HH:MM for daily / weekdays / weekly.'),
        weekday: int('0 = Sunday … 6 = Saturday, for weekly.'),
        interval_minutes: int('For interval (minimum 5).'),
        continue_this_chat: { type: 'boolean', description: 'Wake this chat on each run instead of starting a new one.' },
      },
      ['name', 'instructions', 'schedule'],
    ),
    label: (a) => `Scheduling “${a.name}”`,
    async run(a, ctx) {
      const schedule = normalizeSchedule({ type: a.schedule, time: a.time, day: a.weekday, minutes: a.interval_minutes });
      const heartbeat = !!a.continue_this_chat && !!ctx.chatId;
      const desc = `${describeSchedule(schedule)}${heartbeat ? ', continuing this chat' : ''}`;
      const ok = await ctx.confirm(`Create routine “${a.name}” — ${desc}`);
      if (!ok) return { content: 'The user declined to create this routine.', isError: true };
      const r = {
        id: uid('r'), name: String(a.name).slice(0, 80), instructions: String(a.instructions),
        kind: heartbeat ? 'heartbeat' : 'cron', ...(heartbeat ? { chatId: ctx.chatId } : {}),
        schedule, active: true, created: Date.now(), nextRun: nextRunTime(schedule), runs: [],
      };
      await saveRoutine(r);
      return { content: `Routine created: ${r.name} (${desc}). First run: ${new Date(r.nextRun).toLocaleString()}. The user can manage it in Settings → Routines.`, detail: desc };
    },
  },
];

export function selectTools({ nativeSearch, permission, memory, history, headless }) {
  return TOOLS.filter((t) =>
    !(t.clientSearch && nativeSearch) &&
    !(t.browserControl && permission === 'read') &&
    !(t.needsMemory && !memory) &&
    !(t.needsHistory && !history) &&
    !(t.interactive && headless));
}

export async function currentPageInfo() {
  try {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (t && isWebUrl(t.url)) return { id: t.id, title: t.title, url: t.url };
  } catch {}
  return null;
}
