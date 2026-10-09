// 设置面板 —— 持久化到 localStorage，支持的选项：
//   - sfx: 音效开关（boolean）
//   - bgm: 背景音乐开关（boolean）
//   - focusDefault: 进入游戏是否默认开启专注模式（boolean）
//   - animSpeed: 动画速度 0.5 = 慢、1.0 = 正常、2.0 = 快（仅作偏好记录，
//                当前 game 内动画走的 RAF，主循环无明显等待时间，故记但不强制）
//
// 读取优先级：localStorage > DEFAULT。
// 应用端通过 applySettings(game, settings) 把设置绑到 game 实例上。

import { Modal } from "./panels.js";

const KEY = "monopoly-office-settings";
const DEFAULT = Object.freeze({
  sfx: true,
  bgm: true,
  focusDefault: false,
  animSpeed: 1.0,
});

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT, ...parsed };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // localStorage 不可用（隐身模式 / 容量满）—— 静默失败
  }
}

// 应用设置到 game 实例
export function applySettings(game, s = loadSettings()) {
  game.soundOn = !!s.sfx;
  game.bgmOn = !!s.bgm;
  game.settings = { ...s };
  // 同步 audio 内部状态（audio.js 读自己的 localStorage）
  game.audio.enabled = !!s.sfx;
  game.audio.bgmOn = !!s.bgm;
  // 动画速度真正落到棋盘：旧版只存 localStorage 不生效（设置页自己承认"记但不强制"）
  if (game.board) {
    const sp = s.animSpeed || 1;
    game.board.stepMs = Math.max(24, Math.round(72 / sp));
    game.board.diceMs = Math.max(400, Math.round(1100 / sp));
  }
  try {
    if (s.bgm) game.audio.startBgm();
    else game.audio.stopBgm();
  } catch { /* ctx 未激活 */ }
  // 同步顶栏图标
  const sBtn = document.getElementById("btnSound");
  if (sBtn) sBtn.textContent = s.sfx ? "🔊" : "🔇";
  const bBtn = document.getElementById("btnBgm");
  if (bBtn) bBtn.textContent = s.bgm ? "🎵" : "🔕";
}

// 设置面板弹窗 —— 由 bindTopButtons() 里 btnSettings 触发
export function openSettingsModal(game, onChange) {
  const current = loadSettings();
  const modal = new Modal(document.getElementById("modalLayer"));
  const html = `
    <div class="set-wrap">
      <div class="set-row">
        <div class="set-label">
          <div class="set-name">🔊 音效</div>
          <div class="set-hint">掷骰、买地、破产等事件触发的短音</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="setSfx" ${current.sfx ? "checked" : ""}>
          <span class="slider"></span>
        </label>
      </div>
      <div class="set-row">
        <div class="set-label">
          <div class="set-name">🎵 背景音乐</div>
          <div class="set-hint">每回合推进时播放的循环 BGM</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="setBgm" ${current.bgm ? "checked" : ""}>
          <span class="slider"></span>
        </label>
      </div>
      <div class="set-row">
        <div class="set-label">
          <div class="set-name">🎯 进入游戏默认专注模式</div>
          <div class="set-hint">开启后只保留棋盘，按 F11 可随时切换</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="setFocus" ${current.focusDefault ? "checked" : ""}>
          <span class="slider"></span>
        </label>
      </div>
      <div class="set-row">
        <div class="set-label">
          <div class="set-name">⚡ 动画速度</div>
          <div class="set-hint">移动棋子、结算翻页的快慢</div>
        </div>
        <div class="seg" role="radiogroup">
          <button data-speed="0.5" class="${current.animSpeed === 0.5 ? "on" : ""}">慢</button>
          <button data-speed="1.0" class="${current.animSpeed === 1.0 ? "on" : ""}">正常</button>
          <button data-speed="2.0" class="${current.animSpeed === 2.0 ? "on" : ""}">快</button>
        </div>
      </div>
    </div>
  `;
  const buttons = [
    { label: "恢复默认", value: "reset", cls: "ghost" },
    { label: "保存", value: "save" },
  ];
  // 现有 Modal API: open(title, bodyHtml, emoji, buttons) + onClick(fn)
  modal.open("⚙️ 设置", html, "⚙️", buttons);
  modal.onClick((value, src) => {
    // value 是 "__foot__" 时用 src.dataset.foot 区分 save / reset
    const v = value === "__foot__" ? src?.dataset?.foot : value;
    if (v === "save") {
      const seg = document.querySelector(".seg button.on");
      const next = {
        sfx: !!(document.getElementById("setSfx")?.checked),
        bgm: !!(document.getElementById("setBgm")?.checked),
        focusDefault: !!(document.getElementById("setFocus")?.checked),
        animSpeed: seg ? parseFloat(seg.dataset.speed) : 1.0,
      };
      saveSettings(next);
      applySettings(game, next);
      onChange?.(next);
      modal.close();
    } else if (v === "reset") {
      saveSettings({ ...DEFAULT });
      applySettings(game, { ...DEFAULT });
      modal.close();
    }
  });

  // 段控器交互（modal.onClick 抓不到，因为不在 [data-foot] 上）
  // —— 直接挂全局 click 委托，modal 关闭后 dead listener 自动 GC
  document.querySelectorAll(".seg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg button").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
    });
  });
}
