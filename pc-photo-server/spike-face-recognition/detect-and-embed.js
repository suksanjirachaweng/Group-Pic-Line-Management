// Extends the pure-noise smoke test to real image content, but scoped to ONLY the user's own,
// explicitly-consented solo photo (1.jpg). Deliberately does NOT run detection across the group
// photo (2.jpg.jpg) — that would mean generating face embeddings for several other real,
// non-consenting people present at what looks like a private gathering, which is outside this
// feature's actual consent context (university registrants). See conversation for the full
// reasoning; this script only proves the real-image detect->crop->embed pipeline technically works.
const ort = require("onnxruntime-node");
const sharp = require("sharp");

const INPUT_SIZE = 640;
const STRIDES = [8, 16, 32];
const SCORE_THRESHOLD = 0.5;

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

/** Minimal SCRFD anchor decode for det_10g's 2-anchor-per-location head — picks the single
 * highest-confidence detection across all 3 strides (enough to validate the pipeline; not a full
 * NMS since we only need the best face, not every face). */
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
            best = { score, x1: cx - l, y1: cy - t, x2: cx + r, y2: cy + b, stride };
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
  // HWC uint8 -> CHW float32, mean-subtracted per standard InsightFace preprocessing (BGR order
  // isn't critical for this smoke-level check; using RGB order consistently for both models).
  const chw = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let p = 0; p < plane; p++) {
    for (let c = 0; c < 3; c++) {
      chw[c * plane + p] = (data[p * info.channels + c] - 127.5) / 128.0;
    }
  }
  return new ort.Tensor("float32", chw, [1, 3, size, size]);
}

async function main() {
  const photoBuf = require("fs").readFileSync("1.jpg");
  const meta = await sharp(photoBuf).metadata();
  console.log(`1.jpg: ${meta.width}x${meta.height}`);

  const detSession = await ort.InferenceSession.create("models/det_10g.onnx");
  const detInput = await imageToTensor(photoBuf, INPUT_SIZE);
  const detStart = Date.now();
  const detOutputs = await detSession.run({ [detSession.inputNames[0]]: detInput });
  console.log(`det_10g inference: ${Date.now() - detStart}ms`);

  const best = decodeBestDetection(detOutputs, detSession);
  if (!best || best.score < SCORE_THRESHOLD) {
    console.log("No confident face detected. Best candidate:", best);
    return;
  }
  const scaleX = meta.width / INPUT_SIZE;
  const scaleY = meta.height / INPUT_SIZE;
  const box = {
    x1: Math.max(0, best.x1 * scaleX),
    y1: Math.max(0, best.y1 * scaleY),
    x2: Math.min(meta.width, best.x2 * scaleX),
    y2: Math.min(meta.height, best.y2 * scaleY),
  };
  console.log(`Face detected: score=${best.score.toFixed(3)} box=`, box);

  // Pad the box a bit (bbox regression tends to be tight) then crop+resize to the recognition
  // model's fixed 112x112 input — a plain crop, not full 5-point landmark alignment, which is
  // enough to validate "does a real detected face produce a real embedding."
  const padX = (box.x2 - box.x1) * 0.15;
  const padY = (box.y2 - box.y1) * 0.15;
  const left = Math.max(0, Math.round(box.x1 - padX));
  const top = Math.max(0, Math.round(box.y1 - padY));
  const right = Math.min(meta.width, Math.round(box.x2 + padX));
  const bottom = Math.min(meta.height, Math.round(box.y2 + padY));

  const faceCropBuf = await sharp(photoBuf)
    .extract({ left, top, width: right - left, height: bottom - top })
    .toBuffer();

  // Visual sanity check — draws the padded crop box (the region actually fed to the recognition
  // model) onto a copy of the original photo via an SVG overlay, saved as a new file.
  const strokeWidth = Math.max(4, Math.round(meta.width / 500));
  const boxSvg = `<svg width="${meta.width}" height="${meta.height}">
    <rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}"
      fill="none" stroke="#00ff00" stroke-width="${strokeWidth}" />
  </svg>`;
  await sharp(photoBuf)
    .composite([{ input: Buffer.from(boxSvg), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toFile("1-detected.jpg");
  console.log("Saved visualization: 1-detected.jpg");

  const embedSession = await ort.InferenceSession.create("models/w600k_r50.onnx");
  const embedInput = await imageToTensor(faceCropBuf, 112);
  const embedStart = Date.now();
  const embedOutputs = await embedSession.run({ [embedSession.inputNames[0]]: embedInput });
  console.log(`w600k_r50 inference: ${Date.now() - embedStart}ms`);

  const embedding = embedOutputs[embedSession.outputNames[0]].data;
  const norm = Math.sqrt([...embedding].reduce((s, v) => s + v * v, 0));
  console.log(`Embedding: dims=${embedding.length} L2-norm=${norm.toFixed(3)} first5=[${[...embedding].slice(0, 5).map((v) => v.toFixed(3)).join(", ")}]`);
  console.log("\nResult: real detect->crop->embed pipeline ran successfully on a real photo of a real (consenting) face.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exitCode = 1;
});
