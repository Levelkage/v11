import { FaceTracker } from "./tracker.js";
import { EyeAnalyzer } from "./eyes.js";
import { LaserFX } from "./laser.js";
import { LaserAudio } from "./audio.js";

// Campo de visão aproximado da câmera frontal do iPhone no eixo maior.
const CAMERA_FOV_DEG = 68;
// Distância média entre as pupilas de um adulto (m) — usada para estimar a profundidade.
const IPD_METERS = 0.063;

const $ = (id) => document.getElementById(id);
const video = $("video");
const canvas = $("stage");
const ctx = canvas.getContext("2d", { alpha: false });
const statusEl = $("status");

const tracker = new FaceTracker();
const eyes = new EyeAnalyzer();
const laser = new LaserFX();
const audio = new LaserAudio();

let W = 0, H = 0, dpr = 1;
let lastVideoTime = -1;
let lastFrame = performance.now();
let analysis = null;
let showHud = false;
let fps = 0;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  laser.resize(W, H);
}
window.addEventListener("resize", resize);

// Mapeamento "cover" do vídeo para a tela (espelhado, como um espelho).
function videoLayout() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const sc = Math.max(W / vw, H / vh);
  const dw = vw * sc, dh = vh * sc;
  return { vw, vh, sc, dw, dh, ox: (W - dw) / 2, oy: (H - dh) / 2 };
}

async function start() {
  const btn = $("btnStart");
  btn.disabled = true;
  audio.start(); // dentro do toque, por causa do iOS

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Este navegador não permite acesso à câmera. Abra via HTTPS no Safari.");
    }
    statusEl.textContent = "Pedindo acesso à câmera…";
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    video.srcObject = stream;
    await video.play();

    statusEl.textContent = "Carregando detector de rosto…";
    await tracker.init();

    $("intro").hidden = true;
    $("controls").hidden = false;
    resize();
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      err.name === "NotAllowedError"
        ? "Permissão da câmera negada. Libere em Ajustes › Safari › Câmera."
        : `Erro: ${err.message || err}`;
    btn.disabled = false;
  }
}

function loop(now) {
  const dt = Math.max(0.001, (now - lastFrame) / 1000);
  lastFrame = now;
  fps = fps * 0.9 + (1 / dt) * 0.1;

  if (video.readyState >= 2 && video.videoWidth) {
    const L = videoLayout();

    // Só roda a detecção quando chega um frame novo da câmera.
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const face = tracker.detect(video, now);
      analysis = face ? eyes.update(face.landmarks, face.blendshapes, L.vw, L.vh) : null;
    }

    laser.update(dt, buildLaserInput(L));
    audio.update(laser.power.x, laser.impactLevel);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.translate(laser.shake.x, laser.shake.y);

    // Vídeo espelhado.
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, L.ox, L.oy, L.dw, L.dh);
    ctx.restore();

    laser.render(ctx);
    if (showHud) updateHud();
  }
  requestAnimationFrame(loop);
}

function buildLaserInput(L) {
  if (!analysis || !analysis.eye) return { active: false };
  const e = analysis.eye;
  const fVideo = (Math.max(L.vw, L.vh) / 2) / Math.tan(((CAMERA_FOV_DEG / 2) * Math.PI) / 180);
  const z0 = Math.min(1.5, Math.max(0.12, (fVideo * IPD_METERS) / Math.max(analysis.ipd, 1)));
  return {
    active: true,
    side: e.side,
    // Coordenadas de tela espelhadas.
    origin: { x: L.ox + (L.vw - e.origin.x) * L.sc, y: L.oy + e.origin.y * L.sc },
    dir: { x: -e.dir.x, y: e.dir.y, z: e.dir.z },
    eyeWidth: e.width * L.sc,
    cam: { f: fVideo * L.sc, cx: L.ox + L.dw / 2, cy: L.oy + L.dh / 2 },
    z0,
  };
}

function updateHud() {
  const c = analysis?.closure;
  // Na tela espelhada, o olho esquerdo da pessoa aparece à esquerda.
  const openL = c ? 1 - c.L : 0, openR = c ? 1 - c.R : 0;
  $("barL").style.width = `${openL * 100}%`;
  $("barR").style.width = `${openR * 100}%`;
  $("barL").style.background = openL > 0.5 ? "#4cd964" : "#ff3b30";
  $("barR").style.background = openR > 0.5 ? "#4cd964" : "#ff3b30";
  const st = !analysis ? "sem rosto" : analysis.state === "none" ? "aguardando piscadela" : `LASER (olho ${analysis.state === "L" ? "esq." : "dir."})`;
  $("hudState").textContent = st;
  $("hudFps").textContent = `${fps.toFixed(0)} fps`;
}

$("btnStart").addEventListener("click", start);
$("btnSound").addEventListener("click", (ev) => {
  audio.enabled = !audio.enabled;
  audio.start();
  ev.currentTarget.textContent = audio.enabled ? "🔊" : "🔇";
});
$("btnDebug").addEventListener("click", () => {
  showHud = !showHud;
  $("hud").hidden = !showHud;
});
$("btnClear").addEventListener("click", () => laser.clearMarks());

// Pausa a câmera quando o app vai para segundo plano.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && video.srcObject) video.play().catch(() => {});
});

resize();
