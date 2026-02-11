export function createSettingsRouteRenderer({
  showView,
  setNavButtons,
  getDownloadQualityRaw,
  normalizeDownloadQuality,
  setDownloadQualityRaw,
  clampDownloadQualityForCapabilities,
  downloadQualityKey,
  getNormalizeAudioSetting,
  setNormalizeAudioSetting,
}) {
  let settingsWired = false;

  return async function renderSettingsRoute(route) {
    showView("settings", { scrollTop: route?.scrollTop });
    const statusEl = document.getElementById("settingsSessionStatus");
    const userEl = document.getElementById("settingsSessionUser");
    const dirEl = document.getElementById("settingsDownloadDir");
    const qualityEl = document.getElementById("settingsQuality");
    const normalizeEl = document.getElementById("settingsNormalizeAudio");

    const setStatus = (text) => {
      if (statusEl) statusEl.textContent = String(text || "");
    };
    const setUser = (text) => {
      if (userEl) userEl.textContent = String(text || "");
    };

    setStatus("Loading…");
    setUser("—");

    try {
      const st = await window.dz?.status?.();
      if (st?.deezerSdkLoggedIn) {
        setStatus("Logged in");
        setUser(String(st?.user?.name || "Deezer user"));
      } else {
        setStatus("Not logged in");
        setUser("—");
      }
    } catch {
      setStatus("Unknown");
    }

    if (qualityEl) {
      const saved = getDownloadQualityRaw({ fallback: "" });
      if (saved) qualityEl.value = saved;

      try {
        const res = await window.dz?.getCapabilities?.();
        const caps = res?.ok && res.capabilities && typeof res.capabilities === "object" ? res.capabilities : null;
        const canHQ = Boolean(caps?.can_stream_hq);
        const canLossless = Boolean(caps?.can_stream_lossless);

        const options = Array.from(qualityEl.querySelectorAll("option"));
        for (const opt of options) {
          const v = normalizeDownloadQuality(opt.value);
          const disabled = (v === "mp3_320" && !canHQ) || (v === "flac" && !canLossless);
          opt.disabled = disabled;
        }

        const desired = normalizeDownloadQuality(qualityEl.value);
        const effective = clampDownloadQualityForCapabilities(desired, caps);
        if (desired !== effective) {
          qualityEl.value = effective;
          setDownloadQualityRaw(effective);
        }
      } catch {}
    }

    if (dirEl) {
      dirEl.textContent = ".session/downloads";
    }

    if (normalizeEl) {
      const enabled = Boolean(getNormalizeAudioSetting?.({ fallback: false }));
      normalizeEl.dataset.on = enabled ? "true" : "false";
      normalizeEl.setAttribute("aria-pressed", enabled ? "true" : "false");
    }

    if (!settingsWired) {
      settingsWired = true;
      const openDirBtn = document.getElementById("settingsOpenSessionDir");
      openDirBtn?.addEventListener?.("click", () => void window.app?.openSessionDir?.());

      const refreshBtn = document.getElementById("settingsRefreshAppState");
      refreshBtn?.addEventListener?.("click", async () => {
        await window.deezer?.extractAppState?.();
      });

      const logoutBtn = document.getElementById("settingsLogout");
      logoutBtn?.addEventListener?.("click", () => void window.auth?.logout?.());

      qualityEl?.addEventListener?.("change", () => {
        setDownloadQualityRaw(qualityEl.value);
      });

      normalizeEl?.addEventListener?.("click", (event) => {
        event.preventDefault();
        const cur = Boolean(getNormalizeAudioSetting?.({ fallback: false }));
        const next = !cur;
        setNormalizeAudioSetting?.(next);
        normalizeEl.dataset.on = next ? "true" : "false";
        normalizeEl.setAttribute("aria-pressed", next ? "true" : "false");
      });
    }

    // Keep the constant referenced for parity with previous logic and local storage key expectations.
    void downloadQualityKey;
    setNavButtons();
  };
}
