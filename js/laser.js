// Efeito do raio laser com física.
//
// Modelo:
//  * O raio é um feixe 3D que sai da íris na direção para onde o rosto aponta
//    (orientação da cabeça + olhar). A profundidade do olho vem da distância
//    entre as pupilas e o modelo pinhole da câmera.
//  * O raio é intersectado com o plano do aparelho: ele atinge o vidro da tela
//    exatamente no ponto para onde você mira (vire a cabeça para "desenhar").
//    Lá ele queima o vidro: faíscas com gravidade, arrasto do ar, quique e
//    resfriamento (cor de corpo negro), fumaça com empuxo e marcas que esfriam.
//  * A direção do raio tem inércia (mola amortecida) e a potência sobe/desce
//    com uma mola, dando "carga" e "descarga" naturais.
//  * Poeira no ar só aparece quando atravessa o feixe (espalhamento, efeito Tyndall).
import { OneEuro, Spring } from "./filters.js";

const BEAM_RADIUS = 0.0022; // raio físico do núcleo do feixe (m)
// Tamanho físico de 1 px CSS em telas de iPhone (~163 pontos por polegada).
const M_PER_PX = 0.0254 / 163;
const CAMERA_Y_PX = 12;     // altura da câmera frontal em relação ao topo da tela (px CSS)
// Sensibilidade da mira (1 = fisicamente exato; menor = mais fácil de controlar).
const AIM_GAIN = 0.7;
const MAX_SPARKS = 1600;
const MAX_SMOKE = 90;
const MAX_SCORCH = 420;
const DUST_COUNT = 150;

// ---------- utilidades ----------
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise1(t) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u);
}

// Paleta aproximada de corpo negro: t=1 branco-quente, t=0 vermelho escuro.
const HEAT_STOPS = [
  [0.0, 40, 0, 0],
  [0.15, 140, 15, 5],
  [0.3, 230, 60, 10],
  [0.5, 255, 140, 30],
  [0.72, 255, 215, 120],
  [1.0, 255, 250, 235],
];
function heatColor(t) {
  t = clamp(t, 0, 1);
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const b = HEAT_STOPS[i];
    if (t <= b[0]) {
      const a = HEAT_STOPS[i - 1];
      const k = (t - a[0]) / (b[0] - a[0]);
      return [lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k)].map(Math.round);
    }
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1].slice(1);
}

function makeSprite(r, g, b, stops, size = 64) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d");
  const h = size / 2;
  const gr = x.createRadialGradient(h, h, 0, h, h, h);
  for (const [o, a] of stops) gr.addColorStop(o, `rgba(${r},${g},${b},${a})`);
  x.fillStyle = gr;
  x.fillRect(0, 0, size, size);
  return c;
}
const GLOW = [[0, 1], [0.15, 0.6], [0.4, 0.18], [0.7, 0.04], [1, 0]];
const SOFT = [[0, 0.9], [0.5, 0.35], [1, 0]];

const HEAT_LEVELS = 24;

// Recorta o segmento a->b no retângulo (Liang–Barsky). Retorna o parâmetro final (0..1).
function clipEnd(ax, ay, bx, by, x0, y0, x1, y1) {
  let u1 = 1;
  const dx = bx - ax, dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) continue;
    const r = q[i] / p[i];
    if (p[i] > 0) u1 = Math.min(u1, r);
  }
  return clamp(u1, 0, 1);
}

// Desenha um feixe afunilado com pontas arredondadas (trapézio + semicírculos).
function taper(ctx, ax, ay, aw, bx, by, bw) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  ctx.beginPath();
  if (len < 0.5) {
    ctx.arc(bx, by, Math.max(aw, bw), 0, Math.PI * 2);
  } else {
    const nx = -dy / len, ny = dx / len;
    const th = Math.atan2(ny, nx);
    ctx.moveTo(ax + nx * aw, ay + ny * aw);
    ctx.lineTo(bx + nx * bw, by + ny * bw);
    ctx.arc(bx, by, bw, th, th + Math.PI, true);
    ctx.lineTo(ax - nx * aw, ay - ny * aw);
    ctx.arc(ax, ay, aw, th + Math.PI, th, true);
  }
  ctx.closePath();
  ctx.fill();
}

export class LaserFX {
  constructor() {
    this.W = 1;
    this.H = 1;
    this.scale = 1;
    this.time = 0;

    this.power = new Spring(260, 0.85, 0);
    this.fOx = new OneEuro(1.4, 0.015);
    this.fOy = new OneEuro(1.4, 0.015);
    this.fD = [new OneEuro(1.2, 0.6), new OneEuro(1.2, 0.6), new OneEuro(1.2, 0.6)];
    // Inércia do feixe: a direção segue o rosto com uma mola levemente subamortecida.
    this.dS = [new Spring(180, 0.7), new Spring(180, 0.7), new Spring(180, 0.7, -1)];

    this.origin = null; // {x,y} na tela
    this.dir = { x: 0, y: 0, z: -1 };
    this.eyeWidth = 30;
    this.cam = { f: 800, cx: 0, cy: 0 };
    this.z0 = 0.4;
    this.side = null;
    this.geo = null;

    this.sparks = [];
    this.smoke = [];
    this.scorch = [];
    this.dust = [];
    this.sparkAcc = 0;
    this.smokeAcc = 0;
    this.shake = { x: 0, y: 0 };
    this.impactLevel = 0;

    this.glowRed = makeSprite(255, 20, 0, GLOW);
    this.glowWhite = makeSprite(255, 255, 255, GLOW);
    this.sootSprite = makeSprite(15, 8, 5, SOFT);
    this.smokeSprite = makeSprite(130, 122, 118, SOFT);
    this.heatSprites = [];
    for (let i = 0; i < HEAT_LEVELS; i++) {
      const [r, g, b] = heatColor(i / (HEAT_LEVELS - 1));
      this.heatSprites.push(makeSprite(r, g, b, GLOW));
    }
    this.heatCss = [];
    for (let i = 0; i < HEAT_LEVELS; i++) {
      const [r, g, b] = heatColor(i / (HEAT_LEVELS - 1));
      this.heatCss.push(`rgb(${r},${g},${b})`);
    }
  }

  resize(W, H) {
    this.W = W;
    this.H = H;
    this.scale = Math.min(W, H) / 800;
    if (this.dust.length === 0) {
      for (let i = 0; i < DUST_COUNT; i++) {
        this.dust.push({
          x: rand(0, W), y: rand(0, H),
          vx: rand(-5, 5), vy: rand(-5, 5),
          s: rand(0.6, 1.8), tw: rand(0, 100),
        });
      }
    }
  }

  clearMarks() {
    this.scorch.length = 0;
  }

  get firing() {
    return this.power.x > 0.02;
  }

  // input: { active, side, origin:{x,y}, dir:{x,y,z}, eyeWidth, cam:{f,cx,cy}, z0 }
  update(dt, input) {
    dt = Math.min(dt, 1 / 20);
    this.time += dt;

    if (input && input.active) {
      if (this.side !== input.side || !this.origin) {
        // Troca de olho (ou primeiro disparo): reinicia filtros na nova posição.
        this.fOx.reset(); this.fOy.reset();
        this.fD.forEach((f) => f.reset());
        this.dS[0].snap(input.dir.x); this.dS[1].snap(input.dir.y); this.dS[2].snap(input.dir.z);
        this.side = input.side;
      }
      this.origin = { x: this.fOx.filter(input.origin.x, dt), y: this.fOy.filter(input.origin.y, dt) };
      const d = [input.dir.x, input.dir.y, input.dir.z].map((v, i) => this.dS[i].step(this.fD[i].filter(v, dt), dt));
      const m = Math.hypot(d[0], d[1], d[2]) || 1;
      this.dir = { x: d[0] / m, y: d[1] / m, z: d[2] / m };
      this.eyeWidth = lerp(this.eyeWidth, input.eyeWidth, 0.3);
      this.cam = input.cam;
      this.z0 = lerp(this.z0, input.z0, 0.2);
    } else if (!this.firing) {
      this.side = null;
    }

    const target = input && input.active ? 1 : 0;
    this.power.step(target, dt);
    this.power.x = clamp(this.power.x, 0, 1.15);

    const p = this.power.x;
    // Cintilação: ruído de alta frequência + modulação lenta.
    this.flicker = 0.9 + 0.07 * noise1(this.time * 37) + 0.05 * noise1(this.time * 3.1 + 9);
    this.geo = this.origin && p > 0.005 ? this._geometry() : null;

    const g = this.geo;
    const impact = !!(g && g.impact) && p > 0.15;
    this.impactLevel = lerp(this.impactLevel, impact ? p : 0, 1 - Math.exp(-dt * 10));

    if (impact) this._emit(dt, g, p);
    this._updateSparks(dt);
    this._updateSmoke(dt);
    this._updateScorch(dt, impact ? g : null, p);
    this._updateDust(dt);

    // Tremor de câmera sutil enquanto queima.
    const amp = 1.6 * this.scale * this.impactLevel;
    this.shake.x = (noise1(this.time * 31) - 0.5) * 2 * amp;
    this.shake.y = (noise1(this.time * 29 + 50) - 0.5) * 2 * amp;
  }

  // Calcula onde o feixe 3D atinge o aparelho e projeta o trecho visível.
  _geometry() {
    const { f, cx, cy } = this.cam;
    const z0 = this.z0;
    const D = this.dir;
    const ax = this.origin.x, ay = this.origin.y;
    // Posição 3D do olho no espaço da câmera (m), a partir da projeção pinhole.
    const E = { x: ((ax - cx) * z0) / f, y: ((ay - cy) * z0) / f, z: z0 };
    const aw = (f * BEAM_RADIUS) / z0;

    let bx, by, bw, hits = false;
    if (D.z < -0.05) {
      // Interseção do raio com o plano do aparelho (z = 0, onde estão câmera e tela).
      const t = -E.z / D.z;
      const X = E.x + AIM_GAIN * t * D.x, Y = E.y + AIM_GAIN * t * D.y;
      // A câmera fica no topo, no centro; converte metros → pixels da tela.
      bx = this.W / 2 + X / M_PER_PX;
      by = CAMERA_Y_PX + Y / M_PER_PX;
      bw = BEAM_RADIUS / M_PER_PX; // no vidro o feixe tem seu tamanho real
      hits = true;
    } else {
      // Apontando para o lado/para longe: o feixe sai pela borda.
      const m = Math.hypot(D.x, D.y) || 1;
      const L = 3 * Math.max(this.W, this.H);
      bx = ax + (D.x / m) * L;
      by = ay + (D.y / m) * L;
      bw = aw;
    }

    // Recorta na tela (com margem para o brilho).
    const m = 30 * this.scale;
    const u = clipEnd(ax, ay, bx, by, -m, -m, this.W + m, this.H + m);
    if (u < 1) {
      hits = false; // mirou fora da tela: o raio passa direto pela borda
      bx = lerp(ax, bx, u);
      by = lerp(ay, by, u);
      bw = lerp(aw, bw, u);
    }
    return { ax, ay, aw, bx, by, bw, impact: hits, len: Math.hypot(bx - ax, by - ay) };
  }

  // ---------- partículas ----------
  _emit(dt, g, p) {
    const s = this.scale;
    this.sparkAcc += dt * 400 * p;
    while (this.sparkAcc >= 1) {
      this.sparkAcc -= 1;
      if (this.sparks.length >= MAX_SPARKS) break;
      const ang = rand(0, Math.PI * 2);
      const r = Math.random() * g.bw * 0.5;
      // Distribuição com cauda longa: poucas faíscas muito rápidas.
      const speed = s * (180 + 1100 * Math.pow(Math.random(), 2.2));
      const big = Math.random() < 0.08; // gotas de material derretido
      this.sparks.push({
        x: g.bx + Math.cos(ang) * r,
        y: g.by + Math.sin(ang) * r,
        px: g.bx, py: g.by,
        vx: Math.cos(ang) * speed * (big ? 0.4 : 1),
        vy: Math.sin(ang) * speed * (big ? 0.4 : 1) - s * rand(0, 250),
        temp: rand(0.85, 1),
        cool: big ? rand(0.25, 0.45) : rand(0.6, 1.6),
        drag: big ? 0.0004 : rand(0.0012, 0.003),
        w: big ? rand(2.2, 3.2) : rand(0.8, 1.8),
        bounces: 0,
      });
    }

    this.smokeAcc += dt * 22 * p;
    while (this.smokeAcc >= 1) {
      this.smokeAcc -= 1;
      if (this.smoke.length >= MAX_SMOKE) this.smoke.shift();
      this.smoke.push({
        x: g.bx + rand(-1, 1) * g.bw * 0.4,
        y: g.by + rand(-1, 1) * g.bw * 0.4,
        vx: rand(-30, 30) * s,
        vy: rand(-90, -40) * s,
        r: (12 + g.bw * 0.5) * s,
        age: 0,
        life: rand(2, 3.5),
        rot: rand(0, Math.PI * 2),
      });
    }
  }

  _updateSparks(dt) {
    const s = this.scale;
    const G = 2100 * s; // gravidade em px/s²
    const W = this.W, H = this.H;
    const list = this.sparks;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const k = list[i];
      k.px = k.x;
      k.py = k.y;
      // Arrasto quadrático do ar: a = -c·|v|·v / escala
      const sp = Math.hypot(k.vx, k.vy);
      const dragF = Math.exp((-k.drag * sp * dt) / s);
      k.vx *= dragF;
      k.vy = k.vy * dragF + G * dt;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      // Colisões com as bordas (o chão é a borda de baixo).
      if (k.y > H) {
        k.y = H;
        k.vy *= -rand(0.25, 0.45);
        k.vx *= 0.65;
        k.temp *= 0.85;
        k.bounces++;
      }
      if (k.x < 0) { k.x = 0; k.vx *= -0.4; }
      else if (k.x > W) { k.x = W; k.vx *= -0.4; }
      // Resfriamento radiativo (mais rápido quanto mais quente: ~T⁴, simplificado).
      k.temp -= dt * k.cool * (0.35 + k.temp * k.temp);
      if (k.temp > 0.04 && k.bounces < 4) list[n++] = k;
    }
    list.length = n;
  }

  _updateSmoke(dt) {
    const s = this.scale;
    const list = this.smoke;
    let n = 0;
    for (const p of list) {
      p.age += dt;
      // Empuxo (ar quente sobe) + arrasto linear + turbulência.
      p.vy -= 70 * s * dt;
      p.vx += (noise1(p.age * 2 + p.rot * 10) - 0.5) * 120 * s * dt;
      const d = Math.exp(-1.2 * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += 38 * s * dt; // difusão: a nuvem se expande
      if (p.age < p.life) list[n++] = p;
    }
    list.length = n;
  }

  _updateScorch(dt, g, p) {
    const s = this.scale;
    const list = this.scorch;
    const heatDecay = Math.exp(-dt * 1.6);
    const sootDecay = Math.exp(-dt * 0.04);
    for (const m of list) {
      m.heat *= heatDecay;
      m.soot *= sootDecay;
    }
    if (g) {
      const R = Math.max(10 * s, g.bw * 0.6);
      let best = null, bd = R;
      for (const m of list) {
        const d = Math.hypot(m.x - g.bx, m.y - g.by);
        if (d < bd) { bd = d; best = m; }
      }
      if (!best) {
        if (list.length >= MAX_SCORCH) list.shift();
        best = { x: g.bx, y: g.by, heat: 0, soot: 0, r: R };
        list.push(best);
      }
      best.heat = Math.min(1.3, best.heat + dt * 4 * p);
      best.soot = Math.min(1, best.soot + dt * 0.9 * p);
      best.r = Math.max(best.r, R);
    }
    let n = 0;
    for (const m of list) if (m.soot > 0.02 || m.heat > 0.02) list[n++] = m;
    list.length = n;
  }

  _updateDust(dt) {
    const W = this.W, H = this.H, s = this.scale;
    for (const d of this.dust) {
      // Movimento browniano com amortecimento.
      d.vx = d.vx * Math.exp(-0.6 * dt) + (Math.random() - 0.5) * 40 * s * dt;
      d.vy = d.vy * Math.exp(-0.6 * dt) + (Math.random() - 0.5) * 40 * s * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.x < 0) d.x += W; else if (d.x > W) d.x -= W;
      if (d.y < 0) d.y += H; else if (d.y > H) d.y -= H;
    }
  }

  // ---------- renderização ----------
  render(ctx) {
    const p = this.power.x * this.flicker;
    const g = this.geo;

    this._drawScorch(ctx);
    this._drawSmoke(ctx);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    if (g && p > 0.005) {
      const minWH = Math.min(this.W, this.H);
      // Luz vermelha ambiente (ilumina o rosto e o "ambiente").
      ctx.globalAlpha = 0.05 * p;
      ctx.fillStyle = "rgb(255,30,10)";
      ctx.fillRect(0, 0, this.W, this.H);
      const fr = minWH * 0.55;
      ctx.globalAlpha = 0.22 * p;
      ctx.drawImage(this.glowRed, g.ax - fr, g.ay - fr, fr * 2, fr * 2);

      this._drawBeam(ctx, g, p);
      this._drawDust(ctx, g, p);
    }

    this._drawSparks(ctx);

    if (g && p > 0.005) {
      if (g.impact) this._drawImpact(ctx, g, p);
      this._drawEyeFlare(ctx, g, p);
    }
    ctx.restore();
  }

  _drawBeam(ctx, g, p) {
    // Camadas do mais largo/fraco ao núcleo branco-quente.
    const layers = [
      [10, "255,0,0", 0.04],
      [5, "255,0,0", 0.09],
      [2.6, "255,10,0", 0.22],
      [1.5, "255,30,10", 0.5],
      [0.85, "255,90,70", 0.8],
      [0.35, "255,225,215", 0.9],
    ];
    // Pequena ondulação lateral do núcleo (turbulência térmica do ar).
    const j = (noise1(this.time * 60) - 0.5) * 0.6 * this.scale;
    for (const [mul, rgb, a] of layers) {
      ctx.globalAlpha = clamp(a * p, 0, 1);
      ctx.fillStyle = `rgb(${rgb})`;
      const aw = Math.max(0.6, g.aw * mul);
      const bw = Math.max(0.6, g.bw * mul);
      taper(ctx, g.ax, g.ay, aw, g.bx + j, g.by + j, bw);
    }
  }

  _drawDust(ctx, g, p) {
    const dx = g.bx - g.ax, dy = g.by - g.ay;
    const L2 = dx * dx + dy * dy || 1;
    for (const d of this.dust) {
      // Distância da partícula ao eixo do feixe na tela.
      let t = ((d.x - g.ax) * dx + (d.y - g.ay) * dy) / L2;
      t = clamp(t, 0, 1);
      const cx = g.ax + dx * t, cy = g.ay + dy * t;
      const w = lerp(g.aw, g.bw, t) * 3 + 2;
      const dist = Math.hypot(d.x - cx, d.y - cy);
      const I = Math.exp(-(dist * dist) / (w * w)) * p;
      if (I < 0.03) continue;
      const tw = 0.6 + 0.4 * Math.sin(this.time * 6 + d.tw);
      const sz = (3 + d.s * 4) * this.scale * (1 + I);
      ctx.globalAlpha = clamp(I * tw, 0, 1);
      ctx.drawImage(this.heatSprites[Math.floor(HEAT_LEVELS * 0.55)], d.x - sz, d.y - sz, sz * 2, sz * 2);
    }
  }

  _drawSparks(ctx) {
    if (this.sparks.length === 0) return;
    // Agrupa por temperatura para desenhar em lotes (bem mais rápido).
    const B = 12;
    const buckets = Array.from({ length: B }, () => []);
    for (const k of this.sparks) buckets[Math.min(B - 1, Math.floor(k.temp * B))].push(k);
    ctx.lineCap = "round";
    for (let b = 0; b < B; b++) {
      const arr = buckets[b];
      if (!arr.length) continue;
      const t = (b + 0.5) / B;
      ctx.strokeStyle = this.heatCss[Math.floor(t * (HEAT_LEVELS - 1))];
      ctx.globalAlpha = clamp(0.25 + t, 0, 1);
      // Faíscas finas e gotas maiores em passes separados.
      for (const big of [false, true]) {
        ctx.beginPath();
        let any = false;
        for (const k of arr) {
          if ((k.w > 2) !== big) continue;
          any = true;
          // Rastro de movimento (motion blur): da posição anterior, esticada.
          const ex = k.x + (k.x - k.px) * 0.6, ey = k.y + (k.y - k.py) * 0.6;
          ctx.moveTo(k.px, k.py);
          ctx.lineTo(ex, ey);
        }
        if (!any) continue;
        ctx.lineWidth = (big ? 2.8 : 1.3) * Math.max(1, this.scale);
        ctx.stroke();
      }
    }
    // Brilho em volta das faíscas mais quentes.
    for (const k of this.sparks) {
      if (k.temp < 0.7) continue;
      const sz = 6 * this.scale * k.temp;
      ctx.globalAlpha = 0.25 * k.temp;
      ctx.drawImage(this.heatSprites[HEAT_LEVELS - 4], k.x - sz, k.y - sz, sz * 2, sz * 2);
    }
  }

  _drawImpact(ctx, g, p) {
    const s = this.scale;
    const fl = 0.85 + 0.3 * noise1(this.time * 45);
    const core = (g.bw * 1.6 + 10 * s) * fl;
    const halo = (g.bw * 5 + 60 * s) * fl;
    ctx.globalAlpha = 0.65 * p;
    ctx.drawImage(this.glowRed, g.bx - halo, g.by - halo, halo * 2, halo * 2);
    ctx.globalAlpha = 0.9 * p;
    ctx.drawImage(this.heatSprites[HEAT_LEVELS - 6], g.bx - core * 1.6, g.by - core * 1.6, core * 3.2, core * 3.2);
    ctx.globalAlpha = Math.min(1, p);
    ctx.drawImage(this.glowWhite, g.bx - core, g.by - core, core * 2, core * 2);
  }

  _drawEyeFlare(ctx, g, p) {
    const s = this.scale;
    const ew = this.eyeWidth;
    const fl = 0.9 + 0.2 * noise1(this.time * 50 + 3);
    const x = g.ax, y = g.ay;

    // Halo vermelho e núcleo branco na íris.
    let r = ew * 2.2 * fl;
    ctx.globalAlpha = 0.8 * p;
    ctx.drawImage(this.glowRed, x - r, y - r, r * 2, r * 2);
    r = ew * 0.55 * fl;
    ctx.globalAlpha = Math.min(1, p);
    ctx.drawImage(this.glowWhite, x - r, y - r, r * 2, r * 2);

    // Streak anamórfico horizontal (lente).
    const sw = Math.min(this.W, ew * 14) * fl, sh = Math.max(3 * s, ew * 0.18);
    ctx.globalAlpha = 0.55 * p;
    ctx.drawImage(this.glowRed, x - sw, y - sh, sw * 2, sh * 2);
    ctx.globalAlpha = 0.35 * p;
    ctx.drawImage(this.glowWhite, x - sw * 0.4, y - sh * 0.4, sw * 0.8, sh * 0.8);

    // Reflexos internos da lente: "fantasmas" na linha que passa pelo centro óptico.
    const cx = this.W / 2, cy = this.H / 2;
    const ghosts = [[-0.35, 0.5], [0.45, 0.3], [0.8, 0.9], [1.25, 0.4], [1.6, 1.4]];
    for (const [k, size] of ghosts) {
      const gx = x + (cx - x) * 2 * k, gy = y + (cy - y) * 2 * k;
      const gr = ew * size * 1.4;
      ctx.globalAlpha = 0.07 * p;
      ctx.drawImage(this.heatSprites[Math.floor(HEAT_LEVELS * (0.3 + 0.1 * size))], gx - gr, gy - gr, gr * 2, gr * 2);
    }
  }

  _drawScorch(ctx) {
    if (!this.scorch.length) return;
    ctx.save();
    // Fuligem (escurece o vidro).
    for (const m of this.scorch) {
      const r = m.r * 1.6;
      ctx.globalAlpha = clamp(m.soot * 0.6, 0, 1);
      ctx.drawImage(this.sootSprite, m.x - r, m.y - r, r * 2, r * 2);
    }
    // Material incandescente esfriando: branco → amarelo → laranja → vermelho.
    ctx.globalCompositeOperation = "lighter";
    for (const m of this.scorch) {
      if (m.heat < 0.03) continue;
      const h = clamp(m.heat, 0, 1);
      const r = m.r * (0.9 + 0.6 * h);
      ctx.globalAlpha = clamp(m.heat, 0, 1);
      ctx.drawImage(this.heatSprites[Math.floor(h * (HEAT_LEVELS - 1))], m.x - r, m.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  _drawSmoke(ctx) {
    if (!this.smoke.length) return;
    ctx.save();
    for (const p of this.smoke) {
      const k = p.age / p.life;
      // Entra rápido, some devagar.
      const a = Math.min(1, p.age * 4) * (1 - k) * (1 - k) * 0.22;
      ctx.globalAlpha = a;
      ctx.drawImage(this.smokeSprite, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    ctx.restore();
  }
}
