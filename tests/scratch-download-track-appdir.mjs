import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { Deezer } from "../deemix-main/packages/deezer-sdk/dist/index.mjs";
import { DEFAULT_SETTINGS, Downloader, generateDownloadObject } from "../vendor/dist/deemix-lite-entry.mjs";

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8"));
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
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (exts.has(path.extname(ent.name).toLowerCase())) out.push(full);
    }
  };
  walk(rootDir);
  return out;
}

function findMostRecentAudioFile(rootDir) {
  const files = listAudioFiles(rootDir);
  let best = null;
  for (const p of files) {
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (!best || st.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs };
  }
  return best?.path || null;
}

function resolvePathFromDeemixObject(obj, downloadLocation) {
  if (!obj || typeof obj !== "object") return null;
  const files = Array.isArray(obj.files) ? obj.files : [];
  if (files.length === 0) return null;
  const extrasPath = obj?.extrasPath ? String(obj.extrasPath) : "";

  const candidatePaths = [];
  for (const f of files) {
    const p = f?.path ? String(f.path) : "";
    if (p) {
      candidatePaths.push(p);
      if (downloadLocation && !path.isAbsolute(p)) candidatePaths.push(path.join(downloadLocation, p));
    }
    const filename = f?.filename ? String(f.filename) : "";
    if (filename && extrasPath) candidatePaths.push(path.join(extrasPath, filename));
    if (filename && downloadLocation) candidatePaths.push(path.join(downloadLocation, filename));
  }

  for (const p of candidatePaths) {
    try {
      if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {}
  }
  return null;
}

function qualityToBitrate(quality) {
  const q = String(quality || "mp3_128").toLowerCase();
  return q === "flac" ? 9 : q === "mp3_320" ? 3 : 1;
}

async function runOnce({ dz, trackId, bitrate }) {
  const uuid = `track_${trackId}_${bitrate}`;
  const downloadRoot = path.resolve(process.cwd(), ".session", "downloads");
  const downloadDir = path.join(downloadRoot, uuid);
  ensureDir(downloadDir);

  const settings = { ...DEFAULT_SETTINGS, downloadLocation: downloadDir + path.sep, maxBitrate: bitrate };

  let downloadPath = null;
  const listener = {
    send: (eventName, data) => {
      const maybePath = data && typeof data === "object" ? data.downloadPath : null;
      if (!downloadPath && typeof maybePath === "string" && maybePath) downloadPath = maybePath;
      if (eventName === "updateQueue" && (data?.downloaded || data?.alreadyDownloaded || data?.downloadPath)) {
        console.log("[event]", eventName, {
          downloaded: data?.downloaded,
          alreadyDownloaded: data?.alreadyDownloaded,
          downloadPath: data?.downloadPath,
        });
      }
    },
  };

  const link = `https://www.deezer.com/track/${trackId}`;
  const obj = await generateDownloadObject(dz, link, bitrate, {}, listener);
  obj.uuid = uuid;

  const downloader = new Downloader(dz, obj, settings, listener);
  await downloader.start();

  const rawEventPath = downloadPath;

  if (!downloadPath) downloadPath = resolvePathFromDeemixObject(obj, downloadDir + path.sep);

  const normalize = (p) => {
    try {
      if (!p) return null;
      const s = String(p);
      return path.isAbsolute(s) ? s : path.join(downloadDir, s);
    } catch {
      return null;
    }
  };

  downloadPath = normalize(downloadPath);

  // Validate within downloadRoot (NOT just per-track dir) to catch "already downloaded" pointing elsewhere in session.
  if (downloadPath) {
    try {
      const root = path.resolve(downloadRoot);
      const full = path.resolve(downloadPath);
      if (full !== root && !full.startsWith(root + path.sep)) downloadPath = null;
    } catch {
      downloadPath = null;
    }
    try {
      if (!fs.existsSync(downloadPath) || !fs.statSync(downloadPath).isFile()) downloadPath = null;
    } catch {
      downloadPath = null;
    }
  }

  if (!downloadPath) downloadPath = findMostRecentAudioFile(downloadDir);

  return { uuid, downloadRoot, downloadDir, rawEventPath, resolvedPath: downloadPath, files: listAudioFiles(downloadDir) };
}

async function main() {
  const args = process.argv.slice(2);
  const idIdx = args.indexOf("--id");
  const qualityIdx = args.indexOf("--quality");
  const trackId = idIdx >= 0 ? Number(args[idIdx + 1]) : Number(process.env.TRACK_ID);
  if (!Number.isFinite(trackId) || trackId <= 0) {
    console.error("Pass --id <trackId>");
    process.exit(1);
  }
  const quality = qualityIdx >= 0 ? String(args[qualityIdx + 1]) : String(process.env.QUALITY || "mp3_128");
  const bitrate = qualityToBitrate(quality);

  const arl = String(process.env.DEEZER_ARL || "").trim() || readArlFromSessionCookies();
  if (!arl) {
    console.error("Missing Deezer ARL.");
    process.exit(2);
  }

  const dz = new Deezer();
  const ok = await dz.loginViaArl(arl);
  console.log("loginViaArl:", Boolean(ok));
  if (!ok) process.exit(3);

  console.log("\nFIRST RUN");
  const r1 = await runOnce({ dz, trackId, bitrate });
  console.log({
    uuid: r1.uuid,
    rawEventPath: r1.rawEventPath,
    resolvedPath: r1.resolvedPath,
    files: r1.files.length,
  });

  console.log("\nSECOND RUN (same folder; should be alreadyDownloaded or re-download)");
  const r2 = await runOnce({ dz, trackId, bitrate });
  console.log({
    uuid: r2.uuid,
    rawEventPath: r2.rawEventPath,
    resolvedPath: r2.resolvedPath,
    files: r2.files.length,
  });
}

main().catch((e) => {
  console.error("fatal", String(e?.message || e));
  process.exit(1);
});

