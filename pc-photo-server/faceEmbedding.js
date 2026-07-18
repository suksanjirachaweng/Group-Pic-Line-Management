// Real (non-spike) face detect+embed pipeline for POST /embed-face — ported from the de-risk
// spike at pc-photo-server/spike-face-recognition/faceLib.js, which validated this exact SCRFD
// decode + ArcFace embedding approach on real production data (0.85 same-person vs 0.39
// different-person cosine similarity). Loads both ONNX models once at server startup, not
// per-request — w600k_r50.onnx alone takes ~700ms to load.
const path = require("path");
const ort = require("onnxruntime-node");
const sharp = require("sharp");

const MODELS_DIR = process.env.FACE_MODELS_DIR || path.join(__dirname, "models");
const INPUT_SIZE = 640;
const STRIDES = [8, 16, 32];
const SCORE_THRESHOLD = 0.5;

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

/** Minimal SCRFD anchor decode for det_10g's 2-anchor-per-location head — picks the single
 * highest-confidence detection across all 3 strides (this server only ever needs the best face in
 * a crop the caller has already narrowed down, not every face in a full crowd photo). */
function decodeBestDetection(outputs, session) {
  const outNames = session.outputNames;
  let best = null;

  STRIDES.forEach((stride, strideIdx) => {
    const scores = outputs[outNames[strideIdx]].data;
    const bboxes = outputs[outNames[3 + strideIdx]].data;
    const featSize = INPUT_SIZE / stride;
    const numAnchors = 2;

    for (let i = 0; i < featSize; i++) {
      for (let j = 0; j < featSize; j++) {
        for (let a = 0; a < numAnchors; a++) {
          const anchorIdx = (i * featSize + j) * numAnchors + a;
          const rawScore = scores[anchorIdx];
          const score = rawScore >= 0 && rawScore <= 1 ? rawScore : sigmoid(rawScore);
          if (!best || score > best.score) {
            const cx = (j + 0.5) * stride;
            const cy = (i + 0.5) * stride;
            const l = bboxes[anchorIdx * 4 + 0] * stride;
            const t = bboxes[anchorIdx * 4 + 1] * stride;
            const r = bboxes[anchorIdx * 4 + 2] * stride;
            const b = bboxes[anchorIdx * 4 + 3] * stride;
            best = { score, x1: cx - l, y1: cy - t, x2: cx + r, y2: cy + b };
          }
        }
      }
    }
  });
  return best;
}

async function imageToTensor(buf, size) {
  const { data, info } = await sharp(buf)
    .resize(size, size, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const chw = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let p = 0; p < plane; p++) {
    for (let c = 0; c < 3; c++) {
      chw[c * plane + p] = (data[p * info.channels + c] - 127.5) / 128.0;
    }
  }
  return new ort.Tensor("float32", chw, [1, 3, size, size]);
}

let detSessionPromise = null;
let embedSessionPromise = null;

// Retries on a failed load rather than caching the rejection forever — the background preload at
// startup can easily lose a race against the operator still finishing model setup, and without
// this a transient "models not there yet" failure would permanently break /embed-face until the
// whole process was restarted.
function getDetSession() {
  if (!detSessionPromise) {
    detSessionPromise = ort.InferenceSession.create(path.join(MODELS_DIR, "det_10g.onnx"));
    detSessionPromise.catch(() => {
      detSessionPromise = null;
    });
  }
  return detSessionPromise;
}
function getEmbedSession() {
  if (!embedSessionPromise) {
    embedSessionPromise = ort.InferenceSession.create(path.join(MODELS_DIR, "w600k_r50.onnx"));
    embedSessionPromise.catch(() => {
      embedSessionPromise = null;
    });
  }
  return embedSessionPromise;
}

/** Eagerly loads both models — call once at server startup so the first real request isn't slow
 * and so a missing/corrupt model file fails fast at boot, not on a random future request. */
async function preloadModels() {
  await Promise.all([getDetSession(), getEmbedSession()]);
}

/** Detects the best face in `buf` and returns its 512-d embedding, or null if no confident face
 * was found. Also returns the padded crop actually fed to the recognition model, so the caller
 * can save it as the profile's sourceCropUrl for visual confirmation later. */
async function detectAndEmbed(buf) {
  const meta = await sharp(buf).metadata();
  const detSession = await getDetSession();
  const detInput = await imageToTensor(buf, INPUT_SIZE);
  const detOutputs = await detSession.run({ [detSession.inputNames[0]]: detInput });
  const best = decodeBestDetection(detOutputs, detSession);
  if (!best || best.score < SCORE_THRESHOLD) return null;

  const scaleX = meta.width / INPUT_SIZE;
  const scaleY = meta.height / INPUT_SIZE;
  const box = {
    x1: Math.max(0, best.x1 * scaleX),
    y1: Math.max(0, best.y1 * scaleY),
    x2: Math.min(meta.width, best.x2 * scaleX),
    y2: Math.min(meta.height, best.y2 * scaleY),
  };
  const padX = (box.x2 - box.x1) * 0.15;
  const padY = (box.y2 - box.y1) * 0.15;
  const left = Math.max(0, Math.round(box.x1 - padX));
  const top = Math.max(0, Math.round(box.y1 - padY));
  const right = Math.min(meta.width, Math.round(box.x2 + padX));
  const bottom = Math.min(meta.height, Math.round(box.y2 + padY));

  const faceCropBuf = await sharp(buf)
    .extract({ left, top, width: right - left, height: bottom - top })
    .jpeg({ quality: 90 })
    .toBuffer();

  const embedSession = await getEmbedSession();
  const embedInput = await imageToTensor(faceCropBuf, 112);
  const embedOutputs = await embedSession.run({ [embedSession.inputNames[0]]: embedInput });
  const embedding = Array.from(embedOutputs[embedSession.outputNames[0]].data);

  return { embedding, score: best.score, faceCropBuf };
}

module.exports = { preloadModels, detectAndEmbed };
