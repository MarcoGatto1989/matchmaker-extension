// ESOS AI v4.0.8 — load the existing v4.0.6 worker and make identity fixes
// available immediately in already-open XING tabs after an extension reload.
importScripts('service-worker-v406.js');

async function injectCurrentXingIdentityParser() {
  try {
    const tabs = await chrome.tabs.query({
      url: [
        'https://xing.com/*',
        'https://www.xing.com/*',
        'https://*.xing.com/*'
      ]
    });

    await Promise.allSettled((tabs || [])
      .filter(tab => Number.isInteger(tab.id))
      .map(tab => chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['profile-identity-v407.js']
      })));
  } catch (_) {}
}

chrome.runtime.onInstalled.addListener(() => {
  injectCurrentXingIdentityParser();
});

chrome.runtime.onStartup.addListener(() => {
  injectCurrentXingIdentityParser();
});

// Unpacked-extension reloads do not always behave like a normal Web Store update.
// Run once whenever this worker itself starts so open XING profiles are fixed too.
injectCurrentXingIdentityParser();
