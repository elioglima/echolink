const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const http = require("http");
const net = require("net");

let echoLinkUdsBridgeServer = null;

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

function startEchoLinkUdsTcpBridgeIfNeeded() {
  const uds = process.env.ECHO_LINK_UDS_PATH?.trim();
  if (!uds || process.platform === "win32") {
    return Promise.resolve();
  }
  const port = Number(
    process.env.ECHO_LINK_LOCAL_BRIDGE_PORT?.trim() || 8765
  );
  return new Promise((resolve, reject) => {
    echoLinkUdsBridgeServer = net.createServer((client) => {
      const upstream = net.createConnection(uds);
      const teardown = () => {
        try {
          upstream.destroy();
        } catch {
          /* ignore */
        }
        try {
          client.destroy();
        } catch {
          /* ignore */
        }
      };
      client.on("error", teardown);
      upstream.on("error", teardown);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    const onListenErr = (err) => {
      if (echoLinkUdsBridgeServer) {
        echoLinkUdsBridgeServer.off("error", onListenErr);
        echoLinkUdsBridgeServer.close();
        echoLinkUdsBridgeServer = null;
      }
      reject(err);
    };
    echoLinkUdsBridgeServer.once("error", onListenErr);
    echoLinkUdsBridgeServer.listen(port, "127.0.0.1", () => {
      echoLinkUdsBridgeServer.off("error", onListenErr);
      process.env.ECHO_LINK_LOCAL_BRIDGE_ORIGIN = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
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

ipcMain.on("echolink:syncServiceLocalOrigin", (event) => {
  event.returnValue =
    process.env.ECHO_LINK_LOCAL_BRIDGE_ORIGIN?.trim() || "";
});

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

ipcMain.handle("echolink:httpFetch", async (_event, payload) => {
  const p = payload && typeof payload === "object" ? payload : {};
  const rawPath = typeof p.path === "string" ? p.path : "/";
  const pathname = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const method =
    typeof p.method === "string" && p.method.length > 0 ? p.method : "GET";
  const body = typeof p.body === "string" ? p.body : undefined;
  const inHeaders =
    p.headers !== null && typeof p.headers === "object" && !Array.isArray(p.headers)
      ? p.headers
      : {};
  const uds = process.env.ECHO_LINK_UDS_PATH?.trim();
  const opts = {
    method,
    path: pathname,
    headers: { ...inHeaders },
  };
  if (uds) {
    opts.socketPath = uds;
    opts.host = "127.0.0.1";
  } else {
    const host =
      process.env.ECHO_LINK_BIND_HOST?.trim() || "127.0.0.1";
    const port = Number(process.env.ECHO_LINK_BIND_PORT || 8765);
    opts.hostname = host;
    opts.port = port;
  }
  return await new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      const parts = [];
      res.on("data", (c) => parts.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(parts);
        const ctype = String(res.headers["content-type"] || "").toLowerCase();
        const isText =
          ctype.includes("application/json") ||
          ctype.startsWith("text/") ||
          ctype.includes("javascript");
        const encoding = isText ? "utf8" : "base64";
        const bodyStr = isText
          ? buf.toString("utf8")
          : buf.toString("base64");
        resolve({
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400,
          status: res.statusCode ?? 0,
          body: bodyStr,
          encoding,
        });
      });
    });
    req.on("error", (err) => reject(err));
    if (body != null && method !== "GET" && method !== "HEAD") {
      req.write(body);
    }
    req.end();
  });
});

app.whenReady().then(async () => {
  try {
    await startEchoLinkUdsTcpBridgeIfNeeded();
  } catch (e) {
    console.error("EchoLink bridge TCP→UDS:", e);
  }
  Menu.setApplicationMenu(buildApplicationMenu());
  createWindow();
});

app.on("before-quit", () => {
  if (echoLinkUdsBridgeServer) {
    echoLinkUdsBridgeServer.close();
    echoLinkUdsBridgeServer = null;
  }
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
