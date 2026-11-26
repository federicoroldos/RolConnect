// Agent tools: web search, page reading, tab control, memory, history and routines.
// Every tool returns { content: string, sources?: [{title,url}], detail?: string }.

import { getMemories, saveMemories, saveRoutine, getRoutines, deleteRoutine, getReads, addRead } from './storage.js';
import { normalizeSchedule, nextRunTime, describeSchedule } from './routines.js';
import { snapshotPage, describeEl, clickEl, typeEl, pressKeyEl, scrollEl, runInPage, drawMarks, armDialogs, takeDialogs } from './page.js';
import { SKILLS, getSkill, skillText } from './skills.js';

const MAX_TEXT = 15000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXT_ORIGIN = chrome.runtime.getURL('');
const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Tabs the agent opens live in their own tab group, which the user can take over at any time.
export const AGENT_GROUP = 'Rold';
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

let lastAgentTabId = null; // the tab the agent opened most recently (see targetTab)

async function openAgentTab(url, ctx, active = false, remember = true) {
  if (active && ctx?.run) ctx.run.lastAgentFocus = Date.now();
  const tab = await chrome.tabs.create({ url, active });
  if (remember) lastAgentTabId = tab.id;
  await addToAgentGroup(tab.id, ctx);
  return tab;
}

// Native dialogs and new windows around one of the agent's own actions (see armDialogs in page.js).
const DIALOG = {
  dialog: { type: 'string', enum: ['accept', 'dismiss'], description: 'How to answer an alert/confirm/prompt the page opens because of this action. Default: dismiss (Cancel), or OK after a click the user approved. accept answers OK and counts as consequential.' },
  dialog_text: { type: 'string', description: 'Answer to type into a prompt dialog this action opens (optional).' },
};
const dialogPlan = (a, approvedCrucial) => ({ accept: a.dialog === 'accept' || (a.dialog !== 'dismiss' && approvedCrucial), text: a.dialog_text ?? null });
const tabIds = async () => new Set((await chrome.tabs.query({})).map((t) => t.id));

async function armPage(tabId, frameId, plan) {
  try {
    await withTimeout(chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId || 0] }, world: 'MAIN', func: armDialogs, args: [plan] }), 3000, 'arm');
  } catch {}
}

// What happened besides the page change: dialogs it answered, windows it opened.
async function pageEvents(tabId, frameId, before, ctx) {
  const out = [];
  let seen = [];
  try {
    const [r] = await withTimeout(chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId || 0] }, world: 'MAIN', func: takeDialogs }), 3000, 'take');
    seen = r?.result || [];
  } catch {}
  for (const s of seen) {
    if (s.type === 'alert') out.push(`The page showed an alert: “${s.message}” (closed).`);
    else if (s.type === 'confirm') out.push(`The page asked “${s.message}” in a confirm dialog, answered ${s.answer}.${s.answer === 'Cancel' ? ' To answer OK, do the same action again with dialog="accept".' : ''}`);
    else if (s.type === 'prompt') out.push(`The page asked “${s.message}” in a prompt dialog, answered ${s.answer}.${s.answer === 'Cancel' ? ' To answer it, do the same action again with dialog_text set to the answer.' : ''}`);
    else if (s.type === 'open') {
      const t = await openAgentTab(s.url, ctx).catch(() => null);
      if (t) before?.add(t.id);
      out.push(t ? `The page opened ${s.url} in a new window: it's tab id=${t.id}.` : `The page tried to open ${s.url} in a new window.`);
    }
  }
  if (before) {
    for (const t of await chrome.tabs.query({}).catch(() => [])) {
      if (!before.has(t.id)) out.push(`A new tab opened: id=${t.id} | ${t.title || ''} | ${t.url || t.pendingUrl || ''}`);
    }
  }
  return out.length ? `\n${out.join('\n')}` : '';
}

// Crucial actions wait for the user's approval in Guard mode (send, pay, delete, submit…).
const CRUCIAL = /\b(send|submit|post|publish|tweet|reply|comment|pay|buy|purchase|order|confirm|delete|remove|unsubscribe|transfer|book|reserve|donate|sign up|subscribe|save|apply|enviar|publicar|responder|comentar|pagar|comprar|pedir|confirmar|eliminar|borrar|quitar|suscribir|reservar|guardar|aplicar|donar)\b/i;

// Clicks that only stage something (a cart, a wishlist) never need approval on their own.
const HARMLESS = /^\s*(add to (cart|bag|basket|trolley|wishlist|wish list|favorites|favourites)|añadir al carrito|agregar al carrito|añadir a la cesta|añadir a favoritos)(?![a-z])/i;
const crucialClick = (d) => !d.search && !HARMLESS.test(d.label || '') && (d.submit || CRUCIAL.test(d.label));

// The same action approved a moment ago (a "Delete" and then the page's own "Delete" confirm
// dialog) is one decision: the second identical request passes once without asking again.
async function approve(ctx, text, crucial) {
  if (!crucial || ctx.permission === 'full') return true;
  const last = ctx.run?.lastApproval;
  if (last && last.text === text && Date.now() - last.at < 30000) {
    ctx.run.lastApproval = null;
    return true;
  }
  // The user just approved this through request_approval ("Place the order for …?"): the click on
  // "Place order" that carries it out shouldn't ask again. Every word of the control's label must
  // appear in what they approved, and it counts once.
  const asked = ctx.run?.askedApproval;
  const label = /“([^”]+)”/.exec(text)?.[1] || '';
  const words = label.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
  if (asked && Date.now() - asked.at < 60000 && words.length && words.every((w) => asked.text.includes(w))) {
    ctx.run.askedApproval = null;
    return true;
  }
  const ok = await ctx.confirm(text);
  if (ok && ctx.run) ctx.run.lastApproval = { text, at: Date.now() };
  return ok;
}

const CONSEQUENTIAL = {
  type: 'boolean',
  description: 'true if it sends, posts, pays, buys, books, deletes, submits or changes settings. Not for adding to a cart, filtering, searching or moving to the next step.',
};

// ---------------------------------------------------------------------------
// Injected / shared page functions (must be self-contained: they are serialized
// by chrome.scripting.executeScript).

function readPage(maxLen, docArg, selector) {
  const doc = docArg || document;
  const live = !docArg;
  const title = (doc.title || '').trim();
  const url = live ? location.href : '';
  let missed = '';
  if (selector) {
    let el = null;
    try { el = doc.querySelector(selector); } catch {}
    if (el) {
      const t = (el.innerText || el.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      return { title, url, text: t.length > maxLen ? t.slice(0, maxLen) + '\n\n[truncated, ' + t.length + ' characters total]' : t };
    }
    // A guessed selector that misses shouldn't cost another call: read the whole page instead.
    missed = '[Nothing matches the selector ' + selector + ', so this is the whole page.]\n\n';
  }
  const main = doc.querySelector('article, main, [role="main"]');
  const root = main && (main.textContent || '').trim().length > 400 ? main : doc.body;
  if (!root) return { title, url, text: '' };
  let text;
  if (live && root.innerText) {
    text = root.innerText;
    // innerText skips shadow DOM (web components: Reddit, YouTube, many design systems). If the
    // page has shadow roots, walk them too and keep whichever reading has more.
    let hosts = 0;
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length && i < 20000 && !hosts; i++) if (all[i].shadowRoot) hosts++;
    if (hosts) {
      const BLK = /^(P|DIV|SECTION|ARTICLE|LI|UL|OL|TR|TABLE|PRE|BLOCKQUOTE|BR|HR|DT|DD|DL|FIGCAPTION|FIGURE|HEADER|FOOTER|NAV|MAIN|ASIDE|FORM|H[1-6])$/;
      const out = [];
      let n = 0;
      const walk = (node) => {
        const kids = node.tagName === 'SLOT' ? node.assignedNodes({ flatten: true }) : node.childNodes;
        for (const c of kids) {
          if (++n > 40000) return;
          if (c.nodeType === 3) { out.push(c.nodeValue); continue; }
          if (c.nodeType !== 1 || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|CANVAS|IFRAME)$/i.test(c.tagName)) continue;
          if (c.checkVisibility && !c.checkVisibility() && getComputedStyle(c).display !== 'contents') continue;
          const blk = BLK.test(c.tagName);
          if (/^H[1-6]$/.test(c.tagName)) out.push('\n\n' + '#'.repeat(+c.tagName[1]) + ' ');
          else if (c.tagName === 'LI') out.push('\n- ');
          else if (blk) out.push('\n');
          else if (/^(TD|TH)$/.test(c.tagName)) out.push('\t');
          walk(c.shadowRoot || c);
          if (blk) out.push('\n');
        }
      };
      walk(root);
      const deep = out.join('');
      if (deep.replace(/\s+/g, '').length > text.replace(/\s+/g, '').length * 1.1 + 100) text = deep;
    }
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
  return { title, url, text: missed + text };
}

// Passages of a page's text that mention a phrase (or, failing that, all of its words).
// Self-contained: injected with chrome.scripting.
function findText(query, selector) {
  let root = document.body || document.documentElement;
  if (selector) { try { root = document.querySelector(selector) || root; } catch {} }
  const text = String(root.innerText || root.textContent || '');
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
  const q = norm(query.trim().replace(/^@/, '')).trim();
  const words = q.split(' ').filter((w) => w.length > 1);
  const inner = (el) => el.innerText || el.textContent || '';
  // Each hit is the smallest box around the match with some substance (a post, a table row, a
  // paragraph), so what belongs together stays together.
  const search = (fits) => {
    const seen = new Set();
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const first = words[0] || q;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!norm(n.nodeValue).includes(first)) continue;
      let el = n.parentElement;
      if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue;
      const unit = (e) => /^(TR|LI|ARTICLE|DT|DD|P|H[1-6])$/.test(e.tagName) || /^(row|listitem|article)$/.test(e.getAttribute('role') || '');
      while (el && el !== root && el.parentElement && !(fits(norm(inner(el))) && (unit(el) || inner(el).trim().length >= 60))) {
        if (fits(norm(inner(el))) && inner(el.parentElement).length > 1500) break; // don't swallow a whole list
        el = el.parentElement;
      }
      if (!el || !fits(norm(inner(el))) || seen.has(el)) continue;
      if ([...seen].some((s) => s.contains(el) || el.contains(s))) continue;
      seen.add(el);
      out.push(inner(el).replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim().slice(0, 700));
    }
    return out;
  };
  let hits = search((t) => t.includes(q));
  let byWords = false;
  if (!hits.length && words.length > 1) { hits = search((t) => words.every((w) => t.includes(w))); byWords = true; }
  const loading = /loading|load more|show more/i.test(text.slice(-200));
  let shadow = false;
  if (!hits.length) {
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length && i < 20000 && !shadow; i++) shadow = !!all[i].shadowRoot;
  }
  return { title: document.title, url: location.href, hits: hits.slice(0, 25), total: hits.length, words: byWords && hits.length > 0, chars: text.length, loading, shadow };
}

// ---------------------------------------------------------------------------
// Element ids and frames. Top-frame elements have plain ids ("12"); elements inside
// an iframe carry the frame: "f3:12".

function parseEl(id) {
  const s = String(id ?? '').trim();
  const m = /^f(\d+):(\d+)$/i.exec(s);
  if (m) return { frameId: Number(m[1]), local: m[2] };
  if (/^\d+$/.test(s)) return { frameId: 0, local: s };
  throw new Error(`"${id}" is not an element id. Use an id from get_page_elements, like 12 or f3:7.`);
}

// A page frozen by a native dialog (one the agent didn't cause) never answers a script.
const FROZEN = 'The page did not respond for 45 seconds: a browser dialog (alert, confirm, "Leave site?") may be open on it, or the page is frozen.';
async function unfreeze(tabId) {
  if (!attached.has(tabId)) return ' Ask the user to close the dialog, or turn on Computer use so Rold can.';
  const ok = await cdp(tabId, 'Page.handleJavaScriptDialog', { accept: false }).then(() => true, () => false);
  return ok ? ' Rold dismissed an open dialog; try again.' : ' Ask the user to check the tab.';
}

async function injectAt(tabId, frameId, func, args = []) {
  try {
    const [res] = await withTimeout(chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId || 0] }, func, args }), 45000, FROZEN);
    return res ? res.result : undefined;
  } catch (e) {
    if (e.message === FROZEN) throw new Error(FROZEN + (await unfreeze(tabId)));
    if (frameId) throw new Error(`That frame is gone (${e.message}). Call get_page_elements again.`);
    throw new Error(`Can't access this tab (${e.message}). Browser-internal pages and the add-ons store are off limits.`);
  }
}

const AD_FRAME = /doubleclick|googlesyndication|adservice|amazon-adsystem|adnxs|criteo|taboola|outbrain|recaptcha|hcaptcha|challenges\.cloudflare/i;
const MAX_VIEW = 16000;
const indentOf = (d) => '  '.repeat(Math.min(d, 8));
const fmtItems = (items, prefix) => items.map((i) => `${indentOf(i.d)}${i.id ? `[${prefix}${i.id}] ` : ''}${i.t}`).join('\n');

// A structured view of a tab: headings, areas, dialogs and interactive elements with ids,
// including open shadow roots and iframes. With diff, only what changed since the last view.
async function pageView(tabId, opts = {}) {
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId, allFrames: !opts.selector }, func: snapshotPage, args: [opts] });
  } catch (e) {
    throw new Error(`Can't access this tab (${e.message}). Browser-internal pages and the add-ons store are off limits.`);
  }
  const top = results.find((r) => r.frameId === 0)?.result || results[0]?.result;
  if (!top) throw new Error('Could not read this page.');
  if (top.error) return { error: top.error, url: '', title: '' };
  const frames = results
    .filter((r) => r.frameId !== 0 && r.result?.items?.length && !AD_FRAME.test(r.result.url || ''))
    .slice(0, 6);

  const head = [];
  if (top.missed) head.push(`Nothing matches the selector ${top.missed}, so this is the whole page.`);
  if (top.dialog) head.push(`A dialog is open ("${top.dialog}"). If it blocks the task, deal with it first (close, accept or fill it).`);
  let body;
  let changed = 0;
  if (opts.diff && top.changes) {
    const { added, removed } = top.changes;
    changed = added.length + removed;
    const frameAdds = frames.filter((f) => f.result.changes?.added?.length);
    if (!added.length && !removed && !frameAdds.length) {
      body = 'No visible change on the page. If you expected one, the action may not have worked: check with get_page_elements or a screenshot.';
    } else if (added.length > 80) {
      body = `The page changed a lot (${added.length} new or changed items, ${removed} gone). Current view:\n${fmtItems(top.items, '')}`;
    } else {
      body = `Page changes: ${added.length} new or changed, ${removed} gone.${added.length ? '\n' + fmtItems(added, '') : ''}`;
      for (const f of frameAdds) body += `\nIn frame f${f.frameId}:\n${fmtItems(f.result.changes.added, `f${f.frameId}:`)}`;
    }
  } else {
    body = fmtItems(top.items, '') || '(nothing interactive on this page)';
    if (top.omitted) body += `\n[${top.omitted} offscreen elements not listed. Scroll, or pass a selector to focus on one part.]`;
    if (top.cut) body += `\n[${top.cut} more elements not listed. Pass a selector to focus on one part.]`;
    for (const f of frames) {
      body += `\n--- frame f${f.frameId} (${String(f.result.url).slice(0, 100)}) ---\n${fmtItems(f.result.items, `f${f.frameId}:`)}`;
    }
  }
  if (top.scroll?.max > 0) head.push(`Scroll position ${top.scroll.y}/${top.scroll.max}px.`);
  let text = `${head.length ? head.join(' ') + '\n' : ''}${body}`;
  if (text.length > MAX_VIEW) text = text.slice(0, MAX_VIEW) + '\n[cut: too long. Pass a selector to focus on one part.]';
  const count = top.items.filter((i) => i.id).length + frames.reduce((n, f) => n + f.result.items.filter((i) => i.id).length, 0);
  return { text, url: top.url, title: top.title, count, changed };
}

// Waits for the page to settle after an action, then reports what changed.
async function afterPageAction(tabId, ms = 900) {
  await sleep(ms);
  await waitForTab(tabId, 10000);
  const t = await chrome.tabs.get(tabId);
  let view = null;
  try { view = await pageView(tabId, { diff: true }); } catch {}
  return { tab: t, text: `Tab id=${t.id} is now: ${t.title} (${t.url})${view?.text ? '\n' + view.text : ''}` };
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
  // From Rold's own pages (the new tab chat, a routine running in the background) "this tab"
  // means the page the agent just opened, not the chat itself.
  const base = chrome.runtime?.getURL?.('');
  const own = !!base && !!active?.url?.startsWith(base);
  if (own && lastAgentTabId != null) {
    try { return await chrome.tabs.get(lastAgentTabId); } catch {}
  }
  if (active) return active;
  const tabs = (await chrome.tabs.query({})).filter((t) => isWebUrl(t.url));
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  if (!tabs.length) throw new Error('There is no open web page tab.');
  return tabs[0];
}

async function inject(tabId, func, args = []) {
  try {
    const [res] = await withTimeout(chrome.scripting.executeScript({ target: { tabId }, func, args }), 45000, FROZEN);
    return res ? res.result : undefined;
  } catch (e) {
    if (e.message === FROZEN) throw new Error(FROZEN + (await unfreeze(tabId)));
    throw new Error(`Can't access this tab (${e.message}). Browser-internal pages and the add-ons store are off limits. Use browser_info for the installed build.`);
  }
}

async function readViaTab(url, ctx) {
  const tab = await openAgentTab(url, ctx, false, false);
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
  const tab = await openAgentTab(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, ctx, false, false);
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
  if (!chrome.debugger) throw new Error('Computer use needs the "debugger" permission. Reload Rold in edge://extensions.');
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

// Viewport center of an element from get_page_elements (isolated world, where the ids live).
// The drag start is scrolled into view; a drop target low on the page aims at its visible top part.
function centerOfId(id, start) {
  const ref = window.__rold?.els.get(String(id));
  const el = ref && ref.deref();
  if (!el || !el.isConnected) return null;
  let r = el.getBoundingClientRect();
  if (start && (r.top < 0 || r.bottom > innerHeight)) { el.scrollIntoView({ block: 'center' }); r = el.getBoundingClientRect(); }
  const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight);
  const y = bottom > top ? (top + Math.min(bottom, top + 200)) / 2 : r.top + r.height / 2;
  return { x: r.left + r.width / 2, y };
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

const TAB_ID = int("Tab id (omit for the user's current tab).");
const EL_ID = str('Element id from get_page_elements, e.g. "12", or "f3:7" for an element inside a frame.');
const DECLINED = 'The user did not approve this. Do not retry it; ask them how to proceed.';
const MIME = {
  csv: 'text/csv', tsv: 'text/tab-separated-values', md: 'text/markdown', json: 'application/json', html: 'text/html', htm: 'text/html',
  txt: 'text/plain', ics: 'text/calendar', xml: 'application/xml', svg: 'image/svg+xml', yaml: 'text/yaml', yml: 'text/yaml', js: 'text/javascript', css: 'text/css',
};

// Simple word-overlap ranking for local searches.
function rank(list, query, textOf) {
  const words = String(query || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  if (!words.length) return list;
  return list
    .map((x) => { const t = textOf(x).toLowerCase(); return { x, s: words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0) }; })
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((r) => r.x);
}

async function bookmarkFolder(name) {
  const found = (await chrome.bookmarks.search({ title: name })).find((b) => !b.url);
  if (found) return found.id;
  const [root] = await chrome.bookmarks.getTree();
  const other = root.children?.find((c) => c.id === '2') || root.children?.[1] || root.children?.[0];
  return (await chrome.bookmarks.create({ parentId: other.id, title: name })).id;
}

// Schedule from tool arguments (create_routine / update_routine).
function scheduleFrom(a) {
  if (a.schedule === 'once') {
    let at = a.at ? new Date(String(a.at).trim().replace(' ', 'T')).getTime() : NaN;
    if (!Number.isFinite(at)) at = Date.now() + Math.max(1, Number(a.in_minutes) || 60) * 60000;
    return normalizeSchedule({ type: 'once', at });
  }
  return normalizeSchedule({ type: a.schedule, time: a.time, day: a.weekday, minutes: a.interval_minutes });
}

// Pages the agent reads go into the "past reads" log when memory is on.
function noteRead(ctx, page) {
  const m = ctx?.settings?.memory;
  if (!m?.enabled || m.reads === false || ctx.sub) return;
  addRead(page).catch(() => {});
}


export const TOOLS = [
  {
    name: 'web_search',
    parallel: true,
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
    parallel: true,
    kind: 'read',
    description:
      'Fetch a web page or document by URL and return its readable text. Use it on search results and links to get full details before answering.',
    parameters: obj({ url: str('Absolute http(s) URL.') }, ['url']),
    label: (a) => `Reading ${host(a.url)}`,
    async run({ url }, ctx) {
      url = normalizeUrl(url);
      let page = null;
      let scripted = true; // unknown until fetched: assume the page may need a real tab
      try {
        const res = await fetch(url, { credentials: 'omit', signal: ctx.signal, redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const type = res.headers.get('content-type') || '';
        if (/pdf/i.test(type)) {
          page = null; // fall through to tab: Edge's PDF viewer isn't scriptable; report instead
          return { content: `The URL is a PDF (${url}). PDFs can't be read by this tool; try another source or an HTML version.` };
        }
        const body = await res.text();
        // Built by JavaScript (an app shell, script bundles, a noscript notice)? Then a tab may show more.
        scripted = /<script|<noscript|id=["'](root|app|__next|__nuxt)["']/i.test(body);
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
      // A short static page is complete as fetched; loading it again in a tab only costs time.
      if (!page || page.text.length < 80 || (page.text.length < 400 && scripted)) {
        try {
          const viaTab = await readViaTab(url, ctx);
          if (viaTab && (!page || viaTab.text.length > page.text.length)) page = viaTab;
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          if (!page) throw e;
        }
      }
      if (!page || !page.text) return { content: `Could not extract any text from ${url}.` };
      noteRead(ctx, { url: page.url || url, title: page.title, text: page.text });
      return {
        content: `Title: ${page.title}\nURL: ${page.url || url}\n\n${page.text}`,
        sources: [{ title: page.title || host(url), url: page.url || url }],
        detail: `${page.text.length.toLocaleString()} chars`,
        url: page.url || url,
      };
    },
  },
  {
    name: 'list_tabs',
    parallel: true,
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
    parallel: true,
    kind: 'read',
    description:
      'Get the installed Rold version, browser version, platform and current tab. Use this for questions about the installed build or the browser. Extensions cannot read browser-internal pages such as edge://extensions.',
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
          `Installed build: Rold ${m.version} (extension id ${chrome.runtime.id})\n` +
          `Browser: ${browser}\nPlatform: ${platform}\n` +
          `Current tab: ${active ? `${active.title} (${active.url})` : 'none'}\n\n` +
          "This comes from the browser's extension APIs. Browser-internal pages (edge://, chrome://) and the add-ons store can't be read or controlled by extensions.",
        detail: `Rold ${m.version}`,
      };
    },
  },
  {
    name: 'read_tab',
    parallel: true,
    kind: 'read',
    description:
      "Read the text of an open tab, including pages the user is logged into. For a browser-internal page (edge://, chrome://), captures its visible area instead. Defaults to the user's current tab. Use this when they say \"this page\". Pass selector (CSS) to read just one part of a long page, or find to get only the passages that mention something (searches all of the page's text, however long).",
    parameters: obj({
      tab_id: TAB_ID,
      selector: str('CSS selector of the part to read (optional).'),
      find: str('Words or a name to look for, e.g. "quietfox" or "refund policy" (optional). Returns each passage that contains them.'),
    }),
    label: (a) => (a.find ? `Looking for “${String(a.find).slice(0, 40)}”` : a.tab_id ? 'Reading a tab' : 'Reading your tab'),
    async run({ tab_id, selector, find }, ctx) {
      const tab = await targetTab(tab_id);
      if (find && isWebUrl(tab.url)) {
        const r = await inject(tab.id, findText, [String(find), selector || '']);
        const head = `Tab id=${tab.id}\nTitle: ${r.title}\nURL: ${r.url}\n\n`;
        if (!r.hits.length && r.shadow) {
          // The text may sit inside web components' shadow DOM, which findText can't walk:
          // search the deep reading line by line, with a line of context on each side.
          const page = await inject(tab.id, readPage, [600000, null, selector || '']);
          const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
          const q = norm(String(find).trim().replace(/^@/, '')).trim();
          const words = q.split(' ').filter((w) => w.length > 1);
          const lines = page.text.split('\n').filter((l) => l.trim());
          const scan = (fits) => {
            const out = [];
            let last = -9;
            lines.forEach((l, i) => {
              if (!fits(norm(l)) || i - last < 3) return;
              last = i;
              out.push(lines.slice(Math.max(0, i - 1), i + 2).join('\n').slice(0, 700));
            });
            return out;
          };
          let hits = scan((t) => t.includes(q));
          let byWords = false;
          if (!hits.length && words.length > 1) { hits = scan((t) => words.every((w) => t.includes(w))); byWords = hits.length > 0; }
          if (hits.length) {
            return {
              content: `${head}${hits.length} passage${hits.length === 1 ? ' mentions' : 's mention'} “${find}”${byWords ? ' (matched by its words, not the exact phrase)' : ''}${hits.length > 25 ? ', first 25 shown' : ''}:\n\n${hits.slice(0, 25).join('\n---\n')}`,
              sources: [{ title: r.title || host(r.url), url: r.url }],
              detail: `${hits.length} found`,
              url: r.url,
            };
          }
        }
        if (!r.hits.length) {
          return { content: `${head}“${find}” does not appear in the page text (${r.chars.toLocaleString()} characters searched${r.loading ? '; the page may still be loading more as you scroll' : ''}). Images, canvases and unloaded parts aren't searched.`, detail: 'No matches' };
        }
        return {
          content: `${head}${r.total} passage${r.total === 1 ? ' mentions' : 's mention'} “${find}”${r.words ? ' (matched by its words, not the exact phrase)' : ''}${r.total > r.hits.length ? `, first ${r.hits.length} shown` : ''}:\n\n${r.hits.join('\n---\n')}`,
          sources: [{ title: r.title || host(r.url), url: r.url }],
          detail: `${r.total} found`,
          url: r.url,
        };
      }
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
              'Open the Rold side panel while this page is in front (click the Rold toolbar button, or right-click → Summarize this page with Rold), then ask again. ' +
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
      const page = await inject(tab.id, readPage, [MAX_TEXT, null, selector || '']);
      if (page.error) return { content: page.error, isError: true, url: page.url };
      if (!selector) noteRead(ctx, page);
      return {
        content: `Tab id=${tab.id}\nTitle: ${page.title}\nURL: ${page.url}\n\n${page.text || '(no text)'}`,
        sources: [{ title: page.title || host(page.url), url: page.url }],
        detail: page.title,
        url: page.url,
      };
    },
  },
  {
    name: 'open_tab',
    kind: 'tab',
    browserControl: true,
    description: 'Open a URL in a new tab in your "Rold" tab group and wait for it to load. Returns the new tab id. Opens in the background unless active=true.',
    parameters: obj({ url: str('Absolute http(s) URL.'), active: { type: 'boolean', description: 'Switch to the tab (default false).' } }, ['url']),
    label: (a) => `Opening ${host(a.url)}`,
    async run({ url, active }, ctx) {
      const tab = await openAgentTab(normalizeUrl(url), ctx, !!active);
      await waitForTab(tab.id);
      const t = await chrome.tabs.get(tab.id);
      return { content: `Opened tab id=${t.id}: ${t.title} (${t.url})`, url: t.url };
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
      return { content: `Tab id=${t.id} is now at: ${t.title} (${t.url})`, url: t.url };
    },
  },
  {
    name: 'get_page_elements',
    kind: 'tab',
    browserControl: true,
    parallel: true,
    description:
      'Get a structured view of a tab: headings, areas (navigation, forms, dialogs), and every interactive element with an id and its state (checked, expanded, current value, disabled). Covers shadow DOM and iframes (frame elements have ids like f3:7). Ids stay the same while the page lives. Call before click_element / type_text. Pass selector to focus on one part of a big page, include_text to also get the text around the controls.',
    parameters: obj({
      tab_id: TAB_ID,
      selector: str('CSS selector to limit the view to one part of the page (optional).'),
      include_text: { type: 'boolean', description: 'Also include paragraphs and other text (default false).' },
    }),
    label: (a) => (a.selector ? `Scanning ${String(a.selector).slice(0, 40)}` : 'Scanning page controls'),
    async run({ tab_id, selector, include_text }) {
      const tab = await targetTab(tab_id);
      if (!isWebUrl(tab.url)) return { content: `Tab id=${tab.id} (${tab.url}) is not a web page, so it can't be scanned.`, isError: true };
      const v = await pageView(tab.id, { selector: selector || '', text: !!include_text, limit: include_text ? 250 : 300 });
      if (v.error) return { content: v.error, isError: true };
      return { content: `Tab id=${tab.id} | ${v.title} | ${v.url}\n${v.text}`, detail: `${v.count} elements`, url: v.url };
    },
  },
  {
    name: 'click_element',
    kind: 'click',
    browserControl: true,
    description: 'Click an element by its id from get_page_elements. Returns what changed on the page afterwards. Set consequential=true for clicks that send, post, pay, buy, delete or submit.',
    parameters: obj({ tab_id: TAB_ID, element_id: EL_ID, consequential: CONSEQUENTIAL, ...DIALOG }, ['element_id']),
    label: (a) => `Clicking element ${a.element_id}`,
    async run(args, ctx) {
      const { tab_id, element_id, consequential } = args;
      const tab = await targetTab(tab_id);
      const { frameId, local } = parseEl(element_id);
      const d = await injectAt(tab.id, frameId, describeEl, [local]);
      if (!d) return { content: 'Element not found (the page changed). Call get_page_elements again.', isError: true };
      const crucial = !!consequential || crucialClick(d) || args.dialog === 'accept';
      const ok = await approve(ctx, `Click ${d.tag} “${d.label || '(no label)'}” on ${host(tab.url)}${args.dialog === 'accept' ? ' and answer OK to the page’s dialog' : ''}${d.filled ? `\nSends: ${d.filled}` : ''}`, crucial);
      if (!ok) return { content: DECLINED, isError: true };
      const before = await tabIds();
      await armPage(tab.id, frameId, dialogPlan(args, crucial));
      const r = await injectAt(tab.id, frameId, clickEl, [local]);
      if (!r?.ok) return { content: r?.error || 'Click failed.', isError: true };
      if (r.newTab) {
        const t = await openAgentTab(r.newTab, ctx);
        return { content: `Clicked ${d.tag} “${d.label}”: it opens in a new tab, now tab id=${t.id} (${r.newTab}).`, detail: d.label };
      }
      const after = await afterPageAction(tab.id, 900);
      const events = await pageEvents(tab.id, frameId, before, ctx);
      const warn = r.covered ? `\nWarning: ${r.covered} was on top of this element, so the page may not have received the click. Close that overlay first, or use click_at.` : '';
      return { content: `Clicked ${d.tag} “${d.label}”.${warn}${events}\n${after.text}`, detail: d.label, url: after.tab.url };
    },
  },
  {
    name: 'type_text',
    kind: 'type',
    browserControl: true,
    description: 'Type into an input, textarea or editable area by its id from get_page_elements (for a <select>, pass the option text; for a slider, date or color input, pass the value). Replaces the current value unless append=true. Optionally press Enter / submit afterwards. Returns what changed on the page.',
    parameters: obj(
      {
        tab_id: TAB_ID,
        element_id: EL_ID,
        text: str('Text to enter.'),
        append: { type: 'boolean', description: 'Add to the end of the current value instead of replacing it.' },
        submit: { type: 'boolean', description: 'Press Enter / submit the form afterwards.' },
        consequential: CONSEQUENTIAL,
      },
      ['element_id', 'text'],
    ),
    label: (a) => `Typing “${String(a.text || '').slice(0, 40)}”`,
    async run({ tab_id, element_id, text, append, submit, consequential }, ctx) {
      const tab = await targetTab(tab_id);
      const { frameId, local } = parseEl(element_id);
      const d = await injectAt(tab.id, frameId, describeEl, [local]);
      if (!d) return { content: 'Element not found (the page changed). Call get_page_elements again.', isError: true };
      if (d.password) return { content: 'Refused: that looks like a password, one-time code or payment field. Ask the user to fill it in.', isError: true };
      const crucial = !!consequential || (!!submit && !d.search);
      const ok = await approve(ctx, `Type “${text}” into “${d.label || d.tag}”${submit ? ' and submit' : ''} on ${host(tab.url)}`, crucial);
      if (!ok) return { content: DECLINED, isError: true };
      if (submit) await armPage(tab.id, frameId, dialogPlan({}, crucial));
      const r = await injectAt(tab.id, frameId, typeEl, [local, String(text), !!submit, !!append]);
      if (!r?.ok) return { content: r?.error || 'Typing failed.', isError: true };
      const after = await afterPageAction(tab.id, submit ? 1200 : 300);
      const events = submit ? await pageEvents(tab.id, frameId, null, ctx) : '';
      return { content: `${r.chose ? `Chose “${r.chose}” in` : 'Typed into'} “${d.label || d.tag}”.${events}\n${after.text}`, url: after.tab.url };
    },
  },
  {
    name: 'scroll_page',
    kind: 'tab',
    browserControl: true,
    description: 'Scroll a tab, or one scrollable part of it (a list, a chat, a side panel) by giving an element id inside it. "bottom" keeps scrolling while an endless feed loads more, so one call loads it all (up to about 20 seconds). Useful before get_page_elements or read_tab find on long or lazy-loading pages.',
    parameters: obj({ tab_id: TAB_ID, direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'] }, element_id: str('Scroll the scrollable area containing this element (optional).') }, ['direction']),
    label: (a) => `Scrolling ${a.direction}`,
    async run({ tab_id, direction, element_id }, ctx) {
      const tab = await targetTab(tab_id);
      const el = element_id == null || element_id === '' ? null : parseEl(element_id);
      const go = () => injectAt(tab.id, el?.frameId || 0, scrollEl, [direction, el ? el.local : null]);
      let r = await go();
      await sleep(600);
      let loads = 0;
      let quiet = 2;
      if (direction === 'bottom') {
        // Endless feeds grow when the bottom comes into view: keep going until the height settles.
        const until = Date.now() + 20000;
        for (quiet = 0; quiet < 2 && Date.now() < until;) {
          if (ctx?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          await sleep(quiet ? 900 : 300);
          const next = await go();
          if (next.max > r.max + 2) { loads++; quiet = 0; } else quiet++;
          r = next;
        }
      }
      const more = loads ? ` The page loaded more content ${loads} time${loads === 1 ? '' : 's'}${quiet < 2 ? ' and may still have more (scroll bottom again)' : ''}.` : '';
      return { content: `Scrolled ${direction}${r.element ? ' inside that area' : ''}. Position ${r.y}/${r.max}px.${r.y >= r.max - 2 && (direction === 'down' || direction === 'bottom') ? ' (at the end)' : ''}${more}` };
    },
  },
  {
    name: 'press_key',
    kind: 'type',
    browserControl: true,
    description: 'Press a key on a tab: on an element from get_page_elements, or on whatever is focused. Use for Enter, Escape (closes most popups and dialogs), Tab, arrows, PageDown etc.',
    parameters: obj(
      {
        tab_id: TAB_ID,
        key: { type: 'string', enum: ['Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'] },
        element_id: str('Element id from get_page_elements (optional).'),
        consequential: CONSEQUENTIAL,
        ...DIALOG,
      },
      ['key'],
    ),
    label: (a) => `Pressing ${a.key}`,
    async run(args, ctx) {
      const { tab_id, key, element_id, consequential } = args;
      const tab = await targetTab(tab_id);
      const k = key === 'Space' ? ' ' : key;
      const el = element_id == null || element_id === '' ? null : parseEl(element_id);
      const frameId = el?.frameId || 0;
      const d = await injectAt(tab.id, frameId, describeEl, [el ? el.local : null]);
      const crucial = !!consequential || args.dialog === 'accept' || (k === 'Enter' && !!d && !d.search && (d.multiline || d.submit || d.tag === 'input'));
      const ok = await approve(ctx, `Press ${key}${d?.label ? ` on “${d.label}”` : ''} on ${host(tab.url)}${args.dialog === 'accept' ? ' and answer OK to the page’s dialog' : ''}`, crucial);
      if (!ok) return { content: DECLINED, isError: true };
      const before = await tabIds();
      await armPage(tab.id, frameId, dialogPlan(args, crucial));
      const r = await injectAt(tab.id, frameId, pressKeyEl, [el ? el.local : null, k]);
      if (!r?.ok) return { content: r?.error || 'Key press failed.', isError: true };
      const after = await afterPageAction(tab.id, k === 'Enter' ? 1200 : 400);
      const events = await pageEvents(tab.id, frameId, before, ctx);
      return { content: `Pressed ${key}.${r.value != null ? ` The slider is now at ${r.value}.` : ''}${events}\n${after.text}`, url: after.tab.url };
    },
  },
  {
    name: 'batch_actions',
    kind: 'click',
    browserControl: true,
    description:
      'Run several page actions on one tab in a row, without a turn in between: fill a whole form, open a menu and pick an item, type and submit. Stops at the first failure and reports how far it got. Element ids come from get_page_elements (elements that only appear after an earlier step can be used if you already know their ids). Returns what changed on the page at the end. Use single actions instead when each step depends on what the page shows next.',
    parameters: obj(
      {
        tab_id: TAB_ID,
        actions: {
          type: 'array',
          description: 'Steps in order (up to 20).',
          items: obj(
            {
              action: { type: 'string', enum: ['click', 'type', 'key', 'scroll', 'wait', 'navigate'] },
              element_id: str('For click, type, and optionally key or scroll.'),
              text: str('For type: the text (for a <select>, the option).'),
              append: { type: 'boolean', description: 'For type: add instead of replace.' },
              submit: { type: 'boolean', description: 'For type: press Enter / submit after typing.' },
              key: str('For key: Enter, Escape, Tab, Backspace, Delete, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, PageUp, PageDown, Home, End.'),
              direction: str('For scroll: down, up, top or bottom.'),
              seconds: int('For wait: 1-10.'),
              url: str('For navigate: the URL.'),
            },
            ['action'],
          ),
        },
        consequential: CONSEQUENTIAL,
      },
      ['actions'],
    ),
    label: (a) => `Running ${(a.actions || []).length} page actions`,
    async run({ tab_id, actions, consequential }, ctx) {
      const tab = await targetTab(tab_id);
      const steps = (Array.isArray(actions) ? actions : []).slice(0, 20);
      if (!steps.length) return { content: 'No actions given.', isError: true };
      const crucialStep = (s, d) =>
        s.action === 'click' ? crucialClick(d)
        : s.action === 'type' ? !!s.submit && !d.search
        : s.key === 'Enter' && !d.search && (d.multiline || d.submit || d.tag === 'input');
      // One approval up front for the crucial steps that are already on the page.
      const approved = new Set();
      if (ctx.permission !== 'full') {
        const crucial = [];
        const typed = [];
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          if (!['click', 'type', 'key'].includes(s.action)) continue;
          let d = null;
          try {
            const el = s.element_id == null || s.element_id === '' ? null : parseEl(s.element_id);
            if (el || s.action === 'key') d = await injectAt(tab.id, el?.frameId || 0, describeEl, [el ? el.local : null]);
          } catch {}
          if (!d) continue;
          if (s.action === 'type' && d.password) return { content: `Refused: step ${i + 1} types into a password, one-time code or payment field. Ask the user to fill it in.`, isError: true };
          if (s.action === 'type') typed.push(`${d.label || d.tag}: ${String(s.text ?? '').replace(/\s+/g, ' ').slice(0, 60)}`);
          if (crucialStep(s, d)) {
            crucial.push(`${i + 1}. ${s.action} “${d.label || d.tag}”${s.action === 'click' && d.filled && !typed.length ? ` (sends: ${d.filled})` : ''}`);
            approved.add(i);
          }
        }
        if (crucial.length || consequential) {
          const ok = await approve(ctx, `Run ${steps.length} actions on ${host(tab.url)}, including:\n${crucial.join('\n') || 'a consequential step'}${crucial.length && typed.length ? `\nFilling in: ${typed.slice(0, 8).join(' · ')}` : ''}`, true);
          if (!ok) return { content: DECLINED, isError: true };
          if (consequential) steps.forEach((_, i) => approved.add(i));
        }
      }
      const log = [];
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        await ctx.gate?.();
        if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const n = `${i + 1}.`;
        try {
          const el = s.element_id == null || s.element_id === '' ? null : parseEl(s.element_id);
          if (s.action === 'click' || s.action === 'type') {
            if (!el) throw new Error('needs element_id');
            const d = await injectAt(tab.id, el.frameId, describeEl, [el.local]);
            if (!d) throw new Error(`element ${s.element_id} not found`);
            if (s.action === 'type' && d.password) throw new Error('that is a password or payment field; ask the user to fill it in');
            if (crucialStep(s, d) && !approved.has(i) && !(await approve(ctx, `${s.action === 'click' ? 'Click' : 'Type into'} “${d.label || d.tag}” on ${host(tab.url)}${s.action === 'click' && d.filled ? `\nSends: ${d.filled}` : ''}`, true))) {
              log.push(`${n} ${s.action} “${d.label}”: not approved by the user. Stopped.`);
              break;
            }
            const acts = s.action === 'click' || s.submit;
            const before = acts ? await tabIds() : null;
            if (acts) await armPage(tab.id, el.frameId, dialogPlan({}, approved.has(i) || (ctx.permission === 'full' && crucialStep(s, d))));
            const r = s.action === 'click'
              ? await injectAt(tab.id, el.frameId, clickEl, [el.local])
              : await injectAt(tab.id, el.frameId, typeEl, [el.local, String(s.text ?? ''), !!s.submit, !!s.append]);
            if (!r?.ok) throw new Error(r?.error || 'failed');
            if (r.newTab) {
              const t = await openAgentTab(r.newTab, ctx);
              log.push(`${n} clicked ${d.tag} “${d.label}”: it opens in a new tab, now tab id=${t.id} (${r.newTab}). Stopped here; continue on that tab.`);
              break;
            }
            log.push(`${n} ${s.action === 'click' ? 'clicked' : r.chose ? `chose “${r.chose}” in` : 'typed into'} ${d.tag} “${d.label}”${r.covered ? ` (warning: ${r.covered} was on top of it)` : ''}`);
            await sleep(acts ? 700 : 150);
            if (acts) {
              await waitForTab(tab.id, 8000);
              const events = await pageEvents(tab.id, el.frameId, before, ctx);
              if (events) log.push(events.trim());
            }
          } else if (s.action === 'key') {
            const k = s.key === 'Space' ? ' ' : String(s.key || '');
            if (!k) throw new Error('needs key');
            if (k === 'Enter' && !approved.has(i)) {
              const d = await injectAt(tab.id, el?.frameId || 0, describeEl, [el ? el.local : null]);
              if (d && crucialStep(s, d) && !(await approve(ctx, `Press Enter on “${d.label || d.tag}” on ${host(tab.url)}`, true))) {
                log.push(`${n} Enter: not approved by the user. Stopped.`);
                break;
              }
            }
            const r = await injectAt(tab.id, el?.frameId || 0, pressKeyEl, [el ? el.local : null, k]);
            if (!r?.ok) throw new Error(r?.error || 'failed');
            log.push(`${n} pressed ${s.key}`);
            await sleep(k === 'Enter' ? 900 : 200);
            if (k === 'Enter') await waitForTab(tab.id, 8000);
          } else if (s.action === 'scroll') {
            const r = await injectAt(tab.id, el?.frameId || 0, scrollEl, [s.direction || 'down', el ? el.local : null]);
            log.push(`${n} scrolled ${s.direction || 'down'} (${r.y}/${r.max}px)`);
            await sleep(400);
          } else if (s.action === 'wait') {
            const sec = Math.max(1, Math.min(10, s.seconds || 2));
            await sleep(sec * 1000);
            log.push(`${n} waited ${sec}s`);
          } else if (s.action === 'navigate') {
            await chrome.tabs.update(tab.id, { url: normalizeUrl(s.url) });
            await sleep(400);
            await waitForTab(tab.id);
            log.push(`${n} opened ${s.url}`);
          } else throw new Error(`unknown action "${s.action}"`);
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          log.push(`${n} ${s.action} failed: ${e.message}. Stopped here; later steps did not run.`);
          break;
        }
      }
      const after = await afterPageAction(tab.id, 300);
      const failed = /failed:|not approved/.test(log[log.length - 1] || '');
      return { content: `${log.join('\n')}\n\n${after.text}`, isError: failed, detail: `${log.length}/${steps.length} steps`, url: after.tab.url };
    },
  },
  {
    name: 'run_js',
    kind: 'code',
    browserControl: true,
    description:
      "Run JavaScript inside a tab's page, in the page's own context: full DOM access, the page's variables, and its logged-in session (fetch() sends the site's cookies). Write the body of an async function and return a value (objects come back as JSON, elements as HTML). Best for pulling structured data out of complex pages (tables, long lists, JSON embedded in the page), reading what the element view misses, or calling the site's own JSON endpoints. Set consequential=true if the code sends, posts, buys, deletes or changes anything; never use it to get around an approval.",
    parameters: obj({ tab_id: TAB_ID, code: str('Body of an async function. Use return to send back a result.'), consequential: CONSEQUENTIAL }, ['code']),
    label: () => 'Running a script in the page',
    async run({ tab_id, code, consequential }, ctx) {
      const tab = await targetTab(tab_id);
      if (!isWebUrl(tab.url)) return { content: "Can't run scripts on browser-internal pages.", isError: true };
      code = String(code || '');
      const ok = await approve(ctx, `Run a script on ${host(tab.url)}:\n${code.slice(0, 400)}`, !!consequential);
      if (!ok) return { content: DECLINED, isError: true };
      let r;
      try {
        const [res] = await withTimeout(
          chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: runInPage, args: [code] }),
          30000, 'The script took longer than 30 seconds.');
        r = res?.result;
      } catch (e) {
        r = { ok: false, error: e.message };
      }
      // Pages whose security policy forbids eval still run code through the debugger.
      if (r && !r.ok && r.blocked && ctx.computer) {
        await attachTab(tab, ctx);
        const ev = await cdp(tab.id, 'Runtime.evaluate', {
          expression: `(async () => {\n${code}\n})()`, awaitPromise: true, returnByValue: true, userGesture: true, timeout: 30000,
        });
        if (ev.exceptionDetails) r = { ok: false, error: ev.exceptionDetails.exception?.description || ev.exceptionDetails.text };
        else {
          const v = ev.result?.value;
          r = { ok: true, value: v === undefined ? 'undefined' : typeof v === 'string' ? v : JSON.stringify(v, null, 1) };
        }
      }
      if (!r?.ok) {
        const hint = r?.blocked && !ctx.computer ? ' (this site blocks injected code; with computer use on in Settings, Rold can run it another way)' : '';
        return { content: `Script error: ${r?.error || 'no result'}${hint}`, isError: true };
      }
      const out = String(r.value);
      return { content: out.length > 20000 ? `${out.slice(0, 20000)}\n[cut, ${out.length} characters in total]` : out, detail: `${out.length.toLocaleString()} chars`, url: tab.url };
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
      'See a tab: returns a screenshot of its visible area. Use it to understand visual layouts, canvas apps, maps, editors, charts and images, and to find x/y coordinates for click_at, scroll_at and drag. Works on background tabs. labels=true boxes every control with its element id (the same ids as get_page_elements) and lists them, so you can see the layout and then act by id with click_element / type_text: the best first look at an unfamiliar or visual page. Set show_user=true to also show the image under your answer, as proof that a browser task is done or when the user asked to see something.',
    parameters: obj({
      tab_id: TAB_ID,
      labels: { type: 'boolean', description: 'Box and number the controls with their element ids (default false).' },
      show_user: { type: 'boolean', description: 'Also show this screenshot to the user in the chat.' },
    }),
    label: (a) => (a.show_user ? 'Taking a screenshot for you' : a.labels ? 'Looking at the page layout' : 'Looking at the screen'),
    async run({ tab_id, labels, show_user }, ctx) {
      const tab = await controlTab(tab_id, ctx);
      let r;
      if (labels && !show_user) {
        // Fresh ids for the whole view, boxes drawn for the visible ones, then removed right after the capture.
        let view = null, marked = [];
        try {
          view = await pageView(tab.id, {});
          marked = (await injectAt(tab.id, 0, drawMarks, [true])) || [];
        } catch {}
        try {
          r = await screenshotResult(tab);
        } finally {
          injectAt(tab.id, 0, drawMarks, [false]).catch(() => {});
        }
        if (view && !view.error) {
          const ids = new Set(marked);
          const visible = view.text.split('\n').filter((l) => { const m = /^\s*\[(\d+)\]/.exec(l); return !m || ids.has(m[1]); }).join('\n');
          r.content += `\n${marked.length} visible controls are boxed and numbered with their element ids. Act on them with click_element / type_text by id; use click_at only for things without a box.\n${visible}`;
        }
      } else r = await screenshotResult(tab);
      if (!show_user || !r.image) return { ...r, url: tab.url };
      return { ...r, url: tab.url, showUser: true, content: r.content + '\nThis screenshot is shown to the user under your answer.' };
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
        ...DIALOG,
      },
      ['x', 'y'],
    ),
    label: (a) => `${{ double_click: 'Double-clicking', triple_click: 'Triple-clicking', right_click: 'Right-clicking', hover: 'Hovering' }[a.action] || 'Clicking'} at ${a.x}, ${a.y}`,
    async run(args, ctx) {
      const { tab_id, x, y, action = 'left_click', modifiers, consequential } = args;
      const tab = await controlTab(tab_id, ctx);
      const p = await toPage(tab.id, x, y);
      const d = await evalInTab(tab.id, pointInfo, p.x, p.y);
      const what = d ? `${d.tag}${d.label ? ` “${d.label}”` : ''}` : `point ${x}, ${y}`;
      let crucial = false;
      if (action !== 'hover') {
        crucial = !!consequential || (!!d && crucialClick(d)) || args.dialog === 'accept';
        const ok = await approve(ctx, `Click ${what} on ${host(tab.url)}${args.dialog === 'accept' ? ' and answer OK to the page’s dialog' : ''}`, crucial);
        if (!ok) return { content: 'The user did not approve this click. Do not retry it; ask them how to proceed.', isError: true };
      }
      const before = await tabIds();
      await armPage(tab.id, 0, dialogPlan(args, crucial));
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
      const events = await pageEvents(tab.id, 0, before, ctx);
      return { ...r, content: `${r.content}${events}`, detail: d?.label || undefined };
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
    description: 'Drag with the mouse from one point to another (sliders, maps, drawing, moving cards between lists). Give each end as screenshot coordinates or as an element id (from_id / to_id, e.g. a draggable card and the column to drop it in). Returns a new screenshot: check the result.',
    parameters: obj({
      tab_id: TAB_ID,
      from_id: str('Element id to drag (instead of from_x/from_y).'), to_id: str('Element id to drop onto (instead of to_x/to_y).'),
      from_x: COORD('Start X'), from_y: COORD('Start Y'), to_x: COORD('End X'), to_y: COORD('End Y'),
    }),
    label: (a) => (a.to_id ? `Dragging onto element ${a.to_id}` : `Dragging to ${a.to_x}, ${a.to_y}`),
    async run({ tab_id, from_id, to_id, from_x, from_y, to_x, to_y }, ctx) {
      const tab = await controlTab(tab_id, ctx);
      const end = async (id, x, y, which) => {
        if (id != null && id !== '') {
          const c = await injectAt(tab.id, 0, centerOfId, [String(id), which === 'start']);
          if (!c) throw new Error(`No element ${id} on the page. Call get_page_elements or screenshot labels=true again.`);
          return c;
        }
        if (x == null || y == null) throw new Error(`Give ${which === 'start' ? 'from_id or from_x/from_y' : 'to_id or to_x/to_y'}.`);
        return toPage(tab.id, x, y);
      };
      const a = await end(from_id, from_x, from_y, 'start');
      const b = await end(to_id, to_x, to_y, 'end');
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
    name: 'computer_batch',
    kind: 'click',
    browserControl: true,
    needsComputer: true,
    description:
      'Several real mouse and keyboard steps on one tab in a row, with one screenshot at the end instead of one per step. Use it when you already know where everything is: draw a shape and label it (drag, double_click, type, key Escape), click a few spots on a canvas, fill a field by coordinates. Coordinates are in the latest screenshot (they must still be right after the earlier steps). Stops at the first failure. Use single tools when you need to see the result of a step before the next.',
    parameters: obj(
      {
        tab_id: TAB_ID,
        steps: {
          type: 'array',
          description: 'Steps in order (up to 25).',
          items: obj(
            {
              action: { type: 'string', enum: ['click', 'double_click', 'right_click', 'hover', 'drag', 'type', 'key', 'scroll', 'wait'] },
              x: COORD('X (click, double_click, right_click, hover, scroll; drag start)'),
              y: COORD('Y (click, double_click, right_click, hover, scroll; drag start)'),
              to_x: COORD('Drag end X'),
              to_y: COORD('Drag end Y'),
              text: str('For type: text typed into whatever is focused.'),
              key: str('For key: a key or shortcut, e.g. "Enter", "Escape", "ctrl+a", "Delete".'),
              repeat: int('For key: times to press it, 1-50.'),
              direction: { type: 'string', enum: ['down', 'up', 'left', 'right'], description: 'For scroll.' },
              modifiers: str('For clicks and drags: keys held, e.g. "shift" (optional).'),
              seconds: int('For wait: 1-5.'),
            },
            ['action'],
          ),
        },
        consequential: CONSEQUENTIAL,
        ...DIALOG,
      },
      ['steps'],
    ),
    label: (a) => `Running ${(a.steps || []).length} mouse and keyboard steps`,
    async run(args, ctx) {
      const { tab_id, steps: raw, consequential } = args;
      const steps = (Array.isArray(raw) ? raw : []).slice(0, 25);
      if (!steps.length) return { content: 'No steps given.', isError: true };
      const tab = await controlTab(tab_id, ctx);
      for (const s of steps) if (s.action === 'key') parseCombo(s.key || ''); // validate keys first
      if (consequential && !(await approve(ctx, `Run ${steps.length} mouse and keyboard steps on ${host(tab.url)}`, true))) return { content: DECLINED, isError: true };
      const before = await tabIds();
      await armPage(tab.id, 0, dialogPlan(args, !!consequential));
      const mods = (m) => (m ? String(m).split('+').reduce((v, k) => v | (MODS[k.trim().toLowerCase()] || 0), 0) : 0);
      const log = [];
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        await ctx.gate?.();
        if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const n = `${i + 1}.`;
        try {
          if (['click', 'double_click', 'right_click', 'hover'].includes(s.action)) {
            const p = await toPage(tab.id, s.x, s.y);
            const d = await evalInTab(tab.id, pointInfo, p.x, p.y);
            const what = d ? `${d.tag}${d.label ? ` “${d.label}”` : ''}` : `point ${s.x}, ${s.y}`;
            if (s.action !== 'hover' && !consequential && d && crucialClick(d) && !(await approve(ctx, `Click ${what} on ${host(tab.url)}`, true))) {
              log.push(`${n} click on ${what}: not approved by the user. Stopped.`);
              break;
            }
            const m = mods(s.modifiers);
            await mouse(tab.id, 'mouseMoved', p.x, p.y, { modifiers: m });
            if (s.action !== 'hover') {
              const button = s.action === 'right_click' ? 'right' : 'left';
              const times = s.action === 'double_click' ? 2 : 1;
              for (let c = 1; c <= times; c++) {
                await mouse(tab.id, 'mousePressed', p.x, p.y, { button, buttons: button === 'right' ? 2 : 1, clickCount: c, modifiers: m });
                await mouse(tab.id, 'mouseReleased', p.x, p.y, { button, buttons: 0, clickCount: c, modifiers: m });
              }
            }
            log.push(`${n} ${s.action.replace('_', '-')} at ${s.x}, ${s.y}${d?.label ? ` (${what})` : ''}`);
            await sleep(s.action === 'hover' ? 250 : 350);
          } else if (s.action === 'drag') {
            const a = await toPage(tab.id, s.x, s.y);
            const b = await toPage(tab.id, s.to_x, s.to_y);
            const m = mods(s.modifiers);
            await mouse(tab.id, 'mouseMoved', a.x, a.y, { modifiers: m });
            await mouse(tab.id, 'mousePressed', a.x, a.y, { button: 'left', buttons: 1, clickCount: 1, modifiers: m });
            for (let k = 1; k <= 10; k++) {
              await mouse(tab.id, 'mouseMoved', a.x + ((b.x - a.x) * k) / 10, a.y + ((b.y - a.y) * k) / 10, { button: 'left', buttons: 1, modifiers: m });
              await sleep(16);
            }
            await mouse(tab.id, 'mouseReleased', b.x, b.y, { button: 'left', buttons: 0, clickCount: 1, modifiers: m });
            log.push(`${n} dragged ${s.x}, ${s.y} → ${s.to_x}, ${s.to_y}`);
            await sleep(300);
          } else if (s.action === 'type' || s.action === 'key') {
            const f = await evalInTab(tab.id, focusInfo);
            if (f?.secret) throw new Error('the focused field looks like a password, one-time code or payment field; ask the user to fill it in');
            if (s.action === 'type') {
              if (!s.text) throw new Error('needs text');
              await cdp(tab.id, 'Input.insertText', { text: String(s.text) });
              log.push(`${n} typed “${String(s.text).slice(0, 60)}”${f?.label ? ` in “${f.label}”` : ''}`);
              await sleep(150);
            } else {
              const k = String(s.key).toLowerCase().replace(/\s/g, '');
              const sends = /(^|\+)(enter|return)$/.test(k) && (k !== 'enter' && k !== 'return' ? true : !!f && !f.search && (f.multiline || f.tag === 'input'));
              if (sends && !consequential && !(await approve(ctx, `Press ${s.key}${f?.label ? ` in “${f.label}”` : ''} on ${host(tab.url)}`, true))) {
                log.push(`${n} ${s.key}: not approved by the user. Stopped.`);
                break;
              }
              const times = Math.max(1, Math.min(50, s.repeat || 1));
              for (let r = 0; r < times; r++) await pressCombo(tab.id, s.key);
              log.push(`${n} pressed ${s.key}${times > 1 ? ` ×${times}` : ''}`);
              await sleep(/enter|return/.test(k) ? 800 : 150);
            }
          } else if (s.action === 'scroll') {
            const p = await toPage(tab.id, s.x, s.y);
            const dir = s.direction || 'down';
            await mouse(tab.id, 'mouseMoved', p.x, p.y);
            await mouse(tab.id, 'mouseWheel', p.x, p.y, { deltaX: dir === 'right' ? 500 : dir === 'left' ? -500 : 0, deltaY: dir === 'down' ? 500 : dir === 'up' ? -500 : 0 });
            log.push(`${n} scrolled ${dir} at ${s.x}, ${s.y}`);
            await sleep(400);
          } else if (s.action === 'wait') {
            const sec = Math.max(1, Math.min(5, s.seconds || 1));
            await sleep(sec * 1000);
            log.push(`${n} waited ${sec}s`);
          } else throw new Error(`unknown action "${s.action}"`);
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          log.push(`${n} ${s.action} failed: ${e.message}. Stopped here; later steps did not run.`);
          break;
        }
      }
      const r = await afterAction(tab, 500, ctx, `${log.join('\n')}\n\n`);
      const events = await pageEvents(tab.id, 0, before, ctx);
      const failed = /failed:|not approved/.test(log[log.length - 1] || '');
      return { ...r, content: `${r.content}${events}`, isError: failed, detail: `${log.length}/${steps.length} steps` };
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
      if (ok && ctx.run) ctx.run.askedApproval = { text: String(action || '').toLowerCase(), at: Date.now() };
      return { content: ok ? 'Approved by the user.' : 'Declined by the user. Do not do it; ask how to proceed.', detail: ok ? 'Approved' : 'Declined' };
    },
  },
  {
    name: 'search_history',
    parallel: true,
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
      'Remember something for future chats (stored on this device; the user can see and edit it). kind "fact" = lasting info about the user (preferences, name, location, projects); kind "task" = a notable outcome of a task worth knowing later (not short-lived details like a 10-minute hold). Task memories are dated automatically. Never store secrets.',
    parameters: obj({ text: str('One short, self-contained sentence, without a date.'), kind: { type: 'string', enum: ['fact', 'task'] } }, ['text']),
    label: (a) => `Remembering: ${String(a.text || '').slice(0, 60)}`,
    async run({ text, kind }, ctx) {
      // The date is shown with each task memory, so drop one the model wrote in front.
      text = String(text || '').trim().replace(/^[([]?\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}[)\]]?[\s:,-]*/, '').slice(0, 500);
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
      'Schedule a task for later: repeating ("every morning", "check daily", "weekly summary") or once ("remind me at 5", "check back in an hour whether the order shipped"). By default each run starts a new chat; set continue_this_chat=true to wake this chat instead, which suits checking back on the current task. The user must approve.',
    parameters: obj(
      {
        name: str('Short name.'),
        instructions: str('Complete, self-contained instructions for each run (runs do not see this chat).'),
        schedule: { type: 'string', enum: ['interval', 'daily', 'weekdays', 'weekly', 'once'] },
        time: str('Local time HH:MM for daily / weekdays / weekly.'),
        weekday: int('0 = Sunday … 6 = Saturday, for weekly.'),
        interval_minutes: int('For interval (minimum 5).'),
        in_minutes: int('For once: run this many minutes from now.'),
        at: str('For once: local date and time, YYYY-MM-DD HH:MM.'),
        continue_this_chat: { type: 'boolean', description: 'Wake this chat on each run instead of starting a new one.' },
      },
      ['name', 'instructions', 'schedule'],
    ),
    label: (a) => `Scheduling “${a.name}”`,
    async run(a, ctx) {
      const schedule = scheduleFrom(a);
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
      return { content: `Routine created: ${r.name} (${desc}). First run: ${new Date(r.nextRun).toLocaleString()}. The user can manage it from Routines in the sidebar.`, detail: desc };
    },
  },
  {
    name: 'list_routines',
    kind: 'routine',
    parallel: true,
    description: "List the user's scheduled routines: id, schedule, status, next run, last run and instructions.",
    parameters: obj({}),
    label: () => 'Looking at routines',
    async run() {
      const all = Object.values(await getRoutines()).sort((a, b) => (b.created || 0) - (a.created || 0));
      if (!all.length) return { content: 'There are no routines.' };
      return {
        content: all.map((r) => {
          const last = r.runs?.[0];
          return `${r.id} | ${r.name} | ${describeSchedule(r.schedule)} | ${r.active ? 'active' : 'paused'} | ${r.kind === 'heartbeat' ? 'continues a chat' : 'new chat each run'}` +
            ` | next: ${r.active && r.nextRun ? new Date(r.nextRun).toLocaleString() : 'none'} | last run: ${last ? `${new Date(last.ts).toLocaleString()} (${last.status}${last.note ? `: ${last.note}` : ''})` : 'never'}` +
            `\n   Instructions: ${String(r.instructions).slice(0, 300)}`;
        }).join('\n'),
        detail: `${all.length} routines`,
      };
    },
  },
  {
    name: 'update_routine',
    kind: 'routine',
    description:
      'Change a routine by id (from list_routines): pause, resume, run_now, delete, or edit its name, instructions or schedule. A routine may pause itself once its job is done, for example a check that should stop when the thing it waits for has happened.',
    parameters: obj(
      {
        id: str('Routine id.'),
        action: { type: 'string', enum: ['pause', 'resume', 'run_now', 'delete', 'edit'] },
        name: str('For edit: new name.'),
        instructions: str('For edit: new self-contained instructions.'),
        schedule: { type: 'string', enum: ['interval', 'daily', 'weekdays', 'weekly', 'once'] },
        time: str('Local time HH:MM for daily / weekdays / weekly.'),
        weekday: int('0 = Sunday … 6 = Saturday, for weekly.'),
        interval_minutes: int('For interval (minimum 5).'),
        in_minutes: int('For once: run this many minutes from now.'),
        at: str('For once: local date and time, YYYY-MM-DD HH:MM.'),
      },
      ['id', 'action'],
    ),
    label: (a) => `${{ pause: 'Pausing', resume: 'Resuming', run_now: 'Running', delete: 'Deleting', edit: 'Editing' }[a.action] || 'Updating'} a routine`,
    async run(a, ctx) {
      const all = await getRoutines();
      const r = all[a.id];
      if (!r) return { content: `No routine with id ${a.id}. Use list_routines.`, isError: true };
      if (a.action === 'pause' || a.action === 'resume') {
        r.active = a.action === 'resume';
        if (r.active) r.nextRun = nextRunTime(r.schedule);
        await saveRoutine(r);
        return { content: `Routine “${r.name}” is ${r.active ? `active again. Next run: ${new Date(r.nextRun).toLocaleString()}` : 'paused'}.` };
      }
      if (a.action === 'run_now') {
        const res = await chrome.runtime.sendMessage({ type: 'runRoutine', id: r.id }).catch((e) => ({ ok: false, error: e.message }));
        return res?.ok ? { content: `Started a run of “${r.name}” in the background.` } : { content: `Could not start it: ${res?.error || 'unknown error'}.`, isError: true };
      }
      if (a.action === 'delete') {
        if (!(await ctx.confirm(`Delete routine “${r.name}”`))) return { content: 'The user did not approve deleting it.', isError: true };
        await deleteRoutine(r.id);
        return { content: `Deleted routine “${r.name}”.` };
      }
      const next = { ...r };
      if (a.name) next.name = String(a.name).slice(0, 80);
      if (a.instructions) next.instructions = String(a.instructions);
      if (a.schedule) next.schedule = scheduleFrom(a);
      const desc = describeSchedule(next.schedule);
      if (!(await ctx.confirm(`Change routine “${r.name}”: ${next.name !== r.name ? `rename to “${next.name}”, ` : ''}${a.instructions ? 'new instructions, ' : ''}${desc}`))) {
        return { content: 'The user did not approve the change.', isError: true };
      }
      next.nextRun = nextRunTime(next.schedule);
      await saveRoutine(next);
      return { content: `Updated “${next.name}” (${desc}). Next run: ${new Date(next.nextRun).toLocaleString()}.` };
    },
  },
  {
    name: 'read_skill',
    kind: 'read',
    parallel: true,
    description: 'Load a site guide by name (see "Site guides" in your instructions): direct URLs, search operators, how the site behaves, and what counts as consequential there. Guides also load by themselves the first time you visit a matching site.',
    parameters: obj({ name: str('Guide name, e.g. gmail.') }, ['name']),
    label: (a) => `Reading the ${a.name} guide`,
    async run({ name }, ctx) {
      const s = getSkill(name);
      if (!s) return { content: `No guide named "${name}". Available: ${SKILLS.map((x) => x.name).join(', ')}.`, isError: true };
      ctx.skillsSeen?.add(s.name);
      return { content: skillText(s), detail: s.title };
    },
  },
  {
    name: 'update_todos',
    kind: 'todo',
    silent: true,
    description:
      'Show the user a checklist for a multi-step task (3 or more steps) and keep it current. Send the whole list every time, with each item\'s status. Mark an item in_progress when you start it and done when it is verified; use blocked (with the reason in the text) for anything you could not finish. Skip it for quick questions.',
    parameters: obj(
      {
        todos: {
          type: 'array',
          items: obj({ text: str('The step, short.'), status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'blocked'] } }, ['text', 'status']),
        },
      },
      ['todos'],
    ),
    label: () => 'Updating the checklist',
    async run({ todos }) {
      const list = (Array.isArray(todos) ? todos : []).slice(0, 25)
        .map((t) => ({ text: String(t?.text || '').slice(0, 200), status: ['pending', 'in_progress', 'done', 'blocked'].includes(t?.status) ? t.status : 'pending' }))
        .filter((t) => t.text);
      const done = list.filter((t) => t.status === 'done').length;
      return { content: `Checklist updated (${done}/${list.length} done).`, todos: list };
    },
  },
  {
    name: 'ask_user',
    kind: 'ask',
    interactive: true,
    description:
      'Ask the user a question and wait for the answer. Only for decisions you truly cannot make yourself: a real choice between options with different outcomes, or details only they know. Ask everything you need in one question, offer short options when you can with your recommendation first, and never ask for a permission you already have or to confirm what they already said.',
    parameters: obj(
      {
        question: str('The question, self-contained.'),
        options: { type: 'array', items: { type: 'string' }, description: 'Up to 6 short answers to pick from, recommended first (optional).' },
        allow_text: { type: 'boolean', description: 'Let the user type their own answer (default true).' },
      },
      ['question'],
    ),
    label: (a) => `Asking: ${String(a.question || '').slice(0, 80)}`,
    async run({ question, options, allow_text }, ctx) {
      if (!ctx.ask) return { content: 'No one can answer right now. Pick the most sensible option, say what you assumed, and continue.' };
      const ans = await ctx.ask({
        question: String(question || ''),
        options: (Array.isArray(options) ? options : []).map((o) => String(o).slice(0, 120)).filter(Boolean).slice(0, 6),
        allowText: allow_text !== false,
      });
      if (ans == null || ans === '') return { content: 'The user skipped the question. Continue with the most sensible default and say what you assumed.', detail: 'Skipped' };
      return { content: `The user answered: ${ans}`, detail: String(ans).slice(0, 120) };
    },
  },
  {
    name: 'delegate',
    kind: 'delegate',
    noSub: true,
    description:
      'Send independent research jobs to helper agents that work at the same time (up to 4). Each helper can search the web, read pages and read tabs, but cannot click, type or see this chat. Give each a complete brief: what to find, where to look if you know, and exactly what to return (with source links). Use it to compare several options, check many sources, or research separate topics in parallel. Their reports come back together.',
    parameters: obj({ tasks: { type: 'array', items: { type: 'string' }, description: '1-4 self-contained briefs.' } }, ['tasks']),
    label: (a) => { const n = (a.tasks || []).length; return `Sending ${n} helper${n === 1 ? '' : 's'} to research`; },
    async run({ tasks }, ctx) {
      const list = (Array.isArray(tasks) ? tasks : []).map((t) => String(t || '').trim()).filter(Boolean).slice(0, 4);
      if (!list.length) return { content: 'Give at least one task.', isError: true };
      if (!ctx.delegate) return { content: 'Helpers are not available here. Do the research yourself.', isError: true };
      const out = await ctx.delegate(list);
      return { content: out.map((r, i) => `## Helper ${i + 1}: ${list[i].slice(0, 120)}\n${r}`).join('\n\n'), detail: `${list.length} reports` };
    },
  },
  {
    name: 'save_file',
    kind: 'file',
    available: () => !!chrome.downloads,
    description:
      "Save content you produced as a file in the user's Downloads folder (in a Rold subfolder): CSV for spreadsheets, Markdown, JSON, HTML, TXT, ICS calendar files, and so on. Use it when the user wants a file or an export, or the output is too long to read in chat.",
    parameters: obj({ filename: str('File name with extension, e.g. prices.csv.'), content: str('The full file content.') }, ['filename', 'content']),
    label: (a) => `Saving ${String(a.filename || 'a file').slice(0, 60)}`,
    async run({ filename, content }) {
      const name = String(filename || 'rold.txt').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^\.+/, '').slice(0, 120) || 'rold.txt';
      const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || 'txt').toLowerCase();
      const mime = MIME[ext] || 'text/plain';
      const text = String(content ?? '');
      const blob = new Blob([ext === 'csv' ? '﻿' + text : text], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      try {
        const id = await chrome.downloads.download({ url, filename: `Rold/${name}`, conflictAction: 'uniquify', saveAs: false });
        return { content: `Saved as Downloads/Rold/${name} (${blob.size.toLocaleString()} bytes, download id ${id}).`, detail: name };
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    },
  },
  {
    name: 'download_url',
    kind: 'file',
    browserControl: true,
    available: () => !!chrome.downloads,
    description: "Download a file from a URL into the user's Downloads folder (a PDF, an image, an export link). Uses the user's browser session.",
    parameters: obj({ url: str('Absolute http(s) URL of the file.'), filename: str('File name to save as (optional).') }, ['url']),
    label: (a) => `Downloading from ${host(a.url)}`,
    async run({ url, filename }, ctx) {
      url = normalizeUrl(url);
      if (!(await approve(ctx, `Download ${url}`, true))) return { content: DECLINED, isError: true };
      const opts = { url, conflictAction: 'uniquify', saveAs: false };
      if (filename) opts.filename = `Rold/${String(filename).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120)}`;
      const id = await chrome.downloads.download(opts);
      return { content: `Download started (id ${id}). It goes to the Downloads folder.`, detail: host(url) };
    },
  },
  {
    name: 'search_bookmarks',
    kind: 'search',
    parallel: true,
    needsExtra: 'bookmarks',
    available: () => !!chrome.bookmarks,
    description: "Search the user's bookmarks by words in the title or URL. With no query, lists the most recently added ones.",
    parameters: obj({ query: str('Words to look for (optional).'), max_results: int('1-50 (default 25).') }),
    label: (a) => (a.query ? `Searching bookmarks for “${a.query}”` : 'Looking at recent bookmarks'),
    async run({ query, max_results }) {
      const n = Math.max(1, Math.min(50, max_results || 25));
      const items = query ? await chrome.bookmarks.search(String(query)) : await chrome.bookmarks.getRecent(n);
      const list = items.filter((b) => b.url).slice(0, n);
      return {
        content: list.map((b) => `${b.title || '(no title)'} | ${b.url}${b.dateAdded ? ` | added ${new Date(b.dateAdded).toLocaleDateString()}` : ''}`).join('\n') || 'No bookmarks found.',
        detail: `${list.length} bookmarks`,
      };
    },
  },
  {
    name: 'add_bookmark',
    kind: 'memory',
    browserControl: true,
    needsExtra: 'bookmarks',
    available: () => !!chrome.bookmarks,
    description: 'Bookmark a page for the user. It goes into a "Rold" folder under Other bookmarks unless you name another folder.',
    parameters: obj({ url: str('Page URL.'), title: str('Bookmark title (optional).'), folder: str('Folder name (optional).') }, ['url']),
    label: (a) => `Bookmarking ${host(a.url)}`,
    async run({ url, title, folder }) {
      url = normalizeUrl(url);
      const parentId = await bookmarkFolder(String(folder || 'Rold').slice(0, 80));
      const b = await chrome.bookmarks.create({ parentId, title: String(title || url).slice(0, 200), url });
      return { content: `Bookmarked “${b.title}” in ${folder || 'Rold'}.` };
    },
  },
  {
    name: 'recently_closed',
    kind: 'tab',
    parallel: true,
    needsExtra: 'sessions',
    available: () => !!chrome.sessions,
    description: 'List tabs and windows the user closed recently, newest first. Pass restore with a session id to reopen one.',
    parameters: obj({ restore: str('Session id to reopen (optional).') }),
    label: (a) => (a.restore ? 'Reopening a closed tab' : 'Looking at recently closed tabs'),
    async run({ restore }, ctx) {
      if (restore) {
        if (ctx.permission === 'read') return { content: 'Reopening tabs needs Guard or Full access.', isError: true };
        const s = await chrome.sessions.restore(String(restore));
        const t = s?.tab || s?.window?.tabs?.[0];
        return { content: `Reopened ${s?.window ? `a window with ${s.window.tabs?.length || 0} tabs` : `tab id=${t?.id}: ${t?.title} (${t?.url})`}.` };
      }
      const list = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
      const when = (s) => new Date((s.lastModified || 0) * 1000).toLocaleString();
      return {
        content: list.map((s) => s.tab
          ? `tab ${s.tab.sessionId} | ${when(s)} | ${s.tab.title} | ${s.tab.url}`
          : `window ${s.window?.sessionId} | ${when(s)} | ${s.window?.tabs?.length || 0} tabs: ${(s.window?.tabs || []).slice(0, 4).map((t) => t.title).join('; ')}`).join('\n') || 'Nothing was closed recently.',
        detail: `${list.length} items`,
      };
    },
  },
  {
    name: 'search_memory',
    kind: 'memory',
    needsMemory: true,
    parallel: true,
    description: 'Search everything you remember about the user and past tasks. Your instructions only show the most recent memories, so search when something older may be relevant.',
    parameters: obj({ query: str('Words to look for.') }, ['query']),
    label: (a) => `Searching memory for “${a.query}”`,
    async run({ query }, ctx) {
      const list = await getMemories(ctx.settings);
      const hits = rank(list, query, (m) => m.text).slice(0, 25);
      return {
        content: hits.map((m) => `[${m.id}] ${m.kind === 'episodic' ? `(task, ${new Date(m.updated || m.created).toLocaleDateString()}) ` : ''}${m.text}`).join('\n') || 'Nothing matches.',
        detail: `${hits.length} memories`,
      };
    },
  },
  {
    name: 'search_past_reads',
    kind: 'search',
    needsMemory: true,
    needsReads: true,
    parallel: true,
    description: 'Search pages you read in earlier tasks (title, URL, opening text, date), newest first. Use it when the user refers to something you looked at before.',
    parameters: obj({ query: str('Words to look for (empty = most recent).') }),
    label: (a) => (a.query ? `Searching past reads for “${a.query}”` : 'Looking at recent reads'),
    async run({ query }) {
      const list = (await getReads()).slice().reverse();
      const hits = (query ? rank(list, query, (r) => `${r.title} ${r.url} ${r.excerpt}`) : list).slice(0, 20);
      return {
        content: hits.map((r) => `${new Date(r.ts).toLocaleString()} | ${r.title || '(no title)'} | ${r.url}\n   ${r.excerpt.slice(0, 240)}`).join('\n') || 'Nothing matches.',
        detail: `${hits.length} pages`,
      };
    },
  },
];

export function selectTools({ nativeSearch, permission, memory, history, headless, computer, sub = false, extras = {}, reads = true }) {
  return TOOLS.filter((t) =>
    !(t.clientSearch && nativeSearch) &&
    !(t.available && !t.available()) &&
    !(t.noSub && sub) &&
    !(t.needsComputer && !computer) &&
    !(t.browserControl && permission === 'read') &&
    !(t.needsMemory && !memory) &&
    !(t.needsHistory && !history) &&
    !(t.needsExtra && !extras?.[t.needsExtra]) && // optional permissions the user turned on in Settings
    !(t.needsReads && !reads) &&
    !(t.interactive && headless));
}

export async function currentPageInfo() {
  try {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (t && isWebUrl(t.url)) return { id: t.id, title: t.title, url: t.url };
  } catch {}
  return null;
}
