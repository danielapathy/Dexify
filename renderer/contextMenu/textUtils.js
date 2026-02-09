export function splitBulletParts(text) {
  return String(text || "")
    .split("•")
    .map((p) => String(p || "").trim())
    .filter(Boolean);
}

export function isDownloadStatusPart(part) {
  const s = String(part || "").trim();
  if (!s) return false;
  if (/^downloaded$/i.test(s)) return true;
  if (/^\d+\s*\/\s*\d+\s+downloaded$/i.test(s)) return true;
  return false;
}
