// ESOS AI v4.1.3 — keep the proven ESOS worker chain and add persistent LinkedHelper batch orchestration.
importScripts('service-worker-v420.js');
importScripts('linkedhelper-batch-worker-v421.js');

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'ESOS_OPEN_EXTENSION_POPUP_HINT') return undefined;
  (async () => {
    try {
      if (chrome.action?.openPopup) {
        await chrome.action.openPopup();
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'Popup kann in dieser Chrome-Version nicht automatisch geöffnet werden.' });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();
  return true;
});

console.log('[ESOS AI] v4.1.3 active: persistent LinkedHelper panel + background tab processing.');