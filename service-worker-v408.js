// ESOS AI v4.0.10 — load the existing v4.0.6 worker and make current
// profile extraction fixes available immediately in already-open provider tabs.
importScripts('service-worker-v406.js');

async function injectScriptsIntoTabs(urls, files) {
  try {
    const tabs = await chrome.tabs.query({ url: urls });
    await Promise.allSettled((tabs || [])
      .filter(tab => Number.isInteger(tab.id))
      .map(async tab => {
        for (const file of files) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: [file]
            });
          } catch (_) {}
        }
      }));
  } catch (_) {}
}

async function injectCurrentProfileParsers() {
  await Promise.allSettled([
    injectScriptsIntoTabs(
      [
        'https://xing.com/*',
        'https://www.xing.com/*',
        'https://*.xing.com/*'
      ],
      ['profile-identity-v407.js']
    ),
    injectScriptsIntoTabs(
      [
        'https://linkedin.com/*',
        'https://www.linkedin.com/*',
        'https://*.linkedin.com/*'
      ],
      ['position-profile-parser.js', 'linkedin-profile-identity-v410.js']
    )
  ]);
}

chrome.runtime.onInstalled.addListener(() => {
  injectCurrentProfileParsers();
});

chrome.runtime.onStartup.addListener(() => {
  injectCurrentProfileParsers();
});

// Unpacked-extension reloads do not always behave like a normal Web Store update.
// Run once whenever this worker itself starts so already-open profiles are fixed too.
injectCurrentProfileParsers();
