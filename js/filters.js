// Filtro One Euro: remove o tremor dos landmarks sem atrasar movimentos rápidos.
// https://gery.casiez.net/1euro/
class LowPass {
  constructor() { this.y = null; }
  filter(x, a) {
    this.y = this.y === null ? x : this.y + a * (x - this.y);
    return this.y;
  }
}

const alpha = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuro {
  constructor(minCutoff = 1, beta = 0, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }
  reset() {
    this.x = new LowPass();
    this.dx = new LowPass();
    this.prev = null;
  }
  filter(value, dt) {
    if (this.prev === null) {
      this.prev = value;
      this.dx.filter(0, 1);
      return this.x.filter(value, 1);
    }
    const d = (value - this.prev) / dt;
    this.prev = value;
    const ed = this.dx.filter(d, alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(ed);
    return this.x.filter(value, alpha(cutoff, dt));
  }
}

// Mola amortecida (massa-mola-amortecedor) integrada com Euler semi-implícito.
export class Spring {
  constructor(stiffness, dampingRatio, value = 0) {
    this.k = stiffness;
    this.c = 2 * Math.sqrt(stiffness) * dampingRatio;
    this.x = value;
    this.v = 0;
  }
  step(target, dt) {
    const a = this.k * (target - this.x) - this.c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
  snap(value) {
    this.x = value;
    this.v = 0;
  }
}
