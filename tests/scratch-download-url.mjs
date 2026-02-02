import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { Deezer } from "../deemix-main/packages/deezer-sdk/dist/index.mjs";
import { DEFAULT_SETTINGS, Downloader, generateDownloadObject } from "../vendor/dist/deemix-lite-entry.mjs";

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8"));
}

function readText(relPath) {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");
}

function readArlFromSessionCookies() {
  try {
    const cookies = readJson(".session/cookies.json");
    if (!Array.isArray(cookies)) return "";
    const arl = cookies.find((c) => String(c?.name || "").toLowerCase() === "arl")?.value;
    return typeof arl === "string" ? arl.trim() : "";
  } catch {
    return "";
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listAudioFiles(rootDir) {
  const exts = new Set([".mp3", ".flac", ".m4a", ".mp4", ".ogg", ".wav"]);
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = path.extname(ent.name).toLowerCase();
      if (!exts.has(ext)) continue;
      out.push(full);
    }
  };
  walk(rootDir);
  return out;
}

function normalizeDownloadedFilePath(maybePath, baseDir, allowedRootDir) {
  try {
    const raw = String(maybePath || "");
    if (!raw) return null;
    const absolute = path.isAbsolute(raw) ? raw : path.join(String(baseDir || ""), raw);

    const root = path.resolve(String(allowedRootDir || ""));
    const full = path.resolve(absolute);
    if (full !== root && !full.startsWith(root + path.sep)) return null;
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
    return full;
  } catch {
    return null;
  }
}

function qualityToBitrate(quality) {
  const q = String(quality || "mp3_128").toLowerCase();
  return q === "flac" ? 9 : q === "mp3_320" ? 3 : 1;
}

function inferUuidFromDeezerUrl(url, bitrate) {
  const u = String(url || "").trim();
  const m = u.match(/deezer\.com\/(track|album|playlist)\/(\d+)/i);
  if (!m) return `test_url_${Date.now()}`;
  return `test_url_${String(m[1]).toLowerCase()}_${String(m[2])}_${Number(bitrate) || 0}`;
}

function extractTargetsFromAppStateText(appStateText, type) {
  const re = new RegExp(`"target"\\s*:\\s*"\\/${type}\\/(\\d+)`, "g");
  const ids = [];
  let m;
  while ((m = re.exec(appStateText))) ids.push(String(m[1]));
  return Array.from(new Set(ids));
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function pickSmallAlbumUrl({ maxTracks }) {
  const appStateText = readText(".session/app_state.json");
  const ids = extractTargetsFromAppStateText(appStateText, "album").slice(0, 40);
  if (ids.length === 0) return "";

  for (const id of ids) {
    try {
      const meta = await fetchJson(`https://api.deezer.com/album/${id}`);
      const nb = Number(meta?.nb_tracks);
      if (Number.isFinite(nb) && nb > 0 && nb <= maxTracks) return `https://www.deezer.com/album/${id}`;
    } catch {}
  }
  return `https://www.deezer.com/album/${ids[0]}`;
}

async function main() {
  const args = process.argv.slice(2);
  const urlIdx = args.indexOf("--url");
  const qualityIdx = args.indexOf("--quality");
  const maxTracksIdx = args.indexOf("--max-tracks");

  const urlArg = urlIdx >= 0 ? String(args[urlIdx + 1] || "") : "";
  const quality = qualityIdx >= 0 ? String(args[qualityIdx + 1] || "") : String(process.env.QUALITY || "mp3_128");
  const bitrate = qualityToBitrate(quality);
  const maxTracks = maxTracksIdx >= 0 ? Number(args[maxTracksIdx + 1]) : Number(process.env.MAX_TRACKS || 3);

  const url = urlArg.trim() || (await pickSmallAlbumUrl({ maxTracks: Number.isFinite(maxTracks) ? maxTracks : 3 }));
  if (!url) {
    console.error("No --url provided and couldn't find an album target in .session/app_state.json");
    process.exit(2);
  }

  const arl = String(process.env.DEEZER_ARL || "").trim() || readArlFromSessionCookies();
  if (!arl) {
    console.error("Missing Deezer ARL.");
    process.exit(3);
  }

  const dz = new Deezer();
  const ok = await dz.loginViaArl(arl);
  console.log("loginViaArl:", Boolean(ok));
  if (!ok) process.exit(4);

  const downloadRoot = path.resolve(process.cwd(), ".session", "downloads");
  ensureDir(downloadRoot);

  const uuid = inferUuidFromDeezerUrl(url, bitrate);
  const downloadDir = path.join(downloadRoot, uuid);
  ensureDir(downloadDir);

  const settings = { ...DEFAULT_SETTINGS, downloadLocation: downloadDir + path.sep, maxBitrate: bitrate };

  const capturedPaths = new Set();
  const listener = {
    send: (eventName, data) => {
      const maybePath = data && typeof data === "object" ? data.downloadPath : null;
      if (typeof maybePath === "string" && maybePath) capturedPaths.add(maybePath);
      if (eventName === "updateQueue" && (data?.downloaded || data?.alreadyDownloaded || data?.downloadPath)) {
        console.log("[event]", eventName, {
          downloaded: data?.downloaded,
          alreadyDownloaded: data?.alreadyDownloaded,
          downloadPath: data?.downloadPath,
        });
      }
    },
  };

  console.log("url:", url);
  console.log("uuid:", uuid);
  console.log("downloadDir:", downloadDir);

  const objOrObjs = await generateDownloadObject(dz, url, bitrate, {}, listener);
  const objects = Array.isArray(objOrObjs) ? objOrObjs : [objOrObjs];
  if (!objects[0] || typeof objects[0] !== "object") {
    console.error("generateDownloadObject returned no objects");
    process.exit(5);
  }

  for (const obj of objects) {
    if (obj && typeof obj === "object" && !obj.uuid) obj.uuid = uuid;
    const downloader = new Downloader(dz, obj, settings, listener);
    await downloader.start();
  }

  for (const obj of objects) {
    if (!obj?.files || !Array.isArray(obj.files)) continue;
    for (const f of obj.files) {
      if (!f?.path) continue;
      const p = String(f.path);
      if (p) capturedPaths.add(p);
    }
  }

  const resolved = [];
  for (const p of capturedPaths) {
    const full = normalizeDownloadedFilePath(p, downloadDir, downloadRoot);
    if (full) resolved.push(full);
  }
  for (const p of listAudioFiles(downloadDir)) resolved.push(p);

  const unique = Array.from(new Set(resolved));
  console.log("capturedPaths:", capturedPaths.size);
  console.log("resolvedPaths:", unique.length);
  console.log("filesInDir:", listAudioFiles(downloadDir).length);
  console.log("firstResolved:", unique[0] || null);

  if (unique.length === 0) process.exit(6);
}

main().catch((e) => {
  console.error("fatal", String(e?.message || e));
  process.exit(1);
});

