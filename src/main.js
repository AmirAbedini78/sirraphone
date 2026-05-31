
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

let mainWindow = null;
let pjsuaProcess = null;

function logToWindow(level, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pjsua-log', {
      level,
      message: String(message || ''),
      time: new Date().toLocaleTimeString()
    });
  }
}

function uniqueExisting(paths) {
  return [...new Set(paths)].filter(Boolean);
}

function getProjectRoot() {
  // dev: src/main.js -> project root is ..
  return path.resolve(__dirname, '..');
}

function candidateEnginePaths() {
  const root = getProjectRoot();
  const candidates = [
    path.join(root, 'tools', 'pjsua', 'pjsua.exe'),
    path.join(process.cwd(), 'tools', 'pjsua', 'pjsua.exe'),
    path.join(__dirname, '..', 'tools', 'pjsua', 'pjsua.exe'),
  ];

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'tools', 'pjsua', 'pjsua.exe'));
    candidates.push(path.join(process.resourcesPath, 'app', 'tools', 'pjsua', 'pjsua.exe'));
    candidates.push(path.join(path.dirname(process.execPath), 'resources', 'tools', 'pjsua', 'pjsua.exe'));
  }

  return uniqueExisting(candidates);
}

function findEngine() {
  const candidates = candidateEnginePaths();
  const found = candidates.find(p => fs.existsSync(p));
  return { found: !!found, path: found || null, candidates };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 1050,
    minHeight: 720,
    title: 'Asterisk Softphone',
    backgroundColor: '#0f172a',
    webPreferences: {
      // Deliberately enabled for this internal desktop app to avoid preload failures.
      // Renderer only loads local files. Do not load remote websites in this window.
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    logToWindow('info', 'Electron API active via nodeIntegration. No preload is required.');
    const engine = findEngine();
    logToWindow(engine.found ? 'success' : 'error', engine.found ? `PJSUA found: ${engine.path}` : `PJSUA not found. Checked: ${engine.candidates.join(' | ')}`);
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  stopPjsua();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', stopPjsua);

function stopPjsua() {
  if (pjsuaProcess) {
    try { pjsuaProcess.stdin && pjsuaProcess.stdin.write('q\n'); } catch (_) {}
    try { pjsuaProcess.kill(); } catch (_) {}
    pjsuaProcess = null;
  }
}

function buildPjsuaArgs(cfg) {
  const server = String(cfg.server1 || cfg.server || '').trim();
  const username = String(cfg.username || cfg.extension || '').trim();
  const authUser = String(cfg.authUser || username).trim();
  const password = String(cfg.password || '').trim();
  const port = String(cfg.port || '5060').trim();
  const transport = String(cfg.transport || 'udp').toLowerCase();
  const realm = String(cfg.realm || '*').trim() || '*';

  if (!server || !username || !password) {
    throw new Error('Server, username/extension and password are required.');
  }

  const sipServer = server.includes(':') ? server : `${server}:${port}`;
  const transportParam = transport === 'udp' ? '' : `;transport=${transport.toUpperCase()}`;

  const args = [
    '--id', `sip:${username}@${sipServer}`,
    '--registrar', `sip:${sipServer}`,
    '--realm', realm,
    '--username', authUser,
    '--password', password,
    '--log-level', String(cfg.logLevel || '5'),
    '--app-log-level', String(cfg.appLogLevel || '5'),
    '--null-audio'
  ];

  if (transport === 'tcp') args.push('--use-tcp');
  if (transport === 'tls') args.push('--use-tls');

  if (cfg.proxy) {
    args.push('--proxy', String(cfg.proxy));
  }

  return args;
}

ipcMain.handle('engine:check', async () => {
  const engine = findEngine();
  return {
    ok: engine.found,
    path: engine.path,
    candidates: engine.candidates,
    cwd: process.cwd(),
    dirname: __dirname,
    resourcesPath: process.resourcesPath || null
  };
});

ipcMain.handle('network:test', async (_, payload) => {
  const host = String(payload.host || payload.server || '').trim();
  const port = Number(payload.port || 5060);
  const timeout = Number(payload.timeout || 3500);
  if (!host) return { ok: false, error: 'Host is required.' };

  return await new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch (_) {}
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish({ ok: true, message: `TCP ${host}:${port} reachable` }));
    socket.once('timeout', () => finish({ ok: false, error: `Timeout connecting to ${host}:${port}` }));
    socket.once('error', err => finish({ ok: false, error: err.message }));
    socket.connect(port, host);
  });
});

ipcMain.handle('pjsua:start', async (_, cfg) => {
  const engine = findEngine();
  if (!engine.found) return { ok: false, error: 'pjsua.exe not found', details: engine };

  stopPjsua();

  let args;
  try { args = buildPjsuaArgs(cfg || {}); }
  catch (e) { return { ok: false, error: e.message }; }

  logToWindow('info', `Starting PJSUA: ${engine.path}`);
  logToWindow('info', `Args: ${args.map(a => a.includes(String(cfg.password||'__NO__')) ? '******' : a).join(' ')}`);

  try {
    pjsuaProcess = spawn(engine.path, args, {
      cwd: path.dirname(engine.path),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    pjsuaProcess.stdout.on('data', d => logToWindow('pjsua', d.toString()));
    pjsuaProcess.stderr.on('data', d => logToWindow('error', d.toString()));
    pjsuaProcess.on('error', err => logToWindow('error', `PJSUA process error: ${err.message}`));
    pjsuaProcess.on('exit', (code, signal) => {
      logToWindow('warn', `PJSUA exited. code=${code} signal=${signal || ''}`);
      pjsuaProcess = null;
    });

    return { ok: true, pid: pjsuaProcess.pid, args };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('pjsua:stop', async () => {
  stopPjsua();
  return { ok: true };
});

ipcMain.handle('pjsua:call', async (_, payload) => {
  const destination = String(payload.destination || '').trim();
  const server = String(payload.server || payload.server1 || '').trim();
  if (!destination) return { ok: false, error: 'Destination is required.' };
  if (!pjsuaProcess || !pjsuaProcess.stdin) return { ok: false, error: 'PJSUA is not running/registering.' };

  const target = destination.includes('@') || destination.startsWith('sip:')
    ? (destination.startsWith('sip:') ? destination : `sip:${destination}`)
    : `sip:${destination}@${server}`;

  try {
    pjsuaProcess.stdin.write('m\n');
    setTimeout(() => {
      try { pjsuaProcess.stdin.write(target + '\n'); } catch (_) {}
    }, 250);
    logToWindow('info', `Dial command sent: ${target}`);
    return { ok: true, target };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('pjsua:hangup', async () => {
  if (!pjsuaProcess || !pjsuaProcess.stdin) return { ok: false, error: 'PJSUA is not running.' };
  try {
    pjsuaProcess.stdin.write('ha\n');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('pjsua:dtmf', async (_, digit) => {
  if (!pjsuaProcess || !pjsuaProcess.stdin) return { ok: false, error: 'PJSUA is not running.' };
  try {
    pjsuaProcess.stdin.write('#\n');
    setTimeout(() => pjsuaProcess && pjsuaProcess.stdin && pjsuaProcess.stdin.write(String(digit) + '\n'), 150);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
