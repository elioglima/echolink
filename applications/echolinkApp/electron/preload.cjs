const { contextBridge, ipcRenderer } = require("electron");

function readServiceLocalOrigin() {
  try {
    const v = ipcRenderer.sendSync("echolink:syncServiceLocalOrigin");
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

const echolinkApi = {
  isElectron: true,
  readSettings: () => ipcRenderer.invoke("echolink:readSettings"),
  writeSettings: (data) => ipcRenderer.invoke("echolink:writeSettings", data),
  openExternal: (url) => ipcRenderer.invoke("echolink:openExternal", url),
  httpFetch: (payload) => ipcRenderer.invoke("echolink:httpFetch", payload),
};

Object.defineProperty(echolinkApi, "serviceLocalOrigin", {
  enumerable: true,
  get: readServiceLocalOrigin,
});

contextBridge.exposeInMainWorld("echolink", echolinkApi);
