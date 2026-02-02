import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { Deezer } from "../deemix-main/packages/deezer-sdk/dist/index.mjs";

function readJson(relPath) {
  const p = path.resolve(process.cwd(), relPath);
  return JSON.parse(fs.readFileSync(p, "utf8"));
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

function pickFirstSmarttracklist(appState) {
  const sections = Array.isArray(appState?.sections) ? appState.sections : [];
  for (const sec of sections) {
    const items = Array.isArray(sec?.items) ? sec.items : [];
    for (const item of items) {
      if (String(item?.type || "").toLowerCase() !== "smarttracklist") continue;
      const smartId = item?.data?.SMARTTRACKLIST_ID || item?.id;
      if (typeof smartId === "string" && smartId) return { section: sec?.title || "", item, smartId };
    }
  }
  return null;
}

function listSmarttracklistIds(appState) {
  const sections = Array.isArray(appState?.sections) ? appState.sections : [];
  const out = [];
  for (const sec of sections) {
    const items = Array.isArray(sec?.items) ? sec.items : [];
    for (const item of items) {
      if (String(item?.type || "").toLowerCase() !== "smarttracklist") continue;
      const smartId = item?.data?.SMARTTRACKLIST_ID || item?.id;
      if (typeof smartId === "string" && smartId) out.push({ section: sec?.title || "", smartId });
    }
  }
  return out;
}

function summarizeResult(res) {
  if (!res || typeof res !== "object") return { type: typeof res, keys: [] };
  const keys = Object.keys(res).slice(0, 40);

  const tracks =
    (Array.isArray(res?.data) && res.data) ||
    (Array.isArray(res?.SONGS) && res.SONGS) ||
    (Array.isArray(res?.songs) && res.songs) ||
    (Array.isArray(res?.results?.data) && res.results.data) ||
    null;

  const preview = [];
  if (Array.isArray(tracks)) {
    for (const t of tracks.slice(0, 3)) {
      preview.push({
        SNG_ID: t?.SNG_ID ?? t?.id,
        SNG_TITLE: t?.SNG_TITLE ?? t?.title,
        ART_NAME: t?.ART_NAME ?? t?.artist?.name,
        ALB_TITLE: t?.ALB_TITLE ?? t?.album?.title,
      });
    }
  }

  return { keys, tracksCount: Array.isArray(tracks) ? tracks.length : null, preview };
}

async function main() {
  const appState = readJson(".session/app_state.json");
  const args = process.argv.slice(2);
  const wantAll = args.includes("--all");
  const idArgIdx = args.indexOf("--id");
  const forcedId = idArgIdx >= 0 ? String(args[idArgIdx + 1] || "").trim() : "";

  const arl = String(process.env.DEEZER_ARL || "").trim() || readArlFromSessionCookies();
  if (!arl) {
    console.error("Missing Deezer ARL.");
    console.error("Set DEEZER_ARL or ensure .session/cookies.json contains an arl cookie.");
    process.exit(2);
  }

  const dz = new Deezer();
  const loggedIn = await dz.loginViaArl(arl);
  console.log("loginViaArl:", Boolean(loggedIn));
  if (!loggedIn) process.exit(3);

  const gw = dz.gw;
  if (!gw || typeof gw.api_call !== "function") {
    console.error("Missing dz.gw.api_call");
    process.exit(4);
  }

  const picked = forcedId
    ? { section: "(forced)", smartId: forcedId }
    : pickFirstSmarttracklist(appState);
  if (!picked) {
    console.error("No smarttracklist item found in .session/app_state.json");
    process.exit(1);
  }

  const list = wantAll ? listSmarttracklistIds(appState) : [picked];
  for (const { section, smartId } of list) {
    console.log("\nSMARTTRACKLIST:", { section, smartId });
    try {
      const res = await gw.api_call("smartTracklist.getSongs", { SMARTTRACKLIST_ID: smartId, start: 0, nb: 50 });
      const summary = summarizeResult(res);
      console.log("smartTracklist.getSongs", {
        keys: summary.keys,
        count: res?.count ?? null,
        total: res?.total ?? null,
        tracksCount: summary.tracksCount,
        preview: summary.preview,
      });
    } catch (e) {
      console.log("smartTracklist.getSongs err", String(e?.message || e));
    }
  }
}

main().catch((e) => {
  console.error("fatal", e);
  process.exit(1);
});
