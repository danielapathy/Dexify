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

function findFirstTrackIdFromAppState() {
  try {
    const appState = readJson(".session/app_state.json");
    const sections = Array.isArray(appState?.sections) ? appState.sections : [];
    for (const sec of sections) {
      const items = Array.isArray(sec?.items) ? sec.items : [];
      for (const item of items) {
        const target = String(item?.target || "");
        const m = target.match(/\/track\/(\d+)/);
        if (m) return Number(m[1]);
      }
    }
  } catch {}
  return null;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listFilesRecursive(rootDir) {
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
      else out.push(full);
    }
  };
  walk(rootDir);
  return out;
}

function listAudioFiles(rootDir) {
  const exts = new Set([".mp3", ".flac", ".m4a", ".mp4", ".ogg", ".wav"]);
  return listFilesRecursive(rootDir).filter((p) => exts.has(path.extname(p).toLowerCase()));
}

function diffNewFiles(before, after) {
  const set = new Set(before);
  return after.filter((p) => !set.has(p));
}

function qualityToBitrate(quality) {
  const q = String(quality || "mp3_128").toLowerCase();
  return q === "flac" ? 9 : q === "mp3_320" ? 3 : 1;
}

async function main() {
  const args = process.argv.slice(2);
  const idIdx = args.indexOf("--id");
  const qualityIdx = args.indexOf("--quality");

  const trackId =
    (idIdx >= 0 ? Number(args[idIdx + 1]) : Number(process.env.TRACK_ID)) || findFirstTrackIdFromAppState();
  if (!Number.isFinite(trackId) || trackId <= 0) {
    console.error("Missing track id. Pass --id <trackId>.");
    process.exit(1);
  }

  const quality = (qualityIdx >= 0 ? String(args[qualityIdx + 1]) : String(process.env.QUALITY || "mp3_128")) || "mp3_128";
  const bitrate = qualityToBitrate(quality);

  const arl = String(process.env.DEEZER_ARL || "").trim() || readArlFromSessionCookies();
  if (!arl) {
    console.error("Missing Deezer ARL. Set DEEZER_ARL or ensure .session/cookies.json contains arl.");
    process.exit(2);
  }

  const dz = new Deezer();
  const loggedIn = await dz.loginViaArl(arl);
  console.log("loginViaArl:", Boolean(loggedIn));
  if (!loggedIn) process.exit(3);

  const uuid = `test_track_${trackId}_${bitrate}_${Date.now()}`;
  const downloadRoot = path.resolve(process.cwd(), ".session", "downloads-test", uuid);
  ensureDir(downloadRoot);

  const settings = {
    ...DEFAULT_SETTINGS,
    downloadLocation: downloadRoot + path.sep,
    maxBitrate: bitrate,
  };

  const link = `https://www.deezer.com/track/${trackId}`;
  console.log("download", { trackId, quality, bitrate, downloadRoot });

  const beforeAudio = listAudioFiles(downloadRoot);
  let lastDownloadPath = null;

  const listener = {
    send: (eventName, data) => {
      const maybe = data && typeof data === "object" ? data.downloadPath : null;
      if (typeof maybe === "string" && maybe) lastDownloadPath = maybe;
      if (eventName === "updateQueue" || eventName === "downloadFinished" || eventName === "downloadFailed") {
        console.log("[event]", eventName, {
          uuid: data?.uuid,
          downloaded: data?.downloaded,
          alreadyDownloaded: data?.alreadyDownloaded,
          downloadPath: data?.downloadPath,
          state: data?.state,
          err: data?.err,
          error: data?.error,
          message: data?.message,
        });
      }
    },
  };

  const obj = await generateDownloadObject(dz, link, bitrate, {}, listener);
  if (typeof obj !== "object" || !obj) throw new Error("generateDownloadObject returned null");
  obj.uuid = uuid;

  console.log("obj keys:", Object.keys(obj).slice(0, 40));
  console.log("obj.extrasPath:", obj.extrasPath || null);
  console.log("obj.files (first 3):", Array.isArray(obj.files) ? obj.files.slice(0, 3) : null);

  const downloader = new Downloader(dz, obj, settings, listener);
  await downloader.start();

  const afterAudio = listAudioFiles(downloadRoot);
  const newAudio = diffNewFiles(beforeAudio, afterAudio);
  console.log("lastDownloadPath (from events):", lastDownloadPath);
  console.log("audio files:", afterAudio.length);
  console.log("new audio files:", newAudio.length);
  console.log(newAudio.slice(0, 10));
}

main().catch((e) => {
  console.error("fatal", String(e?.message || e));
  process.exit(1);
});

