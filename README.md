# 大富翁 · 工位版

打工人资产争霸赛。40 回合内靠工资、投资和运气积累资产，**最后比谁更有钱**。

纯前端（HTML + CSS + 原生 JS），零运行时依赖，**单文件双击即玩**。

---

## 快速开始

### 方式一：直接玩（推荐给普通用户）

双击 `dist/monopoly-office.html` 即可。单个文件，无需安装任何东西。

### 方式二：开发模式

```bash
cd monopoly-office
npm install          # 只装 esbuild（构建）和 playwright（测试）
node tools/build.mjs # 构建单文件版

# 另开一个终端，起本地服务
npx serve .          # 或 python -m http.server 8080
```

然后访问 `http://localhost:8080/dist/monopoly-office.html`（开发态）或
`http://localhost:8080/` （开发态源码版）。

> 为什么要起服务：ES module 在 `file://` 下会被浏览器 CORS 拦。单文件产物没这个问题。

### 方式三：Electron 桌面版

```bash
npm install --save-dev electron
npx electron electron/main.cjs
```

会起一个本地服务再打开窗口（`electron/main.cjs` 里的做法是为了绕开
ESM 的 `file://` 限制）。注意入口是 `.cjs`：package.json 声明了
`"type": "module"`，CJS 语法的入口必须用 `.cjs` 后缀，否则启动即报
`require is not defined`。

### 方式四：打包分发

| 产物 | 命令 | 给谁用 |
|---|---|---|
| 免安装 zip（约 60 KB） | 手动：把 `dist/monopoly-office.html` 连同说明打包即可 | 微信/U 盘随手发，双击 html 就玩 |
| Windows 安装程序 | `npm run dist:win` | 想要桌面图标/开始菜单的普通玩家 |

```bash
npm run dist:win   # = electron-builder --win nsis --x64
# 产物：release/installer/monopoly-office-setup-<版本>.exe
```

> 国内网络建议先设镜像再装依赖：
> `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
> `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
>
> 安装包未做代码签名，首次运行时 Windows SmartScreen 可能提示
> "未知发布者"，点「仍要运行」即可。

---

## 目录结构

```
monopoly-office/
├─ index.html              开发态入口
├─ dist/
│  └─ monopoly-office.html   构建产物（单文件，129 KB）
├─ data/                   ← 改数值/文案只动这里
│  ├─ config.json          经济参数、职级、胜利条件
│  ├─ board.json           40 格地图、房价、内部装饰
│  ├─ events.json          格子事件池
│  ├─ cards.opportunity.json   机会卡 20 张
│  ├─ cards.fate.json      命运卡 20 张
│  ├─ cards.item.json      道具卡 12 张
│  ├─ ai_profiles.json     AI 三性格
│  └─ ui_text.json         界面文案
├─ src/
│  ├─ main.js              主控制器：装配 core + ui + 音频
│  ├─ core/                纯逻辑，零 DOM 零 IO（可在 Node 里跑）
│  │  ├─ reducer.js        唯一状态变更入口
│  │  ├─ turnMachine.js    回合阶段推进（实现在 reducer.advancePhase）
│  │  ├─ economy.js        月度结算管线
│  │  ├─ cards.js          牌堆管理
│  │  ├─ effects.js        17 个效果算子
│  │  ├─ ai.js / aiPlan.js AI 决策 + 目标规划
│  │  ├─ bankruptcy.js     破产清算
│  │  ├─ serialize.js      快照 / 回合包 / 哈希
│  │  └─ rng.js            带种子 PRNG
│  ├─ data/                loader + schema 校验
│  ├─ net/                 协议 / 三种传输 / host / client
│  └─ ui/                  棋盘 / 面板 / 弹窗 / 音效 / 设置
├─ server/room-server.cjs  WebSocket 房间中继（可选，零依赖）
├─ electron/main.cjs       Electron 打包入口
├─ tools/                  构建与测试脚本
└─ docs/                   四份文档 + 截图
```

---

## 工具

| 命令 | 作用 |
|---|---|
| `node tools/build.mjs` | 构建单文件 HTML |
| `node tools/verify-core.mjs` | 33 项回归验证（含伪联机哈希一致性）|
| `node tools/profile.mjs 400` | 跑 400 局看三性格胜率与资产画像 |
| `node tools/human-sim.mjs 300 4` | 人类行为模拟（验证破产机制）|
| `node tools/headless-sim.mjs 500 4` | 通用无头模拟 |
| `node tools/ui-smoke.mjs` | 无头浏览器 UI 冒烟测试 + 截图 |
| `node tools/trace.mjs` | 逐帧打印 phase/turn/cash，定位推进问题 |
| `node tools/check-layout.mjs` | 验证棋盘布局（40 格、无重复、不越界）|
| `node tools/fix-quotes.mjs data/*.json` | 批量修 JSON 里的中文引号 |

---

## 架构要点

三条铁律（来自第 1 步设计，贯穿全部代码）：

1. **一切状态变更走 `dispatch(action)` → `reducer(state, action) → {state, diff}`**，
   reducer 是纯函数。
   → 单机 / AI / 联机共用同一套逻辑；联机只传 action；断线可重放。

2. **随机数走 seeded PRNG，种子存在 `state.meta`**，
   reducer 内禁止 `Math.random()`。
   → 回放一致、伪联机哈希校验、客户端改不了结果。

3. **core 层零 DOM / 零 IO**。
   → 能在 Node 里跑无头模拟（这是调数值的主要手段）。

---

## 文档

| 文档 | 内容 |
|---|---|
| [玩法说明](docs/02-玩法说明.md) | 规则、格子类型、经济系统、卡牌、破产规则 |
| [联机说明](docs/03-联机说明.md) | 伪联机 / WebSocket / WebRTC 三种方式 + 断线重连 |
| [自定义数值与文案](docs/04-自定义数值与文案.md) | 每个字段怎么改、改完怎么验证 |

---

## 更新日志

### v1.1.0（2026-10-09）bug 修复 + 视觉升级（参考《大富翁11》）

**玩法修复**
- 买车格真正可玩：旧版落进事件文案分支，`kind:"vehicle"` 购买弹窗永远造不出来，两个买车格形同虚设；现在落格弹看车窗（含"先不买"退路），AI 决策改为「投资视角（生活减免回本）+ 消费视角（面子/心情）」双通道，人均车辆从 0.00 → 0.22 辆。
- 手冲咖啡/简历镀金的"重掷"生效：掷两次取较高值（旧版只消费道具不产生任何效果）。
- 正好落在起点也发起步补贴（旧版只有路过才发，与格面文案矛盾）。
- 折叠伞（shield）生效：挡下一次负面事件的现金损失/比例损失（旧版 grant 发出后无人消费）。
- 茶水间情报生效：直接展示首富资产明细弹窗（旧版 peekRichest 是死数据）。
- AI 决策不再下发金额为 0 的存取款（seed 777 实测此类非法 action 会造成调度层活锁卡死整局）。
- AI 买房杠杆算式与 reducer 完全对齐（漏算已有贷款本金会反复碰壁）。
- 月末收租与"路过收租"同口径（持有加成每月 +2%，旧版两处数字不一致）。

**联机修复**
- 回合包改为携带完整状态快照（剥离可本地重建的静态数据）：旧版只传 action 且导出时过滤条件写反，action 列表恒为空，导入必然校验失败——伪联机此前完全不可用。
- AI 决策函数不再在 reducer 外推进 rng 流，否则发送方哈希混入决策期消耗，接收方重放必然对不上。

**UI/性能修复**
- AI 回合看门狗：单个 AI 座位一回合最多 20 秒，卡住（弹窗循环/队列残留/回调链断）就按当前阶段合法地强制推进；人类回合不计时，页面切后台不计时。
- 骰子 3D 动画接线（旧版 showDice/drawDice 从未被调用，且翻滚阈值 560ms 大于存活期 320ms，翻滚帧一帧未画过）。
- 车贷月供按 24 期展示（旧版看车窗错用房贷 36 期）。
- TILE_EVENT 阶段不再显示存/取款按钮（阶段白名单不允许，点了必被拒）。
- index.html 移除与 bindTopButtons 重复的音效/BGM/帮助绑定（开发态点一次 toggle 两次）。
- 移除 reducer 中无人消费的 pending.aiQueue 死代码；开局文案读配置的初始现金。

**体验反馈（第二轮，2026-10-09）**
- 道具修复：「简历」「简历镀金」的抽机会卡、「年假条」的跳过下一回合，旧版 grant 发出后无任何代码消费，用了等于白用 —— 现已全部生效；抽到/获得卡牌、折叠伞生效都有即时 toast + 音效反馈。
- 棋子放大 40%（占格宽 13.5% → 19%），描边与投影加强，棋盘上一眼可见。
- 掷骰动画 320ms → 1.1s 三段演出：入场砸落 → 摇晃颠簸翻面 → 定格回弹；事件弹窗等骰子落定后才出现，不再被遮罩提前盖住。
- 中央办公区重做：木地板拼条 + 十字走廊动线 + 金边地毯 + 中央"¥ 工位大亨"金币徽章，白板挪出正中心。

**体验反馈（第三轮，2026-10-09）**
- 结算画面重做：前三名领奖台（金框冠军台）+ 第 4 名起完整排名 + 「再来一局 / 退出游戏」双按钮（再来一局直接同配置开新局；退出先尝试关窗，被拦则显示告别页）。顺带修复一个老 bug：GAME_OVER 阶段 dispatch 跳过 step()，结算画面从未真正弹出过。
- 道具存在感：修复"全场只有开局 3 张道具"的投放空白 —— 吃饭/公司/购物/公休四类事件池新增道具掉落；新增「顺风车」（移动+3）与「老板红包」（现金+10000）两张卡；红牛/桌面绿植/年假条/餐补券效果加强（绿植改为永久月被动收入）；打出任何卡都有全屏卡牌特效；道具栏与使用按钮带呼吸灯。
- Q 版卡通人物：全新手绘 6 位人类打工人（眼镜小哥/红裙丽人/丸子头妹妹/绿衫大叔/金表老板/高马尾小柒，纯 canvas 参数化绘制），替换全部动物 emoji 头像，棋子/玩家卡/设置页/AI 形象四处生效。
- UI 增色：玩家卡左侧玩家色身份条纹、操作按钮按功能分色（存蓝/取绿/机会紫/道具金）、顶栏金色分隔线、按钮呼吸灯。

**视觉升级**
- 棋子重绘为大富翁式角色棋子：底盘 + 身体 + 白底 emoji 头像头，破产打叉覆盖全身。
- 当前行动者头顶金色浮动箭头。
- 地皮归属升级为「玩家色小房子 + 三角旗」标记（旧版一条色带）。
- 中央办公区新增「工位大亨 MONOPOLY·OFFICE」水印；新增健身房 / 机房 / 前台三个手绘场景。
- 主题打磨：玩家卡职级星标、当前玩家金色渐变描边、主按钮金色渐变、弹窗顶部金色饰条、胜利榜前三名奖牌。
- 设置页「动画速度」真正生效（联动棋子移动与骰子时长）。

### v1.0.0（2026-10-08）

首次交付，见 git 历史 / docs。

---

## 已知限制

- **伪联机不防作弊**：能防文件损坏与篡改（快照哈希校验），但接收方自己改 state 再导入是拦不住的。
  界面上已注明是「友战模式」。
- **联机需要所有端用同一份 `data/*.json`**，否则回合包哈希校验会失败。
- **房产产出率（1.07%）仍低于存款利率（4.2%）**，因为负债占资产 70%。
  这是短局（10 个月）+ 高杠杆的必然结果，不是 bug。想调整见自定义文档。
- **买车仍偏投资性弱**（人均约 0.22 辆）：10 个月短局里生活减免很难回本，
  买车的价值主要在面子/心情与开销减免，属于设计取舍而非 bug。
