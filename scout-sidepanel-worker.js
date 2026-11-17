// Copyright © 2026–present Marco Gatto. All rights reserved. Proprietary and confidential.
// The action now opens Chrome's native docked Side Panel, not an overlay/popup.
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error =>
    console.warn('[Scout SidePanel] Chrome cannot enable the docked panel:', error?.message || error)
  );
  chrome.runtime.onInstalled.addListener(() =>
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
  );
  chrome.runtime.onStartup.addListener(() =>
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
  );
}
