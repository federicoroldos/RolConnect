// ChatGPT sign-in: uses the user's ChatGPT plan (Plus, Pro, Business…) through the same
// OAuth login the Codex CLI uses. No API key.
//
// Flow: open OpenAI's sign-in page in a tab (PKCE). When it redirects to the local callback
// address, the tab's URL carries the code; we read it from the tab, close the tab, and
// exchange the code for tokens. Nothing listens on that address, and nothing needs to.

const OPENAI = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authBase: 'https://auth.openai.com',
  redirectUri: 'http://localhost:1455/auth/callback',
  scope: 'openid profile email offline_access',
};

function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makePkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

function decodeJwt(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function tokenRequest(params) {
  const res = await fetch(`${OPENAI.authBase}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) {
    const err = new Error(data?.error_description || data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || text.slice(0, 300) || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data || {};
}

// Tokens → what we store: access/refresh tokens, expiry, the ChatGPT account id and email.
function normalize(data, prev = {}) {
  if (!data?.access_token) throw new Error('ChatGPT did not return a token.');
  const id = decodeJwt(data.id_token) || {};
  const access = decodeJwt(data.access_token) || {};
  const auth = id['https://api.openai.com/auth'] || access['https://api.openai.com/auth'] || {};
  const expSec = Number(data.expires_in) || (access.exp ? access.exp - Date.now() / 1000 : 3600);
  return {
    access: data.access_token,
    refresh: data.refresh_token || prev.refresh || '',
    expires: Date.now() + Math.max(60, expSec) * 1000,
    accountId: auth.chatgpt_account_id || prev.accountId || '',
    plan: auth.chatgpt_plan_type || prev.plan || '',
    label: id.email || access['https://api.openai.com/profile']?.email || prev.label || '',
  };
}

function callbackParams(url, state) {
  if (!url || !url.startsWith(OPENAI.redirectUri)) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  const error = u.searchParams.get('error');
  if (error) return { error: u.searchParams.get('error_description') || error };
  const code = u.searchParams.get('code');
  if (!code || u.searchParams.get('state') !== state) return null;
  return { code };
}

// Resolves with the code once the sign-in tab reaches the callback address.
function waitForCallback(tabId, state, timeoutMs = 10 * 60000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      fn();
    };
    const check = (url) => {
      const r = callbackParams(url, state);
      if (!r) return;
      if (r.error) finish(() => reject(new Error(`ChatGPT sign-in failed: ${r.error}`)));
      else finish(() => resolve(r.code));
    };
    const onUpdated = (id, info, tab) => { if (id === tabId) check(info.url || tab?.url); };
    const onRemoved = (id) => {
      if (id === tabId) finish(() => reject(new Error('The sign-in tab was closed before sign-in finished.')));
    };
    const timer = setTimeout(() => finish(() => reject(new Error('Sign-in timed out. Try again.'))), timeoutMs);
    const poll = setInterval(() => chrome.tabs.get(tabId).then((t) => check(t.pendingUrl || t.url), () => {}), 1000);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

export async function connectChatGPT() {
  const { verifier, challenge } = await makePkce();
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const url = new URL(`${OPENAI.authBase}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: OPENAI.clientId,
    redirect_uri: OPENAI.redirectUri,
    scope: OPENAI.scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: 'codex_cli_rs',
  }).toString();
  const tab = await chrome.tabs.create({ url: url.toString(), active: true });
  let code;
  try {
    code = await waitForCallback(tab.id, state);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
  return normalize(await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: OPENAI.redirectUri,
    client_id: OPENAI.clientId,
    code_verifier: verifier,
  }));
}

// ---- keeping the login fresh ----

const refreshing = new Map();

async function storedOAuth(key) {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    return settings?.providers?.[key]?.oauth || null;
  } catch {
    return null;
  }
}

async function persistOAuth(key, oauth) {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    if (!settings?.providers?.[key]) return;
    settings.providers[key].oauth = oauth;
    await chrome.storage.local.set({ settings });
  } catch {}
}

const fresh = (o) => o?.access && (!o.expires || o.expires > Date.now() + 60000);

// Returns a valid access token, refreshing it when it is about to expire. Updates cfg.oauth.
export async function ensureOAuth(key, cfg) {
  if (!cfg?.oauth?.access) return null;
  if (fresh(cfg.oauth)) return cfg.oauth.access;
  // Another page (a routine, the side panel) may have refreshed it already. OpenAI rotates
  // refresh tokens, so using an old one would fail.
  const stored = await storedOAuth(key);
  if (stored?.access && (stored.expires || 0) > (cfg.oauth.expires || 0)) {
    cfg.oauth = stored;
    if (fresh(stored)) return stored.access;
  }
  const lock = `${key}:${cfg.oauth.refresh || ''}`;
  if (!refreshing.has(lock)) {
    const prev = cfg.oauth;
    const p = (async () => {
      if (!prev.refresh) throw new Error('No refresh token.');
      const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: prev.refresh, client_id: OPENAI.clientId, scope: OPENAI.scope });
      const next = normalize(data, prev);
      await persistOAuth(key, next);
      return next;
    })().finally(() => refreshing.delete(lock));
    refreshing.set(lock, p);
  }
  try {
    cfg.oauth = await refreshing.get(lock);
    return cfg.oauth.access;
  } catch (err) {
    const e = new Error('Your ChatGPT sign-in expired. Sign in again in Settings.');
    e.status = 401;
    e.cause = err;
    throw e;
  }
}
