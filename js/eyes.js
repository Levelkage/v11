// Análise dos olhos: quão fechado está cada olho, qual está aberto,
// para onde a cabeça aponta e onde está a íris.
//
// "R" e "L" são do ponto de vista da pessoa (olho direito / esquerdo dela).

// 6 pontos clássicos do Eye Aspect Ratio: [canto, sup1, sup2, canto, inf2, inf1]
const EYE_R = { ear: [33, 160, 158, 133, 153, 144], iris: 468, corners: [33, 133] };
const EYE_L = { ear: [362, 385, 387, 263, 373, 380], iris: 473, corners: [362, 263] };

// Pontos para estimar a orientação da cabeça.
const CHEEK_R = 234, CHEEK_L = 454, FOREHEAD = 10, CHIN = 152;
// A linha testa→queixo é inclinada em relação à direção em que o rosto olha;
// esta rotação (~13°, medida num rosto frontal) corrige esse viés.
const PITCH_SIN = 0.232, PITCH_COS = 0.973;

// Limiares da máquina de estados (closure: 0 = aberto, 1 = fechado).
const CLOSED_MIN = 0.55;  // olho fechado precisa passar disso
const OPEN_MAX = 0.4;     // olho aberto precisa ficar abaixo disso (tolera apertar)
const DIFF_MIN = 0.35;    // diferença mínima entre os dois olhos
const ENTER_FRAMES = 3;   // frames seguidos para ativar (evita piscadas)
const EXIT_FRAMES = 4;    // frames seguidos para desativar

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function eyeAspectRatio(p) {
  return (dist(p[1], p[5]) + dist(p[2], p[4])) / (2 * dist(p[0], p[3]) + 1e-6);
}

export class EyeAnalyzer {
  constructor() {
    this.reset();
  }

  reset() {
    // Referência adaptativa do EAR com o olho aberto (cada rosto é diferente).
    this.openRef = { L: 0.28, R: 0.28 };
    // Erro acumulado das duas formas de associar os blendshapes aos olhos.
    // (Evita depender da convenção esquerda/direita do modelo.)
    this.pairErr = [0, 0];
    this.closure = { L: 0, R: 0 };
    this.state = "none"; // "none" | "L" (só o esquerdo aberto) | "R" (só o direito aberto)
    this.enter = 0;
    this.exit = 0;
    this.candidate = "none";
  }

  _earClosure(side, ear) {
    const ref = this.openRef;
    // Só atualiza a referência quando o olho parece aberto, para que uma
    // piscadela longa não "ensine" que o olho fechado é o normal.
    if (ear > ref[side]) ref[side] += (ear - ref[side]) * 0.08;
    else if (ear > ref[side] * 0.7) ref[side] += (ear - ref[side]) * 0.01;
    const r = Math.max(ref[side], 0.85 * Math.max(ref.L, ref.R));
    return clamp01(1 - (ear - 0.45 * r) / (0.4 * r));
  }

  // landmarks normalizados do MediaPipe; vw/vh = tamanho do vídeo em pixels.
  update(landmarks, blendshapes, vw, vh) {
    const P = (i) => {
      const l = landmarks[i];
      return { x: l.x * vw, y: l.y * vh, z: l.z * vw };
    };

    const earR = eyeAspectRatio(EYE_R.ear.map(P));
    const earL = eyeAspectRatio(EYE_L.ear.map(P));
    const cR = this._earClosure("R", earR);
    const cL = this._earClosure("L", earL);

    let closL = cL, closR = cR;
    if (blendshapes) {
      const a = blendshapes.eyeBlinkLeft ?? 0;
      const b = blendshapes.eyeBlinkRight ?? 0;
      this.pairErr[0] = this.pairErr[0] * 0.995 + Math.abs(a - cL) + Math.abs(b - cR);
      this.pairErr[1] = this.pairErr[1] * 0.995 + Math.abs(a - cR) + Math.abs(b - cL);
      const [bL, bR] = this.pairErr[0] <= this.pairErr[1] ? [a, b] : [b, a];
      closL = 0.6 * bL + 0.4 * cL;
      closR = 0.6 * bR + 0.4 * cR;
    }
    // Suavização leve (piscar é rápido, então pouca inércia).
    this.closure.L += (closL - this.closure.L) * 0.6;
    this.closure.R += (closR - this.closure.R) * 0.6;

    this._updateState();

    // --- Orientação da cabeça (normal do plano do rosto) ---
    const xAxis = sub(P(CHEEK_L), P(CHEEK_R)); // aponta para a direita da imagem
    const yAxis = sub(P(CHIN), P(FOREHEAD));   // aponta para baixo
    let fwd = normalize(cross(xAxis, yAxis));  // +z = para longe da câmera
    fwd = { x: -fwd.x, y: -fwd.y, z: -fwd.z }; // para frente do rosto (rumo à câmera)
    fwd = {
      x: fwd.x,
      y: fwd.y * PITCH_COS + fwd.z * PITCH_SIN,
      z: -fwd.y * PITCH_SIN + fwd.z * PITCH_COS,
    };

    const ipd = dist(P(EYE_R.iris), P(EYE_L.iris));

    let eye = null;
    if (this.state !== "none") {
      const def = this.state === "L" ? EYE_L : EYE_R;
      const iris = landmarks.length > def.iris ? P(def.iris) : null;
      const c0 = P(def.corners[0]), c1 = P(def.corners[1]);
      const mid = { x: (c0.x + c1.x) / 2, y: (c0.y + c1.y) / 2 };
      const width = dist(c0, c1);
      const origin = iris ?? mid;
      // O olhar (posição da íris dentro do olho) desvia um pouco o raio.
      const gx = (origin.x - mid.x) / width;
      const gy = (origin.y - mid.y) / width;
      const dir = normalize({ x: fwd.x + gx * 1.2, y: fwd.y + gy * 0.6, z: fwd.z });
      eye = { side: this.state, origin, width, dir };
    }

    return { state: this.state, closure: { ...this.closure }, forward: fwd, ipd, eye };
  }

  _updateState() {
    const { L, R } = this.closure;
    let want = "none";
    if (R > CLOSED_MIN && L < OPEN_MAX && R - L > DIFF_MIN) want = "L";
    else if (L > CLOSED_MIN && R < OPEN_MAX && L - R > DIFF_MIN) want = "R";

    if (this.state === "none") {
      if (want !== "none" && want === this.candidate) this.enter++;
      else this.enter = want !== "none" ? 1 : 0;
      this.candidate = want;
      if (this.enter >= ENTER_FRAMES) {
        this.state = want;
        this.exit = 0;
      }
      return;
    }

    // Já disparando: histerese mais frouxa para não "piscar" o laser.
    const open = this.state === "L" ? L : R;
    const closed = this.state === "L" ? R : L;
    const holding = closed > CLOSED_MIN - 0.12 && open < OPEN_MAX + 0.15;
    if (holding) this.exit = 0;
    else if (++this.exit >= EXIT_FRAMES) {
      this.state = "none";
      this.enter = 0;
      this.candidate = "none";
    }
  }
}

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function normalize(v) {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}
