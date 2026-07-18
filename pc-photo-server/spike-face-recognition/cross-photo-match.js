// Real cross-photo accuracy test — explicitly scoped and confirmed by the user to exactly this
// plan: 3 real faculty crops from already-consented (via university registration) production
// group photos, at specific coordinates pulled from real GroupPhotoTag rows. Two crops are the
// same tagged person from two different event photos ("same person" case); one is a different
// tagged person from the same photo as the first ("different person" case, isolating identity as
// the only variable since photo/lighting/camera match).
const fs = require("fs");
const sharp = require("sharp");
const { detectAndEmbed, cosineSimilarity } = require("./faceLib");

// These group photos are extremely high-resolution (up to 15174px wide) with ~50-150 people
// spread across the frame — a small fixed crop window can miss the actual face entirely if the
// tagged (x,y) point isn't dead-center on it. 1400px gives the detector (already proven accurate
// on full, uncropped photos) enough surrounding context to reliably find the real face.
const CROP_SIZE = 1400;

async function fetchAndCrop(rawUrl, x, y) {
  // Vercel Blob URLs come out of the DB already percent-encoded; the self-hosted PC storage ones
  // come out with raw spaces/Thai characters. Try as-is first, fall back to encodeURI.
  let resp = await fetch(rawUrl);
  if (!resp.ok) resp = await fetch(encodeURI(rawUrl));
  if (!resp.ok) throw new Error(`fetch failed ${resp.status} for ${rawUrl}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const meta = await sharp(buf).metadata();
  const half = CROP_SIZE / 2;
  const left = Math.max(0, Math.min(meta.width - CROP_SIZE, Math.round(x - half)));
  const top = Math.max(0, Math.min(meta.height - CROP_SIZE, Math.round(y - half)));
  return sharp(buf)
    .extract({ left, top, width: Math.min(CROP_SIZE, meta.width), height: Math.min(CROP_SIZE, meta.height) })
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function labeledPanel(faceCropBuf, box, label) {
  const panelSize = 260;
  const resized = await sharp(faceCropBuf).resize(panelSize, panelSize, { fit: "cover" }).toBuffer();
  const labelSvg = `<svg width="${panelSize}" height="40">
    <rect width="${panelSize}" height="40" fill="black" opacity="0.7"/>
    <text x="8" y="26" font-size="16" fill="white" font-family="sans-serif">${label}</text>
  </svg>`;
  return sharp(resized)
    .composite([{ input: Buffer.from(labelSvg), top: panelSize - 40, left: 0 }])
    .png()
    .toBuffer();
}

async function main() {
  const plan = JSON.parse(fs.readFileSync("/tmp/face-test-plan.json", "utf8"));

  console.log("Fetching + cropping 3 real tagged faculty photos from production...");
  const rawA = await fetchAndCrop(plan.samePerson.a.groupPhoto.imageUrl, plan.samePerson.a.x, plan.samePerson.a.y);
  const rawB = await fetchAndCrop(plan.samePerson.b.groupPhoto.imageUrl, plan.samePerson.b.x, plan.samePerson.b.y);
  const rawC = await fetchAndCrop(plan.differentPerson.crop.groupPhoto.imageUrl, plan.differentPerson.crop.x, plan.differentPerson.crop.y);

  console.log("Running detect+embed on each crop...");
  const resA = await detectAndEmbed(rawA);
  const resB = await detectAndEmbed(rawB);
  const resC = await detectAndEmbed(rawC);
  console.log(`A (${plan.samePerson.name}, photo 1): det score=${resA.score.toFixed(3)}`);
  console.log(`B (${plan.samePerson.name}, photo 2): det score=${resB.score.toFixed(3)}`);
  console.log(`C (${plan.differentPerson.name}, photo 1): det score=${resC.score.toFixed(3)}`);

  const simSame = cosineSimilarity(resA.embedding, resB.embedding);
  const simDiff = cosineSimilarity(resA.embedding, resC.embedding);
  console.log(`\nCosine similarity — SAME person (A vs B): ${simSame.toFixed(4)}`);
  console.log(`Cosine similarity — DIFFERENT person (A vs C): ${simDiff.toFixed(4)}`);
  console.log(`Separation (same - different): ${(simSame - simDiff).toFixed(4)}`);

  const panelA = await labeledPanel(resA.faceCropBuf, resA.box, "A: person 1, photo 1");
  const panelB = await labeledPanel(resB.faceCropBuf, resB.box, "B: person 1, photo 2");
  const panelC = await labeledPanel(resC.faceCropBuf, resC.box, "C: person 2, photo 1");

  const panelSize = 260;
  const gap = 20;
  const width = panelSize * 3 + gap * 4;
  const height = panelSize + 140;

  const summarySvg = `<svg width="${width}" height="120">
    <rect width="${width}" height="120" fill="#111"/>
    <text x="20" y="30" font-size="18" fill="#0f0" font-family="sans-serif">A vs B (same person): cosine similarity = ${simSame.toFixed(4)}</text>
    <text x="20" y="60" font-size="18" fill="#f55" font-family="sans-serif">A vs C (different person): cosine similarity = ${simDiff.toFixed(4)}</text>
    <text x="20" y="90" font-size="16" fill="#ccc" font-family="sans-serif">Separation: ${(simSame - simDiff).toFixed(4)} ${simSame > simDiff ? "(model correctly ranks same-person higher)" : "(WARNING: did not separate correctly)"}</text>
  </svg>`;

  await sharp({ create: { width, height, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } })
    .composite([
      { input: panelA, top: 0, left: gap },
      { input: panelB, top: 0, left: gap * 2 + panelSize },
      { input: panelC, top: 0, left: gap * 3 + panelSize * 2 },
      { input: Buffer.from(summarySvg), top: panelSize + 10, left: 0 },
    ])
    .png()
    .toFile("cross-photo-match-result.png");

  console.log("\nSaved visualization: cross-photo-match-result.png");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exitCode = 1;
});
