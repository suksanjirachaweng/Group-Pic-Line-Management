// Shared detect+embed helpers, extracted from detect-and-embed.js so cross-photo-match.js can
// reuse the same (already visually verified) SCRFD decode logic.
const ort = require("onnxruntime-node");
const sharp = require("sharp");

const INPUT_SIZE = 640;
const STRIDES = [8, 16, 32];

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function decodeBestDetection(outputs, session) {
  const outNames = session.outputNames;
  let best = null;

  STRIDES.forEach((stride, strideIdx) => {
    const scoreName = outNames[strideIdx];
    const bboxName = outNames[3 + strideIdx];
    const scores = outputs[scoreName].data;
    const bboxes = outputs[bboxName].data;
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

let detSessionPromise, embedSessionPromise;
function getDetSession() {
  if (!detSessionPromise) detSessionPromise = ort.InferenceSession.create("models/det_10g.onnx");
  return detSessionPromise;
}
function getEmbedSession() {
  if (!embedSessionPromise) embedSessionPromise = ort.InferenceSession.create("models/w600k_r50.onnx");
  return embedSessionPromise;
}

/** Detects the best face in `buf`, crops+pads it, returns { faceCropBuf, box, score, embedding }. */
async function detectAndEmbed(buf) {
  const meta = await sharp(buf).metadata();
  const detSession = await getDetSession();
  const detInput = await imageToTensor(buf, INPUT_SIZE);
  const detOutputs = await detSession.run({ [detSession.inputNames[0]]: detInput });
  const best = decodeBestDetection(detOutputs, detSession);
  if (!best) throw new Error("No face detected");

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
    .toBuffer();

  const embedSession = await getEmbedSession();
  const embedInput = await imageToTensor(faceCropBuf, 112);
  const embedOutputs = await embedSession.run({ [embedSession.inputNames[0]]: embedInput });
  const embedding = Float32Array.from(embedOutputs[embedSession.outputNames[0]].data);

  return { faceCropBuf, box: { left, top, right, bottom }, score: best.score, embedding, meta };
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

module.exports = { detectAndEmbed, cosineSimilarity };
