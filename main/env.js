function readNonEmptyString(value) {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s : "";
}

function parseBooleanStrict(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function parseBooleanLoose(value) {
  const v = String(value || "").trim().toLowerCase();
  return v === "true" || v === "1";
}

function parsePort(value, fallback) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const int = Math.trunc(n);
  if (int < 0 || int > 65535) return fallback;
  return int;
}

function isDownloadDebugEnabled({ DEBUG_DOWNLOADS, NODE_ENV }) {
  const d = String(DEBUG_DOWNLOADS || "").trim();
  if (d === "true" || d === "1" || d === "verbose") return true;
  return String(NODE_ENV || "").trim() !== "production";
}

function readEnvFrom(source) {
  const MUSIC_APP_LOGIN_URL =
    readNonEmptyString(source?.MUSIC_APP_LOGIN_URL) || "https://account.deezer.com/en/login/";

  const NODE_ENV = readNonEmptyString(source?.NODE_ENV) || "";
  const DEBUG_DOWNLOADS = readNonEmptyString(source?.DEBUG_DOWNLOADS) || "";

  return {
    AUTO_OPEN_DEVTOOLS: parseBooleanStrict(source?.AUTO_OPEN_DEVTOOLS),
    SESSION_DIR: readNonEmptyString(source?.SESSION_DIR) || null,
    MUSIC_APP_LOGIN_URL,

    SESSION_WEBHOOK_PORT: parsePort(source?.SESSION_WEBHOOK_PORT, 3210),
    SESSION_WEBHOOK_TOKEN: readNonEmptyString(source?.SESSION_WEBHOOK_TOKEN) || "",
    SESSION_WEBHOOK_EXPOSE_ARL: parseBooleanStrict(source?.SESSION_WEBHOOK_EXPOSE_ARL),
    SESSION_WEBHOOK_EXPOSE_COOKIES: parseBooleanStrict(source?.SESSION_WEBHOOK_EXPOSE_COOKIES),

    NODE_ENV,
    DEBUG_DOWNLOADS,
    DEBUG_DOWNLOADS_ENABLED: isDownloadDebugEnabled({ DEBUG_DOWNLOADS, NODE_ENV }),

    CHROME_EXTENSIONS: readNonEmptyString(source?.CHROME_EXTENSIONS) || "",
    KEYPASS_EXTENSION_DIR: readNonEmptyString(source?.KEYPASS_EXTENSION_DIR) || "",
    KEEPASSXC_EXTENSION_DIR: readNonEmptyString(source?.KEEPASSXC_EXTENSION_DIR) || "",

    // Debug/automation (opt-in)
    DEXIFY_UI_DEBUG: parseBooleanLoose(source?.DEXIFY_UI_DEBUG),
  };
}

const env = readEnvFrom(process.env);

module.exports = {
  env,
  readEnvFrom,
  parseBooleanStrict,
  parseBooleanLoose,
  parsePort,
};
