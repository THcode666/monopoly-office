// 音效：Web Audio 程序化合成，零资源文件（不引入 mp3，体积为 0）。
// 提供：骰子声、收银声、叹息声、升职/降职、破产、点击、BGM 循环。
//
// 设计取舍：BGM 用简单五声音阶琶音，节奏慢、不抢戏；
// 职场题材的幽默感靠音效选择（如"叹息"用下滑音）而不是复杂旋律。

const A4 = 440;
const semi = (n) => A4 * Math.pow(2, n / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem("sf_sound") !== "0";
    this.bgmOn = localStorage.getItem("sf_bgm") !== "0";
    this.master = null;
    this.bgmNodes = null;
  }

  _ensure() {
    if (this.ctx) return true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
      return true;
    } catch { return false; }
  }

  resume() {
    if (this._ensure() && this.ctx.state === "suspended") this.ctx.resume();
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem("sf_sound", this.enabled ? "1" : "0");
    if (!this.enabled && this.bgmNodes) this.stopBgm();
    return this.enabled;
  }

  toggleBgm() {
    this.bgmOn = !this.bgmOn;
    localStorage.setItem("sf_bgm", this.bgmOn ? "1" : "0");
    if (this.bgmOn) this.startBgm(); else this.stopBgm();
    return this.bgmOn;
  }

  // 基础：单个音符
  tone(freq, dur, type = "sine", gain = 0.5, delay = 0, sweep = null) {
    if (!this.enabled || !this._ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }

  // 噪声（骰子/纸张）
  noise(dur, gain = 0.4, delay = 0, hp = 800) {
    if (!this.enabled || !this._ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass"; f.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  }

  dice(value = 3) {
    // 3~5 次清脆撞击，音高随点数微升
    const times = [0, 70, 150, 240, 340].slice(0, 3 + Math.min(2, Math.floor(value / 2)));
    times.forEach((d, i) => {
      this.noise(0.09, 0.32, d, 1400);
      this.tone(420 + i * 45 + value * 18, 0.1, "triangle", 0.22, d);
    });
  }

  cash() {
    // 收银：叮咚 + 钞票翻动
    this.tone(semi(16), 0.12, "triangle", 0.34, 0);
    this.tone(semi(23), 0.16, "triangle", 0.28, 0.075);
    this.tone(semi(28), 0.3, "sine", 0.2, 0.15);
    this.noise(0.16, 0.12, 0.02, 2600);
  }

  sigh() {
    // 叹息：下滑的三角波 + 轻微颤音
    this.tone(320, 0.6, "triangle", 0.24, 0, 150);
    this.noise(0.4, 0.06, 0.05, 500);
  }

  up() {
    // 升职：上行三音
    [0, 4, 7, 12].forEach((s, i) => this.tone(semi(s), 0.16, "sine", 0.3, i * 0.085));
  }

  down() {
    // 降职：下行三音 + 低沉尾音
    [0, -3, -7, -12].forEach((s, i) => this.tone(semi(s), 0.18, "sine", 0.28, i * 0.1));
    this.tone(semi(-17), 0.4, "triangle", 0.2, 0.42);
  }

  bankrupt() {
    [0, -5, -9, -14, -19].forEach((s, i) => this.tone(semi(s), 0.3, "sawtooth", 0.16, i * 0.13));
    this.noise(0.7, 0.1, 0.1, 300);
  }

  click() {
    this.tone(660, 0.05, "square", 0.12);
  }

  popup() {
    this.tone(520, 0.08, "sine", 0.2);
    this.tone(780, 0.1, "sine", 0.18, 0.05);
  }

  startBgm() {
    if (!this.bgmOn || !this._ensure() || this.bgmNodes) return;
    this.resume();
    const t0 = this.ctx.currentTime;
    // 五声音阶（C D E G A）琶音，缓慢循环
    const notes = [0, 4, 7, 9, 7, 4, 2, 4, 5, 9, 7, 4];
    const g = this.ctx.createGain();
    g.gain.value = 0.075;
    g.connect(this.master);
    const oscs = [];
    notes.forEach((s, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = semi(s - 5);
      osc.connect(g);
      osc.start(t0 + i * 0.34);
      oscs.push(osc);
    });
    // 32 秒后回收并重启，形成循环
    const loopLen = notes.length * 0.34;
    setTimeout(() => {
      if (this.bgmNodes === handle) { this.stopBgm(); if (this.bgmOn) this.startBgm(); }
    }, loopLen * 1000);
    const handle = { oscs, gain: g };
    this.bgmNodes = handle;
  }

  stopBgm() {
    if (!this.bgmNodes) return;
    try { this.bgmNodes.oscs.forEach((o) => o.stop()); } catch { /* 已停止 */ }
    try { this.bgmNodes.gain.disconnect(); } catch { /* 已断开 */ }
    this.bgmNodes = null;
  }
}
