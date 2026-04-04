const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs/promises");

const defaultUrl = "http://127.0.0.1:3000";

function buildApplicationMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : [
          {
            label: "Arquivo",
            submenu: [{ role: "quit", label: "Sair" }],
          },
        ]),
    {
      label: "Visualizar",
      submenu: [
        { role: "reload", label: "Recarregar" },
        { role: "forceReload", label: "Forçar recarregar" },
        { type: "separator" },
        { role: "toggleDevTools", label: "Ferramentas do desenvolvedor" },
        { type: "separator" },
        { role: "resetZoom", label: "Zoom real" },
        { role: "zoomIn", label: "Ampliar" },
        { role: "zoomOut", label: "Reduzir" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Tela cheia" },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function settingsFilePath() {
  return path.join(app.getPath("userData"), "echolink-settings.json");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  const url = process.env.ELECTRON_START_URL || defaultUrl;
  win.loadURL(url);
  win.webContents.on("did-finish-load", () => {
    win.webContents.setZoomFactor(1);
  });
}

ipcMain.handle("echolink:readSettings", async () => {
  try {
    const raw = await fs.readFile(settingsFilePath(), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
});

ipcMain.handle("echolink:writeSettings", async (_event, data) => {
  const payload =
    data !== null && typeof data === "object" ? data : {};
  await fs.writeFile(
    settingsFilePath(),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
});

ipcMain.handle("echolink:openExternal", async (_event, url) => {
  if (typeof url !== "string" || url.length === 0) return;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return;
  await shell.openExternal(trimmed);
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildApplicationMenu());
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
