// 主机端：唯一跑 reducer 的地方。收到 guest 的 action 就执行并广播。
//
// 房主掉线处理：任意 guest 都持有完整 state + actionLog，
// 可以本地重放出等价状态 → 用投票选举新 host，不需要中心服务器仲裁。
// 这是 action/reducer 架构带来的红利。

import { MSG, pack, unpack } from "./protocol.js";
import { wireState } from "../core/serialize.js";

export class Host {
  constructor(game, transport, room, data) {
    this.game = game;
    this.transport = transport;
    this.room = room;
    this.data = data;
    this.peers = new Map();   // peerId -> { id, name, seat, lastSeen, offline }
    this.timer = null;
    this.migrating = false;
  }

  start() {
    const t = this.transport;
    t.onOpen(() => this._startHeartbeat());
    t.onMessage((m) => this.onMessage(unpack(m)));
    t.onClose(() => this._onPeerGone());
    t.open(this.room);
  }

  // 游戏状态变化后调用 → 广播
  broadcast() {
    const s = this.game.state;
    this.transport.send(pack(MSG.ROOM_STATE, this.room, s.meta.seq, {
      wire: wireState(s),
      you: {}, // 座位在 WELCOME 里已分配
    }));
  }

  onMessage(m) {
    if (!m) return;
    switch (m.type) {
      case MSG.HELLO: {
        const p = m.payload;
        this.peers.set(p.playerId, {
          id: p.playerId, name: p.name, avatar: p.avatar, color: p.color,
          lastSeen: Date.now(), offline: false,
        });
        // 分配一个空座
        const used = new Set(this.game.state.players.filter((x) => x.id !== p.playerId).map((x) => x.seat));
        let seat = 0;
        while (used.has(seat) && seat < 6) seat++;
        this.transport.send(pack(MSG.WELCOME, this.room, this.game.state.meta.seq, {
          yourSeat: seat,
          wire: wireState(this.game.state),
          peers: [...this.peers.values()].map((x) => ({ id: x.id, name: x.name, seat })),
        }));
        this.broadcast();
        break;
      }

      case MSG.ACTION: {
        const p = m.payload;
        const peer = this.peers.get(p.playerId);
        if (peer) peer.lastSeen = Date.now();
        // 只有当前回合所属玩家能操作（reducer 自身也会校验，这里提前拦一道减少无谓重放）
        const cur = this.game.state.players[this.game.state.meta.currentSeat];
        if (cur && cur.id !== p.playerId && p.playerId !== "SYS") {
          this.transport.send(pack(MSG.REJECT, this.room, this.game.state.meta.seq, {
            reason: "还没轮到你",
          }));
          return;
        }
        const ok = this.game.dispatch({ ...p.action, playerId: p.playerId });
        if (!ok) {
          this.transport.send(pack(MSG.REJECT, this.room, this.game.state.meta.seq, {
            reason: "动作被拒",
          }));
        }
        this.broadcast();
        break;
      }

      case MSG.PING:
        this.transport.send(pack(MSG.PONG, this.room, this.game.state.meta.seq, {
          t: m.payload.t,
        }));
        break;

      case MSG.SYNC_REQ: {
        // 重连：按 seq 差决定增量还是全量
        const s = this.game.state;
        const gap = s.meta.seq - (m.payload.lastSeq || 0);
        this.transport.send(pack(MSG.ROOM_STATE, this.room, s.meta.seq, {
          wire: wireState(s),
          full: gap > 200 || m.payload.lastSeq == null,
        }));
        break;
      }

      case MSG.CANDIDATE:
        this._onCandidate(m.payload);
        break;

      case MSG.VOTE:
        this._onVote(m.payload);
        break;

      case MSG.BYE: {
        const peer = this.peers.get(m.payload.playerId);
        if (peer) { peer.offline = true; this.broadcast(); }
        break;
      }
    }
  }

  _startHeartbeat() {
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      const t = Date.now();
      this.transport.send(pack(MSG.PING, this.room, 0, { t }));
      // 掉线检测：90 秒无响应视为离线，AI 代打
      for (const [, peer] of this.peers) {
        const wasOffline = peer.offline;
        if (t - peer.lastSeen > 9000 && !wasOffline) {
          peer.offline = true;
          this.game.toast?.show(`${peer.name} 掉线，AI 暂代操作`, "warn");
          this.broadcast();
        } else if (t - peer.lastSeen < 9000 && wasOffline) {
          peer.offline = false;
          this.game.toast?.show(`${peer.name} 回来了`, "good");
          this.broadcast();
        }
      }
    }, 3000);
  }

  // ── 房主迁移 ──
  _onCandidate(cand) {
    if (!this.migrating) return;
    this._candidates = this._candidates || new Map();
    this._candidates.set(cand.playerId, cand);
    // 收到候选即投票赞成
    this.transport.send(pack(MSG.VOTE, this.room, 0, {
      playerId: "HOST", for: cand.playerId,
    }));
  }

  _onVote(v) {
    this._votes = this._votes || [];
    this._votes.push(v);
  }

  close() {
    clearInterval(this.timer);
    this.transport.close();
  }
}
