// Pure technical smoke test — no photos, real or otherwise. Proves onnxruntime-node can load
// these exact model files on this hardware and run inference, and measures raw forward-pass
// latency using random-noise tensors (latency is dominated by the matmul compute, so a real image
// wouldn't change the number — only real face-detection accuracy needs real photos, which this
// test deliberately skips per the user's decision).
const ort = require("onnxruntime-node");

function randomTensor(dims) {
  const size = dims.reduce((a, b) => a * b, 1);
  const data = Float32Array.from({ length: size }, () => Math.random());
  return new ort.Tensor("float32", data, dims);
}

async function timeRuns(session, feeds, label, runs = 5) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = Date.now();
    await session.run(feeds);
    times.push(Date.now() - start);
  }
  console.log(`${label}: runs=${JSON.stringify(times)}ms avg=${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)}ms`);
}

async function inspectAndRun(path, dims, label) {
  console.log(`\n--- ${label} (${path}) ---`);
  const loadStart = Date.now();
  const session = await ort.InferenceSession.create(path);
  console.log(`loaded in ${Date.now() - loadStart}ms`);
  console.log("inputNames:", session.inputNames);
  console.log("outputNames:", session.outputNames);

  const inputName = session.inputNames[0];
  const feeds = { [inputName]: randomTensor(dims) };
  const result = await session.run(feeds);
  for (const name of session.outputNames) {
    console.log(`output "${name}" dims:`, result[name].dims);
  }
  await timeRuns(session, feeds, label);
}

async function main() {
  // w600k_r50 (ArcFace recognition/embedding model) — standard fixed 112x112x3 input, NCHW.
  await inspectAndRun("models/w600k_r50.onnx", [1, 3, 112, 112], "w600k_r50 (embedding)");

  // det_10g (SCRFD detector) — commonly run at 640x640 for full-image detection.
  await inspectAndRun("models/det_10g.onnx", [1, 3, 640, 640], "det_10g (detector)");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exitCode = 1;
});
