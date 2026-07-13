// Self-hosted photo storage server — runs on the admin's own PC as an alternative to Vercel
// Blob. Reachability + HTTPS are handled by a Cloudflare Tunnel (cloudflared) pointed at this
// port; this process itself only ever listens on 127.0.0.1 and speaks plain HTTP.
//
// Auth model: the main Next.js app mints a short-lived HMAC-signed token (see
// src/lib/actions/pcPhotoStorage.ts) using a secret that's shared via UPLOAD_SECRET below and
// NEVER sent to the browser. This server re-derives the same signature and rejects anything that
// doesn't match or has expired. Viewing an uploaded photo (GET /photos/...) is unauthenticated,
// same as a Vercel Blob public URL — the filename's random suffix is what makes it unguessable.
require("dotenv/config");
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const PORT = Number(process.env.PORT || 8793);
const SECRET = process.env.UPLOAD_SECRET;
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, "storage");
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200MB — generous headroom over the ~20MB+ group photos this serves

if (!SECRET) {
  console.error("UPLOAD_SECRET is not set in .env — refusing to start (uploads would be unauthenticated).");
  process.exit(1);
}
if (!PUBLIC_BASE_URL) {
  console.error("PUBLIC_BASE_URL is not set in .env (e.g. https://grouppic.newsalon1999.com) — refusing to start.");
  process.exit(1);
}

fs.mkdirSync(STORAGE_DIR, { recursive: true });

const app = express();
app.disable("x-powered-by");

function verifyToken(token) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [expiryStr, signature] = parts;
  const expiry = Number(expiryStr);
  if (!expiry || Date.now() > expiry) return false;

  const expected = crypto.createHmac("sha256", SECRET).update(expiryStr).digest("hex");
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Resolves a relative path against STORAGE_DIR, rejecting anything that would escape it. */
function safeStoragePath(relativePath) {
  const resolved = path.resolve(STORAGE_DIR, relativePath);
  if (!resolved.startsWith(path.resolve(STORAGE_DIR) + path.sep)) {
    throw new Error("Path escapes storage directory");
  }
  return resolved;
}

app.post("/upload", (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!verifyToken(token)) {
    return res.status(401).json({ error: "unauthorized or expired token" });
  }

  const requestedPath = String(req.query.path || "");
  if (!requestedPath || requestedPath.includes("..") || path.isAbsolute(requestedPath)) {
    return res.status(400).json({ error: "invalid path" });
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > MAX_UPLOAD_BYTES) {
    return res.status(413).json({ error: "file too large" });
  }

  const dir = path.dirname(requestedPath);
  const ext = path.extname(requestedPath) || ".jpg";
  const base = path.basename(requestedPath, ext);
  const randomSuffix = crypto.randomBytes(8).toString("hex");
  const relativeFilePath = path.join(dir, `${base}-${randomSuffix}${ext}`);

  let destPath;
  try {
    destPath = safeStoragePath(relativeFilePath);
  } catch {
    return res.status(400).json({ error: "invalid path" });
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  let bytesWritten = 0;
  const writeStream = fs.createWriteStream(destPath);

  req.on("data", (chunk) => {
    bytesWritten += chunk.length;
    if (bytesWritten > MAX_UPLOAD_BYTES) {
      req.destroy();
      writeStream.destroy();
      fs.unlink(destPath, () => {});
      if (!res.headersSent) res.status(413).json({ error: "file too large" });
    }
  });
  req.on("error", () => {
    writeStream.destroy();
    if (!res.headersSent) res.status(500).json({ error: "upload failed" });
  });
  writeStream.on("error", () => {
    if (!res.headersSent) res.status(500).json({ error: "failed to save file" });
  });
  writeStream.on("finish", () => {
    const urlPath = relativeFilePath.split(path.sep).join("/");
    res.json({ url: `${PUBLIC_BASE_URL.replace(/\/+$/, "")}/photos/${urlPath}` });
  });

  req.pipe(writeStream);
});

app.use(
  "/photos",
  express.static(STORAGE_DIR, { maxAge: "365d", immutable: true, dotfiles: "deny", index: false }),
);

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Photo storage server listening on 127.0.0.1:${PORT}, serving from ${STORAGE_DIR}`);
});
