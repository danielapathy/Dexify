const { app, safeStorage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

const { safeJsonParse } = require("./utils");
const { env } = require("./env");

function getSessionDir() {
  if (env.SESSION_DIR) return env.SESSION_DIR;
  if (app.isPackaged) return app.getPath("userData");

  // In development, prefer the project root (electron can be launched with cwd="/"
  // when started via LaunchServices). Use argv[1] when it points at the project.
  const looksLikeProjectRoot = (candidate) => {
    const p = typeof candidate === "string" ? candidate.trim() : "";
    if (!p) return null;
    const abs = path.resolve(p);
    try {
      return fs.existsSync(path.join(abs, "package.json")) ? abs : null;
    } catch {
      return null;
    }
  };

  const fromArgv = looksLikeProjectRoot(process.argv?.[1]);
  const fromCwd = looksLikeProjectRoot(process.cwd());
  const base = fromArgv || fromCwd;
  if (base) return path.join(base, ".session");

  // Last resort: writable per-user location.
  return path.join(app.getPath("userData"), "dev-session");
}

function getArlStoragePath() {
  return path.join(getSessionDir(), "arl.enc.json");
}

function getCookieStoragePath() {
  return path.join(getSessionDir(), "cookies.json");
}

function getAppStateStoragePath() {
  return path.join(getSessionDir(), "app_state.json");
}

function getAesKeyPath() {
  return path.join(app.getPath("userData"), "arl.key");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function getDownloadsDir() {
  const base = getSessionDir();
  return path.join(base, "downloads");
}

function getOrCreateAesKey() {
  try {
    const key = fs.readFileSync(getAesKeyPath());
    if (Buffer.isBuffer(key) && key.length === 32) return key;
  } catch {}

  const key = crypto.randomBytes(32);
  ensureDir(app.getPath("userData"));
  fs.writeFileSync(getAesKeyPath(), key, { mode: 0o600 });
  return key;
}

function encryptForDisk(plaintext) {
  if (safeStorage?.isEncryptionAvailable?.()) {
    const encrypted = safeStorage.encryptString(String(plaintext));
    return { v: 1, enc: "safeStorage", data: encrypted.toString("base64") };
  }

  const key = getOrCreateAesKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    enc: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: ciphertext.toString("base64"),
  };
}

function decryptFromDisk(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.enc === "safeStorage" && typeof payload.data === "string") {
    try {
      const buf = Buffer.from(payload.data, "base64");
      const plaintext = safeStorage.decryptString(buf);
      return typeof plaintext === "string" && plaintext ? plaintext : null;
    } catch {
      return null;
    }
  }

  if (
    payload.enc === "aes-256-gcm" &&
    typeof payload.iv === "string" &&
    typeof payload.tag === "string" &&
    typeof payload.data === "string"
  ) {
    try {
      const key = getOrCreateAesKey();
      const iv = Buffer.from(payload.iv, "base64");
      const tag = Buffer.from(payload.tag, "base64");
      const ciphertext = Buffer.from(payload.data, "base64");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      return plaintext ? plaintext : null;
    } catch {
      return null;
    }
  }

  return null;
}

function isValidArl(value) {
  if (typeof value !== "string") return false;
  return value.trim().length > 0;
}

function extractArlFromStoredCookies(cookies) {
  if (!Array.isArray(cookies)) return null;
  const cookie = cookies.find((c) => String(c?.name || "").toLowerCase() === "arl");
  const value = cookie?.value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function loadSession() {
  try {
    const raw = fs.readFileSync(getArlStoragePath(), "utf8");
    const parsed = safeJsonParse(raw);
    let arl = decryptFromDisk(parsed);

    let cookies = null;
    try {
      const cookiesRaw = fs.readFileSync(getCookieStoragePath(), "utf8");
      cookies = safeJsonParse(cookiesRaw);
    } catch {}

    if (!isValidArl(arl) && Array.isArray(cookies)) {
      const fromCookies = extractArlFromStoredCookies(cookies);
      if (isValidArl(fromCookies)) arl = fromCookies;
    }

    return { arl: arl || null, cookies };
  } catch {
    return { arl: null, cookies: null };
  }
}

function saveSession(next) {
  const arl = next.arl || null;
  if (!arl) throw new Error("Missing arl");
  const payload = JSON.stringify(encryptForDisk(arl), null, 2);
  ensureDir(getSessionDir());
  fs.writeFileSync(getArlStoragePath(), payload, { encoding: "utf8", mode: 0o600 });

  if (next.cookies) {
    fs.writeFileSync(getCookieStoragePath(), JSON.stringify(next.cookies, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}

function clearSession() {
  try {
    fs.unlinkSync(getArlStoragePath());
  } catch {}
  try {
    fs.unlinkSync(getCookieStoragePath());
  } catch {}
  try {
    fs.unlinkSync(getAppStateStoragePath());
  } catch {}
}

module.exports = {
  getSessionDir,
  getArlStoragePath,
  getCookieStoragePath,
  getAppStateStoragePath,
  ensureDir,
  getDownloadsDir,
  encryptForDisk,
  decryptFromDisk,
  loadSession,
  saveSession,
  clearSession,
  isValidArl,
  extractArlFromStoredCookies,
};
