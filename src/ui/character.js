// Q 版卡通人物绘制 —— 纯 canvas 手绘，棋子 / 玩家卡 / 设置页三处共用。
// 人物规格见 icons.js 的 CHARACTERS（全部是人类打工人，不用动物头像）。
//
// drawCharacterFace(c, cx, cy, r, ch, opts)
//   cx/cy  头部圆心
//   r      头部半径
//   ch     CHARACTERS 里的人物规格
//   opts.body  画肩膀衣服（玩家卡大头贴模式）；棋子上不画（太小）

export function drawCharacterFace(c, cx, cy, r, ch, opts = {}) {
  if (!ch) ch = {};
  const skin = ch.skin || "#f2cfad";
  const hair = ch.hairColor || "#2b2b33";
  c.save();

  // ── 脸 ──
  c.fillStyle = skin;
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "rgba(0,0,0,0.3)";
  c.lineWidth = Math.max(0.8, r * 0.07);
  c.stroke();

  // ── 头发：上半圆发帽 + 发型件 ──
  c.fillStyle = hair;
  c.beginPath();
  // 发际线略带弧度：从左侧发脚扫到右侧发脚
  c.arc(cx, cy - r * 0.06, r * 1.04, Math.PI * 1.06, Math.PI * 1.94);
  c.closePath();
  c.fill();
  switch (ch.hair) {
    case "long":
      // 垂到肩的两侧长发
      c.fillRect(cx - r * 1.08, cy - r * 0.4, r * 0.3, r * 1.35);
      c.fillRect(cx + r * 0.78, cy - r * 0.4, r * 0.3, r * 1.35);
      break;
    case "buns":
      // 双丸子
      c.beginPath(); c.arc(cx - r * 0.74, cy - r * 0.86, r * 0.34, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(cx + r * 0.74, cy - r * 0.86, r * 0.34, 0, Math.PI * 2); c.fill();
      break;
    case "ponytail": {
      // 侧马尾
      c.save();
      c.translate(cx + r * 0.95, cy - r * 0.05);
      c.rotate(0.55);
      c.beginPath();
      c.ellipse(0, 0, r * 0.28, r * 0.6, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
      break;
    }
    case "bald":
      // 秃头造型：抹掉发帽、只留两侧鬓角
      c.fillStyle = skin;
      c.beginPath();
      c.arc(cx, cy - r * 0.06, r * 1.05, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = hair;
      c.fillRect(cx - r * 1.04, cy - r * 0.3, r * 0.24, r * 0.46);
      c.fillRect(cx + r * 0.8, cy - r * 0.3, r * 0.24, r * 0.46);
      // 秃顶反光
      c.fillStyle = "rgba(255,255,255,0.22)";
      c.beginPath();
      c.ellipse(cx - r * 0.3, cy - r * 0.45, r * 0.2, r * 0.1, -0.5, 0, Math.PI * 2);
      c.fill();
      break;
    case "short":
    default:
      break;
  }

  // ── 腮红 ──
  c.fillStyle = "rgba(231,110,110,0.34)";
  c.beginPath(); c.arc(cx - r * 0.56, cy + r * 0.34, r * 0.15, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(cx + r * 0.56, cy + r * 0.34, r * 0.15, 0, Math.PI * 2); c.fill();

  // ── 眼睛 ──
  const ex = r * 0.34, ey = cy + r * 0.14;
  const er = Math.max(0.8, r * 0.11);
  c.fillStyle = "#2b2530";
  c.beginPath(); c.arc(cx - ex, ey, er, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(cx + ex, ey, er, 0, Math.PI * 2); c.fill();
  // 眼里的小高光（脸够大才画得下）
  if (r > 9) {
    c.fillStyle = "rgba(255,255,255,0.9)";
    c.beginPath(); c.arc(cx - ex + er * 0.35, ey - er * 0.35, er * 0.35, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(cx + ex + er * 0.35, ey - er * 0.35, er * 0.35, 0, Math.PI * 2); c.fill();
  }

  // ── 眼镜 ──
  if (ch.glasses) {
    c.strokeStyle = "#3d3d46";
    c.lineWidth = Math.max(0.7, r * 0.08);
    c.beginPath(); c.arc(cx - ex, ey, r * 0.28, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(cx + ex, ey, r * 0.28, 0, Math.PI * 2); c.stroke();
    c.beginPath();
    c.moveTo(cx - r * 0.07, ey); c.lineTo(cx + r * 0.07, ey);
    c.stroke();
  }

  // ── 嘴（微笑）──
  c.strokeStyle = "#8a4640";
  c.lineWidth = Math.max(0.8, r * 0.09);
  c.beginPath();
  c.arc(cx, cy + r * 0.3, r * 0.26, Math.PI * 0.18, Math.PI * 0.82);
  c.stroke();

  // ── 胡子 ──
  if (ch.beard) {
    c.fillStyle = hair;
    c.globalAlpha = 0.85;
    c.beginPath();
    c.arc(cx, cy + r * 0.34, r * 0.42, Math.PI * 0.12, Math.PI * 0.88);
    c.closePath();
    c.fill();
    c.globalAlpha = 1;
  }

  // ── 肩膀/衣服（大头贴模式才有空间画）──
  if (opts.body && r > 10) {
    c.fillStyle = ch.shirt || "#4f80d8";
    c.beginPath();
    c.ellipse(cx, cy + r * 1.72, r * 1.06, r * 0.82, 0, Math.PI, 0);
    c.fill();
    if (ch.tie) {
      c.fillStyle = ch.tie;
      c.beginPath();
      c.moveTo(cx - r * 0.14, cy + r * 1.12);
      c.lineTo(cx + r * 0.14, cy + r * 1.12);
      c.lineTo(cx + r * 0.1, cy + r * 1.66);
      c.lineTo(cx - r * 0.1, cy + r * 1.66);
      c.closePath();
      c.fill();
    }
  }

  c.restore();
}

// 把人物画进一个 <canvas>（玩家卡 / 设置页选择器用）
export function drawCharacterOnCanvas(cv, charId, CHARACTERS) {
  const ch = CHARACTERS[charId] || CHARACTERS.coder;
  if (!cv || !ch) return;
  const c = cv.getContext("2d");
  const w = cv.width, h = cv.height;
  c.clearRect(0, 0, w, h);
  const r = Math.min(w, h) * 0.27;
  drawCharacterFace(c, w / 2, h * 0.44, r, ch, { body: true });
}
