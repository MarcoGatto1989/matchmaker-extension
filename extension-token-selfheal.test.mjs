import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./service-worker-v418.js', import.meta.url), 'utf8');

function makeContext({ extensionToken = '', sessionToken = 'session-jwt', heartbeatStatuses = [200], rotateStatus = 200 } = {}) {
  const storage = {
    extension_token: extensionToken,
    esos_jwt: sessionToken,
    esos_jwt_source: 'browser_cookie',
    esos_url: 'https://app.esos.cloud',
  };
  const calls = [];
  let heartbeatIndex = 0;
  const listeners = { installed: [], startup: [], message: [] };

  const context = {
    console,
    URL,
    setTimeout: () => 0,
    clearTimeout: () => {},
    importScripts: () => {},
    Response,
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/api/outreach-ext/heartbeat')) {
        const status = heartbeatStatuses[Math.min(heartbeatIndex, heartbeatStatuses.length - 1)];
        heartbeatIndex += 1;
        return new Response('{}', { status, headers: { 'Content-Type': 'application/json' } });
      }
      if (String(url).endsWith('/api/outreach/config/regenerate-token')) {
        return new Response(JSON.stringify({ token: 'MM-EXT-auto-generated' }), {
          status: rotateStatus,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    },
    safeFetch: async (url, init) => context.fetch(url, init),
    processNextJob: async () => {},
    sendHeartbeat: async () => ({ connected: false }),
    getToken: async () => storage.extension_token || '',
    getApiBase: async () => storage.esos_url,
    chrome: {
      storage: {
        local: {
          get(keys, callback) {
            const requested = Array.isArray(keys) ? keys : [keys];
            const result = Object.fromEntries(requested.map(key => [key, storage[key]]));
            if (callback) callback(result);
            return Promise.resolve(result);
          },
          set(values, callback) {
            Object.assign(storage, values);
            if (callback) callback();
            return Promise.resolve();
          },
          remove(keys) {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
            return Promise.resolve();
          },
        },
      },
      runtime: {
        onInstalled: { addListener(fn) { listeners.installed.push(fn); } },
        onStartup: { addListener(fn) { listeners.startup.push(fn); } },
        onMessage: { addListener(fn) { listeners.message.push(fn); } },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'service-worker-v418.js' });
  return { context, storage, calls };
}

test('keeps a valid tenant extension token without rotating it', async () => {
  const { context, storage, calls } = makeContext({ extensionToken: 'MM-EXT-existing', heartbeatStatuses: [200] });
  const result = await context.esosV418EnsureExtensionToken();
  assert.equal(result.connected, true);
  assert.equal(storage.extension_token, 'MM-EXT-existing');
  assert.equal(calls.some(call => call.url.endsWith('/api/outreach/config/regenerate-token')), false);
});

test('creates a tenant extension token when the browser has none', async () => {
  const { context, storage, calls } = makeContext({ extensionToken: '', heartbeatStatuses: [200] });
  const result = await context.esosV418EnsureExtensionToken();
  assert.equal(result.connected, true);
  assert.equal(storage.extension_token, 'MM-EXT-auto-generated');
  const rotation = calls.find(call => call.url.endsWith('/api/outreach/config/regenerate-token'));
  assert.ok(rotation);
  assert.equal(rotation.init.method, 'POST');
  assert.equal(rotation.init.headers.Authorization, 'Bearer session-jwt');
});

test('replaces an explicitly rejected tenant extension token', async () => {
  const { context, storage } = makeContext({ extensionToken: 'MM-EXT-stale', heartbeatStatuses: [401, 200] });
  const result = await context.esosV418EnsureExtensionToken();
  assert.equal(result.connected, true);
  assert.equal(storage.extension_token, 'MM-EXT-auto-generated');
});
