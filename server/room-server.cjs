// WebSocket 房间中继（可选）。零依赖：手写 WebSocket 帧解析，约 180 行。
//
// 用途：局域网多机联机时中继消息。房间内房主的 message 会转发给其他成员。
// 不做状态存储 —— 状态只在房主的浏览器内存里，中继只负责转发。
//
// 运行：node server/room-server.js   （默认 8974，PORT=9000 可改）

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT ? +process.env.PORT : 8974;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const root = path.join(__dirname, "..");

// ── 静态文件（顺便托管游戏）──
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/dist/monopoly-office.html";
  const fp = path.join(root, p);
  fs.readFile(fp, (err, data) => {
    if (err) {
      fs.readFile(path.join(root, "dist/monopoly-office.html"), (e2, d2) => {
        if (e2) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("404 — 先跑 node tools/build.mjs 生成单文件版");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[".html"] });
        res.end(d2);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "text/plain" });
    res.end(data);
  });
});

// ── 房间表 ──
const rooms = new Map(); // room -> Set<sock>

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) return socket.destroy();
  const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  let roomId = "?";
  let buf = Buffer.alloc(0);
  const sock = { room: null, alive: true };

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    // 帧循环
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      if (buf.length < off + len) return;
      const payload = buf.slice(off, off + len);
      buf = buf.slice(off + len);

      if (opcode === 0x8) {           // close
        cleanup();
        socket.end();
        return;
      }
      if (opcode === 0x9) {           // ping
        socket.write(frame(payload, 0xA));
        continue;
      }
      if (opcode === 0x1) {           // text
        handleText(payload.toString("utf8"));
      }
    }
  });

  function handleText(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.type === "JOIN") {
      roomId = String(msg.room || "?").toUpperCase().slice(0, 4);
      sock.room = roomId;
      sock.id = msg.playerId;
      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      rooms.get(roomId).add(sock);
      send(sock, { type: "JOINED", room: roomId, members: rooms.get(roomId).size });
      log(`房间 ${roomId} 加入（${rooms.get(roomId).size} 人）`);
      return;
    }
    if (!sock.room) return;
    // 其余消息一律广播给同房间其他人
    const set = rooms.get(sock.room);
    if (!set) return;
    for (const other of set) {
      if (other !== sock) send(other, msg);
    }
  }

  function send(s, obj) {
    if (s.destroyed) return;
    try { s.write(frame(Buffer.from(JSON.stringify(obj), "utf8"), 0x1)); }
    catch { /* 对端已断开 */ }
  }

  function cleanup() {
    if (sock.room && rooms.has(sock.room)) {
      const set = rooms.get(sock.room);
      set.delete(sock);
      log(`房间 ${sock.room} 离开（${set.size} 人）`);
      if (set.size === 0) rooms.delete(sock.room);
    }
    try { socket.destroy(); } catch { /* 已销毁 */ }
  }

  socket.on("error", cleanup);
  socket.on("close", cleanup);
});

function frame(payload, opcode = 0x1) {
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2);
    head[1] = len;
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, payload]);
}

function log(s) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] ${s}`);
}

server.listen(PORT, () => {
  console.log(`\n大富翁·工位版 — 房间中继已启动`);
  console.log(`  ws://127.0.0.1:${PORT}`);
  console.log(`  游戏页 http://127.0.0.1:${PORT}/`);
  console.log(`  局域网内其他设备用 http://<你的IP>:${PORT}/\n`);
});
