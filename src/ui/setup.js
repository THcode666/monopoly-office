// 模式选择 + 开局设置界面。
// 单人练习 / 本地热座 / 局域网对战 三个入口。

import { AI_AVATARS, CHARACTERS, CHARACTER_ORDER } from "./icons.js";
import { drawCharacterOnCanvas } from "./character.js";

export function showSetup(root, data, onStart) {
  const colors = data.board.colorTokens;
  const profiles = data.aiProfiles.profiles;

  // 从 localStorage 恢复上次设置
  const saved = JSON.parse(localStorage.getItem("sf_setup") || "{}");
  const cfg = {
    mode: saved.mode || "solo",
    winCondition: saved.winCondition || "rounds",
    humanCount: saved.humanCount || 1,
    names: saved.names || ["我", "小明", "阿珍", "老王", "小美", "大壮"],
    colors: saved.colors || colors.slice(),
    avatars: saved.avatars || CHARACTER_ORDER.slice(),
    aiProfiles: saved.aiProfiles || ["greedy", "steady", "spender"],
  };

  root.innerHTML = `
    <div class="setup">
      <div class="setup-inner">
        <h1>大富翁 · 工位版</h1>
        <div class="sub">打工人资产争霸赛 · 40 回合见真章</div>

        <div class="setup-sec">
          <h2>选择模式</h2>
          <div class="mode-grid" id="modeGrid">
            <div class="mode-card" data-mode="solo">
              <div class="mode-ico">🎮</div>
              <div class="mode-name">单人练习</div>
              <div class="mode-desc">你 + 1~3 名 AI，同屏操作，随时重开</div>
            </div>
            <div class="mode-card" data-mode="hotseat">
              <div class="mode-ico">👥</div>
              <div class="mode-name">本地热座</div>
              <div class="mode-desc">2~6 人轮流用同一台电脑，屏幕传给下一位</div>
            </div>
            <div class="mode-card" data-mode="lan">
              <div class="mode-ico">📡</div>
              <div class="mode-name">局域网对战</div>
              <div class="mode-desc">多台设备同一房间，主机权威；不支持时可降级为回合包传递</div>
            </div>
          </div>
        </div>

        <div class="setup-sec" id="setupBody"></div>
      </div>
    </div>
  `;

  const grid = root.querySelector("#modeGrid");
  const body = root.querySelector("#setupBody");

  const renderBody = () => {
    [...grid.children].forEach((c) => c.classList.toggle("sel", c.dataset.mode === cfg.mode));

    if (cfg.mode === "lan") {
      body.innerHTML = `
        <h2>局域网</h2>
        <div class="field">
          <label>房号</label>
          <input type="text" id="roomId" value="${(cfg.roomId || genRoom()).toUpperCase()}" maxlength="6">
          <button class="btn sm ghost" id="genRoom">换个房号</button>
        </div>
        <div class="field">
          <label>昵称</label>
          <input type="text" id="lanName" value="${cfg.names[0]}" maxlength="8">
          <button class="btn sm" id="lanRole">我要建房间</button>
        </div>
        <div class="field">
          <label>玩家数</label>
          <div class="seg" id="countSeg">
            ${[2, 3, 4, 5, 6].map((n) => `<button data-n="${n}" class="${(cfg.humanCount || 4) === n ? "on" : ""}">${n} 人</button>`).join("")}
          </div>
        </div>
        <div class="setup-foot">
          <button class="btn primary" id="startBtn">进入房间</button>
          <span class="note">
            同一房间号的人用同一份数据文件即可。
            不想装服务器？开局后用顶栏的「📤 导出 / 📥 导入」传递回合包，
            微信发文件就行。
          </span>
        </div>
      `;
      root.querySelector("#genRoom").onclick = () => {
        cfg.roomId = root.querySelector("#roomId").value;
        root.querySelector("#roomId").value = genRoom();
      };
      root.querySelector("#countSeg").onclick = (e) => {
        const b = e.target.closest("button"); if (!b) return;
        cfg.humanCount = +b.dataset.n;
        renderBody();
      };
      cfg.lanRole = cfg.lanRole || "host";
      const roleBtn = root.querySelector("#lanRole");
      const paintRole = () => { roleBtn.textContent = cfg.lanRole === "host" ? "我是房主" : "我加入"; };
      paintRole();
      roleBtn.onclick = () => { cfg.lanRole = cfg.lanRole === "host" ? "join" : "host"; paintRole(); };
      root.querySelector("#lanName").oninput = (e) => { cfg.names[0] = e.target.value; };
      root.querySelector("#startBtn").onclick = () => {
        cfg.names[0] = root.querySelector("#lanName").value.trim() || "玩家";
        cfg.roomId = root.querySelector("#roomId").value.toUpperCase();
        localStorage.setItem("sf_setup", JSON.stringify(cfg));
        onStart(cfg);
      };
      return;
    }

    // 单人 / 热座：选人数
    const total = cfg.mode === "solo"
      ? 1 + (cfg.aiCount ?? 3)
      : cfg.humanCount;

    body.innerHTML = `
      <h2>对局设置</h2>
      <div class="field">
        <label>${cfg.mode === "solo" ? "AI 数量" : "玩家人数"}</label>
        <div class="seg" id="countSeg">
          ${cfg.mode === "solo"
            ? [1, 2, 3].map((n) => `<button data-n="${n}" class="${(cfg.aiCount ?? 3) === n ? "on" : ""}">${n} 名 AI</button>`).join("")
            : [2, 3, 4, 5, 6].map((n) => `<button data-n="${n}" class="${cfg.humanCount === n ? "on" : ""}">${n} 人</button>`).join("")}
        </div>
      </div>

      <div class="field">
        <label>胜利条件</label>
        <div class="seg" id="winSeg">
          <button data-w="rounds" class="${cfg.winCondition === "rounds" ? "on" : ""}">固定 40 回合</button>
          <button data-w="bankruptcy" class="${cfg.winCondition === "bankruptcy" ? "on" : ""}">破产淘汰制</button>
        </div>
      </div>

      ${cfg.mode === "solo" ? `
      <div class="field">
        <label>AI 性格</label>
        <div class="aipick" id="aiPick">
          ${profiles.map((p) => `<span class="chip" data-p="${p.id}">${CHARACTERS[AI_AVATARS[p.id]]?.name || ""}·${p.name}</span>`).join("")}
        </div>
      </div>` : ""}

      <div class="field">
        <label>你的角色</label>
        <input type="text" id="p0name" value="${cfg.names[0]}" maxlength="8">
        <div class="swatches" id="sw0">
          ${colors.map((c) => `<div class="swatch ${c === cfg.colors[0] ? "sel" : ""}" data-c="${c}" style="background:${c}"></div>`).join("")}
        </div>
        <div class="swatches" id="av0">
          ${CHARACTER_ORDER.map((k) => `<div class="swatch char-swatch ${k === cfg.avatars[0] ? "sel" : ""}" data-a="${k}" title="${CHARACTERS[k].name}"><canvas width="44" height="44" data-char="${k}"></canvas></div>`).join("")}
        </div>
      </div>

      ${cfg.mode === "hotseat" ? `
      <div class="field">
        <label>其他玩家</label>
        ${Array.from({ length: total - 1 }, (_, i) => `
          <input type="text" id="pn${i + 1}" value="${cfg.names[i + 1] || "玩家" + (i + 2)}" maxlength="8">
          <div class="swatches" data-pick="${i + 1}">
            ${colors.map((c) => `<div class="swatch ${c === cfg.colors[i + 1] ? "sel" : ""}" data-c="${c}" style="background:${c}"></div>`).join("")}
          </div>`).join("")}
      </div>` : ""}

      <div class="setup-foot">
        <button class="btn primary" id="startBtn">开始游戏</button>
        <span class="note">初始现金 20000 元 · 实习生职级 · 每 4 回合发一次工资</span>
      </div>
    `;

    // 人数
    root.querySelector("#countSeg").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const n = +b.dataset.n;
      if (cfg.mode === "solo") cfg.aiCount = n; else cfg.humanCount = n;
      renderBody();
    };
    // 胜利条件
    root.querySelector("#winSeg").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      cfg.winCondition = b.dataset.w;
      renderBody();
    };
    // AI 性格
    const aiPick = root.querySelector("#aiPick");
    if (aiPick) aiPick.onclick = (e) => {
      const c = e.target.closest(".chip"); if (!c) return;
      const idx = cfg.aiProfiles.indexOf(c.dataset.p);
      if (idx >= 0) cfg.aiProfiles.splice(idx, 1);
      else cfg.aiProfiles.push(c.dataset.p);
      [...aiPick.children].forEach((x) => x.classList.toggle("on", cfg.aiProfiles.includes(x.dataset.p)));
    };
    // 名字
    root.querySelector("#p0name").oninput = (e) => { cfg.names[0] = e.target.value; };
    for (let i = 1; i < total; i++) {
      const el = root.querySelector("#pn" + i);
      if (el) el.oninput = (e) => { cfg.names[i] = e.target.value; };
    }
    // 颜色
    const bindSwatch = (sel, idx) => {
      const box = root.querySelector(sel);
      if (!box) return;
      box.onclick = (e) => {
        const s = e.target.closest(".swatch"); if (!s) return;
        if (s.dataset.c !== undefined) {
          cfg.colors[idx] = s.dataset.c;
          [...box.children].forEach((x) => x.classList.toggle("sel", x.dataset.c === s.dataset.c));
        } else if (s.dataset.a !== undefined) {
          cfg.avatars[idx] = s.dataset.a;
          [...box.children].forEach((x) => x.classList.toggle("sel", x.dataset.a === s.dataset.a));
        }
      };
    };
    bindSwatch("#sw0", 0);
    bindSwatch("#av0", 0);
    body.querySelectorAll("[data-pick]").forEach((box) => {
      const idx = +box.dataset.pick;
      box.onclick = (e) => {
        const s = e.target.closest(".swatch"); if (!s) return;
        cfg.colors[idx] = s.dataset.c;
        [...box.children].forEach((x) => x.classList.toggle("sel", x.dataset.c === s.dataset.c));
      };
    });

    root.querySelector("#startBtn").onclick = () => {
      const name0 = root.querySelector("#p0name").value.trim() || "我";
      cfg.names[0] = name0;
      localStorage.setItem("sf_setup", JSON.stringify(cfg));
      onStart(cfg);
    };

    // 人物选择器：innerHTML 之后把 Q 版人物画进各个小 canvas
    root.querySelectorAll("#av0 canvas").forEach((cv) => {
      drawCharacterOnCanvas(cv, cv.dataset.char, CHARACTERS);
    });
  };

  grid.onclick = (e) => {
    const c = e.target.closest(".mode-card"); if (!c) return;
    cfg.mode = c.dataset.mode;
    localStorage.setItem("sf_setup", JSON.stringify(cfg));
    renderBody();
  };

  renderBody();
}

function genRoom() {
  const cs = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += cs[Math.floor(Math.random() * cs.length)];
  return s;
}
