import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./service-worker-v418.js', import.meta.url), 'utf8');

function makeContext({ extensionToken = '', sessionToken = 'session-jwt', heartbeatStatus = 200, rotateStatus = 200 } = {}) {
  const storage = {
    extension_token: extensionToken,
    esos_jwt: sessionToken,
    esos_jwt_source: 'browser_cookie',
    esos_url: 'https://app.esos.cloud',
  };
  const calls = [];
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
        return new Response('{}', { status: heartbeatStatus, headers: { 'Content-Type': 'application/json' } });
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
  const { context, storage, calls } = makeContext({ extensionToken: 'MM-EXT-existing', heartbeatStatus: 200 });
  const result = await context.esosV418EnsureExtensionToken();
  assert.equal(result.connected, true);
  assert.equal(storage.extension_token, 'MM-EXT-existing');
  assert.equal(calls.some(call => call.url.endsWith('/api/outreach/config/regenerate-token')), false);
});

test('replaces a missing or rejected extension token from the active ESOS browser session', async () => {
  const { context, storage, calls } = makeContext({ extensionToken: '', heartbeatStatus: 401 });
  const result = await context.esosV418EnsureExtensionToken();
  assert.equal(result.connected, true);
  assert.equal(storage.extension_token, 'MM-EXT-auto-generated');
  const rotation = calls.find(call => call.url.endsWith('/api/outreach/config/regenerate-token'));
  assert.ok(rotation);
  assert.equal(rotation.init.method, 'POST');
  assert.equal(rotation.init.headers.Authorization, 'Bearer session-jwt');
});
