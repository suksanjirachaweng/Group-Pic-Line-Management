// Self-hosted photo storage server — runs on the admin's own PC as an alternative to Vercel
// Blob. Reachability + HTTPS are handled by a Cloudflare Tunnel (cloudflared) pointed at this
// port; this process itself only ever listens on 127.0.0.1 and speaks plain HTTP.
//
// Auth model: the main Next.js app mints a short-lived HMAC-signed token (see
// src/lib/actions/pcPhotoStorage.ts / src/lib/pcPhotoServer.ts) using a secret that's shared via
// UPLOAD_SECRET below and NEVER sent to the browser for full-access tokens. This server re-derives
// the same signature and rejects anything that doesn't match or has expired. Viewing an uploaded
// photo (GET /photos/...) is unauthenticated, same as a Vercel Blob public URL — the filename's
// random suffix is what makes it unguessable.
//
// Two token shapes (see verifyToken below): the original 2-part full-access format (unchanged,
// used by embed-face/archive/group-photo callers), and a newer 3-part scoped+uploadOnly format
// added for the file-manager feature — the ONLY token shape ever handed directly to a browser
// (admin or anonymous share visitor), since it can only write into one path prefix and nothing
// else (not even list/delete/rename within that same folder).
require("dotenv/config");
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { preloadModels, detectAndEmbed } = require("./faceEmbedding");
const checkDiskSpace = require("check-disk-space").default;
const archiver = require("archiver");

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

// The main app's browser (running on the Vercel domain) uploads directly to this server, so this
// is a genuine cross-origin request — without CORS headers the browser blocks it before it ever
// reaches here (shows up client-side as an opaque "network error", not a 4xx/5xx). Wide open is
// fine: /upload is already gated by the HMAC token, and /photos is meant to be public anyway.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/** Boundary-aware prefix check — `scope="filemanager/foo"` must NOT match a request path of
 * `"filemanager/foo-evil/x"`, only `"filemanager/foo"` itself or anything under `"filemanager/foo/"`. */
function isWithinScope(requestedPath, scope) {
  const norm = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "");
  const r = norm(requestedPath);
  const s = norm(scope);
  return r === s || r.startsWith(s + "/");
}

function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Two token formats, both HMAC-signed with SECRET:
 * - Legacy 2-part `"<expiryMs>.<hexSig>"` — full access, no scope restriction, no upload-only
 *   restriction. Used by every caller that existed before the file-manager feature (embedFace,
 *   the archive close-out job, the group-photo uploader) — completely untouched by this change.
 * - New 3-part `"<expiryMs>.<claimsB64url>.<hexSig>"`, claims = `{scope?, uploadOnly?}` JSON.
 *   Only ever minted for the file-manager feature. Any token handed to a browser (admin OR
 *   anonymous share visitor) MUST be minted with `uploadOnly: true` and a matching `scope` — see
 *   mintPcPhotoServerToken's own doc comment on the Next.js side for why.
 *
 * Returns `{ ok, uploadOnly, scope }` — callers must check `uploadOnly` themselves for routes that
 * should never accept a browser-held token (everything except /upload).
 */
function verifyToken(token, requestedPath) {
  if (!token) return { ok: false };
  const parts = token.split(".");

  if (parts.length === 2) {
    const [expiryStr, signature] = parts;
    const expiry = Number(expiryStr);
    if (!expiry || Date.now() > expiry) return { ok: false };
    const expected = crypto.createHmac("sha256", SECRET).update(expiryStr).digest("hex");
    if (!timingSafeEqualStrings(signature, expected)) return { ok: false };
    return { ok: true, uploadOnly: false, scope: null };
  }

  if (parts.length === 3) {
    const [expiryStr, claimsB64, signature] = parts;
    const expiry = Number(expiryStr);
    if (!expiry || Date.now() > expiry) return { ok: false };
    const expected = crypto.createHmac("sha256", SECRET).update(`${expiryStr}.${claimsB64}`).digest("hex");
    if (!timingSafeEqualStrings(signature, expected)) return { ok: false };
    let claims;
    try {
      claims = JSON.parse(Buffer.from(claimsB64, "base64url").toString("utf8"));
    } catch {
      return { ok: false };
    }
    if (claims.scope && requestedPath != null && !isWithinScope(requestedPath, claims.scope)) {
      return { ok: false };
    }
    return { ok: true, uploadOnly: Boolean(claims.uploadOnly), scope: claims.scope ?? null };
  }

  return { ok: false };
}

/** Extracts the Bearer token and verifies it against `requestedPath` in one call — every route
 * should use this instead of hand-rolling the header extraction, so none can forget it. */
function authenticate(req, requestedPath) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return verifyToken(token, requestedPath);
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
  const requestedPath = String(req.query.path || "");
  if (!requestedPath || requestedPath.includes("..") || path.isAbsolute(requestedPath)) {
    return res.status(400).json({ error: "invalid path" });
  }

  // /upload is the one route that accepts BOTH full-access legacy tokens and scoped+uploadOnly
  // ones — every other route below explicitly rejects uploadOnly (see each route's own check).
  const auth = authenticate(req, requestedPath);
  if (!auth.ok) {
    return res.status(401).json({ error: "unauthorized or expired token" });
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > MAX_UPLOAD_BYTES) {
    return res.status(413).json({ error: "file too large" });
  }

  // Default behavior adds a random suffix (regular photo uploads want a unique filename every
  // time). ?exact=1 skips that and writes to the exact requested path, overwriting whatever's
  // already there — used by the main app's event-archive close-out, whose data.json manifest
  // references each image's path deterministically (by photo id) before the upload even happens,
  // so the actual stored file must land at that exact path or the reference breaks.
  const exact = req.query.exact === "1" || req.query.exact === "true";
  // ?failIfExists=1 — file-manager uploads want to KEEP the caller's real filename (unlike group
  // photos' random-suffix scheme), so a name collision is a real possibility. The caller
  // (Next.js) computes a collision-free name via a prior /fm/list call, but that check-then-write
  // has a TOCTOU race — this flag closes it for real by using an atomic exclusive-create ("wx")
  // write instead of silently overwriting, so two racing uploads to the same computed name fail
  // loudly (409) rather than one silently clobbering the other. Only meaningful combined with
  // `exact=1` (the caller already picked the exact final name); never used by the existing
  // group-photo/archive callers, who don't pass this flag.
  const failIfExists = req.query.failIfExists === "1" || req.query.failIfExists === "true";
  const dir = path.dirname(requestedPath);
  const ext = path.extname(requestedPath) || ".jpg";
  const base = path.basename(requestedPath, ext);
  const relativeFilePath = exact
    ? requestedPath
    : path.join(dir, `${base}-${crypto.randomBytes(8).toString("hex")}${ext}`);

  let destPath;
  try {
    destPath = safeStoragePath(relativeFilePath);
  } catch {
    return res.status(400).json({ error: "invalid path" });
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  let bytesWritten = 0;
  const writeStream = fs.createWriteStream(destPath, { flags: failIfExists ? "wx" : "w" });

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
  writeStream.on("error", (err) => {
    if (res.headersSent) return;
    if (err.code === "EEXIST") return res.status(409).json({ error: "already exists" });
    res.status(500).json({ error: "failed to save file" });
  });
  writeStream.on("finish", () => {
    const urlPath = relativeFilePath.split(path.sep).join("/");
    res.json({ url: `${PUBLIC_BASE_URL.replace(/\/+$/, "")}/photos/${urlPath}` });
  });

  req.pipe(writeStream);
});

// Permanently removes a whole path (typically an event's entire archives/<eventId> folder) — used
// by the main app's "ลบงานถาวร" button once an operator is sure a close-out backup is never
// coming back. Recursive + irreversible; the main app itself gates this behind a
// type-the-event-code confirmation before ever calling here.
app.delete("/files", async (req, res) => {
  const requestedPath = String(req.query.path || "");
  if (!requestedPath || requestedPath.includes("..") || path.isAbsolute(requestedPath)) {
    return res.status(400).json({ error: "invalid path" });
  }

  const auth = authenticate(req, requestedPath);
  if (!auth.ok || auth.uploadOnly) {
    return res.status(auth.ok ? 403 : 401).json({ error: auth.ok ? "forbidden" : "unauthorized or expired token" });
  }

  let targetPath;
  try {
    targetPath = safeStoragePath(requestedPath);
  } catch {
    return res.status(400).json({ error: "invalid path" });
  }
  // Refuse to nuke the whole storage root even if a caller somehow requested an empty/root-ish
  // path — safeStoragePath already rejects ".." and absolute paths, this is just a second guard.
  if (targetPath === path.resolve(STORAGE_DIR)) {
    return res.status(400).json({ error: "refusing to delete the storage root" });
  }

  try {
    await fs.promises.rm(targetPath, { recursive: true, force: true });
  } catch (err) {
    return res.status(500).json({ error: `failed to delete: ${err.message}` });
  }
  res.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// File manager (Phase 5) — a physically separate subtree from universities/,
// archives/, faces/ above. Every route below rejects uploadOnly tokens (only
// /upload accepts those) and is additionally restricted to the FM_ROOT
// prefix, so even a bug in one of these handlers can't reach into the
// group-photo/archive/face storage that already lives under STORAGE_DIR.
// ---------------------------------------------------------------------------
const FM_ROOT = "filemanager";

function isFmPath(requestedPath) {
  return requestedPath === FM_ROOT || requestedPath.startsWith(FM_ROOT + "/");
}

function fmAuthCheck(req, requestedPath) {
  if (!isFmPath(requestedPath)) return { ok: false, status: 400, error: "path must be under filemanager/" };
  const auth = authenticate(req, requestedPath);
  if (!auth.ok) return { ok: false, status: 401, error: "unauthorized or expired token" };
  if (auth.uploadOnly) return { ok: false, status: 403, error: "forbidden" };
  return { ok: true, auth };
}

app.get("/fm/list", async (req, res) => {
  const requestedPath = String(req.query.path || FM_ROOT);
  if (requestedPath.includes("..") || path.isAbsolute(requestedPath)) {
    return res.status(400).json({ error: "invalid path" });
  }
  const check = fmAuthCheck(req, requestedPath);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  let dirPath;
  try {
    dirPath = safeStoragePath(requestedPath);
  } catch {
    return res.status(400).json({ error: "invalid path" });
  }

  let dirents;
  try {
    dirents = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    // A not-yet-created folder (e.g. the very first visit, before anyone has uploaded anything)
    // is an empty listing, not an error.
    if (err.code === "ENOENT") return res.json({ entries: [] });
    return res.status(500).json({ error: `failed to list: ${err.message}` });
  }

  const entries = await Promise.all(
    dirents.map(async (d) => {
      const stat = await fs.promises.stat(path.join(dirPath, d.name)).catch(() => null);
      return {
        name: d.name,
        isDir: d.isDirectory(),
        size: stat ? stat.size : 0,
        mtimeMs: stat ? stat.mtimeMs : 0,
      };
    }),
  );
  res.json({ entries });
});

app.post("/fm/mkdir", express.json(), (req, res) => {
  const requestedPath = String((req.body && req.body.path) || "");
  if (!requestedPath || requestedPath.includes("..") || path.isAbsolute(requestedPath)) {
    return res.status(400).json({ error: "invalid path" });
  }
  const check = fmAuthCheck(req, requestedPath);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  let dirPath;
  try {
    dirPath = safeStoragePath(requestedPath);
  } catch {
    return res.status(400).json({ error: "invalid path" });
  }
  if (fs.existsSync(dirPath)) return res.status(409).json({ error: "already exists" });
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (err) {
    return res.status(500).json({ error: `failed to create folder: ${err.message}` });
  }
  res.json({ created: true });
});

app.post("/fm/rename", express.json(), (req, res) => {
  const requestedPath = String((req.body && req.body.path) || "");
  const newName = String((req.body && req.body.newName) || "");
  if (!requestedPath || requestedPath.includes("..") || path.isAbsolute(requestedPath)) {
    return res.status(400).json({ error: "invalid path" });
  }
  if (!newName || newName.includes("/") || newName.includes("\\") || newName.includes("..")) {
    return res.status(400).json({ error: "invalid new name" });
  }
  const check = fmAuthCheck(req, requestedPath);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  let srcPath, destPath;
  try {
    srcPath = safeStoragePath(requestedPath);
    destPath = safeStoragePath(path.join(path.dirname(requestedPath), newName));
  } catch {
    return res.status(400).json({ error: "invalid path" });
  }
  if (fs.existsSync(destPath)) return res.status(409).json({ error: "destination already exists" });
  try {
    fs.renameSync(srcPath, destPath);
  } catch (err) {
    return res.status(500).json({ error: `failed to rename: ${err.message}` });
  }
  res.json({ renamed: true });
});

app.post("/fm/move", express.json(), (req, res) => {
  const requestedPath = String((req.body && req.body.path) || "");
  const newParentPath = String((req.body && req.body.newParentPath) || "");
  if (!requestedPath || requestedPath.includes("..") || path.isAbsolute(requestedPath)) {
    return res.status(400).json({ error: "invalid path" });
  }
  if (!newParentPath || newParentPath.includes("..") || path.isAbsolute(newParentPath) || !isFmPath(newParentPath)) {
    return res.status(400).json({ error: "invalid destination" });
  }
  const check = fmAuthCheck(req, requestedPath);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  const basename = path.basename(requestedPath);
  let srcPath, destPath;
  try {
    srcPath = safeStoragePath(requestedPath);
    destPath = safeStoragePath(path.join(newParentPath, basename));
  } catch {
    return res.status(400).json({ error: "invalid path" });
  }
  if (fs.existsSync(destPath)) return res.status(409).json({ error: "destination already exists" });
  try {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.renameSync(srcPath, destPath);
  } catch (err) {
    return res.status(500).json({ error: `failed to move: ${err.message}` });
  }
  res.json({ moved: true });
});

app.get("/fm/disk-space", async (req, res) => {
  const check = fmAuthCheck(req, FM_ROOT);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  try {
    const info = await checkDiskSpace(path.resolve(STORAGE_DIR));
    res.json({ free: info.free, size: info.size });
  } catch (err) {
    res.status(500).json({ error: `failed to check disk space: ${err.message}` });
  }
});

// Multi-select "download as ZIP" (both the admin file manager and the public share page can ask
// for this) — only ever called server-to-server with a fresh full-access token minted by the
// Next.js app, which has already validated every path against the caller's own scope (a share
// link's folder, or nothing at all for the session-gated admin case). Files-only by design: no
// directory ever appears in `paths` here, since both callers resolve a listing first and only
// forward the individually-selected filenames — keeps this route from turning into an unbounded
// recursive archive of an entire subtree.
app.post("/fm/zip", express.json(), async (req, res) => {
  const paths = req.body && Array.isArray(req.body.paths) ? req.body.paths : null;
  if (!paths || paths.length === 0) return res.status(400).json({ error: "paths required" });
  for (const p of paths) {
    if (typeof p !== "string" || !p || p.includes("..") || path.isAbsolute(p)) {
      return res.status(400).json({ error: "invalid path" });
    }
  }
  const check = fmAuthCheck(req, FM_ROOT);
  if (!check.ok) return res.status(check.status).json({ error: check.error });

  let absPaths;
  try {
    absPaths = paths.map((p) => safeStoragePath(p));
  } catch {
    return res.status(400).json({ error: "invalid path" });
  }
  for (const abs of absPaths) {
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      return res.status(404).json({ error: "file not found" });
    }
    if (!stat.isFile()) return res.status(400).json({ error: "only files can be zipped" });
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="download.zip"');
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("error", (err) => {
    // Headers are likely already flushed by the time archiver hits a mid-stream error (reading a
    // file that got deleted between the stat check above and now) — just end the response rather
    // than trying to send a JSON error onto an already-started binary stream.
    res.end();
    console.error("zip stream error:", err);
  });
  archive.pipe(res);
  absPaths.forEach((abs, i) => archive.file(abs, { name: path.basename(paths[i]) }));
  archive.finalize();
});

const MAX_EMBED_BYTES = 10 * 1024 * 1024; // face crops sent for embedding are small, not full group photos

/** Buffers the raw request body up to `maxBytes`, rejecting (destroying the connection) if
 * exceeded — mirrors /upload's streaming size guard, just fully in-memory since this endpoint
 * needs the whole image for sharp/onnxruntime anyway. */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(Object.assign(new Error("payload too large"), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

app.post("/embed-face", async (req, res) => {
  const auth = authenticate(req, null);
  if (!auth.ok || auth.uploadOnly) {
    return res.status(auth.ok ? 403 : 401).json({ error: auth.ok ? "forbidden" : "unauthorized or expired token" });
  }

  let buf;
  try {
    buf = await readBody(req, MAX_EMBED_BYTES);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  let result;
  try {
    result = await detectAndEmbed(buf);
  } catch (err) {
    console.error("detectAndEmbed failed:", err);
    return res.status(500).json({ error: "face embedding failed" });
  }
  if (!result) {
    return res.status(422).json({ error: "no_face_detected" });
  }

  const relativeFilePath = path.join("faces", `${crypto.randomBytes(12).toString("hex")}.jpg`);
  const destPath = safeStoragePath(relativeFilePath);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, result.faceCropBuf);
  const cropUrl = `${PUBLIC_BASE_URL.replace(/\/+$/, "")}/photos/${relativeFilePath.split(path.sep).join("/")}`;

  res.json({ embedding: result.embedding, score: result.score, cropUrl });
});

app.use(
  "/photos",
  express.static(STORAGE_DIR, { maxAge: "365d", immutable: true, dotfiles: "deny", index: false }),
);

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Photo storage server listening on 127.0.0.1:${PORT}, serving from ${STORAGE_DIR}`);
});

// Face recognition (POST /embed-face) is an optional add-on — photo storage (/upload, /photos) is
// this server's primary job and must keep working even if the face models aren't set up yet, so
// this loads in the background rather than blocking startup. A request to /embed-face made before
// this finishes (or if models/ is missing entirely) just fails with a clear error, not a crash.
preloadModels()
  .then(() => console.log("Face recognition models loaded — /embed-face is ready."))
  .catch((err) => {
    console.warn(
      "Face recognition models failed to load (/embed-face will return errors until this is fixed):",
      err.message,
    );
  });
