import { normalizeTitle } from "./utils.js";

function getPictureMd5(item) {
  const linked = item?.image_linked_item;
  if (linked && typeof linked === "object" && typeof linked.md5 === "string" && linked.md5) return linked.md5;

  const pic0 = item?.pictures?.[0];
  if (pic0 && typeof pic0.md5 === "string" && pic0.md5) return pic0.md5;

  const data = item?.data;
  if (data && typeof data === "object") {
    if (typeof data.ALB_PICTURE === "string" && data.ALB_PICTURE) return data.ALB_PICTURE;
    if (typeof data.ART_PICTURE === "string" && data.ART_PICTURE) return data.ART_PICTURE;
    if (typeof data.PLAYLIST_PICTURE === "string" && data.PLAYLIST_PICTURE) return data.PLAYLIST_PICTURE;
  }
  return null;
}

function getPictureType(item) {
  const linked = item?.image_linked_item;
  if (linked && typeof linked === "object" && typeof linked.type === "string" && linked.type) return linked.type;

  const pic0 = item?.pictures?.[0];
  if (pic0 && typeof pic0.type === "string" && pic0.type) return pic0.type;

  const t = String(item?.type || item?.data?.type || "").toLowerCase();
  if (t === "channel") return "playlist";
  if (t === "artist" || t === "playlist") return t;
  if (t === "album" || t === "track") return "cover";
  return "cover";
}

export function buildDeezerImageUrl(item, { size = 500 } = {}) {
  const md5 = getPictureMd5(item);
  if (!md5) return "";
  const type = getPictureType(item);

  // Per user note: channel images come from image_linked_item.md5 and are playlist images.
  const safeSize = Number.isFinite(Number(size)) ? Math.max(56, Math.min(1024, Number(size))) : 500;

  if (type === "artist") {
    return `https://cdn-images.dzcdn.net/images/artist/${md5}/${safeSize}x${safeSize}-000000-80-0-0.jpg`;
  }
  if (type === "playlist") {
    return `https://cdn-images.dzcdn.net/images/playlist/${md5}/${safeSize}x${safeSize}-000000-80-0-0.jpg`;
  }
  return `https://cdn-images.dzcdn.net/images/cover/${md5}/${safeSize}x${safeSize}-000000-80-0-0.jpg`;
}

export function cleanTargetToPage(target) {
  const raw = String(target || "").trim();
  if (!raw) return "";
  let noHash = raw.split("#")[0];
  noHash = noHash.trim();

  // Support full URLs (common in GW targets).
  try {
    if (/^https?:\/\//i.test(noHash)) {
      const u = new URL(noHash);
      noHash = u.pathname || "";
    }
  } catch {}

  const noQuery = noHash.split("?")[0];
  const page = noQuery.replace(/^\//, "");

  // Deezer often prefixes locale (e.g. /us/track/123). Strip it.
  const parts = page.split("/").filter(Boolean);
  if (parts.length >= 3 && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(parts[0])) {
    const next = String(parts[1] || "").toLowerCase();
    const known = new Set(["album", "artist", "playlist", "track", "channels", "smarttracklist"]);
    if (known.has(next)) parts.shift();
  }

  return parts.join("/");
}

export function parseTarget(target) {
  const page = cleanTargetToPage(target);
  if (!page) return null;

  const m = page.match(/^(album|artist|playlist|track)\/(\d+)$/i);
  if (m) return { kind: m[1].toLowerCase(), id: m[2], page };

  const sm = page.match(/^smarttracklist\/([a-z0-9_\-]+)$/i);
  if (sm) return { kind: "smarttracklist", id: sm[1], page };

  const ch = page.match(/^channels\/([a-z0-9_\-]+)$/i);
  if (ch) return { kind: "channel", id: ch[1], page };

  return { kind: "page", page };
}

export function isFlowSectionTitle(title) {
  return normalizeTitle(title).includes("play how you feel");
}
