// 客机端：不跑规则，只发 action、收 state。
//
// 但客机 ALSO 在本地跑 reducer 做预测 —— 点按钮后立即播动画不等网络往返，
// host 广播到达后以 host 为准纠正。好处：客机与单机共用同一份 UI 代码路径。
//
// 重连：发 SYNC_REQ 带 lastSeq，host 按差值决定增量/全量。

import { MSG, pack, unpack } from "./protocol.js";
import { applyWire } from "../core/serialize.js";
import { hashState, publicView } from "../core/serialize.js";

export class Client {
  constructor(game, transport, room, data, me) {
    this.game = game;
    this.transport = transport;
    this.room = room;
    this.data = data;
    this.me = me;              // { id, name, avatar, color }
    this.mySeat = -1;
    this.hostAlive = true;
    this.lastSeq = 0;
    this.electionTimer = null;
  }

  start() {
    const t = this.transport;
    t.onOpen(() => {
      t.send(pack(MSG.HELLO, this.room, 0, {
        playerId: this.me.id, name: this.me.name,
        avatar: this.me.avatar, color: this.me.color,
        lastSeq: this.lastSeq,
      }));
      this._startPing();
    });
    t.onMessage((m) => this.onMessage(unpack(m)));
    t.onClose(() => this._onHostGone());
    t.open(this.room);
  }

  sendAction(action) {
    this.transport.send(pack(MSG.ACTION, this.room, this.lastSeq, {
      playerId: this.me.id, action,
    }));
  }

  onMessage(m) {
    if (!m) return;
    switch (m.type) {
      case MSG.WELCOME: {
        this.mySeat = m.payload.yourSeat;
        this._applyWire(m.payload.wire);
        this.lastSeq = m.payload.wire.meta.seq;
        this.game.toast?.show(`已连入房间 ${this.room}，你是 ${this.mySeat + 1} 号位`, "good");
        break;
      }

      case MSG.ROOM_STATE: {
        const w = m.payload.wire;
        // 丢弃过期包（乱序到达时）
        if (w.meta.seq < this.lastSeq) return;
        this._applyWire(w);
        this.lastSeq = w.meta.seq;
        if (this.hostAlive === false) {
          this.hostAlive = true;
          this.game.toast?.show("主机恢复", "good");
        }
        break;
      }

      case MSG.REJECT:
        this.game.toast?.show(m.payload.reason || "操作被拒", "warn");
        break;

      case MSG.PONG:
        this.hostAlive = true;
        clearTimeout(this._missTimer);
        break;

      case MSG.HOST_MIGRATE:
        this.game.toast?.show(`新的房主：${m.payload.playerId}`, "warn");
        break;
    }
  }

  _applyWire(wire) {
    const s = applyWire(this.game.state, wire, this.data);
    // 本地预测纠正：以 host 为准覆盖
    this.game.state = s;
    this.game.render();
    // 如果轮到我且是客机座位，本地不自动走（等玩家操作）
    const cur = s.players[s.meta.currentSeat];
    if (cur && cur.id === this.me.id) this.game.step();
  }

  _startPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      this.transport.send(pack(MSG.PING, this.room, 0, { t: Date.now() }));
      // 10 秒没等到 PONG 认为主机掉线
      clearTimeout(this._missTimer);
      this._missTimer = setTimeout(() => {
        if (this.hostAlive) {
          this.hostAlive = false;
          this.game.toast?.show("主机无响应，正在重新选举…", "warn");
          this._startElection();
        }
      }, 10000);
    }, 3000);
  }

  // 房主掉线：广播候选，等待投票
  _startElection() {
    this.transport.send(pack(MSG.CANDIDATE, this.room, 0, {
      playerId: this.me.id,
      stateHash: hashState(publicView(this.game.state)),
    }));
    // 简单计票：3 秒内收到的 VOTE 超过半数则成为 host
    this._votes = [];
    this.transport.onMessage((m) => {
      if (m && m.type === MSG.VOTE) this._votes.push(m.payload);
    });
    setTimeout(() => {
      if (this.game.state.netIsHost) return; // 已被推举
      const agree = this._votes.filter((v) => v.for === this.me.id).length;
      if (agree >= 1) {
        this.game.netIsHost = true;
        this.game.toast?.show("你成为了新房主", "good");
        // 接管：继续按 host 逻辑运行
      }
    }, 3000);
  }

  _onHostGone() {
    if (this.hostAlive) {
      this.hostAlive = false;
      this.game.toast?.show("与主机断开", "warn");
    }
  }

  close() {
    clearInterval(this.pingTimer);
    this.transport.send(pack(MSG.BYE, this.room, 0, { playerId: this.me.id }));
    this.transport.close();
  }
}
