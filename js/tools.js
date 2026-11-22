// Agent tools: web search, page reading, tab control, memory, history and routines.
// Every tool returns { content: string, sources?: [{title,url}], detail?: string }.

import { getMemories, saveMemories, saveRoutine } from './storage.js';
import { normalizeSchedule, nextRunTime, describeSchedule } from './routines.js';

const MAX_TEXT = 15000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXT_ORIGIN = chrome.runtime.getURL('');
const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Tabs the agent opens live in their own tab group, which the user can take over at any time.
export const AGENT_GROUP = 'Rold Harness';
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
  if (total > maxLen) text = text.slice(0, maxLen) + `\n\n[truncated, ${total} characters total]`;
  return { title, url, text };
}

function collectElements(limit) {
  const sel = [
    'a[href]', 'button', 'input:not([type=hidden])', 'textarea', 'select', 'summary',
    '[role=button]', '[role=link]', '[role=tab]', '[role=menuitem]', '[role=checkbox]',
    '[role=option]', '[role=textbox]', '[role=combobox]', '[contenteditable="true"]',
  ].join(',');
  document.querySelectorAll('[data-rold-harness-id]').forEach((e) => e.removeAttribute('data-rold-harness-id'));
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
    el.setAttribute('data-rold-harness-id', String(id));
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
  const el = id == null ? document.activeElement : document.querySelector(`[data-rold-harness-id="${id}"]`);
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
  const el = id == null ? document.activeElement || document.body : document.querySelector(`[data-rold-harness-id="${id}"]`);
  if (!el) return { ok: false, error: 'Element not found. Call get_page_elements again.' };
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
  const el = document.querySelector(`[data-rold-harness-id="${id}"]`);
  if (!el) return { ok: false, error: 'Element not found. Call get_page_elements again (the page may have changed).' };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  if (el.focus) el.focus();
  el.click();
  return { ok: true };
}

function typeIntoElement(id, text, submit) {
  const el = document.querySelector(`[data-rold-harness-id="${id}"]`);
  if (!el) return { ok: false, error: 'Element not found. Call get_page_elements again.' };
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

function isInternalUrl(u) {
  return /^(edge|chrome|about|devtools|view-source):/i.test(u || '');
}

async function captureInternalTab(tab) {
  try {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    await sleep(150);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });
    const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
    if (!m) throw new Error('capture returned no image');
    return { mediaType: m[1], data: m[2] };
  } catch (e) {
    return { error: e.message || String(e) };
  }
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
  if (active) return active;
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
    throw new Error(`Can't access this tab (${e.message}). Browser-internal pages and the add-ons store are off limits. Use browser_info for the installed build.`);
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
// Computer use: screenshots and trusted mouse/keyboard input through the
// Chrome DevTools Protocol (chrome.debugger). Works on any page GUI, including
// canvas apps, editors and maps. Edge shows a "debugging" bar while attached.

const SHOT_MAX_W = 1280;
const SHOT_MAX_H = 900;
const attached = new Map(); // tabId → Set of run objects using it
const stopped = new Set(); // tabs where the user clicked Cancel on the debugging bar

if (chrome.debugger?.onDetach) {
  chrome.debugger.onDetach.addListener(({ tabId }, reason) => {
    attached.delete(tabId);
    if (reason === 'canceled_by_user') stopped.add(tabId);
  });
}

const cdp = (tabId, method, params = {}) => chrome.debugger.sendCommand({ tabId }, method, params);

async function attachTab(tab, ctx) {
  if (!chrome.debugger) throw new Error('Computer use needs the "debugger" permission. Reload Rold Harness in edge://extensions.');
  if (!isWebUrl(tab.url)) throw new Error("Can't control this tab. Browser-internal pages and the add-ons store are off limits.");
  if (stopped.has(tab.id)) throw new Error('The user stopped screen control on this tab. Use get_page_elements and the element tools instead.');
  const users = attached.get(tab.id);
  if (users) { if (ctx?.run) users.add(ctx.run); return; }
  try {
    await chrome.debugger.attach({ tabId: tab.id }, '1.3');
  } catch (e) {
    if (!/already attached/i.test(e.message)) throw new Error(`Can't control this tab (${e.message}).`);
  }
  attached.set(tab.id, new Set(ctx?.run ? [ctx.run] : []));
  // Background tabs behave as if focused, so menus, hovers and carets work.
  await cdp(tab.id, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  // A tiny screencast keeps background tabs painting, so screenshots don't need to switch tabs.
  await cdp(tab.id, 'Page.startScreencast', { format: 'jpeg', quality: 1, maxWidth: 32, maxHeight: 32, everyNthFrame: 600 }).catch(() => {});
  await sleep(400); // Edge's debugging bar resizes the page as it appears
}

// Called when a run ends: detach from every tab only this run was using.
export async function releaseComputer(run) {
  for (const [tabId, users] of [...attached]) {
    users.delete(run);
    if (users.size) continue;
    attached.delete(tabId);
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
  stopped.clear();
}

const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

// Viewport in CSS pixels and the size of the screenshot the model sees.
async function viewport(tabId) {
  const m = await cdp(tabId, 'Page.getLayoutMetrics');
  const v = m.cssVisualViewport || m.visualViewport || m.layoutViewport;
  const w = Math.round(v.clientWidth), h = Math.round(v.clientHeight);
  const s = Math.min(1, SHOT_MAX_W / w, SHOT_MAX_H / h);
  return { w, h, iw: Math.round(w * s), ih: Math.round(h * s), scale: s };
}

async function captureTab(tab) {
  const shot = () => withTimeout(cdp(tab.id, 'Page.captureScreenshot', { format: 'png' }), 4000, 'timeout');
  try {
    return (await shot()).data;
  } catch {
    // Hidden tabs may not paint: bring it to the front for a moment, then restore the user's tab.
    const [prev] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    await chrome.tabs.update(tab.id, { active: true });
    try {
      await sleep(350);
      return (await shot()).data;
    } finally {
      if (prev && prev.id !== tab.id) chrome.tabs.update(prev.id, { active: true }).catch(() => {});
    }
  }
}

async function resizeShot(b64, iw, ih) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(iw, ih);
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, iw, ih);
  bmp.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function screenshotResult(tab, note = '') {
  const vp = await viewport(tab.id);
  const data = await resizeShot(await captureTab(tab), vp.iw, vp.ih);
  const t = await chrome.tabs.get(tab.id);
  return {
    content: `${note}Screenshot of tab id=${t.id} | ${t.title} | ${t.url}\nSize ${vp.iw}×${vp.ih}. Give x/y in this image's pixels.`,
    image: { mediaType: 'image/jpeg', data, width: vp.iw, height: vp.ih },
  };
}

// Converts screenshot pixels to CSS pixels of the page.
async function toPage(tabId, x, y) {
  const vp = await viewport(tabId);
  const px = Number(x), py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || py < 0 || px > vp.iw || py > vp.ih) {
    throw new Error(`Coordinates (${x}, ${y}) are outside the ${vp.iw}×${vp.ih} screenshot.`);
  }
  return { x: px / vp.scale, y: py / vp.scale };
}

// What is under a point (for Guard approvals), self-contained for Runtime.evaluate.
function pointInfo(x, y) {
  let el = document.elementFromPoint(x, y);
  if (!el) return null;
  const hit = el.closest('a,button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="checkbox"],[role="switch"],[role="option"],[contenteditable=""],[contenteditable="true"]') || el;
  const type = (hit.getAttribute('type') || '').toLowerCase();
  const ac = (hit.getAttribute('autocomplete') || '').toLowerCase();
  const label = (hit.getAttribute('aria-label') || hit.getAttribute('title') || hit.innerText || hit.value || hit.getAttribute('placeholder') || hit.getAttribute('alt') || '')
    .replace(/\s+/g, ' ').trim().slice(0, 80);
  const isForm = hit.form || hit.closest('form');
  return {
    tag: hit.tagName.toLowerCase(),
    label,
    submit: type === 'submit' || (hit.tagName === 'BUTTON' && !type && !!isForm),
    search: type === 'search' || hit.getAttribute('role') === 'searchbox' || /search|buscar/i.test(hit.getAttribute('name') || '') || !!hit.closest('[role="search"], form[action*="search"]'),
    secret: type === 'password' || /cc-|one-time-code|current-password|new-password/.test(ac),
  };
}

function focusInfo() {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (!el || el === document.body) return null;
  const type = (el.getAttribute('type') || '').toLowerCase();
  const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
  return {
    tag: el.tagName.toLowerCase(),
    label: (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '').slice(0, 80),
    multiline: el.tagName === 'TEXTAREA' || el.isContentEditable,
    search: type === 'search' || el.getAttribute('role') === 'searchbox' || /search|buscar|^q$/i.test(el.getAttribute('name') || ''),
    secret: type === 'password' || /cc-|one-time-code|current-password|new-password/.test(ac),
  };
}

async function evalInTab(tabId, fn, ...args) {
  try {
    const r = await cdp(tabId, 'Runtime.evaluate', { expression: `(${fn})(${args.map((a) => JSON.stringify(a)).join(',')})`, returnByValue: true });
    return r?.result?.value ?? null;
  } catch { return null; }
}

const KEYS = {
  enter: ['Enter', 'Enter', 13, '\r'], return: ['Enter', 'Enter', 13, '\r'], tab: ['Tab', 'Tab', 9], escape: ['Escape', 'Escape', 27], esc: ['Escape', 'Escape', 27],
  backspace: ['Backspace', 'Backspace', 8], delete: ['Delete', 'Delete', 46], space: [' ', 'Space', 32, ' '],
  arrowup: ['ArrowUp', 'ArrowUp', 38], arrowdown: ['ArrowDown', 'ArrowDown', 40], arrowleft: ['ArrowLeft', 'ArrowLeft', 37], arrowright: ['ArrowRight', 'ArrowRight', 39],
  up: ['ArrowUp', 'ArrowUp', 38], down: ['ArrowDown', 'ArrowDown', 40], left: ['ArrowLeft', 'ArrowLeft', 37], right: ['ArrowRight', 'ArrowRight', 39],
  home: ['Home', 'Home', 36], end: ['End', 'End', 35], pageup: ['PageUp', 'PageUp', 33], pagedown: ['PageDown', 'PageDown', 34], insert: ['Insert', 'Insert', 45],
};
const MODS = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, win: 4, shift: 8 };

function parseCombo(combo) {
  const parts = String(combo).split('+').map((p) => p.trim()).filter(Boolean);
  let mods = 0;
  let key = null;
  for (const p of parts) {
    const l = p.toLowerCase();
    if (MODS[l] && parts.length > 1) { mods |= MODS[l]; continue; }
    if (KEYS[l]) key = KEYS[l];
    else if (/^f([1-9]|1[0-2])$/.test(l)) key = [l.toUpperCase(), l.toUpperCase(), 111 + Number(l.slice(1))];
    else if (p.length === 1) {
      const up = p.toUpperCase();
      const code = /[a-z]/i.test(p) ? 'Key' + up : /\d/.test(p) ? 'Digit' + p : '';
      const ch = mods & 8 ? up : p;
      key = [ch, code, up.charCodeAt(0), ch];
    } else throw new Error(`Unknown key "${p}".`);
  }
  if (!key) throw new Error('No key given.');
  return { key, mods };
}

async function pressCombo(tabId, combo) {
  const { key: [key, code, vk, text], mods } = parseCombo(combo);
  const printable = text && !(mods & 7);
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods };
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: printable ? 'keyDown' : 'rawKeyDown', ...base, ...(printable ? { text, unmodifiedText: text } : {}) });
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function mouse(tabId, type, x, y, extra = {}) {
  await cdp(tabId, 'Input.dispatchMouseEvent', { type, x, y, ...extra });
}

// Shared prologue for computer-use actions.
async function controlTab(tab_id, ctx) {
  const tab = await targetTab(tab_id);
  await attachTab(tab, ctx);
  return tab;
}

async function afterAction(tab, ms, ctx, note) {
  await sleep(ms);
  await waitForTab(tab.id, 8000);
  if (ctx?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return screenshotResult(await chrome.tabs.get(tab.id), note);
}

const COORD = (axis) => int(`${axis} in screenshot pixels.`);

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
    name: 'browser_info',
    kind: 'read',
    description:
      'Get the installed Rold Harness version, browser version, platform and current tab. Use this for questions about the installed build or the browser. Extensions cannot read browser-internal pages such as edge://extensions.',
    parameters: obj({}),
    label: () => 'Checking browser info',
    async run() {
      const m = chrome.runtime.getManifest();
      const ua = navigator.userAgent;
      const edge = ua.match(/(?:Edg|EdgA|EdgiOS)\/([\d.]+)/);
      const chromeVer = ua.match(/(?:Chrome|CriOS)\/([\d.]+)/);
      const browser = edge ? `Microsoft Edge ${edge[1]}` : chromeVer ? `Chrome ${chromeVer[1]}` : navigator.appVersion;
      const platform = navigator.userAgentData?.platform || navigator.platform || 'unknown';
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return {
        content:
          `Installed build: Rold Harness ${m.version} (extension id ${chrome.runtime.id})\n` +
          `Browser: ${browser}\nPlatform: ${platform}\n` +
          `Current tab: ${active ? `${active.title} (${active.url})` : 'none'}\n\n` +
          "This comes from the browser's extension APIs. Browser-internal pages (edge://, chrome://) and the add-ons store can't be read or controlled by extensions.",
        detail: `Rold Harness ${m.version}`,
      };
    },
  },
  {
    name: 'read_tab',
    kind: 'read',
    description:
      "Read the visible text of an open tab, including pages the user is logged into. For a browser-internal page (edge://, chrome://), captures its visible area instead. Defaults to the user's current tab — use this when they say \"this page\".",
    parameters: obj({ tab_id: TAB_ID }),
    label: () => 'Reading your tab',
    async run({ tab_id }) {
      const tab = await targetTab(tab_id);
      if (!isWebUrl(tab.url)) {
        const header = `Tab id=${tab.id}\nTitle: ${tab.title}\nURL: ${tab.url}\n\n`;
        if (!isInternalUrl(tab.url)) {
          return {
            content: header + 'This page is not a web page, so Edge blocks extensions from reading or controlling it.',
            detail: tab.title,
          };
        }
        const shot = await captureInternalTab(tab);
        if (shot.error) {
          return {
            content:
              header +
              'This is a browser-internal page. Edge blocks extensions from reading it directly, and the screenshot fallback was not allowed. ' +
              'Open the Rold Harness side panel while this page is in front (click the Rold Harness toolbar button, or right-click → Summarize this page with Rold Harness), then ask again. ' +
              `(Capture failed: ${shot.error})`,
            detail: tab.title,
          };
        }
        return {
          content:
            header +
            'This is a browser-internal page, so I captured its visible area instead. Read the text and UI from the screenshot (this needs a vision-capable model). ' +
            'Only the visible part is included; ask again after scrolling for more.',
          image: shot,
          detail: `Captured ${tab.title}`,
        };
      }
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
    description: 'Open a URL in a new tab in your "Rold Harness" tab group and wait for it to load. Returns the new tab id. Opens in the background unless active=true.',
    parameters: obj({ url: str('Absolute http(s) URL.'), active: { type: 'boolean', description: 'Switch to the tab (default false).' } }, ['url']),
    label: (a) => `Opening ${host(a.url)}`,
    async run({ url, active }, ctx) {
      const tab = await openAgentTab(normalizeUrl(url), ctx, !!active);
      await waitForTab(tab.id);
      const t = await chrome.tabs.get(tab.id);
      return { content: `Opened tab id=${t.id}: ${t.title} (${t.url})` };
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
      return { content: `Tab id=${t.id} is now at: ${t.title} (${t.url})` };
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
      if (!d) return { content: 'Element not found. Call get_page_elements again.', isError: true };
      const crucial = !!consequential || (!d.search && (d.submit || CRUCIAL.test(d.label)));
      const ok = await approve(ctx, `Click ${d.tag} “${d.label || '(no label)'}” on ${host(tab.url)}`, crucial);
      if (!ok) return { content: 'The user did not approve this click. Do not retry it; ask them how to proceed.', isError: true };
      const r = await inject(tab.id, clickElement, [element_id]);
      if (!r?.ok) return { content: r?.error || 'Click failed.', isError: true };
      await sleep(1200);
      await waitForTab(tab.id, 10000);
      const t = await chrome.tabs.get(tab.id);
      return { content: `Clicked. Tab is now: ${t.title} (${t.url})`, detail: d.label };
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
      if (!d) return { content: 'Element not found. Call get_page_elements again.', isError: true };
      if (d.password) return { content: 'Refused: that looks like a password, one-time code or payment field. Ask the user to fill it in.', isError: true };
      const crucial = !!consequential || (!!submit && !d.search);
      const ok = await approve(ctx, `Type “${text}” into “${d.label || d.tag}”${submit ? ' and submit' : ''} on ${host(tab.url)}`, crucial);
      if (!ok) return { content: 'The user did not approve this. Do not retry it; ask them how to proceed.', isError: true };
      const r = await inject(tab.id, typeIntoElement, [element_id, String(text), !!submit]);
      if (!r?.ok) return { content: r?.error || 'Typing failed.', isError: true };
      if (submit) { await sleep(1200); await waitForTab(tab.id, 10000); }
      const t = await chrome.tabs.get(tab.id);
      return { content: `Done. Tab is now: ${t.title} (${t.url})` };
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
      return { content: `Pressed ${key}. Tab is now: ${t.title} (${t.url})` };
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
    name: 'screenshot',
    kind: 'screen',
    needsComputer: true,
    description:
      'See a tab: returns a screenshot of its visible area. Use it to understand visual layouts, canvas apps, maps, editors, charts and images, and to find x/y coordinates for click_at, scroll_at and drag. Works on background tabs.',
    parameters: obj({ tab_id: TAB_ID }),
    label: () => 'Looking at the screen',
    async run({ tab_id }, ctx) {
      const tab = await controlTab(tab_id, ctx);
      return screenshotResult(tab);
    },
  },
  {
    name: 'click_at',
    kind: 'click',
    browserControl: true,
    needsComputer: true,
    description:
      'Real mouse action at x/y from the latest screenshot of that tab: left_click (default), double_click, triple_click, right_click or hover. Works on anything visible, including canvas and custom widgets. Returns a new screenshot. Set consequential=true for clicks that send, post, pay, buy, delete or submit.',
    parameters: obj(
      {
        tab_id: TAB_ID,
        x: COORD('X'),
        y: COORD('Y'),
        action: { type: 'string', enum: ['left_click', 'double_click', 'triple_click', 'right_click', 'hover'] },
        modifiers: str('Keys held during the click, e.g. "ctrl" or "shift" (optional).'),
        consequential: CONSEQUENTIAL,
      },
      ['x', 'y'],
    ),
    label: (a) => `${{ double_click: 'Double-clicking', triple_click: 'Triple-clicking', right_click: 'Right-clicking', hover: 'Hovering' }[a.action] || 'Clicking'} at ${a.x}, ${a.y}`,
    async run({ tab_id, x, y, action = 'left_click', modifiers, consequential }, ctx) {
      const tab = await controlTab(tab_id, ctx);
      const p = await toPage(tab.id, x, y);
      const d = await evalInTab(tab.id, pointInfo, p.x, p.y);
      const what = d ? `${d.tag}${d.label ? ` “${d.label}”` : ''}` : `point ${x}, ${y}`;
      if (action !== 'hover') {
        const crucial = !!consequential || (!!d && !d.search && (d.submit || CRUCIAL.test(d.label)));
        const ok = await approve(ctx, `Click ${what} on ${host(tab.url)}`, crucial);
        if (!ok) return { content: 'The user did not approve this click. Do not retry it; ask them how to proceed.', isError: true };
      }
      const mods = modifiers ? String(modifiers).split('+').reduce((m, k) => m | (MODS[k.trim().toLowerCase()] || 0), 0) : 0;
      await mouse(tab.id, 'mouseMoved', p.x, p.y, { modifiers: mods });
      if (action !== 'hover') {
        const button = action === 'right_click' ? 'right' : 'left';
        const buttons = button === 'right' ? 2 : 1;
        const times = { double_click: 2, triple_click: 3 }[action] || 1;
        for (let n = 1; n <= times; n++) {
          await mouse(tab.id, 'mousePressed', p.x, p.y, { button, buttons, clickCount: n, modifiers: mods });
          await mouse(tab.id, 'mouseReleased', p.x, p.y, { button, buttons: 0, clickCount: n, modifiers: mods });
        }
      }
      const r = await afterAction(tab, action === 'hover' ? 400 : 900, ctx);
      return { ...r, detail: d?.label || undefined };
    },
  },
  {
    name: 'type_keys',
    kind: 'type',
    browserControl: true,
    needsComputer: true,
    description:
      'Real keyboard input into whatever is focused on a tab (click_at a field first). text types characters; key presses a key or shortcut after the text, e.g. "Enter", "Tab", "Escape", "Backspace", "ctrl+a", "ctrl+shift+k", "F2". Returns a new screenshot. Set consequential=true when the key sends, posts or submits.',
    parameters: obj(
      {
        tab_id: TAB_ID,
        text: str('Text to type (optional).'),
        key: str('Key or shortcut to press after the text (optional).'),
        repeat: int('Times to press the key, 1-50 (default 1).'),
        consequential: CONSEQUENTIAL,
      },
    ),
    label: (a) => (a.text ? `Typing “${String(a.text).slice(0, 40)}”` : `Pressing ${a.key}`),
    async run({ tab_id, text, key, repeat, consequential }, ctx) {
      if (!text && !key) return { content: 'Give text, key, or both.', isError: true };
      const tab = await controlTab(tab_id, ctx);
      if (key) parseCombo(key); // validate before typing anything
      const f = await evalInTab(tab.id, focusInfo);
      if (f?.secret) return { content: 'Refused: the focused field looks like a password, one-time code or payment field. Ask the user to fill it in.', isError: true };
      const k = String(key || '').toLowerCase().replace(/\s/g, '');
      const sends = /(^|\+)(enter|return)$/.test(k) && (k !== 'enter' && k !== 'return' ? true : !!f && !f.search && (f.multiline || f.tag === 'input'));
      const crucial = !!consequential || sends;
      const desc = [text ? `Type “${text}”` : '', key ? `press ${key}` : ''].filter(Boolean).join(' and ');
      const ok = await approve(ctx, `${desc}${f?.label ? ` in “${f.label}”` : ''} on ${host(tab.url)}`, crucial);
      if (!ok) return { content: 'The user did not approve this. Do not retry it; ask them how to proceed.', isError: true };
      if (text) await cdp(tab.id, 'Input.insertText', { text: String(text) });
      if (key) {
        const times = Math.max(1, Math.min(50, repeat || 1));
        for (let i = 0; i < times; i++) await pressCombo(tab.id, key);
      }
      return afterAction(tab, /enter|return/.test(k) ? 1200 : 400, ctx);
    },
  },
  {
    name: 'scroll_at',
    kind: 'tab',
    browserControl: true,
    needsComputer: true,
    description: 'Scroll with the mouse wheel at x/y (scrolls whatever is under the pointer: the page, a list, a map). Returns a new screenshot.',
    parameters: obj(
      { tab_id: TAB_ID, x: COORD('X'), y: COORD('Y'), direction: { type: 'string', enum: ['down', 'up', 'left', 'right'] }, amount: int('Wheel steps, 1-20 (default 5).') },
      ['x', 'y', 'direction'],
    ),
    label: (a) => `Scrolling ${a.direction}`,
    async run({ tab_id, x, y, direction, amount }, ctx) {
      const tab = await controlTab(tab_id, ctx);
      const p = await toPage(tab.id, x, y);
      const px = Math.max(1, Math.min(20, amount || 5)) * 100;
      const dx = direction === 'right' ? px : direction === 'left' ? -px : 0;
      const dy = direction === 'down' ? px : direction === 'up' ? -px : 0;
      await mouse(tab.id, 'mouseMoved', p.x, p.y);
      await mouse(tab.id, 'mouseWheel', p.x, p.y, { deltaX: dx, deltaY: dy });
      return afterAction(tab, 600, ctx);
    },
  },
  {
    name: 'drag',
    kind: 'click',
    browserControl: true,
    needsComputer: true,
    description: 'Drag with the mouse from one point to another (sliders, maps, drawing, moving items). Coordinates from the latest screenshot. Returns a new screenshot.',
    parameters: obj({ tab_id: TAB_ID, from_x: COORD('Start X'), from_y: COORD('Start Y'), to_x: COORD('End X'), to_y: COORD('End Y') }, ['from_x', 'from_y', 'to_x', 'to_y']),
    label: (a) => `Dragging to ${a.to_x}, ${a.to_y}`,
    async run({ tab_id, from_x, from_y, to_x, to_y }, ctx) {
      const tab = await controlTab(tab_id, ctx);
      const a = await toPage(tab.id, from_x, from_y);
      const b = await toPage(tab.id, to_x, to_y);
      await mouse(tab.id, 'mouseMoved', a.x, a.y);
      await mouse(tab.id, 'mousePressed', a.x, a.y, { button: 'left', buttons: 1, clickCount: 1 });
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        await mouse(tab.id, 'mouseMoved', a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, { button: 'left', buttons: 1 });
        await sleep(16);
      }
      await mouse(tab.id, 'mouseReleased', b.x, b.y, { button: 'left', buttons: 0, clickCount: 1 });
      return afterAction(tab, 600, ctx);
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
      const ok = await ctx.confirm(`Create routine “${a.name}”: ${desc}`);
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

export function selectTools({ nativeSearch, permission, memory, history, headless, computer }) {
  return TOOLS.filter((t) =>
    !(t.clientSearch && nativeSearch) &&
    !(t.needsComputer && !computer) &&
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
