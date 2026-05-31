const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const Engine = require('./pjsua-engine');
const Store = require('./store');

let win;
let engine;
const store = new Store();

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 360,
    height: 590,
    minWidth: 340,
    minHeight: 540,
    maxWidth: 430,
    maxHeight: 690,
    title: 'سیرا فون',
    backgroundColor: '#06152f',
    resizable: true,
    autoHideMenuBar: true,
    menuBarVisible: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  engine = new Engine({
    projectRoot: app.getAppPath(),
    userDataPath: app.getPath('userData'),
    resourcesPath: process.resourcesPath,
    onLog: (entry) => win?.webContents.send('engine:log', entry),
    onStatus: (status) => win?.webContents.send('engine:status', status)
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') win.webContents.toggleDevTools();
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  try { engine?.stop(); } catch (_) {}
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('config:load', () => store.getAll());
ipcMain.handle('config:save', (_, cfg) => { store.setAll(cfg || {}); return { ok: true }; });
ipcMain.handle('engine:check', () => engine.check());
ipcMain.handle('engine:start', async (_, cfg) => { store.setAll(cfg || {}); return engine.start(cfg || {}); });
ipcMain.handle('engine:stop', () => engine.stop());
ipcMain.handle('engine:call', (_, number) => engine.call(number));
ipcMain.handle('engine:hangup', () => engine.hangup());
ipcMain.handle('engine:sendDtmf', (_, digit) => engine.sendDtmf(digit));
ipcMain.handle('engine:command', (_, command) => engine.sendCommand(command));
ipcMain.handle('app:openDocs', () => shell.openPath(path.join(app.getAppPath(), 'docs', 'index.html')));
ipcMain.handle('app:choosePjsua', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Select pjsua.exe',
    filters: [{ name: 'PJSUA executable', extensions: ['exe'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false };
  const destDir = path.join(app.getAppPath(), 'tools', 'pjsua');
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, 'pjsua.exe');
  fs.copyFileSync(res.filePaths[0], dest);
  return { ok: true, path: dest };
});
