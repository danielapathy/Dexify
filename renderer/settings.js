export const DOWNLOAD_QUALITY_KEY = "spotify.downloadQuality";
export const NORMALIZE_AUDIO_KEY = "spotify.normalizeAudio";

export function getDownloadQualityRaw({ fallback = "mp3_128" } = {}) {
  try {
    return String(localStorage.getItem(DOWNLOAD_QUALITY_KEY) || fallback);
  } catch {
    return String(fallback);
  }
}

export function setDownloadQualityRaw(value) {
  try {
    localStorage.setItem(DOWNLOAD_QUALITY_KEY, String(value || ""));
    return true;
  } catch {
    return false;
  }
}

export function normalizeDownloadQuality(value) {
  const v = String(value || "").toLowerCase();
  if (v === "flac" || v === "mp3_320" || v === "mp3_128") return v;
  return "mp3_128";
}

export function clampDownloadQualityForCapabilities(value, capabilities) {
  const desired = normalizeDownloadQuality(value);
  const caps = capabilities && typeof capabilities === "object" ? capabilities : {};
  const canHQ = Boolean(caps?.can_stream_hq);
  const canLossless = Boolean(caps?.can_stream_lossless);
  if (desired === "flac" && !canLossless) return canHQ ? "mp3_320" : "mp3_128";
  if (desired === "mp3_320" && !canHQ) return "mp3_128";
  return desired;
}

export function getNormalizedDownloadQuality({ fallback = "mp3_128" } = {}) {
  return normalizeDownloadQuality(getDownloadQualityRaw({ fallback }));
}

export function getClampedDownloadQuality({ capabilities, fallback = "mp3_128" } = {}) {
  return clampDownloadQualityForCapabilities(getDownloadQualityRaw({ fallback }), capabilities);
}

export function getNormalizeAudioSetting({ fallback = false } = {}) {
  try {
    const raw = localStorage.getItem(NORMALIZE_AUDIO_KEY);
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    return Boolean(fallback);
  } catch {
    return Boolean(fallback);
  }
}

export function setNormalizeAudioSetting(enabled) {
  try {
    localStorage.setItem(NORMALIZE_AUDIO_KEY, enabled ? "true" : "false");
    return true;
  } catch {
    return false;
  }
}
