// 传输层抽象：WebRTC / WebSocket / 伪联机 三通道，可插拔。
//
// 降级链：WebRTC（P2P，最低延迟）→ WebSocket（需服务器）→ 伪联机（回合包传递）
// 所有通道暴露同一接口：send(msg) / onMessage(cb) / onOpen(cb) / onClose(cb) / close()

// ─────────── 伪联机（无网络时的兜底）───────────
// 不传输数据本身，而是让玩家导出/导入「回合包」文件，由线下方式传递。
export class LocalPassTransport {
  constructor(onNeedPackage) {
    this.kind = "localpass";
    this.msgCb = null;
    this.openCb = null;
    this.closeCb = null;
    this.onNeedPackage = onNeedPackage;
    this._open = false;
  }
  open(room) {
    this.room = room;
    setTimeout(() => { this._open = true; this.openCb && this.openCb(); }, 0);
  }
  send(msg) {
    // 伪联机不实时通信：需要玩家手动导出回合包
    if (this.onNeedPackage) this.onNeedPackage(msg);
  }
  // 由 UI 调用：把导入的包喂进来
  feed(msg) {
    this.msgCb && this.msgCb(msg);
  }
  onMessage(cb) { this.msgCb = cb; }
  onOpen(cb) { this.openCb = cb; }
  onClose(cb) { this.closeCb = cb; }
  close() { this._open = false; this.closeCb && this.closeCb(); }
}

// ─────────── WebSocket ───────────
export class WsTransport {
  constructor(url) {
    this.kind = "ws";
    this.url = url;
    this.ws = null;
  }
  open(room) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WebSocket 连接超时")), 8000);
      try {
        this.ws = new WebSocket(this.url);
      } catch (e) {
        clearTimeout(timer);
        return reject(e);
      }
      this.ws.onopen = () => {
        clearTimeout(timer);
        this.openCb && this.openCb();
        resolve();
      };
      this.ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("WebSocket 连接失败"));
      };
      this.ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          this.msgCb && this.msgCb(m);
        } catch { /* 忽略非法消息 */ }
      };
      this.ws.onclose = () => this.closeCb && this.closeCb();
    });
  }
  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
  onMessage(cb) { this.msgCb = cb; }
  onOpen(cb) { this.openCb = cb; }
  onClose(cb) { this.closeCb = cb; }
  close() { try { this.ws && this.ws.close(); } catch { /* 已关闭 */ } }
}

// ─────────── WebRTC（DataChannel）───────────
// 手动信令：房主生成 offer，guest 通过复制粘贴交换 answer。
// 局域网内通常无需 STUN 即可直连。
export class RtcTransport {
  constructor() {
    this.kind = "webrtc";
    this.pc = null;
    this.dc = null;
  }

  _mkPc() {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pc.onicecandidate = (e) => {
      if (e.candidate) this._sendSignal({ ice: e.candidate });
    };
    pc.ondatachannel = (e) => this._bindChannel(e.channel);
    return pc;
  }

  _bindChannel(dc) {
    this.dc = dc;
    dc.onopen = () => this.openCb && this.openCb();
    dc.onclose = () => this.closeCb && this.closeCb();
    dc.onmessage = (e) => {
      try {
        this.msgCb && this.msgCb(JSON.parse(e.data));
      } catch { /* 忽略非法消息 */ }
    };
  }

  _sendSignal(obj) {
    this.signalCb && this.signalCb(obj);
  }

  // 房主：生成 offer
  async createOffer() {
    this.pc = this._mkPc();
    this._bindChannel(this.pc.createDataChannel("game", { ordered: true }));
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this._waitIce();
    return this.pc.localDescription;
  }

  // 房主：接收 guest 的 answer
  async acceptAnswer(answer) {
    await this.pc.setRemoteDescription(answer);
  }

  // guest：接收 offer，返回 answer
  async acceptOffer(offer) {
    this.pc = this._mkPc();
    await this.pc.setRemoteDescription(offer);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this._waitIce();
    return this.pc.localDescription;
  }

  _waitIce() {
    return new Promise((resolve) => {
      if (this.pc.iceGatheringState === "complete") return resolve();
      const t = setTimeout(resolve, 2500); // 局域网通常很快，超时也继续
      this.pc.onicegatheringstatechange = () => {
        if (this.pc.iceGatheringState === "complete") {
          clearTimeout(t);
          resolve();
        }
      };
    });
  }

  send(msg) {
    if (this.dc && this.dc.readyState === "open") this.dc.send(JSON.stringify(msg));
  }
  onMessage(cb) { this.msgCb = cb; }
  onOpen(cb) { this.openCb = cb; }
  onClose(cb) { this.closeCb = cb; }
  onSignal(cb) { this.signalCb = cb; }
  close() {
    try { this.dc && this.dc.close(); } catch { /* 已关闭 */ }
    try { this.pc && this.pc.close(); } catch { /* 已关闭 */ }
  }
}

// ─────────── 自动选择 ───────────
export async function autoConnect(room, opts = {}) {
  // 1. 试 WebRTC（需要手动交换 offer/answer 时由 UI 配合）
  // 2. 试 WebSocket（若给了 wsUrl）
  // 3. 兜底伪联机
  if (opts.wsUrl) {
    try {
      const t = new WsTransport(opts.wsUrl);
      await t.open(room);
      return t;
    } catch { /* 继续降级 */ }
  }
  return new LocalPassTransport(opts.onNeedPackage);
}
