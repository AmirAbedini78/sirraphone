(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = window.softphone;
  const fields = ['accountName','server1','server2','server3','extension','password','username','domain','port','localPort','transport','outboundProxy','logLevel'];
  const now = () => new Date().toLocaleTimeString();
  const CONTACTS_KEY = 'asterisk-softphone.contacts.v2';
  const HISTORY_KEY = 'asterisk-softphone.history.v2';

  let connected = false;

  function log(level, message) {
    const logs = $('logs');
    if (!logs) return;
    logs.textContent += `[${now()}] ${String(level || 'INFO').toUpperCase()} ${message}\n`;
    logs.scrollTop = logs.scrollHeight;
  }

  function badge(text, mode) {
    const b = $('connectionBadge');
    if (!b) return;
    b.textContent = text;
    b.className = 'connection' + (mode ? ' ' + mode : '');
  }

  function quick(text) {
    const q = $('quickStatus');
    if (q) q.textContent = text;
  }

  function collect() {
    const cfg = {};
    fields.forEach((f) => {
      const el = $(f);
      if (el) cfg[f] = String(el.value || '').trim();
    });
    if (!cfg.username) cfg.username = cfg.extension;
    if (!cfg.domain) cfg.domain = cfg.server1;
    return cfg;
  }

  function fill(cfg = {}) {
    fields.forEach((f) => {
      const el = $(f);
      if (el && Object.prototype.hasOwnProperty.call(cfg, f)) el.value = cfg[f] || '';
    });
    updateCaption();
  }

  function updateCaption() {
    const cfg = collect();
    const cap = $('accountCaption');
    if (!cap) return;
    cap.textContent = cfg.extension && cfg.server1 ? `${cfg.extension}@${cfg.server1}` : 'بدون اکانت';
  }

  function storageGet(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) { return []; }
  }
  function storageSet(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

  function addHistory(type, number) {
    const list = storageGet(HISTORY_KEY);
    list.unshift({ type, number, time: new Date().toLocaleString('fa-IR') });
    storageSet(HISTORY_KEY, list.slice(0, 60));
    renderHistory();
  }

  function renderContacts() {
    const box = $('contactsList');
    if (!box) return;
    const list = storageGet(CONTACTS_KEY);
    if (!list.length) { box.className = 'list empty'; box.textContent = 'کانتکتی ثبت نشده است.'; return; }
    box.className = 'list'; box.innerHTML = '';
    list.forEach((c, i) => {
      const row = document.createElement('div'); row.className = 'item';
      row.innerHTML = `<div><strong>${escapeHtml(c.name || c.number)}</strong><span>${escapeHtml(c.number)}</span></div>`;
      const actions = document.createElement('div'); actions.className = 'item-actions';
      const call = document.createElement('button'); call.className = 'round call'; call.textContent = '☎';
      call.onclick = () => { $('dialNumber').value = c.number; switchView('dialer'); doCall(); };
      const del = document.createElement('button'); del.className = 'round del'; del.textContent = '×';
      del.onclick = () => { const arr = storageGet(CONTACTS_KEY); arr.splice(i, 1); storageSet(CONTACTS_KEY, arr); renderContacts(); };
      actions.append(call, del); row.append(actions); box.appendChild(row);
    });
  }

  function renderHistory() {
    const box = $('historyList');
    if (!box) return;
    const list = storageGet(HISTORY_KEY);
    if (!list.length) { box.className = 'list empty'; box.textContent = 'هنوز تماسی ثبت نشده است.'; return; }
    box.className = 'list'; box.innerHTML = '';
    list.forEach((h) => {
      const row = document.createElement('div'); row.className = 'item';
      row.innerHTML = `<div><strong>${h.type === 'out' ? 'تماس خروجی' : 'رویداد تماس'}</strong><span>${escapeHtml(h.number)} · ${escapeHtml(h.time)}</span></div>`;
      const actions = document.createElement('div'); actions.className = 'item-actions';
      const call = document.createElement('button'); call.className = 'round call'; call.textContent = '☎';
      call.onclick = () => { $('dialNumber').value = h.number; switchView('dialer'); doCall(); };
      actions.append(call); row.append(actions); box.appendChild(row);
    });
  }

  function escapeHtml(v) {
    return String(v || '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  }

  function switchView(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const view = $('view-' + name); if (view) view.classList.add('active');
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  }

  async function checkEngineSilent() {
    if (!api) { badge('API غیرفعال', 'error'); return; }
    try {
      const r = await api.checkEngine();
      const note = $('engineNote');
      if (r.ok) {
        if (note) note.textContent = 'موتور تماس PJSUA آماده است.';
        log('success', 'PJSUA engine found.');
      } else {
        if (note) note.textContent = 'pjsua.exe پیدا نشد یا قابل اجرا نیست.';
        log('warn', r.message || 'PJSUA engine missing.');
      }
    } catch (e) { log('error', e.message); }
  }

  async function saveConfig() {
    if (!api) return log('error', 'Electron API فعال نیست.');
    const cfg = collect();
    await api.saveConfig(cfg);
    updateCaption();
    log('success', 'تنظیمات ذخیره شد.');
    quick('تنظیمات ذخیره شد. حالا اتصال را بزنید.');
  }

  async function connect() {
    if (!api) return log('error', 'Electron API فعال نیست.');
    const cfg = collect();
    if (!cfg.server1 || !cfg.extension || !cfg.password) {
      badge('اطلاعات ناقص', 'error');
      quick('سرور، داخلی و رمز عبور را در بخش اکانت وارد کنید.');
      switchView('account'); return;
    }
    await api.saveConfig(cfg);
    badge('در حال اتصال...', 'connecting'); quick('در حال اتصال به مرکز تماس...');
    try {
      const r = await api.startEngine(cfg);
      log(r.ok ? 'info' : 'error', r.message || 'پاسخی از موتور دریافت نشد.');
      if (!r.ok) { badge('خطای اتصال', 'error'); quick(r.message || 'اتصال برقرار نشد.'); }
    } catch (e) { badge('خطای اتصال', 'error'); quick(e.message); log('error', e.message); }
  }

  async function disconnect() {
    if (!api) return;
    try { await api.stopEngine(); } catch (e) { log('error', e.message); }
    connected = false; badge('قطع شد'); quick('اتصال قطع شد.');
  }

  async function doCall() {
    if (!api) return log('error', 'Electron API فعال نیست.');
    const n = String($('dialNumber')?.value || '').trim();
    if (!n) return quick('شماره مقصد را وارد کنید.');
    try {
      const r = await api.call(n);
      log(r.ok ? 'call' : 'error', r.message || `Call: ${n}`);
      if (r.ok) { addHistory('out', n); quick(`در حال تماس با ${n}`); }
      else quick(r.message || 'تماس برقرار نشد.');
    } catch (e) { log('error', e.message); quick(e.message); }
  }

  function bind() {
    document.querySelectorAll('.tab-btn').forEach((b) => b.onclick = () => switchView(b.dataset.view));
    fields.forEach((f) => { const el = $(f); if (el) el.addEventListener('input', updateCaption); });

    const keypad = $('keypad');
    ['1','2','3','4','5','6','7','8','9','*','0','#'].forEach((k) => {
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = k;
      btn.onclick = () => { const input = $('dialNumber'); if (input) input.value += k; if (connected && ['*','#'].includes(k)) api?.sendDtmf(k).catch((e)=>log('error',e.message)); };
      keypad.appendChild(btn);
    });

    $('backspaceBtn').onclick = () => { const i = $('dialNumber'); if (i) i.value = i.value.slice(0, -1); };
    $('saveConfig').onclick = saveConfig;
    $('registerBtn').onclick = connect;
    $('stopBtn').onclick = disconnect;
    $('callBtn').onclick = doCall;
    $('hangupBtn').onclick = async () => { try { const r = await api.hangup(); log(r.ok ? 'call' : 'error', r.message || 'Hangup'); quick('تماس قطع شد.'); } catch(e){ log('error', e.message); } };
    $('clearLogs').onclick = () => { $('logs').textContent = ''; };
    $('addContactBtn').onclick = () => $('contactForm').classList.toggle('hidden');
    $('saveContactBtn').onclick = () => {
      const name = String($('contactName').value || '').trim();
      const number = String($('contactNumber').value || '').trim();
      if (!number) return;
      const arr = storageGet(CONTACTS_KEY); arr.unshift({ name: name || number, number }); storageSet(CONTACTS_KEY, arr);
      $('contactName').value = ''; $('contactNumber').value = ''; $('contactForm').classList.add('hidden'); renderContacts();
    };
    $('clearHistoryBtn').onclick = () => { storageSet(HISTORY_KEY, []); renderHistory(); };
  }

  async function init() {
    bind(); renderContacts(); renderHistory();
    if (!api) { badge('API Missing', 'error'); log('error', 'window.softphone موجود نیست. package.json / preload را بررسی کنید.'); return; }
    api.onLog((entry) => log(entry.level || 'info', entry.message || ''));
    api.onStatus((s) => {
      const status = typeof s === 'string' ? s : s.status;
      if (['registered'].includes(status)) { connected = true; badge('متصل شد', 'connected'); quick('اتصال برقرار شد و داخلی آماده تماس است.'); }
      else if (['starting','running'].includes(status)) { badge('در حال اتصال...', 'connecting'); quick('موتور تماس روشن است؛ منتظر نتیجه رجیستر...'); }
      else if (['register-failed','engine-error','missing-engine','error'].includes(status)) { connected = false; badge('خطا', 'error'); quick('اتصال برقرار نشد. لاگ را بررسی کنید.'); }
      else if (status === 'stopped') { connected = false; badge('قطع شد'); }
    });
    try { fill(await api.loadConfig()); } catch (e) { log('warn', e.message); }
    await checkEngineSilent();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
