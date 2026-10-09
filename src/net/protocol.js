// 联机协议：统一信封 + 消息类型。
//
// 主机权威模型：只有 host 跑 reducer，guest 只发 action、收 state。
// 好处：规则只有一份实现；客户端改不了结果（host 会重放驳回）。
//
// 信封：{ v, room, seq, type, payload }

export const V = 1;

export const MSG = {
  HELLO: "HELLO",             // G->H  握手，带 playerId/name/lastSeq
  WELCOME: "WELCOME",         // H->G  分配座位 + 全量状态
  ROOM_STATE: "ROOM_STATE",   // H->G  每次变更后广播（只传 wireState）
  ACTION: "ACTION",           // G->H  玩家操作
  REJECT: "REJECT",           // H->G  非法 action
  PING: "PING",               // 双向  心跳 3s
  PONG: "PONG",
  SYNC_REQ: "SYNC_REQ",       // G->H  重连带 lastSeq
  CANDIDATE: "CANDIDATE",     // G->*  房主掉线时的候选声明
  VOTE: "VOTE",               // G->*  投票
  HOST_MIGRATE: "HOST_MIGRATE", // H->G  通知新房主
  BYE: "BYE",                 // 主动退出
};

export function pack(type, room, seq, payload) {
  return { v: V, room, seq, type, payload };
}

export function unpack(msg) {
  if (!msg || msg.v !== V) return null;
  if (!Object.values(MSG).includes(msg.type)) return null;
  return msg;
}

// 房间号校验（4 位，避开易混字符）
export function validRoom(s) {
  return typeof s === "string" && /^[A-Z2-9]{4}$/.test(s.toUpperCase());
}

export function genRoom() {
  const cs = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += cs[Math.floor(Math.random() * cs.length)];
  return s;
}
