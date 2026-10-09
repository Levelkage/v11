// Wrapper do MediaPipe Face Landmarker (478 pontos do rosto + blendshapes).
import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export class FaceTracker {
  constructor() {
    this.landmarker = null;
    this.lastTs = -1;
  }

  async init() {
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options("GPU"));
    } catch (err) {
      // Alguns Safari/iOS antigos falham com o delegate de GPU.
      console.warn("GPU indisponível, usando CPU", err);
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options("CPU"));
    }
  }

  // Retorna { landmarks, blendshapes } ou null se nenhum rosto foi encontrado.
  detect(video, now) {
    if (!this.landmarker) return null;
    // O timestamp precisa ser estritamente crescente.
    const ts = Math.max(Math.round(now), this.lastTs + 1);
    this.lastTs = ts;
    const res = this.landmarker.detectForVideo(video, ts);
    if (!res.faceLandmarks || res.faceLandmarks.length === 0) return null;
    const blend = {};
    const cats = res.faceBlendshapes?.[0]?.categories;
    if (cats) for (const c of cats) blend[c.categoryName] = c.score;
    return { landmarks: res.faceLandmarks[0], blendshapes: cats ? blend : null };
  }
}
