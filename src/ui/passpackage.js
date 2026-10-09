// 伪联机 UI：导出 / 导入「回合包」文件。
// 无网络环境（或局域网被禁）时的联机方案，靠微信/U 盘传递文件。

import { exportPassPackage, importPassPackage, publicView, hashState } from "../core/serialize.js";
import { reduce } from "../core/reducer.js";
import { fmt } from "./fmt.js";

export function showPassExport(game) {
  const s = game.state;
  // 必须传 0（全量 actionLog）。旧版传 s.meta.seq，过滤后列表恒为空，
  // 接收方重放不出任何东西；包内另有完整状态快照兜底（见 serialize.js）。
  const pkg = exportPassPackage(s, 0);
  const json = JSON.stringify(pkg, null, 2);
  const actor = pkg.nextActor;

  const isMyTurn = actor && actor.playerId === s.players[s.meta.currentSeat]?.id;
  const mine = s.players[s.meta.currentSeat];

  const body = `
    <div class="quote">
      <div>轮到 <b>${actor ? esc(actor.name) : "—"}</b> 操作了。</div>
      <div>回合包含完整存档状态与操作记录，状态指纹
        <code style="font-family:var(--mono);font-size:11px">${pkg.stateHash}</code>。</div>
    </div>
    ${mine ? `<div class="settle-table">
      <div class="st-row"><span class="k">当前回合</span><span class="v">${s.meta.turn} / ${s.meta.maxRounds}</span></div>
      <div class="st-row"><span class="k">${esc(mine.name)} 的净资产</span><span class="v">${fmt(mine.netWorth)}</span></div>
    </div>` : ""}
    <div class="modal-detail">
      把这个文件发给下一位玩家。对方在游戏里点「导入回合包」即可继续。
      校验不通过（文件损坏 / 被改过 / 版本不符）会明确提示。
    </div>
    <div class="opt-list" style="margin-top:10px">
      <button class="opt" data-act="dl">
        <div class="opt-head"><span class="opt-name">下载回合包文件</span>
        <span class="opt-price">${(json.length / 1024).toFixed(1)} KB</span></div>
        <div class="opt-meta">文件名 turn-${pkg.seq}.json</div>
      </button>
      <button class="opt" data-act="copy">
        <div class="opt-head"><span class="opt-name">复制到剪贴板</span></div>
        <div class="opt-meta">不方便传文件时用这个</div>
      </button>
    </div>`;

  game.modal.open("导出回合包", body, "📦", [
    { label: "关闭", value: "close", cls: "ghost" },
  ]);

  game.modal.onClick((act) => {
    if (act === "close" || act === "__foot__") { game.modal.close(); return; }
    if (act === "dl") {
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `turn-${pkg.seq}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      game.toast.show("已下载，发给下一位吧", "good");
    } else if (act === "copy") {
      navigator.clipboard?.writeText(json)
        .then(() => game.toast.show("已复制到剪贴板", "good"))
        .catch(() => game.toast.show("复制失败，改用下载吧", "warn"));
    }
  });
}

export function showPassImport(game, data) {
  const body = `
    <div class="quote">
      <div>选择上一位玩家发给你的回合包文件（<code>turn-*.json</code>）。</div>
      <div>导入后会校验状态指纹，不一致会明确告知原因。</div>
    </div>
    <div class="opt-list" style="margin-top:10px">
      <button class="opt" data-act="file">
        <div class="opt-head"><span class="opt-name">选择文件</span></div>
        <div class="opt-meta">从下载目录里挑 turn-开头的 json</div>
      </button>
      <button class="opt" data-act="paste">
        <div class="opt-head"><span class="opt-name">粘贴内容</span></div>
        <div class="opt-meta">对方用「复制到剪贴板」时用这个</div>
      </button>
    </div>
    <input type="file" accept=".json,application/json" id="passFile" style="display:none">`;

  game.modal.open("导入回合包", body, "📥", [
    { label: "取消", value: "cancel", cls: "ghost" },
  ]);

  game.modal.onClick((act, el) => {
    if (act === "cancel" || act === "__foot__") { game.modal.close(); return; }
    if (act === "file") {
      document.getElementById("passFile").click();
    } else if (act === "paste") {
      navigator.clipboard?.readText()
        .then((t) => applyPkg(game, data, t))
        .catch(() => game.toast.show("读不到剪贴板，改用选文件", "warn"));
    }
  });

  // 文件选择
  const input = document.getElementById("passFile");
  if (input) {
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const text = await f.text();
      applyPkg(game, data, text);
    };
  }
}

function applyPkg(game, data, text) {
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    game.toast.show("不是有效的 JSON 文件", "bad");
    return;
  }
  const r = importPassPackage(pkg, game.state, data, reduce);
  if (!r.ok) {
    game.modal.open("校验失败", `
      <div class="quote"><div>${esc(r.reason)}</div></div>
      <div class="modal-detail">
        常见原因：① 文件传输不完整；② 双方版本不一致（数据文件被改过）；
        ③ 文件被修改过。请让对方重新导出。
      </div>`, "⚠️", [{ label: "知道了", value: "know", cls: "primary" }]);
    game.modal.onClick((a) => { if (a === "know" || a === "__foot__") game.modal.close(); });
    return;
  }
  game.state = r.state;
  game.modal.close();
  game.toast.show(`回合包校验通过，继续 ${r.actor ? r.actor.name : ""} 的回合`, "good");
  game.reportShown = false;
  game.render();
  game.step();
}

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
