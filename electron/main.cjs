// Electron 主进程：起一个本地静态服务再 loadURL。
//
// 为什么不用 loadFile：ES module 在 file:// 下会被 CORS 拦（ERR_UNSUPPORTED_ESM_URL_SCHEME
// 与 module script 的 origin 限制）。本地 http 是最省事的绕法。

const { app, BrowserWindow, Menu } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const PORT = 8973;
let server = null;
let win = null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function startServer(root) {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/dist/monopoly-office.html";
      const fp = path.join(root, p);
      fs.readFile(fp, (err, data) => {
        if (err) {
          // 回退到单文件产物
          fs.readFile(path.join(root, "dist/monopoly-office.html"), (e2, d2) => {
            if (e2) { res.writeHead(404); res.end("not found"); return; }
            res.writeHead(200, { "Content-Type": MIME[".html"] });
            res.end(d2);
          });
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "text/plain" });
        res.end(data);
      });
    });
    server.listen(PORT, "127.0.0.1", () => resolve());
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#f4f2ec",
    title: "大富翁 · 工位版",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(`http://127.0.0.1:${PORT}/dist/monopoly-office.html`);
  // 打开 devtools 便于排查（生产可注释）
  // win.webContents.openDevTools();
}

app.whenReady().then(async () => {
  // 根目录：本文件在 electron/ 下，项目根是上一级
  const root = path.resolve(__dirname, "..");
  await startServer(root);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (server) server.close();
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  if (server) server.close();
});
