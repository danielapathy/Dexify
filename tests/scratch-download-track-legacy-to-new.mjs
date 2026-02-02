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

function qualityToBitrate(quality) {
  const q = String(quality || "mp3_128").toLowerCase();
  return q === "flac" ? 9 : q === "mp3_320" ? 3 : 1;
}

async function downloadOnce({ dz, link, uuid, downloadLocation, bitrate }) {
  ensureDir(downloadLocation);
  const settings = { ...DEFAULT_SETTINGS, downloadLocation: downloadLocation + path.sep, maxBitrate: bitrate };

  let lastPath = null;
  const listener = {
    send: (eventName, data) => {
      const maybe = data && typeof data === "object" ? data.downloadPath : null;
      if (typeof maybe === "string" && maybe) lastPath = maybe;
      if (eventName === "updateQueue" && (data?.downloaded || data?.alreadyDownloaded || data?.downloadPath)) {
        console.log("[event]", eventName, {
          downloaded: data?.downloaded,
          alreadyDownloaded: data?.alreadyDownloaded,
          downloadPath: data?.downloadPath,
        });
      }
    },
  };

  const obj = await generateDownloadObject(dz, link, bitrate, {}, listener);
  obj.uuid = uuid;

  const before = listAudioFiles(downloadLocation);
  const downloader = new Downloader(dz, obj, settings, listener);
  await downloader.start();
  const after = listAudioFiles(downloadLocation);

  return { lastPath, beforeCount: before.length, afterCount: after.length };
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

  const downloadRoot = path.resolve(process.cwd(), ".session", "downloads");
  ensureDir(downloadRoot);

  const link = `https://www.deezer.com/track/${trackId}`;
  const legacyDir = path.join(downloadRoot, "legacy_seed");
  const newDir = path.join(downloadRoot, `track_${trackId}_${bitrate}`);

  console.log("\nLEGACY-STYLE DOWNLOAD (into downloads/legacy_seed)");
  const legacy = await downloadOnce({
    dz,
    link,
    uuid: `legacy_${trackId}_${bitrate}`,
    downloadLocation: legacyDir,
    bitrate,
  });
  console.log("legacy result:", legacy);

  console.log("\nNEW-STYLE DOWNLOAD (into per-track folder)");
  const modern = await downloadOnce({
    dz,
    link,
    uuid: `track_${trackId}_${bitrate}`,
    downloadLocation: newDir,
    bitrate,
  });
  console.log("new result:", modern);
}

main().catch((e) => {
  console.error("fatal", String(e?.message || e));
  process.exit(1);
});

