(async () => {
  'use strict';
  try {
    const response = await fetch(chrome.runtime.getURL('popup.html'), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Popup-Vorlage HTTP ${response.status}`);
    let html = await response.text();
    const marker = '<script src="popup.js"></script>';
    if (!html.includes(marker)) throw new Error('Popup-Einstiegspunkt nicht gefunden');
    html = html.replace(marker, '<script src="popup-session-preload-v415.js"></script>\n  ' + marker);
    document.open();
    document.write(html);
    document.close();
  } catch (error) {
    const target = document.getElementById('boot-status');
    if (target) target.textContent = `ESOS AI konnte nicht geladen werden: ${error?.message || error}`;
  }
})();
