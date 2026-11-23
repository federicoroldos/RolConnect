// Functions injected into web pages with chrome.scripting.executeScript. Each one must be
// self-contained (it is serialized), so small helpers are repeated inside them on purpose.
//
// The snapshot gives every interactive element a stable id that survives later snapshots
// (window.__rold lives in the extension's isolated world for the life of the page). It walks
// open shadow roots, marks states (checked, expanded, value…), keeps headings, landmarks and
// dialogs for structure, and can report only what changed since the previous snapshot.

export function snapshotPage(opts) {
  const o = opts || {};
  const limit = o.limit || 300;
  const S = (window.__rold ||= { ids: new WeakMap(), els: new Map(), next: 1, prev: null });
  for (const [id, ref] of S.els) { const e = ref.deref(); if (!e || !e.isConnected) S.els.delete(id); }

  const ROLES = /^(button|link|tab|menuitem|menuitemcheckbox|menuitemradio|checkbox|radio|switch|option|textbox|searchbox|combobox|slider|spinbutton|treeitem)$/;
  const AREA_ROLES = /^(navigation|main|banner|contentinfo|complementary|form|search|dialog|alertdialog|menu|listbox|tablist|toolbar|alert|grid|table|tree)$/;
  const AREA_TAGS = { NAV: 'navigation', MAIN: 'main', HEADER: 'banner', FOOTER: 'contentinfo', ASIDE: 'complementary', FORM: 'form', DIALOG: 'dialog', TABLE: 'table' };
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|META|LINK|HEAD|SLOT|BR|HR|IMG|VIDEO|AUDIO|CANVAS|OBJECT|PICTURE|SOURCE)$/;
  const TEXT_BLOCK = /^(P|LI|H[1-6]|TD|TH|DT|DD|BLOCKQUOTE|LABEL|FIGCAPTION|PRE|CAPTION|LEGEND)$/;
  const vh = innerHeight;
  const clean = (s, n = 80) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const idOf = (el) => {
    let id = S.ids.get(el);
    if (!id) { id = String(S.next++); S.ids.set(el, id); }
    S.els.set(id, new WeakRef(el));
    if (el.getAttribute('data-rold-id') !== id) el.setAttribute('data-rold-id', id);
    return id;
  };
  const byId = (root, id) => root.getElementById?.(id) || document.getElementById(id);
  const labelOf = (el) => {
    let t = el.getAttribute('aria-label') || '';
    const lb = el.getAttribute('aria-labelledby');
    if (!t && lb) t = lb.split(/\s+/).map((i) => byId(el.getRootNode(), i)?.textContent || '').join(' ');
    if (!t && el.labels && el.labels.length) t = el.labels[0].textContent;
    if (!t && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) t = el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '';
    if (!t) t = el.innerText || el.textContent || '';
    if (!clean(t)) t = el.getAttribute('title') || el.getAttribute('alt') || el.querySelector?.('img[alt]')?.getAttribute('alt') || (el.tagName === 'INPUT' ? el.value : '') || '';
    return clean(t);
  };
  const kindOf = (el) => {
    const tag = el.tagName;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'A' && el.hasAttribute('href')) return role && ROLES.test(role) && role !== 'link' ? role : 'link';
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
    if (tag === 'INPUT') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'hidden') return '';
      if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button';
      if (t === 'checkbox' || t === 'radio') return t;
      if (t === 'range') return 'slider';
      return t === 'text' ? 'input' : `input(${t})`;
    }
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'SELECT') return 'select';
    if (ROLES.test(role)) return role;
    if (el.isContentEditable && !(el.parentElement && el.parentElement.isContentEditable)) return 'editable';
    const clicky = el.hasAttribute('onclick') || (el.getAttribute('tabindex') !== null && el.tabIndex >= 0) || /\bclick\b/.test(el.getAttribute('jsaction') || '');
    if (clicky && getComputedStyle(el).cursor === 'pointer' &&
      !el.querySelector('a[href],button,input,textarea,select,[role=button],[role=link],[role=checkbox],[role=tab]')) return 'clickable';
    return '';
  };
  const states = (el, kind) => {
    const s = [];
    const a = (n) => el.getAttribute(n);
    if (kind === 'checkbox' || kind === 'radio') s.push(el.checked ? 'checked' : 'unchecked');
    else if (a('aria-checked')) s.push(a('aria-checked') === 'true' ? 'checked' : a('aria-checked') === 'mixed' ? 'mixed' : 'unchecked');
    if (a('aria-expanded')) s.push(a('aria-expanded') === 'true' ? 'expanded' : 'collapsed');
    if (a('aria-selected') === 'true' || (el.tagName === 'OPTION' && el.selected)) s.push('selected');
    if (a('aria-pressed') === 'true') s.push('pressed');
    if (a('aria-current') && a('aria-current') !== 'false') s.push('current');
    if (el.disabled || a('aria-disabled') === 'true') s.push('disabled');
    if (el.required || a('aria-required') === 'true') s.push('required');
    if (a('aria-invalid') === 'true') s.push('invalid');
    if (el.tagName === 'DETAILS' || el.tagName === 'SUMMARY') { const d = el.closest('details'); if (d) s.push(d.open ? 'expanded' : 'collapsed'); }
    return s;
  };
  const extra = (el, kind) => {
    let x = '';
    if (/^input|^textarea|^select|^editable|^combobox|^textbox|^searchbox|^slider|^spinbutton/.test(kind)) {
      const secret = el.type === 'password' || /cc-|one-time-code/.test(el.autocomplete || '');
      let v = el.tagName === 'SELECT' ? el.selectedOptions?.[0]?.text : el.isContentEditable ? el.innerText : el.value;
      v = clean(v, 100);
      if (v) x += ` value="${secret ? '•••' : v}"`;
      if (el.tagName === 'SELECT') {
        const opts = [...el.options].map((op) => clean(op.text, 30)).filter(Boolean);
        x += ` options: ${opts.slice(0, 12).join(' | ')}${opts.length > 12 ? ` | …${opts.length - 12} more` : ''}`;
      }
    }
    if (kind === 'link') {
      const h = el.getAttribute('href') || '';
      if (h && !/^javascript:|^#$/.test(h)) {
        try {
          const u = new URL(el.href);
          x += ` -> ${(u.origin === location.origin ? u.pathname + u.search + u.hash : u.href).slice(0, 100)}`;
        } catch {}
      }
    }
    return x;
  };
  const shown = (el) => {
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })) return false;
    return true;
  };

  const items = []; // { d: depth, id?, t: text, off?: offscreen, area?: true }
  let dialog = '';
  const walkKids = (node, d, quiet) => {
    if (node.shadowRoot) for (const c of node.shadowRoot.children) walk(c, d, quiet);
    for (const c of node.childNodes) {
      if (c.nodeType === 1) walk(c, d, quiet);
      else if (c.nodeType === 3 && o.text && !quiet) {
        const t = clean(c.nodeValue, 200);
        if (t.length > 1) items.push({ d, t });
      }
    }
  };
  const walk = (el, d, quiet) => {
    if (SKIP.test(el.tagName)) {
      if (el.tagName === 'IMG' && o.text && !quiet) { const alt = clean(el.getAttribute('alt'), 80); if (alt) items.push({ d, t: `image "${alt}"` }); }
      return;
    }
    if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
      const r = el.getBoundingClientRect();
      if (r.width > 20 && r.height > 20) items.push({ d, t: `frame "${clean(el.title || el.name || el.src, 60)}" (its elements are listed in a frame section)` });
      return;
    }
    if (!shown(el)) return;
    const role = (el.getAttribute('role') || '').toLowerCase();
    const heading = /^H[1-6]$/.test(el.tagName) ? +el.tagName[1] : role === 'heading' ? +(el.getAttribute('aria-level') || 2) : 0;
    if (heading) {
      const t = clean(el.innerText || el.textContent, 120);
      if (t) items.push({ d, t: `${'#'.repeat(Math.min(6, heading))} ${t}` });
      walkKids(el, d, true);
      return;
    }
    const kind = kindOf(el);
    if (kind) {
      const r = el.getBoundingClientRect();
      if (r.width >= 1 && r.height >= 1) {
        const st = states(el, kind);
        const off = r.bottom < 0 || r.top > vh;
        items.push({ d, id: idOf(el), t: `${kind} "${labelOf(el)}"${st.length ? ` (${st.join(', ')})` : ''}${extra(el, kind)}${off ? ' (offscreen)' : ''}`, off });
        if (kind === 'select' || kind === 'editable') return;
        walkKids(el, d + 1, true);
        return;
      }
    }
    const area = AREA_TAGS[el.tagName] || (AREA_ROLES.test(role) ? role : '');
    const modal = el.getAttribute('aria-modal') === 'true' || (el.tagName === 'DIALOG' && el.open) || /dialog/.test(role);
    if (area || modal) {
      const name = clean(el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && byId(el.getRootNode(), el.getAttribute('aria-labelledby'))?.textContent) || '', 60);
      if (modal && !dialog) dialog = name || 'untitled';
      const at = items.length;
      items.push({ d, t: `${modal ? 'dialog' : area}${name ? ` "${name}"` : ''}:`, area: true });
      walkKids(el, d + 1, quiet);
      if (items.length === at + 1) items.pop(); // empty area
      return;
    }
    if (o.text && !quiet && TEXT_BLOCK.test(el.tagName) && !el.querySelector('a[href],button,input,textarea,select,[role],[contenteditable],[tabindex],iframe')) {
      const t = clean(el.innerText, 300);
      if (t) items.push({ d, t: el.tagName === 'LI' ? `- ${t}` : t });
      return;
    }
    walkKids(el, d, quiet);
  };

  let root = document.body || document.documentElement;
  if (o.selector) {
    try { root = document.querySelector(o.selector); } catch { return { error: `Invalid selector: ${o.selector}` }; }
    if (!root) return { error: `Nothing matches the selector ${o.selector} on this page.` };
  }
  if (root) walkKids(root, 0, false);

  // Too many elements: drop the offscreen ones first, then cut.
  let omitted = 0;
  let list = items;
  const count = () => list.filter((i) => i.id).length;
  if (count() > limit) {
    const before = count();
    list = list.filter((i) => !i.off);
    omitted = before - count();
  }
  let cut = 0;
  if (count() > limit) {
    let n = 0;
    const keep = [];
    for (const i of list) { if (i.id && ++n > limit) { cut++; continue; } keep.push(i); }
    list = keep;
  }
  const keyOf = (i) => `${i.id || ''}|${i.t.replace(/ \(offscreen\)$/, '')}`;
  const keys = list.map(keyOf);
  const here = location.origin + location.pathname;
  let changes = null;
  if (o.diff && S.prev && S.prev.page === here) {
    const old = new Set(S.prev.keys);
    const now = new Set(keys);
    const added = list.filter((i, j) => !old.has(keys[j]));
    let removed = 0;
    for (const k of old) if (!now.has(k)) removed++;
    changes = { added: added.map(({ d, id, t }) => ({ d: 0, id, t })), removed };
  }
  S.prev = { page: here, keys };
  return {
    title: document.title,
    url: location.href,
    items: list.map(({ d, id, t }) => ({ d, id, t })),
    changes,
    dialog,
    omitted,
    cut,
    scroll: { y: Math.round(scrollY), max: Math.max(0, document.documentElement.scrollHeight - innerHeight) },
  };
}

// id == null describes the focused element.
export function describeEl(id) {
  const find = (i) => { const r = window.__rold?.els.get(String(i)); const e = r && r.deref(); return e && e.isConnected ? e : document.querySelector(`[data-rold-id="${i}"]`); };
  let el;
  if (id == null) { el = document.activeElement; while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement; }
  else el = find(id);
  if (!el || el === document.body) return null;
  const raw = el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') || '';
  const isSearch = (e) =>
    !!e && (e.type === 'search' || e.getAttribute('role') === 'searchbox' ||
      /search|buscar|query|^q$/i.test(`${e.name || ''} ${e.getAttribute('placeholder') || ''} ${e.getAttribute('aria-label') || ''}`));
  const form = el.form || el.closest('form');
  return {
    tag: el.tagName.toLowerCase(),
    type: el.type || '',
    label: String(raw).trim().replace(/\s+/g, ' ').slice(0, 80),
    password: el.type === 'password' || /cc-|one-time-code/.test(el.autocomplete || '') || /card.?num|cvc|cvv|iban/i.test(el.name || ''),
    submit: (el.tagName === 'BUTTON' && !!form && (el.getAttribute('type') || 'submit') === 'submit') || (el.tagName === 'INPUT' && el.type === 'submit'),
    multiline: el.tagName === 'TEXTAREA' || el.isContentEditable,
    search: isSearch(el) || !!el.closest('[role=search]') || !!form?.querySelector('input[type=search],[role=searchbox],input[name=q]'),
  };
}

export function clickEl(id) {
  const ref = window.__rold?.els.get(String(id));
  let el = ref && ref.deref();
  if (!el || !el.isConnected) el = document.querySelector(`[data-rold-id="${id}"]`);
  if (!el) return { ok: false, error: 'Element not found (the page changed). Call get_page_elements again.' };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  // Is something else on top of it (a cookie banner, an overlay, a dialog)?
  let covered = '';
  let top = document.elementFromPoint(x, y);
  while (top && top.shadowRoot) { const inner = top.shadowRoot.elementFromPoint(x, y); if (!inner || inner === top) break; top = inner; }
  if (top && top !== el && !el.contains(top) && !top.contains(el) && !(el.labels && [...el.labels].some((l) => l.contains(top)))) {
    covered = `${top.tagName.toLowerCase()} "${String(top.getAttribute('aria-label') || top.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60)}"`;
  }
  const opts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window };
  try {
    el.dispatchEvent(new PointerEvent('pointerover', opts));
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, buttons: 1, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...opts, buttons: 1 }));
    el.focus?.({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
  } catch {}
  el.click();
  return { ok: true, covered };
}

export function typeEl(id, text, submit, append) {
  const ref = window.__rold?.els.get(String(id));
  let el = ref && ref.deref();
  if (!el || !el.isConnected) el = document.querySelector(`[data-rold-id="${id}"]`);
  if (!el) return { ok: false, error: 'Element not found (the page changed). Call get_page_elements again.' };
  if (el.type === 'password') return { ok: false, error: 'Typing into password fields is not allowed. Ask the user to do it.' };
  el.scrollIntoView({ block: 'center' });
  el.focus();
  if (el.isContentEditable) {
    const sel = getSelection();
    if (append) { sel.selectAllChildren(el); sel.collapseToEnd(); }
    else document.execCommand('selectAll', false);
    if (!document.execCommand('insertText', false, text)) {
      el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true }));
      if (!append) el.textContent = '';
      el.append(text);
      el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }));
    }
  } else if (el.tagName === 'SELECT') {
    const want = String(text).trim().toLowerCase();
    const opt = [...el.options].find((o) => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want) ||
      [...el.options].find((o) => o.text.toLowerCase().includes(want));
    if (!opt) return { ok: false, error: `No option matching "${text}". Options: ${[...el.options].map((o) => o.text.trim()).join(' | ').slice(0, 500)}` };
    el.value = opt.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (/^(INPUT|TEXTAREA)$/.test(el.tagName)) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, append ? el.value + text : text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    return { ok: false, error: `Element ${id} is a ${el.tagName.toLowerCase()}, not a text field. Click it first or pick the input inside it.` };
  }
  if (submit) {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    const notCancelled = el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
    const form = el.form || el.closest?.('form');
    if (notCancelled && form) form.requestSubmit ? form.requestSubmit() : form.submit();
  }
  return { ok: true };
}

export function pressKeyEl(id, key) {
  let el;
  if (id == null) {
    el = document.activeElement || document.body;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  } else {
    const ref = window.__rold?.els.get(String(id));
    el = ref && ref.deref();
    if (!el || !el.isConnected) el = document.querySelector(`[data-rold-id="${id}"]`);
  }
  if (!el) return { ok: false, error: 'Element not found. Call get_page_elements again.' };
  if (id != null) { el.scrollIntoView({ block: 'center' }); el.focus?.(); }
  const codes = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46, ' ': 32, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, PageUp: 33, PageDown: 34, Home: 36, End: 35 };
  const opts = { key, code: key === ' ' ? 'Space' : key, keyCode: codes[key] || 0, which: codes[key] || 0, bubbles: true, cancelable: true, composed: true };
  const notCancelled = el.dispatchEvent(new KeyboardEvent('keydown', opts));
  if (key === 'Enter' || key === ' ') el.dispatchEvent(new KeyboardEvent('keypress', opts));
  el.dispatchEvent(new KeyboardEvent('keyup', opts));
  if (notCancelled) {
    const form = el.form || el.closest?.('form');
    if (key === 'Enter' && form && el.tagName === 'INPUT') form.requestSubmit ? form.requestSubmit() : form.submit();
    else if (key === 'Enter' && /^(A|BUTTON|SUMMARY)$/.test(el.tagName)) el.click();
    else if (key === 'Escape' && el.closest?.('dialog[open]')) el.closest('dialog[open]').close?.();
    else if (['PageDown', 'PageUp', 'Home', 'End', ' '].includes(key) && !el.isContentEditable && !/INPUT|TEXTAREA|SELECT/.test(el.tagName)) {
      const h = innerHeight * 0.85;
      if (key === 'Home') scrollTo(0, 0);
      else if (key === 'End') scrollTo(0, document.documentElement.scrollHeight);
      else scrollBy(0, key === 'PageUp' ? -h : h);
    }
  }
  return { ok: true };
}

// Scrolls the page, or one scrollable element (a list, a side panel) by its id.
export function scrollEl(direction, id) {
  let target = null;
  if (id != null) {
    const ref = window.__rold?.els.get(String(id));
    let el = ref && ref.deref();
    if (!el || !el.isConnected) el = document.querySelector(`[data-rold-id="${id}"]`);
    // The element itself may not scroll: use its nearest scrollable ancestor.
    for (let e = el; e && e !== document.body; e = e.parentElement || e.getRootNode().host) {
      const st = getComputedStyle(e);
      if (/(auto|scroll)/.test(st.overflowY) && e.scrollHeight > e.clientHeight + 4) { target = e; break; }
    }
  }
  const box = target || document.scrollingElement || document.documentElement;
  const amount = Math.round((target ? target.clientHeight : innerHeight) * 0.85);
  if (direction === 'top') box.scrollTo(0, 0);
  else if (direction === 'bottom') box.scrollTo(0, box.scrollHeight);
  else box.scrollBy(0, direction === 'up' ? -amount : amount);
  return { y: Math.round(box.scrollTop), max: Math.max(0, box.scrollHeight - box.clientHeight), element: !!target };
}

// Runs model-written code in the page's own JavaScript world (MAIN). Serializes the result.
export async function runInPage(src) {
  const ser = (v, depth = 0) => {
    if (v === undefined) return 'undefined';
    if (typeof v === 'string') return v;
    if (v instanceof Element) return v.outerHTML.slice(0, 3000);
    if (v instanceof NodeList || v instanceof HTMLCollection) v = [...v].map((n) => (n instanceof Element ? (n.innerText || n.textContent || '').trim().slice(0, 300) : String(n)));
    try { return JSON.stringify(v, (k, x) => (x instanceof Element ? `<${x.tagName.toLowerCase()}> ${(x.innerText || '').trim().slice(0, 200)}` : x), 1); } catch { return String(v); }
  };
  try {
    const fn = new Function(`return (async () => {\n${src}\n})()`);
    return { ok: true, value: ser(await fn()) };
  } catch (e) {
    const msg = String(e && e.message || e);
    return { ok: false, error: msg, blocked: e instanceof EvalError || /unsafe-eval|Content Security Policy|TrustedScript|Trusted Type/i.test(msg) };
  }
}
