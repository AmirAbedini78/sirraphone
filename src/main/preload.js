const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('softphone', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  checkEngine: () => ipcRenderer.invoke('engine:check'),
  startEngine: (cfg) => ipcRenderer.invoke('engine:start', cfg),
  stopEngine: () => ipcRenderer.invoke('engine:stop'),
  call: (number) => ipcRenderer.invoke('engine:call', number),
  hangup: () => ipcRenderer.invoke('engine:hangup'),
  sendDtmf: (digit) => ipcRenderer.invoke('engine:sendDtmf', digit),
  sendCommand: (command) => ipcRenderer.invoke('engine:command', command),
  testNetwork: (cfg) => ipcRenderer.invoke('engine:testNetwork', cfg),
  openDocs: () => ipcRenderer.invoke('app:openDocs'),
  choosePjsua: () => ipcRenderer.invoke('app:choosePjsua'),
  onLog: (cb) => ipcRenderer.on('engine:log', (_, entry) => cb(entry)),
  onStatus: (cb) => ipcRenderer.on('engine:status', (_, status) => cb(status))
});
