import { setDownloadQualityRaw } from "../settings.js";

export function bootstrapPlayerCapabilities({ getQualitySetting }) {
  setTimeout(() => {
    if (!window.dz?.getCapabilities) return;
    if (!window.__authHasARL) return;
    void window.dz
      .getCapabilities()
      .then((res) => {
        const caps = res?.ok && res?.capabilities && typeof res.capabilities === "object" ? res.capabilities : null;
        window.__dzCapabilities = {
          can_stream_hq: Boolean(caps?.can_stream_hq),
          can_stream_lossless: Boolean(caps?.can_stream_lossless),
        };
        setDownloadQualityRaw(getQualitySetting());
      })
      .catch(() => {
        window.__dzCapabilities = { can_stream_hq: false, can_stream_lossless: false };
        setDownloadQualityRaw(getQualitySetting());
      });
  }, 1200);
}
