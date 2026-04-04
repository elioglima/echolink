const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("echolink", {
  isElectron: true,
  readSettings: () => ipcRenderer.invoke("echolink:readSettings"),
  writeSettings: (data) => ipcRenderer.invoke("echolink:writeSettings", data),
  openExternal: (url) => ipcRenderer.invoke("echolink:openExternal", url),
});
