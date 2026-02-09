export function createPlayerAudioGraph({ audio } = {}) {
  const media = audio && typeof audio === "object" ? audio : null;

  let audioCtx = null;
  let audioSource = null;
  let audioGain = null;
  let audioCompressor = null;

  const ensureAudioGraph = () => {
    if (!media) return false;
    if (audioCtx && audioSource && audioGain) return true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (typeof Ctx !== "function") return false;
    try {
      audioCtx = new Ctx();
      audioSource = audioCtx.createMediaElementSource(media);
      audioGain = audioCtx.createGain();
      audioGain.gain.value = 1;
      audioCompressor = audioCtx.createDynamicsCompressor();
      audioCompressor.threshold.value = -24;
      audioCompressor.knee.value = 18;
      audioCompressor.ratio.value = 4;
      audioCompressor.attack.value = 0.003;
      audioCompressor.release.value = 0.25;
      return true;
    } catch {
      audioCtx = null;
      audioSource = null;
      audioGain = null;
      audioCompressor = null;
      return false;
    }
  };

  const applyNormalizeRouting = async (enabled) => {
    if (!ensureAudioGraph()) return false;
    const normalizeEnabled = Boolean(enabled);
    try {
      await audioCtx.resume();
    } catch {}
    try {
      audioSource.disconnect();
    } catch {}
    try {
      audioCompressor.disconnect();
    } catch {}
    try {
      audioGain.disconnect();
    } catch {}

    try {
      if (normalizeEnabled) audioSource.connect(audioCompressor);
      if (normalizeEnabled) audioCompressor.connect(audioGain);
      else audioSource.connect(audioGain);
      audioGain.connect(audioCtx.destination);
      return true;
    } catch {
      return false;
    }
  };

  return {
    ensureAudioGraph,
    applyNormalizeRouting,
    getAudioCtx: () => audioCtx,
  };
}

