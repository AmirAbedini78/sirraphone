
const { ipcRenderer } = require('electron');

const $ = (id) => document.getElementById(id);
const logsBox = $('logsBox');
const statusText = $('statusText');

function log(level, message) {
  const line = `[${new Date().toLocaleTimeString()}] ${level.toUpperCase()} ${message}`;
  logsBox.textContent += line + '\n';
  logsBox.scrollTop = logsBox.scrollHeight;
}

function setStatus(text) {
  statusText.textContent = text;
}

function getConfig() {
  return {
    accountName: $('accountName').value.trim(),
    server1: $('server1').value.trim(),
    server2: $('server2').value.trim(),
    server3: $('server3').value.trim(),
    username: $('username').value.trim(),
    authUser: $('authUser').value.trim(),
    password: $('password').value,
    port: $('port').value.trim() || '5060',
    transport: $('transport').value,
    realm: $('realm').value.trim() || '*',
    proxy: $('proxy').value.trim(),
    logLevel: $('logLevel').value.trim() || '5'
  };
}

function saveConfig() {
  localStorage.setItem('softphone.config', JSON.stringify(getConfig()));
  log('success', 'Config saved.');
}

function loadConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem('softphone.config') || '{}');
    Object.entries(cfg).forEach(([k,v]) => {
      if ($(k) && typeof v === 'string') $(k).value = v;
    });
  } catch(e) {}
}

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

$('saveConfig').addEventListener('click', saveConfig);

$('checkEngineBtn').addEventListener('click', async () => {
  const res = await ipcRenderer.invoke('engine:check');
  $('testOutput').textContent = JSON.stringify(res, null, 2);
  if (res.ok) {
    setStatus('Engine Found');
    log('success', 'PJSUA found: ' + res.path);
  } else {
    setStatus('Engine Missing');
    log('error', 'PJSUA not found. Checked: ' + res.candidates.join(' | '));
  }
});

$('testServerBtn').addEventListener('click', async () => {
  const cfg = getConfig();
  const res = await ipcRenderer.invoke('network:test', { host: cfg.server1, port: cfg.port });
  $('testOutput').textContent = JSON.stringify(res, null, 2);
  log(res.ok ? 'success' : 'error', res.message || res.error);
});

$('registerBtn').addEventListener('click', async () => {
  saveConfig();
  const res = await ipcRenderer.invoke('pjsua:start', getConfig());
  if (res.ok) {
    setStatus('Registering / Running');
    log('success', 'PJSUA started. PID=' + res.pid);
  } else {
    setStatus('Start Failed');
    log('error', res.error || JSON.stringify(res));
  }
});

$('stopBtn').addEventListener('click', async () => {
  const res = await ipcRenderer.invoke('pjsua:stop');
  setStatus('Stopped');
  log('warn', 'PJSUA stopped.');
});

$('callBtn').addEventListener('click', async () => {
  const cfg = getConfig();
  const res = await ipcRenderer.invoke('pjsua:call', { destination: $('destination').value.trim(), server: cfg.server1 });
  log(res.ok ? 'success' : 'error', res.target || res.error);
});

$('hangupBtn').addEventListener('click', async () => {
  const res = await ipcRenderer.invoke('pjsua:hangup');
  log(res.ok ? 'warn' : 'error', res.ok ? 'Hangup sent.' : res.error);
});

$('clearLogs').addEventListener('click', () => logsBox.textContent = '');

'123456789*0#'.split('').forEach(d => {
  const b = document.createElement('button');
  b.textContent = d;
  b.addEventListener('click', async () => {
    $('destination').value += d;
    await ipcRenderer.invoke('pjsua:dtmf', d);
  });
  $('keypad').appendChild(b);
});

ipcRenderer.on('pjsua-log', (_, entry) => {
  const msg = String(entry.message || '').trimEnd();
  if (!msg) return;
  logsBox.textContent += `[${entry.time}] ${String(entry.level || 'info').toUpperCase()} ${msg}\n`;
  logsBox.scrollTop = logsBox.scrollHeight;

  if (/registration.*200|status=200|OK/i.test(msg)) setStatus('Registered');
  if (/401|403|forbidden|unauthorized/i.test(msg)) setStatus('Auth Failed');
});

window.addEventListener('DOMContentLoaded', async () => {
  loadConfig();
  setStatus('API Ready');
  log('success', 'Renderer API is active. This version does not use preload.');
  const res = await ipcRenderer.invoke('engine:check');
  log(res.ok ? 'success' : 'error', res.ok ? 'PJSUA found: ' + res.path : 'PJSUA not found.');
});
