const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('softphoneAPI', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:set', config),
  probeNetwork: (args) => ipcRenderer.invoke('network:probe', args),
  openDocs: () => ipcRenderer.invoke('docs:open'),
  nativeStart: (config) => ipcRenderer.invoke('native:start', config),
  nativeStop: () => ipcRenderer.invoke('native:stop'),
  nativeCall: (target) => ipcRenderer.invoke('native:call', target),
  nativeHangup: () => ipcRenderer.invoke('native:hangup'),
  nativeStatus: () => ipcRenderer.invoke('native:status'),
  onNativeLog: (callback) => ipcRenderer.on('native:log', (_event, payload) => callback(payload)),
  onNativeStatus: (callback) => ipcRenderer.on('native:status', (_event, payload) => callback(payload)),
  onNativeCall: (callback) => ipcRenderer.on('native:call', (_event, payload) => callback(payload))
});
