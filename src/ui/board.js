// Canvas 棋盘渲染 —— 立体风格。
//
// 相比线框原版的三个关键改动：
//   ① 格子画成立体块：顶部高光 + 底面 + 侧面阴影 + 立体边框，不是纯色平面
//   ② 内部装饰手绘成实际场景（工位隔断、咖啡机、大班台…），不是 emoji 贴图
//   ③ 棋子带高光/投影/轮廓，同格多棋子时立起来排列
//
// 渲染分两层：静态层（底图+格子+装饰）缓存到离屏 canvas，动态层（棋子/动画/骰子）每帧画。

import { TILE, TILE_BADGE, DECOR_SPEC, TOKEN_SKIN, CHARACTERS } from "./icons.js";
import { drawCharacterFace } from "./character.js";

const FONT = '"PingFang SC","Microsoft YaHei",system-ui,sans-serif';
const MONO = '"SF Mono",Consolas,monospace';

export class BoardRenderer {
  constructor(canvas, board) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.board = board;
    this.dpr = window.devicePixelRatio || 1;
    this.size = 600;
    this.static = null;
    this.anim = new Map();
    this.dice = null;
    this.highlight = null;
    this.onTokenClick = null;
    // 动画节奏（ms）：默认值与历史版本一致，设置页的"动画速度"会改写
    this.stepMs = 72;
    // 骰子 320ms 快得像闪一下，毫无"掷"的仪式感 —— 拉长到 1.1s：
    // 前 62% 摇晃翻面，后 38% 定格回弹
    this.diceMs = 1100;
    this._bind();
  }

  setBoard(board) { this.board = board; this.static = null; }

  _bind() {
    this.canvas.addEventListener("click", (e) => {
      if (!this.onTokenClick) return;
      const r = this.canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) * (this.size / r.width);
      const y = (e.clientY - r.top) * (this.size / r.height);
      for (const t of this.tokens()) {
        const dx = x - t.cx, dy = y - t.cy;
        if (dx * dx + dy * dy < (t.r + 4) * (t.r + 4)) { this.onTokenClick(t.id); return; }
      }
    });
  }

  // 格子布局：直接从 board.tiles 的 grid 坐标读（数据是唯一事实来源）
  layout() {
    const g = this.board.grid;
    const n = g.cols;
    const cell = this.size / n;
    const pad = 1.5;
    return this.board.tiles.map((t) => {
      const col = t.grid[0], row = t.grid[1];
      return {
        id: t.id, col, row,
        px: col * cell + pad, py: row * cell + pad,
        pw: cell - pad * 2,
        cx: col * cell + cell / 2,
        cy: row * cell + cell / 2,
      };
    });
  }

  resize() {
    const wrap = this.canvas.parentElement;
    const avail = Math.min(wrap.clientWidth - 24, wrap.clientHeight - 24, 760);
    this.size = Math.max(280, avail);
    this.canvas.style.width = this.size + "px";
    this.canvas.style.height = this.size + "px";
    this.canvas.width = Math.round(this.size * this.dpr);
    this.canvas.height = Math.round(this.size * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.static = null;
  }

  // ─────────── 静态层 ───────────
  buildStatic() {
    const cv = document.createElement("canvas");
    cv.width = this.canvas.width;
    cv.height = this.canvas.height;
    const c = cv.getContext("2d");
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const n = this.board.grid.cols;
    this.cell = this.size / n;
    this.cells = this.layout();

    // 底：深色木纹底板，让外环格子跳出来
    c.fillStyle = "#2b2a33";
    c.fillRect(0, 0, this.size, this.size);

    // 中央办公区底
    this.drawOfficeFloor(c);

    // 内部装饰
    for (const d of this.board.decor || []) this.drawDecor(c, d);

    // 外环格子
    for (const t of this.cells) {
      const tile = this.board.tiles[t.id];
      this.drawTile(c, t, tile);
    }

    // 外框立体边
    this.drawOuterEdge(c);
    this.static = cv;
  }

  // 中央办公区：木地板拼条 + 十字走廊 + 金边地毯 + 中央金币徽章
  // （旧版一块纯色渐变+几条细线，场景散放没有章法 —— 用户反馈"太潦草"）
  drawOfficeFloor(c) {
    const cell = this.cell;
    const x0 = cell, y0 = cell, w = this.size - cell * 2, h = this.size - cell * 2;
    const cx = x0 + w / 2, cy = y0 + h / 2;

    // 1) 暖色木地板底
    const grd = c.createLinearGradient(x0, y0, x0 + w, y0 + h);
    grd.addColorStop(0, "#4c4136");
    grd.addColorStop(1, "#372f28");
    c.fillStyle = grd;
    c.fillRect(x0, y0, w, h);

    // 2) 横向木板条 + 明暗交替 + 错缝拼线
    const rows = 10;
    c.lineWidth = 1;
    for (let i = 0; i < rows; i++) {
      const ry = y0 + (h / rows) * i;
      c.fillStyle = i % 2 ? "rgba(255,246,225,0.03)" : "rgba(0,0,0,0.05)";
      c.fillRect(x0, ry, w, h / rows);
      c.strokeStyle = "rgba(0,0,0,0.18)";
      c.beginPath();
      c.moveTo(x0, ry); c.lineTo(x0 + w, ry);
      c.stroke();
      // 木板错缝（每条错开位置，像真实拼木地板）
      c.strokeStyle = "rgba(0,0,0,0.12)";
      const seam = x0 + w * (0.2 + 0.28 * (i % 3));
      c.beginPath(); c.moveTo(seam, ry); c.lineTo(seam, ry + h / rows); c.stroke();
    }

    // 3) 十字走廊：亮色通道从外环一直通到中央，办公室动线一目了然
    const cw = cell * 0.6;
    c.fillStyle = "rgba(255,246,225,0.065)";
    c.fillRect(x0, cy - cw / 2, w, cw);
    c.fillRect(cx - cw / 2, y0, cw, h);
    c.strokeStyle = "rgba(245,200,66,0.12)";
    c.lineWidth = 1.5;
    c.strokeRect(x0, cy - cw / 2, w, cw);
    c.strokeRect(cx - cw / 2, y0, cw, h);

    // 4) 中央地毯 + 双层金色包边
    const rw = w * 0.56, rh = h * 0.56;
    const rug = c.createLinearGradient(cx - rw / 2, cy - rh / 2, cx + rw / 2, cy + rh / 2);
    rug.addColorStop(0, "rgba(99,76,122,0.42)");
    rug.addColorStop(1, "rgba(66,52,88,0.42)");
    c.fillStyle = rug;
    this.roundRect(c, cx - rw / 2, cy - rh / 2, rw, rh, 16);
    c.fill();
    c.strokeStyle = "rgba(245,200,66,0.42)";
    c.lineWidth = 2;
    this.roundRect(c, cx - rw / 2, cy - rh / 2, rw, rh, 16);
    c.stroke();
    c.strokeStyle = "rgba(245,200,66,0.16)";
    c.lineWidth = 1;
    this.roundRect(c, cx - rw / 2 + 5, cy - rh / 2 + 5, rw - 10, rh - 10, 12);
    c.stroke();

    // 5) 中央徽章：金色光环 + ¥ + 标语
    // 几何约束：正上方被会议室场景（到 cy-25px）压住，所以文案全放徽章下缘。
    const er = cell * 1.0;
    const eg = c.createRadialGradient(cx, cy, er * 0.15, cx, cy, er);
    eg.addColorStop(0, "rgba(245,200,66,0.30)");
    eg.addColorStop(0.7, "rgba(245,200,66,0.10)");
    eg.addColorStop(1, "rgba(245,200,66,0)");
    c.fillStyle = eg;
    c.beginPath(); c.arc(cx, cy, er, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(245,200,66,0.55)";
    c.lineWidth = 2.5;
    c.beginPath(); c.arc(cx, cy, er * 0.52, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = "rgba(245,200,66,0.2)";
    c.lineWidth = 1;
    c.beginPath(); c.arc(cx, cy, er * 0.62, 0, Math.PI * 2); c.stroke();
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillStyle = "rgba(245,200,66,0.92)";
    c.font = `800 ${er * 0.52}px ${MONO}`;
    c.shadowColor = "rgba(0,0,0,0.55)"; c.shadowBlur = 5;
    c.fillText("¥", cx, cy - er * 0.05);
    c.shadowBlur = 0;
    c.fillStyle = "rgba(245,200,66,0.6)";
    c.font = `700 ${Math.max(8, cell * 0.26)}px ${FONT}`;
    c.fillText("工 位 大 亨", cx, cy + er * 0.72);
    c.fillStyle = "rgba(255,255,255,0.25)";
    c.font = `600 ${Math.max(6, cell * 0.15)}px ${MONO}`;
    c.fillText("MONOPOLY · OFFICE", cx, cy + er * 0.98);
  }

  // ─────────── 单个格子（立体）───────────
  drawTile(c, t, tile) {
    const st = TILE[tile.type] || TILE.company;
    const x = t.px, y = t.py, w = t.pw, h = t.pw;
    const depth = Math.max(2, this.cell * 0.055);   // 厚度

    // 投影
    c.fillStyle = "rgba(0,0,0,0.4)";
    this.roundRect(c, x + 1, y + depth + 1.5, w, h, 5);
    c.fill();

    // 侧面
    c.fillStyle = st.edge;
    this.roundRect(c, x, y + depth, w, h, 5);
    c.fill();

    // 顶面（渐变）
    const g = c.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, st.hi);
    g.addColorStop(0.4, st.bg);
    g.addColorStop(1, st.bg);
    c.fillStyle = g;
    this.roundRect(c, x, y, w, h - depth * 0.35, 5);
    c.fill();

    // 顶部高光
    c.fillStyle = "rgba(255,255,255,0.32)";
    this.roundRect(c, x + w * 0.07, y + w * 0.055, w * 0.86, Math.max(1.4, h * 0.035), 2);
    c.fill();

    // ── 垂直分区：类型徽标(左上12%) / 格名(28%) / 棋子区(48%) / 价格(86%) ──
    // 棋子站在 48%~62% 那带，所以格名靠上、价格贴底。
    const bs = Math.max(6.5, h * 0.14);
    c.fillStyle = TILE_BADGE[tile.type] || st.bg;
    this.roundRect(c, x + w * 0.06, y + h * 0.12, bs, bs * 0.66, 2.5);
    c.fill();
    c.fillStyle = "rgba(0,0,0,0.58)";
    c.font = `700 ${Math.max(5.5, bs * 0.58)}px ${FONT}`;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(st.tone, x + w * 0.06 + bs / 2, y + h * 0.12 + bs * 0.33 + 0.5);

    // 格名：27%
    this.fittedText(c, tile.name, x + w / 2, y + h * 0.29, w - 5, st.fg, 6);

    // 价格：86%（贴底，避免被棋子盖住）
    const py = y + h * 0.87;
    if (tile.payload && tile.payload.price) {
      c.font = `700 ${Math.max(6.5, this.cell * 0.14)}px ${MONO}`;
      c.fillStyle = "#fff7d6";
      c.shadowColor = "rgba(0,0,0,0.8)"; c.shadowBlur = 2.5;
      c.fillText(`¥${this.fmtPrice(tile.payload.price)}`, x + w / 2, py);
      c.shadowBlur = 0;
    } else if (tile.type === "start") {
      c.font = `700 ${Math.max(6.5, this.cell * 0.14)}px ${MONO}`;
      c.fillStyle = "#ffe27a";
      c.shadowColor = "rgba(0,0,0,0.8)"; c.shadowBlur = 2.5;
      c.fillText(`+${tile.payload.salaryBonus}`, x + w / 2, py);
      c.shadowBlur = 0;
    } else if (tile.payload && (tile.payload.rent || tile.payload.price)) {
      const amt = tile.payload.rent || tile.payload.price;
      c.font = `600 ${Math.max(6, this.cell * 0.12)}px ${FONT}`;
      c.fillStyle = "rgba(255,255,255,0.92)";
      c.shadowColor = "rgba(0,0,0,0.75)"; c.shadowBlur = 2;
      c.fillText(`−${this.fmtPrice(amt)}`, x + w / 2, py);
      c.shadowBlur = 0;
    }

    // 地皮归属：玩家色小房子 + 旗子（大富翁式所有权标记，比一条色带更可读）
    if (tile.owner) {
      const p = this.players && this.players.find((x2) => x2.id === tile.owner);
      const col = p ? p.color : "#fff";
      const base = y + h - depth - 1.5;
      const hh = Math.max(4.5, h * 0.13);
      // 旗杆 + 三角旗（挂在格子左下角）
      const fx = x + w * 0.12;
      c.strokeStyle = "rgba(255,255,255,0.9)";
      c.lineWidth = Math.max(0.9, h * 0.014);
      c.beginPath(); c.moveTo(fx, base); c.lineTo(fx, base - hh); c.stroke();
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(fx, base - hh);
      c.lineTo(fx + hh * 1.05, base - hh * 0.72);
      c.lineTo(fx, base - hh * 0.44);
      c.closePath(); c.fill();
      // 小房子（右下角，屋顶 + 房体）
      const hw = Math.max(5, w * 0.3);
      const hx = x + w * 0.94 - hw;
      c.fillStyle = col;
      c.fillRect(hx, base - hh * 0.62, hw, hh * 0.62);
      c.beginPath();
      c.moveTo(hx - hw * 0.1, base - hh * 0.62);
      c.lineTo(hx + hw / 2, base - hh * 1.06);
      c.lineTo(hx + hw * 1.1, base - hh * 0.62);
      c.closePath(); c.fill();
      // 房子描一圈细白边，深色格子上也能立起来
      c.strokeStyle = "rgba(255,255,255,0.55)";
      c.lineWidth = 0.7;
      c.strokeRect(hx, base - hh * 0.62, hw, hh * 0.62);
    }
  }

  // 外框立体边：给整个棋盘一圈厚度
  drawOuterEdge(c) {
    const cell = this.cell;
    // 外侧描边（模拟桌沿）
    c.strokeStyle = "rgba(0,0,0,0.5)";
    c.lineWidth = Math.max(3, cell * 0.1);
    this.roundRect(c, cell * 0.06, cell * 0.06, this.size - cell * 0.12, this.size - cell * 0.12, 8);
    c.stroke();
    c.strokeStyle = "rgba(255,255,255,0.10)";
    c.lineWidth = 1.5;
    this.roundRect(c, cell * 0.14, cell * 0.14, this.size - cell * 0.28, this.size - cell * 0.28, 6);
    c.stroke();
  }

  // ─────────── 内部装饰（手绘场景）───────────
  drawDecor(c, d) {
    const cell = this.cell;
    const spec = DECOR_SPEC[d.kind];
    if (!spec) return;
    // span: 占据几格见方（老板办公室/会议室等大场景用 2，细节点缀用 1）
    const span = d.span || 1;
    const pad = cell * (span > 1 ? 0.1 : 0.16);
    const x = d.grid[0] * cell + pad;
    const y = d.grid[1] * cell + pad;
    const w = cell * span - pad * 2;
    const h = cell * span - pad * 2;
    c.save();
    // 台面：略亮底 + 深色边框，把场景托起来
    const g = c.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "rgba(255,255,255,0.06)");
    g.addColorStop(1, "rgba(255,255,255,0.02)");
    c.fillStyle = g;
    this.roundRect(c, x, y, w, h, 6);
    c.fill();
    c.strokeStyle = "rgba(0,0,0,0.35)";
    c.lineWidth = 1.2;
    c.stroke();
    this.roundRect(c, x, y, w, h, 6);
    c.clip();
    this.drawScene(c, spec.kind, x, y, w, h, spec, span);
    c.restore();
    // 场景名（小字标签）
    if (span > 1 && d.label) {
      c.fillStyle = "rgba(255,255,255,0.5)";
      c.font = `600 ${Math.max(7, cell * 0.13)}px ${FONT}`;
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(d.label, x + w / 2, y + h - cell * 0.14);
    }
  }

  drawScene(c, kind, x, y, w, h, spec, span = 1) {
    switch (kind) {
      case "cubicle": this.sceneCubicle(c, x, y, w, h, spec); break;
      case "teaRoom": this.sceneTea(c, x, y, w, h, spec, span); break;
      case "meeting": this.sceneMeeting(c, x, y, w, h, spec, span); break;
      case "boss": this.sceneBoss(c, x, y, w, h, spec, span); break;
      case "printer": this.scenePrinter(c, x, y, w, h, spec); break;
      case "plant": this.scenePlant(c, x, y, w, h, spec); break;
      case "board": this.sceneBoard(c, x, y, w, h, spec); break;
      case "pantry": this.scenePantry(c, x, y, w, h, spec); break;
      case "window": this.sceneWindow(c, x, y, w, h, spec); break;
      case "sofa": this.sceneSofa(c, x, y, w, h, spec); break;
      case "water": this.sceneWater(c, x, y, w, h, spec); break;
      case "gym": this.sceneGym(c, x, y, w, h, spec); break;
      case "server": this.sceneServer(c, x, y, w, h, spec); break;
      case "reception": this.sceneReception(c, x, y, w, h, spec); break;
    }
  }

  // 工位：2×2 四联隔断。格子小，所以只画最关键的轮廓线，不堆细节。
  sceneCubicle(c, x, y, w, h, spec) {
    c.fillStyle = "rgba(0,0,0,0.16)";
    c.fillRect(x, y, w, h);
    const cw = w / 2, ch = h / 2;
    for (let i = 0; i < 4; i++) {
      const px = x + (i % 2) * cw;
      const py = y + Math.floor(i / 2) * ch;
      // 桌面
      c.fillStyle = "#c9a06a";
      c.fillRect(px + cw * 0.08, py + ch * 0.5, cw * 0.84, ch * 0.34);
      c.fillStyle = "rgba(255,255,255,0.22)";
      c.fillRect(px + cw * 0.08, py + ch * 0.5, cw * 0.84, ch * 0.08);
      // 显示器（发光屏）
      c.fillStyle = "#2f3946";
      c.fillRect(px + cw * 0.3, py + ch * 0.14, cw * 0.4, ch * 0.3);
      c.fillStyle = "#7fd8e8";
      c.fillRect(px + cw * 0.33, py + ch * 0.17, cw * 0.34, ch * 0.24);
      // 隔断（竖线）
      c.fillStyle = spec.dark;
      c.fillRect(px + cw * 0.04, py + ch * 0.06, cw * 0.05, ch * 0.44);
    }
    // 中心十字分隔
    c.strokeStyle = "rgba(0,0,0,0.2)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x + cw, y); c.lineTo(x + cw, y + h);
    c.moveTo(x, y + ch); c.lineTo(x + w, y + ch);
    c.stroke();
  }

  // 茶水间：咖啡机 + 杯架 + 茶水台。2 格见方时多画一圈台面与散落的杯子。
  sceneTea(c, x, y, w, h, spec, span = 1) {
    c.fillStyle = "rgba(0,0,0,0.12)";
    c.fillRect(x, y, w, h);
    if (span > 1) {
      // 吧台
      c.fillStyle = "#6b4a30";
      c.fillRect(x, y + h * 0.76, w, h * 0.1);
      c.fillStyle = "rgba(255,255,255,0.15)";
      c.fillRect(x, y + h * 0.76, w, h * 0.022);
    }
    // 咖啡机主体
    const mw = w * 0.44, mh = h * 0.6, mx = x + w * 0.12, my = y + h * (span > 1 ? 0.14 : 0.22);
    c.fillStyle = spec.dark;
    this.roundRect(c, mx, my, mw, mh, 3); c.fill();
    c.fillStyle = spec.tint;
    this.roundRect(c, mx + mw * 0.12, my + mh * 0.08, mw * 0.76, mh * 0.5, 2); c.fill();
    // 出水口
    c.fillStyle = "#3d3a33";
    c.fillRect(mx + mw * 0.42, my + mh * 0.55, mw * 0.16, mh * 0.14);
    // 杯子
    c.fillStyle = "#f0ece4";
    c.fillRect(mx + mw * 0.36, my + mh * 0.68, mw * 0.28, mh * 0.16);
    // 杯架
    c.fillStyle = spec.tint;
    this.roundRect(c, x + w * 0.66, y + h * 0.26, w * 0.22, h * 0.5, 2); c.fill();
    for (let i = 0; i < 3; i++) {
      c.fillStyle = i % 2 ? "#c96" : "#6c9";
      c.fillRect(x + w * 0.68, y + h * (0.32 + i * 0.15), w * 0.18, h * 0.09);
    }
    // 咖啡豆散落
    c.fillStyle = "rgba(90,60,30,0.5)";
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.arc(x + w * (0.16 + i * 0.06), y + h * 0.9, w * 0.02, 0, Math.PI * 2);
      c.fill();
    }
  }

  // 会议室：圆桌 + 四椅
  sceneMeeting(c, x, y, w, h, spec, span = 1) {
    c.fillStyle = "rgba(0,0,0,0.12)";
    c.fillRect(x, y, w, h);
    const cx = x + w / 2, cy = y + h / 2;
    // 椅子
    c.fillStyle = spec.dark;
    for (const [dx, dy] of [[0, -0.32], [0, 0.32], [-0.34, 0], [0.34, 0]]) {
      c.beginPath();
      c.arc(cx + w * dx, cy + h * dy, w * 0.11, 0, Math.PI * 2);
      c.fill();
    }
    // 圆桌
    const tg = c.createRadialGradient(cx - w * 0.06, cy - h * 0.06, w * 0.05, cx, cy, w * 0.28);
    tg.addColorStop(0, "#e0c49a");
    tg.addColorStop(1, "#b8956a");
    c.fillStyle = tg;
    c.beginPath(); c.arc(cx, cy, w * 0.26, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = 1; c.stroke();
    // 桌上文件
    c.fillStyle = "#f5f5f0";
    c.fillRect(cx - w * 0.12, cy - h * 0.08, w * 0.14, h * 0.1);
    c.fillStyle = "#7ec8e3";
    c.fillRect(cx + w * 0.02, cy + h * 0.02, w * 0.12, h * 0.09);
  }

  // 老板办公室：大班台 + 高背椅 + 盆栽
  sceneBoss(c, x, y, w, h, spec, span = 1) {
    c.fillStyle = "rgba(0,0,0,0.14)";
    c.fillRect(x, y, w, h);
    // 高背椅
    c.fillStyle = "#5a3f38";
    this.roundRect(c, x + w * 0.1, y + h * 0.12, w * 0.26, h * 0.44, 3); c.fill();
    // 老板（大班台）
    const tx = x + w * 0.3, ty = y + h * 0.42;
    c.fillStyle = "#7a4a2e";
    this.roundRect(c, tx, ty, w * 0.56, h * 0.3, 3); c.fill();
    c.fillStyle = "#96613c";
    this.roundRect(c, tx + 2, ty + 2, w * 0.56 - 4, h * 0.12, 2); c.fill();
    // 台上的东西
    c.fillStyle = "#2b2b30"; c.fillRect(tx + w * 0.06, ty - h * 0.14, w * 0.18, h * 0.14);
    c.fillStyle = "#d4b02c"; c.fillRect(tx + w * 0.34, ty - h * 0.08, w * 0.1, h * 0.08);
    // 盆栽
    c.fillStyle = "#8a5a3a";
    this.roundRect(c, x + w * 0.84, y + h * 0.68, w * 0.12, h * 0.18, 2); c.fill();
    c.fillStyle = "#4a8a4a";
    c.beginPath(); c.arc(x + w * 0.9, y + h * 0.62, w * 0.1, 0, Math.PI * 2); c.fill();
  }

  scenePrinter(c, x, y, w, h, spec) {
    c.fillStyle = "rgba(0,0,0,0.1)";
    c.fillRect(x, y, w, h);
    const px = x + w * 0.18, py = y + h * 0.26, pw = w * 0.64, ph = h * 0.48;
    c.fillStyle = spec.dark;
    this.roundRect(c, px, py, pw, ph, 2); c.fill();
    c.fillStyle = spec.tint;
    this.roundRect(c, px + pw * 0.08, py + ph * 0.1, pw * 0.84, ph * 0.42, 2); c.fill();
    // 出纸
    c.fillStyle = "#f8f8f4";
    c.fillRect(px + pw * 0.3, py + ph, pw * 0.4, ph * 0.3);
    // 状态灯
    c.fillStyle = "#5cd35c";
    c.beginPath(); c.arc(px + pw * 0.82, py + ph * 0.24, w * 0.035, 0, Math.PI * 2); c.fill();
  }

  scenePlant(c, x, y, w, h, spec) {
    c.fillStyle = "rgba(0,0,0,0.08)";
    c.fillRect(x, y, w, h);
    const cx = x + w / 2, by = y + h * 0.82;
    // 盆
    c.fillStyle = "#a8613a";
    c.beginPath();
    c.moveTo(cx - w * 0.17, by - h * 0.2);
    c.lineTo(cx + w * 0.17, by - h * 0.2);
    c.lineTo(cx + w * 0.12, by);
    c.lineTo(cx - w * 0.12, by);
    c.closePath(); c.fill();
    // 叶
    c.fillStyle = spec.dark;
    for (let i = -2; i <= 2; i++) {
      c.beginPath();
      c.ellipse(cx + i * w * 0.09, by - h * 0.28 - Math.abs(i) * -h * 0.04, w * 0.08, h * 0.14, i * 0.4, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = spec.tint;
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.ellipse(cx + i * w * 0.07, by - h * 0.36, w * 0.07, h * 0.12, i * 0.3, 0, Math.PI * 2);
      c.fill();
    }
  }

  sceneBoard(c, x, y, w, h, spec) {
    c.fillStyle = "rgba(0,0,0,0.08)";
    c.fillRect(x, y, w, h);
    // 支架
    c.fillStyle = spec.dark;
    c.fillRect(x + w * 0.46, y + h * 0.66, w * 0.08, h * 0.24);
    // 白板
    c.fillStyle = "#8a8f96";
    this.roundRect(c, x + w * 0.12, y + h * 0.16, w * 0.76, h * 0.52, 2); c.fill();
    c.fillStyle = "#f4f6f5";
    this.roundRect(c, x + w * 0.15, y + h * 0.19, w * 0.7, h * 0.46, 2); c.fill();
    // 板上的字（红色笔迹）
    c.strokeStyle = "#d9534f"; c.lineWidth = Math.max(0.8, w * 0.02);
    c.beginPath();
    c.moveTo(x + w * 0.24, y + h * 0.34); c.lineTo(x + w * 0.62, y + h * 0.34);
    c.moveTo(x + w * 0.24, y + h * 0.46); c.lineTo(x + w * 0.72, y + h * 0.46);
    c.stroke();
    c.strokeStyle = "#3a7ca5";
    c.beginPath();
    c.moveTo(x + w * 0.24, y + h * 0.57); c.lineTo(x + w * 0.52, y + h * 0.57);
    c.stroke();
  }

  scenePantry(c, x, y, w, h, spec) {
    c.fillStyle = "rgba(0,0,0,0.1)";
    c.fillRect(x, y, w, h);
    // 柜子
    const cx = x + w * 0.14, cy = y + h * 0.16, cw = w * 0.72, ch = h * 0.68;
    c.fillStyle = spec.dark;
    this.roundRect(c, cx, cy, cw, ch, 2); c.fill();
    c.fillStyle = "rgba(255,255,255,0.12)";
    c.fillRect(cx + 2, cy + 2, cw - 4, ch * 0.4);
    // 玻璃门里的零食
    const snacks = ["#e86", "#6c9", "#ec3", "#96c", "#e9a"];
    for (let i = 0; i < 6; i++) {
      c.fillStyle = snacks[i % snacks.length];
      c.fillRect(cx + cw * 0.1 + (i % 3) * cw * 0.28, cy + ch * (0.15 + Math.floor(i / 3) * 0.34), cw * 0.2, ch * 0.22);
    }
    // 中缝
    c.strokeStyle = "rgba(0,0,0,0.3)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx + cw / 2, cy); c.lineTo(cx + cw / 2, cy + ch); c.stroke();
  }

  sceneWindow(c, x, y, w, h, spec) {
    // 窗外天空
    const g = c.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "#7ec8e3");
    g.addColorStop(0.6, "#b8e0f0");
    g.addColorStop(1, "#d8c8a8");
    c.fillStyle = g;
    c.fillRect(x, y, w, h);
    // 云
    c.fillStyle = "rgba(255,255,255,0.85)";
    c.beginPath(); c.arc(x + w * 0.3, y + h * 0.24, w * 0.12, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(x + w * 0.44, y + h * 0.2, w * 0.1, 0, Math.PI * 2); c.fill();
    // 远景楼群
    c.fillStyle = "#9aa8b4";
    for (let i = 0; i < 5; i++) {
      const bw = w * (0.12 + (i % 2) * 0.05);
      c.fillRect(x + w * (0.06 + i * 0.19), y + h * (0.55 + (i % 3) * 0.08), bw, h * 0.3);
    }
    // 窗框
    c.strokeStyle = spec.dark; c.lineWidth = Math.max(1.2, w * 0.035);
    this.roundRect(c, x + w * 0.06, y + h * 0.08, w * 0.88, h * 0.76, 2); c.stroke();
    c.beginPath();
    c.moveTo(x + w * 0.5, y + h * 0.08); c.lineTo(x + w * 0.5, y + h * 0.84);
    c.moveTo(x + w * 0.06, y + h * 0.46); c.lineTo(x + w * 0.94, y + h * 0.46);
    c.stroke();
  }

  sceneSofa(c, x, y, w, h, spec) {
    c.fillStyle = "rgba(0,0,0,0.1)";
    c.fillRect(x, y, w, h);
    // 靠背
    c.fillStyle = spec.dark;
    this.roundRect(c, x + w * 0.1, y + h * 0.28, w * 0.8, h * 0.3, 4); c.fill();
    // 坐垫
    c.fillStyle = spec.tint;
    this.roundRect(c, x + w * 0.1, y + h * 0.52, w * 0.8, h * 0.26, 4); c.fill();
    // 抱枕
    c.fillStyle = "#e88";
    this.roundRect(c, x + w * 0.18, y + h * 0.36, w * 0.18, h * 0.18, 3); c.fill();
    c.fillStyle = "#8ce";
    this.roundRect(c, x + w * 0.62, y + h * 0.36, w * 0.18, h * 0.18, 3); c.fill();
    // 扶手
    c.fillStyle = spec.dark;
    c.fillRect(x + w * 0.04, y + h * 0.42, w * 0.08, h * 0.36);
    c.fillRect(x + w * 0.88, y + h * 0.42, w * 0.08, h * 0.36);
  }

  sceneWater(c, x, y, w, h, spec) {
    c.fillStyle = "rgba(0,0,0,0.08)";
    c.fillRect(x, y, w, h);
    const cx = x + w / 2;
    // 底座
    c.fillStyle = "#8a9096";
    this.roundRect(c, cx - w * 0.16, y + h * 0.66, w * 0.32, h * 0.24, 2); c.fill();
    // 水桶
    const g = c.createLinearGradient(cx - w * 0.16, y, cx + w * 0.16, y);
    g.addColorStop(0, "rgba(160,220,240,0.9)");
    g.addColorStop(0.5, "rgba(220,245,255,0.95)");
    g.addColorStop(1, "rgba(140,200,225,0.9)");
    c.fillStyle = g;
    this.roundRect(c, cx - w * 0.17, y + h * 0.16, w * 0.34, h * 0.5, 3); c.fill();
    // 水位
    c.fillStyle = "rgba(90,170,210,0.55)";
    c.fillRect(cx - w * 0.15, y + h * 0.42, w * 0.3, h * 0.22);
    // 龙头
    c.fillStyle = "#6a7076";
    c.fillRect(cx + w * 0.14, y + h * 0.6, w * 0.14, h * 0.06);
    c.fillStyle = "#e8e8e0";
    c.fillRect(cx + w * 0.08, y + h * 0.72, w * 0.12, h * 0.14);
  }

  // 健身房：跑步机 + 哑铃架 + 瑜伽垫
  sceneGym(c, x, y, w, h, spec) {
    c.fillStyle = "rgba(0,0,0,0.08)";
    c.fillRect(x, y, w, h);
    // 跑步机跑带
    c.fillStyle = "#6b727c";
    this.roundRect(c, x + w * 0.08, y + h * 0.52, w * 0.52, h * 0.16, 3); c.fill();
    c.fillStyle = "#454a52";
    c.fillRect(x + w * 0.11, y + h * 0.58, w * 0.46, h * 0.07);
    // 立柱 + 控制台
    c.fillStyle = "#565d68";
    c.fillRect(x + w * 0.5, y + h * 0.24, w * 0.05, h * 0.32);
    c.fillStyle = "#39404a";
    this.roundRect(c, x + w * 0.42, y + h * 0.15, w * 0.2, h * 0.1, 2); c.fill();
    c.fillStyle = "#8fe0f0";
    c.fillRect(x + w * 0.45, y + h * 0.175, w * 0.14, h * 0.045);
    // 哑铃架
    c.fillStyle = spec.dark;
    c.fillRect(x + w * 0.68, y + h * 0.6, w * 0.26, h * 0.06);
    for (let i = 0; i < 2; i++) {
      const dx = x + w * (0.73 + i * 0.14);
      c.fillStyle = "#3a3f46";
      c.fillRect(dx, y + h * 0.47, w * 0.035, h * 0.15);
      c.beginPath(); c.arc(dx + w * 0.018, y + h * 0.46, w * 0.036, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(dx + w * 0.018, y + h * 0.63, w * 0.036, 0, Math.PI * 2); c.fill();
    }
    // 瑜伽垫
    c.fillStyle = "#7ac0a0";
    this.roundRect(c, x + w * 0.1, y + h * 0.8, w * 0.52, h * 0.09, 3); c.fill();
  }

  // 机房：服务器机柜 + 指示灯 + 线缆
  sceneServer(c, x, y, w, h, spec) {
    c.fillStyle = "rgba(0,0,0,0.14)";
    c.fillRect(x, y, w, h);
    // 机柜
    const rx = x + w * 0.16, ry = y + h * 0.1, rw = w * 0.68, rh = h * 0.8;
    c.fillStyle = "#2c323b";
    this.roundRect(c, rx, ry, rw, rh, 2); c.fill();
    c.strokeStyle = "rgba(255,255,255,0.12)";
    c.lineWidth = 0.8;
    c.stroke();
    // 服务器槽位：色灯 + 通风栅格
    for (let i = 0; i < 4; i++) {
      const sy = ry + rh * (0.07 + i * 0.23);
      c.fillStyle = "#3c444f";
      c.fillRect(rx + rw * 0.08, sy, rw * 0.84, rh * 0.17);
      c.fillStyle = i % 2 ? "#5cd35c" : "#e8c66c";
      c.beginPath();
      c.arc(rx + rw * 0.17, sy + rh * 0.085, Math.max(1, w * 0.022), 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.14)";
      for (let k = 0; k < 4; k++) {
        c.fillRect(rx + rw * (0.32 + k * 0.14), sy + rh * 0.06, rw * 0.09, rh * 0.05);
      }
    }
    // 拖出的线缆
    c.strokeStyle = "#4a5560";
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(rx + rw * 0.5, ry + rh);
    c.quadraticCurveTo(rx + rw * 0.7, ry + rh + h * 0.06, rx + rw * 0.95, ry + rh * 0.9);
    c.stroke();
  }

  // 前台：弧形接待台 + Logo 墙 + 访客椅
  sceneReception(c, x, y, w, h, spec) {
    c.fillStyle = "rgba(0,0,0,0.1)";
    c.fillRect(x, y, w, h);
    // Logo 墙
    c.fillStyle = spec.dark;
    this.roundRect(c, x + w * 0.28, y + h * 0.08, w * 0.44, h * 0.28, 2); c.fill();
    c.fillStyle = "#f5c842";
    c.font = `700 ${Math.max(6, w * 0.15)}px ${FONT}`;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("GO", x + w * 0.5, y + h * 0.22);
    // 弧形前台（两次叠色做台面厚度）
    c.fillStyle = "#a8672f";
    c.beginPath();
    c.ellipse(x + w * 0.5, y + h * 0.72, w * 0.37, h * 0.2, 0, Math.PI, 0);
    c.fill();
    c.fillStyle = "#c8834a";
    c.beginPath();
    c.ellipse(x + w * 0.5, y + h * 0.7, w * 0.37, h * 0.2, 0, Math.PI, 0);
    c.fill();
    c.fillStyle = "rgba(255,255,255,0.16)";
    c.beginPath();
    c.ellipse(x + w * 0.5, y + h * 0.7, w * 0.3, h * 0.12, 0, Math.PI, 0);
    c.fill();
    // 访客椅（左右各一把）
    c.fillStyle = "#6b8cae";
    this.roundRect(c, x + w * 0.05, y + h * 0.64, w * 0.14, h * 0.22, 2); c.fill();
    this.roundRect(c, x + w * 0.81, y + h * 0.64, w * 0.14, h * 0.22, 2); c.fill();
  }

  // ─────────── 棋子 ───────────
  tokens() {
    if (!this.cells || !this.players) return [];
    const out = [];
    const byTile = {};
    // 破产的也保留棋子（打叉状态），只是位置信息照常画
    for (const p of this.players) {
      (byTile[p.pos] = byTile[p.pos] || []).push(p);
    }
    const r = Math.max(7, this.cell * 0.19);
    for (const [tileId, list] of Object.entries(byTile)) {
      const t = this.cells[tileId];
      if (!t) continue;
      const n = list.length;
      // 棋子站在格子下半部分（上半留给类型徽标），同格多人紧凑排布且不越界
      const clusterY = t.cy + this.cell * 0.08;
      const maxDx = this.cell * 0.5 - r - 1.5;
      list.forEach((p, i) => {
        const an = this.anim.get(p.id);
        const bx = an ? an.cx : t.cx;
        const byy = an ? an.cy : t.cy;
        let ox = 0, oy = this.cell * 0.08;
        if (n === 1) {
          ox = 0;
        } else if (n === 2) {
          ox = (i - 0.5) * Math.min(r * 2.1, maxDx * 2);
          oy = this.cell * (i === 0 ? 0.02 : 0.15);
        } else if (n <= 4) {
          // 2×2 网格
          const gx = i % 2 ? 1 : -1;
          const gy = i < 2 ? 0 : 1;
          ox = gx * Math.min(r * 1.05, maxDx);
          oy = this.cell * 0.04 + gy * Math.min(r * 1.1, this.cell * 0.16);
        } else {
          // 5+ 个：绕小圆周
          const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
          const rr = Math.min(r * 1.5, maxDx * 0.9);
          ox = Math.cos(a) * rr;
          oy = this.cell * 0.1 + Math.sin(a) * rr * 0.6;
        }
        out.push({ id: p.id, color: p.color, cx: bx + ox, cy: byy + oy, r, p,
                   // 同格多人时名牌错位排布（level 越大越往上/往右偏），避免叠成一坨
                   tagLevel: n === 1 ? 0 : (i % 2 === 0 ? 0 : 1),
                   tagSide: n > 1 ? (i < n / 2 ? -1 : 1) : 0 });
      });
    }
    return out;
  }

  // ─────────── 动画 ───────────
  moveToken(playerId, from, to, steps, done) {
    const seq = [];
    for (let i = 1; i <= steps; i++) seq.push((from + i) % this.board.tiles.length);
    this.anim.set(playerId, { cx: 0, cy: 0, seq, i: 0, t: 0, done });
    if (!this._raf) this._loop();
  }

  showDice(value, done) {
    this.dice = { value, t: 0, done };
    if (!this._raf) this._loop();
  }

  setHighlight(tileId) { this.highlight = tileId; }

  _loop() {
    const step = (ts) => {
      this._raf = requestAnimationFrame(step);
      const dt = this.last ? ts - this.last : 16;
      this.last = ts;
      let busy = false;

      for (const [pid, an] of this.anim) {
        // 每格移动时长（ms）。原为 150 —— 一个 6 步的移动要 900ms，
        // 4 个 AI 连续行动就累积到 3~5 秒，玩家干等。
        // 降到 72ms：6 步 = 432ms，肉眼仍能看清"跳格"但不再拖沓。
        const SPEED = this.stepMs || 72;
        an.t += dt;
        if (an.t >= SPEED) {
          an.t = 0; an.i++;
          if (an.i >= an.seq.length) {
            const cb = an.done;
            this.anim.delete(pid);
            if (cb) cb();
            continue;
          }
        }
        const fromId = an.i === 0 ? this.board.tiles.length - 1 : an.seq[an.i - 1];
        const toId = an.seq[an.i];
        const a = this.cells[fromId], b = this.cells[toId];
        if (!a || !b) continue;
        const k = Math.min(1, an.t / SPEED);
        an.cx = a.cx + (b.cx - a.cx) * k;
        an.cy = a.cy + (b.cy - a.cy) * k;
        busy = true;
      }

      if (this.dice) {
        this.dice.t += dt;
        // 骰子翻滚时长 620ms → 320ms。骰子只是"确认结果"的信息，
        // 数字早已确定，多等 300ms 纯属折磨。
        if (this.dice.t > (this.diceMs || 320)) {
          const cb = this.dice.done; this.dice = null;
          if (cb) cb();
        } else busy = true;
      }

      this.draw();
      if (!busy && this.anim.size === 0 && !this.dice) {
        cancelAnimationFrame(this._raf);
        this._raf = null; this.last = null;
        this.draw();
      }
    };
    this._raf = requestAnimationFrame(step);
  }

  // ─────────── 动态层 ───────────
  draw(state, players) {
    if (state) {
      this.state = state; this.players = players; this.static = null;
      // 当前行动的玩家 id —— 名牌用它画金色高亮
      const cur = players[state.meta.currentSeat];
      this.currentId = cur?.id || null;
    }
    if (!this.static) this.buildStatic();
    const c = this.ctx;
    c.clearRect(0, 0, this.size, this.size);
    c.drawImage(this.static, 0, 0, this.size, this.size);

    // 高亮格
    if (this.highlight != null && this.cells[this.highlight]) {
      const t = this.cells[this.highlight];
      c.strokeStyle = "#ffe27a";
      c.lineWidth = 2.5;
      this.roundRect(c, t.px + 1, t.py + 1, t.pw - 2, t.pw - 2, 5);
      c.stroke();
      c.globalAlpha = 0.22; c.fillStyle = "#ffe27a";
      this.roundRect(c, t.px + 1, t.py + 1, t.pw - 2, t.pw - 2, 5);
      c.fill();
      c.globalAlpha = 1;
    }

    // 当前回合玩家所在格：脉冲光圈
    if (this.state) {
      const cur = this.state.players[this.state.meta.currentSeat];
      if (cur && cur.alive) {
        const t = this.cells[cur.pos];
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 320);
        c.strokeStyle = `rgba(255,226,122,${0.3 + pulse * 0.55})`;
        c.lineWidth = 2.4;
        this.roundRect(c, t.px + 2, t.py + 2, t.pw - 4, t.pw - 4, 5);
        c.stroke();
      }
    }

    if (this.dice) this.drawDice(c, this.dice);
    for (const t of this.tokens()) this.drawToken(c, t);
    this.drawCurrentArrow(c);
    // 名牌画在棋子上层：格子顶部一条，谁在这一目了然
    this.drawNameTags(c);
  }

  // 棋子：大富翁式角色棋子 —— 投影 + 底盘 + 身体柱 + 白底头像头（emoji 即角色形象）。
  // 旧版是一个平放的圆角方块 + 座位号，更像"标记"不像"角色"。
  drawToken(c, t) {
    const skin = TOKEN_SKIN[t.color] || { hi: "#fff", lo: "#666" };
    const r = t.r;
    const lift = t.p.alive ? 0 : r * 0.45;

    // 地面投影
    c.fillStyle = "rgba(0,0,0,0.35)";
    c.beginPath();
    c.ellipse(t.cx, t.cy + r * 0.82, r * 0.95, r * 0.32, 0, 0, Math.PI * 2);
    c.fill();

    if (!t.p.alive) c.globalAlpha = 0.5;

    // 底盘（椭圆底座，带高光描边）
    const bw = r * 1.7, bh = r * 0.6, by = t.cy + r * 0.52 - bh / 2 + lift;
    const g0 = c.createLinearGradient(0, by, 0, by + bh);
    g0.addColorStop(0, skin.hi);
    g0.addColorStop(1, skin.lo);
    // 身体加一圈柔和投影，从棋盘上"立"起来
    c.save();
    c.shadowColor = "rgba(0,0,0,0.5)";
    c.shadowBlur = 5;
    c.shadowOffsetY = 1.5;
    c.fillStyle = g0;
    this.roundRect(c, t.cx - bw / 2, by, bw, bh, bh * 0.5);
    c.fill();
    c.restore();
    c.strokeStyle = "rgba(255,255,255,0.65)";
    c.lineWidth = 1.2;
    c.stroke();

    // 身体柱（上窄下宽的梯形感，用圆角矩形近似）
    const bw2 = r * 0.92, bh2 = r * 0.82;
    const by2 = by - bh2 + r * 0.12;
    const g1 = c.createLinearGradient(t.cx - bw2 / 2, by2, t.cx + bw2 / 2, by2 + bh2);
    g1.addColorStop(0, skin.hi);
    g1.addColorStop(0.5, t.color);
    g1.addColorStop(1, skin.lo);
    c.fillStyle = g1;
    this.roundRect(c, t.cx - bw2 / 2, by2, bw2, bh2, bw2 * 0.36);
    c.fill();

    // 头：白底圆 + Q 版人物脸（发型/眼镜/胡子一眼可辨，不再是小动物 emoji）
    const ch = CHARACTERS[t.p.avatar] || CHARACTERS.coder;
    const hy = by2 - r * 0.38;
    c.fillStyle = "#fdfaf2";
    c.beginPath();
    c.arc(t.cx, hy, r * 0.62, 0, Math.PI * 2);
    c.fill();
    drawCharacterFace(c, t.cx, hy, r * 0.56, ch, { body: false });
    c.strokeStyle = "rgba(0,0,0,0.42)";
    c.lineWidth = 1.3;
    c.beginPath();
    c.arc(t.cx, hy, r * 0.62, 0, Math.PI * 2);
    c.stroke();

    // 座位号：底盘中央的小圆徽章
    c.fillStyle = "rgba(255,255,255,0.94)";
    c.beginPath();
    c.arc(t.cx, by + bh / 2, r * 0.27, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#2b2a33";
    c.font = `700 ${r * 0.44}px ${FONT}`;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(String(t.p.seat + 1), t.cx, by + bh / 2 + 0.5);

    // 破产：整只棋子打叉
    if (!t.p.alive) {
      c.strokeStyle = "#e24b4a";
      c.lineWidth = 2.6;
      c.beginPath();
      c.moveTo(t.cx - r * 0.7, hy - r * 0.7);
      c.lineTo(t.cx + r * 0.7, by + bh);
      c.moveTo(t.cx + r * 0.7, hy - r * 0.7);
      c.lineTo(t.cx - r * 0.7, by + bh);
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  // 当前行动者的头顶金箭头（大富翁式"轮到谁"指示，上下浮动）
  drawCurrentArrow(c) {
    if (!this.currentId || !this.players) return;
    const t = this.tokens().find((x) => x.id === this.currentId);
    if (!t || !t.p.alive) return;
    const bob = Math.sin(Date.now() / 240) * 2.2;
    const ax = t.cx;
    const ay = t.cy - t.r * 2.1 + bob;
    const s = Math.max(4, t.r * 0.55);
    c.save();
    c.shadowColor = "rgba(245,200,66,0.8)";
    c.shadowBlur = 6;
    c.fillStyle = "#f5c842";
    c.beginPath();
    c.moveTo(ax, ay + s * 0.8);          // 下尖
    c.lineTo(ax - s * 0.75, ay - s * 0.2);
    c.lineTo(ax - s * 0.28, ay - s * 0.2);
    c.lineTo(ax - s * 0.28, ay - s * 0.8);
    c.lineTo(ax + s * 0.28, ay - s * 0.8);
    c.lineTo(ax + s * 0.28, ay - s * 0.2);
    c.lineTo(ax + s * 0.75, ay - s * 0.2);
    c.closePath();
    c.fill();
    c.restore();
    c.strokeStyle = "rgba(90,60,0,0.55)";
    c.lineWidth = 0.8;
    c.stroke();
  }

  // ── 名牌：在格子上方画一条「谁在这」的横条 ──
  // 反馈原话「地图上最好把每个人的位置标注上」——
  // 改成按格子聚合：一格一条横条，格里有几个玩家就并排几个胶囊，
  // 当前玩家金色高亮。每个胶囊 = 玩家色圆点 + 名字 + 净资产。
  drawNameTags(c) {
    if (!this.cells || !this.players) return;
    const byTile = {};
    for (const p of this.players) {
      (byTile[p.pos] = byTile[p.pos] || []).push(p);
    }

    for (const [tileId, list] of Object.entries(byTile)) {
    const t = this.cells[tileId];
      if (!t) continue;
      // 字号跟着格子实际宽度缩放
      const cellW = t.pw || this.cell;
      const fs = Math.max(7.5, Math.min(cellW * 0.118, 10.5));
      const chipH = fs * 1.95;
      const gap = 3;
      const shown = list.slice(0, 6);
      const chips = shown.map((p) => {
        const nm = p.name || `P${p.seat + 1}`;
        const worth = Math.round(p.netWorth || 0);
        const wt = worth >= 10000 ? (worth / 10000).toFixed(1) + "万" : String(worth);
        c.font = `600 ${fs}px ${FONT}`;
        const wName = c.measureText(nm).width;
        c.font = `500 ${fs * 0.85}px ${MONO}`;
        const wWorth = c.measureText(wt).width;
        const dotR = chipH * 0.32;
        return { p, nm, wt, dotR, w: Math.max(wName, wWorth) + dotR * 2 + fs * 0.95 };
      });

      const rawW = chips.reduce((s, x) => s + x.w, 0) + gap * (chips.length - 1);
      // 宽度不许超出格子
      const maxW = cellW * 0.98;
      const scale = rawW > maxW ? maxW / rawW : 1;
      const rowW = rawW * scale;

      let x = t.cx - rowW / 2;
      // 挂在格子内部顶边。格子顶部还有类型徽标，所以往下压一点让开徽标；
      // 顶排（会溢出画布）才翻到格子底部。
      const halfH = cellW * 0.5;
      const yTop = t.cy - halfH + fs * 1.35;
      const y = yTop - chipH > 1 ? yTop - chipH
        : t.cy + halfH - fs * 1.35;

      for (const ch of chips) {
        const w = ch.w * scale;
        const isCur = this.currentId === ch.p.id;
        c.save();
        c.globalAlpha = ch.p.alive ? 1 : 0.45;

        // 胶囊底
        c.fillStyle = isCur ? "rgba(245,200,66,0.92)" : "rgba(14,13,20,0.88)";
        this.roundRect(c, x, y, w, chipH, chipH * 0.44);
        c.fill();
        if (isCur) { c.lineWidth = 1.6; c.strokeStyle = "#fff3c4"; c.stroke(); }

        // 玩家色圆点（和棋盘上的棋子方块同色，一眼对应）
        const dcx = x + ch.dotR * scale + fs * 0.24;
        const dcy = y + chipH / 2;
        c.fillStyle = ch.p.color;
        c.beginPath(); c.arc(dcx, dcy, ch.dotR * scale, 0, Math.PI * 2); c.fill();
        c.strokeStyle = "rgba(255,255,255,0.55)"; c.lineWidth = 0.8; c.stroke();

        // 名字（上）+ 净资产（下）
        const tx = dcx + ch.dotR * scale + fs * 0.3;
        c.textAlign = "left"; c.textBaseline = "middle";
        c.fillStyle = isCur ? "#241f00" : "#eae8f2";
        c.font = `600 ${fs * scale}px ${FONT}`;
        c.fillText(ch.nm, tx, dcy - fs * 0.42);
        c.fillStyle = isCur ? "rgba(36,31,0,0.7)" : "rgba(255,255,255,0.55)";
        c.font = `500 ${fs * 0.82 * scale}px ${MONO}`;
        c.fillText(ch.wt, tx, dcy + fs * 0.48);
        c.restore();

        x += w + gap;
      }
    }
  }

  // 骰子：3D 立方体。三段式演出：
  //   入场（0~140ms）从大到小砸下来 → 摇晃（~62% 时长）左右抖+跳+翻面 → 定格回弹出点数
  drawDice(c, d) {
    const size = Math.max(38, this.size * 0.095);
    const total = this.diceMs || 1100;
    const rollEnd = total * 0.62;
    const rolling = d.t < rollEnd;
    const face = rolling ? 1 + Math.floor((Date.now() / 90) % 6) : d.value;
    const depth = size * 0.16;

    // 位移与缩放演出
    let scale = 1, dx = 0, dy = 0;
    if (d.t < 140) {
      scale = 1.55 - 0.55 * (d.t / 140);                       // 入场：1.55 → 1
      dy = -10 * (1 - d.t / 140);                              // 从上方落下
    } else if (rolling) {
      dx = Math.sin(d.t * 0.085) * 3.4;                        // 左右摇
      dy = -Math.abs(Math.sin(d.t * 0.055)) * 5;               // 上下颠
    } else {
      const k = Math.min(1, (d.t - rollEnd) / (total - rollEnd));
      scale = 1 + 0.16 * Math.sin(k * Math.PI);                // 定格：鼓一下再收回
    }

    const x = this.size - size - 18 + dx;
    const y = 16 + dy;
    c.save();
    c.translate(x + size / 2, y + size / 2);
    c.scale(scale, scale);
    c.translate(-(x + size / 2), -(y + size / 2));

    // 阴影
    c.fillStyle = "rgba(0,0,0,0.4)";
    this.roundRect(c, x + 2, y + depth + 2, size, size, size * 0.22);
    c.fill();
    // 侧面
    c.fillStyle = "#9a1f1c";
    this.roundRect(c, x, y + depth, size, size, size * 0.22);
    c.fill();
    // 顶面
    const g = c.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, "#ff8a85");
    g.addColorStop(0.5, "#e24b4a");
    g.addColorStop(1, "#b8302d");
    c.fillStyle = g;
    this.roundRect(c, x, y, size, size - depth * 0.3, size * 0.22);
    c.fill();
    // 高光
    c.fillStyle = "rgba(255,255,255,0.28)";
    this.roundRect(c, x + size * 0.12, y + size * 0.1, size * 0.4, size * 0.12, size * 0.06);
    c.fill();

    // 点数
    const P = [
      [], [[1, 1]], [[0, 0], [2, 2]], [[0, 0], [1, 1], [2, 2]],
      [[0, 0], [2, 0], [0, 2], [2, 2]], [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
      [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
    ][face];
    const r = size * 0.085;
    const pad = size * 0.27;
    for (const [gx, gy] of P) {
      const px = x + pad + gx * (size - pad * 2) / 2;
      const py = y + pad + gy * (size - pad * 2) / 2 - depth * 0.15;
      c.fillStyle = "rgba(0,0,0,0.3)";
      c.beginPath(); c.arc(px, py + 1, r, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#fff8e6";
      c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  // ─────────── 工具 ───────────
  roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  fmtPrice(p) {
    if (!p) return "0";
    if (p >= 10000) return (p / 10000).toFixed(p % 10000 === 0 ? 0 : 1) + "万";
    return (p / 1000).toFixed(p % 1000 === 0 ? 0 : 1) + "k";
  }

  // 逐字缩放以适应宽度。
  // 双重保险：size 下限 + 循环上限（避免 Canvas 抛 Invalid array length）。
  // 不换行 —— 格子里横向空间只有一格宽，换行会把价格挤出去。
  fittedText(c, text, cx, cy, maxW, fill, minSize = 6.5) {
    if (!text) return;
    const w = Math.max(8, maxW);
    let t = text;
    let size = Math.max(8, this.cell * 0.19);
    let guard = 0;
    c.font = `700 ${size}px ${FONT}`;
    while (c.measureText(t).width > w && t.length > 1 && size > minSize && guard++ < 24) {
      t = t.slice(0, -1);
      size -= 0.4;
      c.font = `700 ${size}px ${FONT}`;
    }
    // 缩到最小还放不下 → 截断加省略号
    if (c.measureText(t).width > w && t.length > 1) {
      while (t.length > 1 && c.measureText(t + "…").width > w) t = t.slice(0, -1);
      t += "…";
    }
    c.font = `700 ${size}px ${FONT}`;
    c.fillStyle = fill;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.shadowColor = "rgba(0,0,0,0.5)"; c.shadowBlur = 2;
    c.fillText(t, cx, cy);
    c.shadowBlur = 0;
  }
}
