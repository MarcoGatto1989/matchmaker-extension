// Runs before popup.js. It keeps the legacy popup UI but routes every ESOS request
// through the canonical CRM/API domain and turns an existing HttpOnly browser session
// into a successful extension login without sending the stored password again.
(() => {
  'use strict';

  const ESOS_V415_API_BASE = 'https://app.esos.cloud';
  const ESOS_V415_LEGACY_RAILWAY_ORIGIN = `https://${['executive', 'sphere', 'production'].join('-')}.up.railway.app`;
  const ESOS_V415_LEGACY_ORIGINS = new Set([
    ESOS_V415_LEGACY_RAILWAY_ORIGIN,
    'https://esos.cloud',
    'https://www.esos.cloud',
  ]);
  const nativeFetch = globalThis.fetch.bind(globalThis);
  let sessionPromise = null;
  const ESOS_V415_TEST_API_BASE = 'https://esos-frontend-test.up.railway.app';

  async function esosV415ConfiguredApiBase() {
    const settings = await chrome.storage.local.get('esos_url');
    return String(settings?.esos_url || '').trim().replace(/\/$/, '') === ESOS_V415_TEST_API_BASE
      ? ESOS_V415_TEST_API_BASE : ESOS_V415_API_BASE;
  }

  function esosV415RewriteUrl(raw) {
    try {
      const url = new URL(String(raw || ''));
      if (url.origin === ESOS_V415_API_BASE || ESOS_V415_LEGACY_ORIGINS.has(url.origin)) {
        const target = new URL(ESOS_V415_API_BASE);
        url.protocol = target.protocol;
        url.host = target.host;
      }
      return url.toString();
    } catch (_) {
      return raw;
    }
  }

  async function esosV415CookieToken(apiBase) {
    try {
      const cookie = await chrome.cookies.get({
        url: `${apiBase}/`,
        name: 'esos_token',
      });
      return cookie?.value || '';
    } catch (_) {
      return '';
    }
  }

  async function esosV415BrowserSession() {
    if (sessionPromise) return sessionPromise;
    sessionPromise = (async () => {
      const apiBase = await esosV415ConfiguredApiBase();
      // Ask the service worker first so storage and the worker queue use the same session.
      try {
        await chrome.runtime.sendMessage({ type: 'SYNC_ESOS_SESSION' });
      } catch (_) {}

      const token = await esosV415CookieToken(apiBase);
      if (!token) return null;

      try {
        const response = await nativeFetch(`${apiBase}/api/auth/me`, {
          method: 'GET',
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return null;
        const user = await response.json();
        try {
          await chrome.storage.local.set({
            esos_url: apiBase,
            esos_jwt: token,
            esos_jwt_source: 'browser_cookie',
          });
        } catch (_) {}
        return { token, user };
      } catch (_) {
        return null;
      }
    })();

    try {
      return await sessionPromise;
    } finally {
      sessionPromise = null;
    }
  }

  globalThis.fetch = async function esosV415PopupFetch(input, init = {}) {
    const rawUrl = typeof input === 'string' ? input : String(input?.url || '');
    const rewrittenUrl = esosV415RewriteUrl(rawUrl);

    // The old popup automatically falls back to /auth/login. When an ESOS browser
    // session already exists, satisfy that request from the validated HttpOnly
    // session instead of re-sending the password and incrementing the login throttle.
    if (/\/api\/auth\/login(?:\?|$)/.test(rewrittenUrl)) {
      const session = await esosV415BrowserSession();
      if (session?.token) {
        return new Response(JSON.stringify({ token: session.token, user: session.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (typeof input === 'string') {
      return nativeFetch(rewrittenUrl, init);
    }

    try {
      const request = new Request(rewrittenUrl, input);
      return nativeFetch(request, init);
    } catch (_) {
      return nativeFetch(input, init);
    }
  };

  async function esosV415RefreshPopupSession() {
    const session = await esosV415BrowserSession();
    const apiBase = await esosV415ConfiguredApiBase();
    const input = document.getElementById('esos-url');
    if (input) input.value = apiBase;
    // Never overwrite the user's explicit test selection on popup open.
    try { await chrome.storage.local.set({ esos_url: apiBase }); } catch (_) {}

    if (!session?.token) return;
    try { esosToken = session.token; } catch (_) {}

    const badge = document.getElementById('esos-badge');
    const badgeText = document.getElementById('esos-badge-text');
    if (badge) badge.className = 'conn-badge ok';
    if (badgeText) badgeText.textContent = 'ESOS ✓';

    const status = document.getElementById('settings-status');
    if (status && /login fehlgeschlagen|nicht eingeloggt|zu viele anmeldeversuche/i.test(status.textContent || '')) {
      status.textContent = `✅ ESOS verbunden über aktive Browser-Sitzung${session.user?.fullName ? ` · ${session.user.fullName}` : ''}`;
      status.style.color = '#16a34a';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => { esosV415RefreshPopupSession().catch(() => {}); }, 0);
    setTimeout(() => { esosV415RefreshPopupSession().catch(() => {}); }, 350);
  }, { once: true });
})();
