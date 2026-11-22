// Claude and ChatGPT subscription logins (OAuth, no API key).

const ANTHROPIC = {
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  redirectUri: 'https://platform.claude.com/oauth/code/callback',
  tokenUrls: [
    'https://platform.claude.com/v1/oauth/token',
    'https://console.anthropic.com/v1/oauth/token',
    'https://claude.ai/v1/oauth/token',
  ],
  scope: 'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload',
};

export const CLAUDE_OAUTH_BETA =
  'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,prompt-caching-scope-2026-01-05';

const OPENAI = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authBase: 'https://auth.openai.com',
  devicePage: 'https://auth.openai.com/codex/device',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    const part = token.split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function tokenRequest(url, params, json = false) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded' },
    body: json ? JSON.stringify(params) : new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) {
    const message = data?.error_description || data?.error?.message || data?.message || text.slice(0, 300) || res.statusText;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data || {};
}

function normalizeClaude(data) {
  if (!data?.access_token) throw new Error('Claude did not return a token.');
  return {
    access: data.access_token,
    refresh: data.refresh_token || '',
    expires: Date.now() + (Number(data.expires_in) || 36000) * 1000,
    label: data.account?.email_address || data.account?.email || data.email || '',
  };
}

function normalizeOpenAI(data) {
  if (!data?.access_token) throw new Error('ChatGPT did not return a token.');
  const claims = decodeJwt(data.id_token) || decodeJwt(data.access_token) || {};
  const accountId =
    claims.chatgpt_account_id ||
    claims['https://api.openai.com/auth']?.chatgpt_account_id ||
    claims.organizations?.[0]?.id ||
    '';
  return {
    access: data.access_token,
    refresh: data.refresh_token || '',
    expires: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    accountId,
    label: claims.email || claims['https://api.openai.com/profile']?.email || '',
  };
}

export async function exchangeClaudeCode(rawCode, verifier) {
  const code = String(rawCode || '').trim().split('#')[0];
  if (!code) throw new Error('Paste the code Claude showed you.');
  const params = {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: ANTHROPIC.clientId,
    redirect_uri: ANTHROPIC.redirectUri,
    state: verifier,
  };
  let lastError = null;
  for (let i = 0; i < ANTHROPIC.tokenUrls.length; i++) {
    try {
      return normalizeClaude(await tokenRequest(ANTHROPIC.tokenUrls[i], params, i > 0));
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Claude token exchange failed.');
}

async function refreshClaude(refreshToken) {
  if (!refreshToken) throw new Error('No Claude refresh token.');
  const params = { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: ANTHROPIC.clientId };
  let lastError = null;
  for (let i = 0; i < ANTHROPIC.tokenUrls.length; i++) {
    try {
      const data = await tokenRequest(ANTHROPIC.tokenUrls[i], params, i > 0);
      return {
        access: data.access_token,
        refresh: data.refresh_token || refreshToken,
        expires: Date.now() + (Number(data.expires_in) || 36000) * 1000,
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Claude token refresh failed.');
}

async function refreshChatGPT(refreshToken) {
  if (!refreshToken) throw new Error('No ChatGPT refresh token.');
  const data = await tokenRequest(`${OPENAI.authBase}/oauth/token`, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OPENAI.clientId,
  });
  return normalizeOpenAI({ ...data, refresh_token: data.refresh_token || refreshToken });
}

const refreshing = new Map();

async function persistOAuth(key, oauth) {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    if (!settings?.providers?.[key]) return;
    settings.providers[key].oauth = oauth;
    await chrome.storage.local.set({ settings });
  } catch {}
}

export async function ensureOAuth(key, cfg) {
  const oauth = cfg?.oauth;
  if (!oauth?.access) return null;
  if (!oauth.expires || oauth.expires > Date.now() + 60000) return oauth.access;
  const lock = `${key}:${oauth.refresh || ''}`;
  if (!refreshing.has(lock)) {
    const p = (async () => {
      const fresh = key === 'anthropic' ? await refreshClaude(oauth.refresh) : await refreshChatGPT(oauth.refresh);
      const next = { ...oauth, ...fresh, accountId: fresh.accountId || oauth.accountId, label: fresh.label || oauth.label };
      await persistOAuth(key, next);
      return next;
    })().finally(() => refreshing.delete(lock));
    refreshing.set(lock, p);
  }
  try {
    const fresh = await refreshing.get(lock);
    cfg.oauth = fresh;
    return fresh.access;
  } catch (err) {
    const e = new Error(`${key === 'anthropic' ? 'Claude' : 'ChatGPT'} login expired. Sign in again in Settings.`);
    e.status = 401;
    e.cause = err;
    throw e;
  }
}

function callbackCode(url, state) {
  if (!url || !/\/oauth\/code\/callback/.test(url)) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  const hash = new URLSearchParams(u.hash.replace(/^#/, ''));
  const code = u.searchParams.get('code') || hash.get('code');
  if (!code) return null;
  const gotState = u.searchParams.get('state') || hash.get('state');
  if (gotState && gotState !== state) return null;
  return code;
}

function waitForClaudeCode(tabId, state, timeoutMs = 5 * 60000) {
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
    const fail = () => finish(() => reject(new Error('Sign-in did not finish. Try connecting Claude again.')));
    const check = (url) => {
      const code = callbackCode(url, state);
      if (code) finish(() => resolve(code));
    };
    const onUpdated = (id, info, tab) => {
      if (id === tabId) check(info.url || tab?.url);
    };
    const onRemoved = (id) => {
      if (id === tabId) {
        const err = new Error('The Claude sign-in tab closed before authorization finished.');
        err.manual = true;
        finish(() => reject(err));
      }
    };
    const timer = setTimeout(fail, timeoutMs);
    const poll = setInterval(() => {
      chrome.tabs.get(tabId).then((tab) => check(tab.url), () => {});
    }, 1000);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

export async function connectClaude() {
  const { verifier, challenge } = await makePkce();
  const url = new URL(ANTHROPIC.authorizeUrl);
  url.search = new URLSearchParams({
    code: 'true',
    response_type: 'code',
    client_id: ANTHROPIC.clientId,
    redirect_uri: ANTHROPIC.redirectUri,
    scope: ANTHROPIC.scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: verifier,
  }).toString();
  const tab = await chrome.tabs.create({ url: url.toString(), active: true });
  try {
    const code = await waitForClaudeCode(tab.id, verifier);
    return await exchangeClaudeCode(code, verifier);
  } finally {
    if (tab?.id != null) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

export async function connectChatGPT({ onCode } = {}) {
  const started = await tokenRequest(`${OPENAI.authBase}/api/accounts/deviceauth/usercode`, { client_id: OPENAI.clientId }, true);
  const userCode = started.user_code;
  if (!userCode) throw new Error('ChatGPT did not return a sign-in code.');
  if (onCode) await onCode(userCode);
  const target = started.verification_uri_complete || started.verification_uri || OPENAI.devicePage;
  const tab = await chrome.tabs.create({ url: target, active: true });
  const interval = Math.max(Number(started.interval) || 5, 1) * 1000;
  const expiresAt = Date.parse(started.expires_at);
  const deadline = Number.isFinite(expiresAt) ? Math.min(expiresAt, Date.now() + 10 * 60000) : Date.now() + 10 * 60000;

  let authorized = null;
  try {
    while (!authorized) {
      if (Date.now() >= deadline) throw new Error('ChatGPT sign-in timed out. Try again.');
      const res = await fetch(`${OPENAI.authBase}/api/accounts/deviceauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_auth_id: started.device_auth_id, user_code: userCode }),
      });
      if (res.ok) {
        authorized = await res.json();
        break;
      }
      if (res.status !== 403 && res.status !== 404 && res.status !== 429) {
        const text = await res.text();
        let message = text.slice(0, 300);
        try { message = JSON.parse(text)?.error?.message || message; } catch {}
        throw new Error(message || `ChatGPT sign-in failed (${res.status}).`);
      }
      await sleep(interval + 3000);
    }
  } finally {
    if (tab?.id != null) chrome.tabs.remove(tab.id).catch(() => {});
  }

  if (!authorized?.authorization_code) throw new Error('ChatGPT did not return an authorization code.');
  const data = await tokenRequest(`${OPENAI.authBase}/oauth/token`, {
    grant_type: 'authorization_code',
    code: authorized.authorization_code,
    redirect_uri: `${OPENAI.authBase}/deviceauth/callback`,
    client_id: OPENAI.clientId,
    code_verifier: authorized.code_verifier || '',
  });
  return normalizeOpenAI(data);
}
