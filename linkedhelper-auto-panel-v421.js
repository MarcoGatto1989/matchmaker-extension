(() => {
  if (window.__ESOS_LINKEDHELPER_PANEL_V421__) return;
  window.__ESOS_LINKEDHELPER_PANEL_V421__ = true;

  const STATUS_KEY = 'esos_linkedhelper_runtime_v421';
  const PROJECT_KEY = 'esos_linkedhelper_xing_project';
  let panel;

  function css() {
    if (document.getElementById('__esos_lh_style')) return;
    const style = document.createElement('style');
    style.id = '__esos_lh_style';
    style.textContent = `
      #__esos_lh_panel{position:fixed;right:18px;top:86px;width:370px;z-index:2147483646;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;border:1px solid rgba(125,211,252,.28);border-radius:18px;overflow:hidden;background:linear-gradient(180deg,rgba(248,250,252,.98),rgba(241,245,249,.98));box-shadow:0 28px 80px rgba(2,6,23,.32);backdrop-filter:blur(18px)}
      #__esos_lh_panel *{box-sizing:border-box}
      #__esos_lh_head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:radial-gradient(circle at 82% -40%,rgba(34,211,238,.34),transparent 52%),linear-gradient(135deg,#020617,#0f172a 48%,#172554);color:#fff;border-bottom:1px solid rgba(56,189,248,.18);cursor:move}
      #__esos_lh_brand{display:flex;align-items:center;gap:10px}
      #__esos_lh_logo{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;font-weight:900;background:linear-gradient(145deg,#22d3ee,#3b82f6 52%,#7c3aed);box-shadow:0 0 22px rgba(34,211,238,.28)}
      #__esos_lh_title{font-size:14px;font-weight:900;letter-spacing:.01em}
      #__esos_lh_sub{font-size:8px;color:#93c5fd;letter-spacing:.16em;font-weight:800;margin-top:2px}
      #__esos_lh_min{border:0;background:rgba(255,255,255,.08);color:#cbd5e1;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:16px}
      #__esos_lh_body{padding:13px}
      #__esos_lh_panel.minimized #__esos_lh_body{display:none}
      .__esos_lh_kicker{font-size:8px;font-weight:900;letter-spacing:.18em;color:#2563eb;margin-bottom:5px}
      .__esos_lh_card{padding:11px;border:1px solid #dbe5f2;border-radius:14px;background:linear-gradient(180deg,#fff,#f8fafc);box-shadow:0 8px 24px rgba(15,23,42,.05);margin-bottom:10px}
      .__esos_lh_row{display:grid;grid-template-columns:1fr 1fr;gap:7px}
      .__esos_lh_label{font-size:9px;color:#64748b;font-weight:700;margin-bottom:5px;display:block}
      #__esos_lh_project{width:100%;height:38px;border:1px solid #dbe5f2;border-radius:10px;padding:0 10px;background:#fff;outline:none;font-size:11px}
      #__esos_lh_project:focus{border-color:#60a5fa;box-shadow:0 0 0 3px rgba(59,130,246,.10)}
      .__esos_lh_btn{height:39px;border-radius:10px;border:1px solid #dbe5f2;background:#fff;font-size:10px;font-weight:800;cursor:pointer;color:#334155}
      .__esos_lh_btn.primary{border:0;color:#fff;background:linear-gradient(135deg,#2563eb,#4f46e5);box-shadow:0 8px 18px rgba(37,99,235,.18)}
      .__esos_lh_btn.stop{color:#b91c1c;background:#fff1f2;border-color:#fecdd3}
      .__esos_lh_btn:disabled{opacity:.45;cursor:not-allowed}
      #__esos_lh_stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px}
      .__esos_lh_stat{padding:8px 5px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;text-align:center}
      .__esos_lh_stat b{display:block;font-size:15px;color:#0f172a}
      .__esos_lh_stat span{display:block;font-size:7.5px;color:#64748b;margin-top:2px;text-transform:uppercase;letter-spacing:.08em;font-weight:800}
      #__esos_lh_status{margin-top:9px;padding:9px 10px;border-radius:10px;background:#eff6ff;color:#1e3a8a;font-size:9.5px;line-height:1.4;min-height:34px}
      #__esos_lh_error{margin-top:7px;font-size:9px;color:#b91c1c;line-height:1.35}
      #__esos_lh_footer{display:flex;justify-content:space-between;align-items:center;margin-top:9px;color:#94a3b8;font-size:8px}
      #__esos_lh_open_full{border:0;background:none;color:#2563eb;font-weight:800;font-size:8px;cursor:pointer;padding:0}
    `;
    document.documentElement.appendChild(style);
  }

  function renderStatus(status = {}) {
    if (!panel) return;
    const current = document.getElementById('__esos_lh_current');
    const added = document.getElementById('__esos_lh_added');
    const existing = document.getElementById('__esos_lh_existing');
    const failed = document.getElementById('__esos_lh_failed');
    const message = document.getElementById('__esos_lh_status');
    const error = document.getElementById('__esos_lh_error');
    const stop = document.getElementById('__esos_lh_stop');
    const buttons = [document.getElementById('__esos_lh_xing'), document.getElementById('__esos_lh_linkedin')];

    if (current) current.textContent = status.total ? String(status.current || 0) + '/' + String(status.total || 0) : '0';
    if (added) added.textContent = String(status.added || 0);
    if (existing) existing.textContent = String(status.existing || 0);
    if (failed) failed.textContent = String(status.failed || 0);
    if (message) message.textContent = status.message || 'Bereit. Geöffnete Profil-Tabs werden nacheinander verarbeitet.';
    if (error) error.textContent = status.lastError ? 'Letzter Fehler: ' + status.lastError : '';
    if (stop) stop.disabled = !status.running;
    for (const button of buttons) if (button) button.disabled = Boolean(status.running);
  }

  async function send(message) {
    try { return await chrome.runtime.sendMessage(message); }
    catch (error) { return { ok:false, error:error?.message || String(error) }; }
  }

  function drag(header) {
    let active = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      active = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY; startLeft = rect.left; startTop = rect.top;
      panel.style.right = 'auto';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!active) return;
      panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, startLeft + e.clientX - startX)) + 'px';
      panel.style.top = Math.max(0, Math.min(window.innerHeight - 60, startTop + e.clientY - startY)) + 'px';
    });
    window.addEventListener('mouseup', () => { active = false; });
  }

  async function build() {
    if (document.getElementById('__esos_lh_panel')) return;
    css();
    panel = document.createElement('div');
    panel.id = '__esos_lh_panel';
    panel.innerHTML = `
      <div id="__esos_lh_head">
        <div id="__esos_lh_brand">
          <div id="__esos_lh_logo">E</div>
          <div><div id="__esos_lh_title">ESOS AI</div><div id="__esos_lh_sub">LINKEDHELPER NETWORK SYNC</div></div>
        </div>
        <button id="__esos_lh_min" title="Minimieren">−</button>
      </div>
      <div id="__esos_lh_body">
        <div class="__esos_lh_kicker">AUTO PROCESSING</div>
        <div class="__esos_lh_card">
          <label class="__esos_lh_label">XING Zielprojekt</label>
          <input id="__esos_lh_project" type="text" placeholder="Projektname eingeben">
          <div class="__esos_lh_row" style="margin-top:8px">
            <button class="__esos_lh_btn primary" id="__esos_lh_xing">XING-Tabs starten</button>
            <button class="__esos_lh_btn primary" id="__esos_lh_linkedin">LinkedIn-Tabs starten</button>
          </div>
          <button class="__esos_lh_btn stop" id="__esos_lh_stop" style="width:100%;margin-top:7px" disabled>Aktuellen Lauf stoppen</button>
          <div id="__esos_lh_stats">
            <div class="__esos_lh_stat"><b id="__esos_lh_current">0</b><span>Fortschritt</span></div>
            <div class="__esos_lh_stat"><b id="__esos_lh_added">0</b><span>Neu</span></div>
            <div class="__esos_lh_stat"><b id="__esos_lh_existing">0</b><span>Vorhanden</span></div>
            <div class="__esos_lh_stat"><b id="__esos_lh_failed">0</b><span>Fehler</span></div>
          </div>
          <div id="__esos_lh_status">Bereit. Geöffnete Profil-Tabs werden nacheinander verarbeitet.</div>
          <div id="__esos_lh_error"></div>
        </div>
        <div id="__esos_lh_footer"><span>Erfolgreiche Tabs schließen · Fehler bleiben offen</span><button id="__esos_lh_open_full">Volles ESOS AI öffnen</button></div>
      </div>`;
    document.body.appendChild(panel);

    drag(document.getElementById('__esos_lh_head'));

    const stored = await chrome.storage.local.get({ [PROJECT_KEY]: '' });
    document.getElementById('__esos_lh_project').value = stored[PROJECT_KEY] || '';

    document.getElementById('__esos_lh_min').addEventListener('click', () => {
      panel.classList.toggle('minimized');
      document.getElementById('__esos_lh_min').textContent = panel.classList.contains('minimized') ? '+' : '−';
    });
    document.getElementById('__esos_lh_xing').addEventListener('click', async () => {
      const project = document.getElementById('__esos_lh_project').value.trim();
      await chrome.storage.local.set({ [PROJECT_KEY]: project });
      await send({ type:'ESOS_LINKEDHELPER_START_XING', project });
    });
    document.getElementById('__esos_lh_linkedin').addEventListener('click', async () => {
      await send({ type:'ESOS_LINKEDHELPER_START_LINKEDIN' });
    });
    document.getElementById('__esos_lh_stop').addEventListener('click', async () => {
      await send({ type:'ESOS_LINKEDHELPER_STOP' });
    });
    document.getElementById('__esos_lh_open_full').addEventListener('click', () => {
      try { chrome.runtime.sendMessage({ type:'ESOS_OPEN_EXTENSION_POPUP_HINT' }); } catch (_) {}
    });

    const status = await send({ type:'ESOS_LINKEDHELPER_GET_STATUS' });
    renderStatus(status || {});
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'ESOS_LINKEDHELPER_STATUS_PUSH') renderStatus(message.status || {});
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STATUS_KEY]) renderStatus(changes[STATUS_KEY].newValue || {});
  });

  function boot() {
    if (document.body) build();
    else setTimeout(boot, 60);
  }
  boot();
})();