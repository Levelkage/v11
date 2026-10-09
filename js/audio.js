// Som do laser sintetizado com Web Audio: zumbido elétrico + chiado da queima.
export class LaserAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  // Precisa ser chamado dentro de um toque do usuário (exigência do iOS).
  start() {
    if (this.ctx) return this.ctx.resume();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // Zumbido: duas serras levemente desafinadas num passa-baixa ressonante.
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 900;
    this.filter.Q.value = 6;
    this.filter.connect(this.master);

    this.osc = [];
    for (const [freq, detune, type] of [[92, -8, "sawtooth"], [138, 7, "sawtooth"], [46, 0, "square"]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = type === "square" ? 0.15 : 0.35;
      o.connect(g).connect(this.filter);
      o.start();
      this.osc.push(o);
    }

    // LFO que faz o filtro "respirar".
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(this.filter.frequency);
    lfo.start();

    // Chiado: ruído branco filtrado (queimando o vidro).
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3200;
    bp.Q.value = 0.7;
    this.sizzle = ctx.createGain();
    this.sizzle.gain.value = 0;
    noise.connect(bp).connect(this.sizzle).connect(ctx.destination);
    noise.start();
    return ctx.resume();
  }

  update(power, impact) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = this.enabled ? 1 : 0;
    this.master.gain.setTargetAtTime(on * Math.min(power, 1) * 0.22, t, 0.03);
    this.filter.frequency.setTargetAtTime(500 + power * 900, t, 0.05);
    this.osc[0].frequency.setTargetAtTime(80 + power * 14, t, 0.05);
    const crackle = 0.6 + 0.4 * Math.random();
    this.sizzle.gain.setTargetAtTime(on * impact * crackle * 0.12, t, 0.02);
  }
}
