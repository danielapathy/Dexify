const fs = require("node:fs");
const http = require("node:http");

const { safeJsonParse } = require("./utils");
const { getAppStateStoragePath } = require("./sessionStorage");
const { env } = require("./env");
const { createUiBridge } = require("./debug/uiBridge");
const { summarizeDownloadedTracks, summarizeDownloadedPlaylists } = require("./debug/downloadsSummary");

function startSessionWebhook({ getSession, getMainWindow, uiDebugEnabled, getDownloadsDir, getDownloadDebugState }) {
  const port = env.SESSION_WEBHOOK_PORT;
  const token = env.SESSION_WEBHOOK_TOKEN;
  const exposeArl = env.SESSION_WEBHOOK_EXPOSE_ARL;
  const exposeCookies = env.SESSION_WEBHOOK_EXPOSE_COOKIES;

  const uiBridge = createUiBridge({
    getMainWindow,
    uiDebugEnabled: Boolean(uiDebugEnabled),
  });

  const requireToken = (req, res) => {
    if (!token) return true;
    const provided = String(req.headers["x-webhook-token"] || "");
    if (provided && provided === token) return true;
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "forbidden" }));
    return false;
  };

  const writeJson = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const readBodyJson = (req) => {
    const MAX = 256 * 1024;
    return new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > MAX) {
          reject(new Error("payload_too_large"));
          try {
            req.destroy();
          } catch {}
        }
      });
      req.on("end", () => {
        try {
          const parsed = raw ? safeJsonParse(raw) : null;
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", (e) => reject(e));
    });
  };

  const parsePositiveInt = (value, { min = 1, max = 2000 } = {}) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const v = Math.trunc(n);
    if (v < min) return null;
    if (v > max) return max;
    return v;
  };

  const server = http.createServer((req, res) => {
    try {
      if (!req.url) {
        writeJson(res, 400, { ok: false, error: "bad_request" });
        return;
      }

      const url = new URL(req.url, "http://127.0.0.1");

      if (url.pathname === "/health") {
        writeJson(res, 200, { ok: true });
        return;
      }

      if (url.pathname === "/session") {
        if (!requireToken(req, res)) return;
        const session = getSession();
        const body = {
          ok: true,
          hasARL: Boolean(session?.arl),
          hasCookies: Boolean(session?.cookies && session.cookies.length > 0),
          cookieCount: session?.cookies?.length || 0,
          ...(exposeArl ? { arl: session?.arl || null } : {}),
          ...(exposeCookies ? { cookies: session?.cookies || [] } : {}),
        };
        writeJson(res, 200, body);
        return;
      }

      if (url.pathname === "/app-state") {
        if (!requireToken(req, res)) return;
        try {
          const appStateRaw = fs.readFileSync(getAppStateStoragePath(), "utf8");
          const appState = safeJsonParse(appStateRaw);
          writeJson(res, 200, { ok: true, appState });
        } catch (error) {
          writeJson(res, 404, { ok: false, error: "not_found" });
        }
        return;
      }

      // UI debug endpoints (opt-in)
      if (url.pathname.startsWith("/ui/")) {
        if (!uiBridge.enabled) {
          writeJson(res, 404, { ok: false, error: "not_found" });
          return;
        }
        if (!requireToken(req, res)) return;

        if (url.pathname === "/ui/wait") {
          const timeoutMs = parsePositiveInt(url.searchParams.get("timeoutMs"), { min: 250, max: 120_000 }) || 25_000;
          void uiBridge
            .waitReady({ timeoutMs })
            .then((out) => writeJson(res, out?.ok ? 200 : 504, out))
            .catch((e) => writeJson(res, 500, { ok: false, error: "server_error", message: String(e?.message || e) }));
          return;
        }

        if (url.pathname === "/ui/snapshot/home") {
          const recentsLimit = parsePositiveInt(url.searchParams.get("recentsLimit"), { min: 0, max: 50 });
          const sectionsLimit = parsePositiveInt(url.searchParams.get("sectionsLimit"), { min: 0, max: 50 });
          const sectionItemsLimit = parsePositiveInt(url.searchParams.get("sectionItemsLimit"), { min: 0, max: 50 });
          void uiBridge
            .invokeRenderer("snapshotHome", {
              ...(recentsLimit !== null ? { recentsLimit } : {}),
              ...(sectionsLimit !== null ? { sectionsLimit } : {}),
              ...(sectionItemsLimit !== null ? { sectionItemsLimit } : {}),
            })
            .then((out) => writeJson(res, out?.ok === false ? 400 : 200, out))
            .catch((e) => writeJson(res, 500, { ok: false, error: "server_error", message: String(e?.message || e) }));
          return;
        }

        if (url.pathname === "/ui/snapshot/library") {
          const limit = parsePositiveInt(url.searchParams.get("limit"), { min: 0, max: 300 });
          void uiBridge
            .invokeRenderer("snapshotLibrary", { ...(limit !== null ? { limit } : {}) })
            .then((out) => writeJson(res, out?.ok === false ? 400 : 200, out))
            .catch((e) => writeJson(res, 500, { ok: false, error: "server_error", message: String(e?.message || e) }));
          return;
        }

        if (url.pathname === "/ui/snapshot/now-playing") {
          void uiBridge
            .invokeRenderer("snapshotNowPlaying", {})
            .then((out) => writeJson(res, out?.ok === false ? 400 : 200, out))
            .catch((e) => writeJson(res, 500, { ok: false, error: "server_error", message: String(e?.message || e) }));
          return;
        }

        if (url.pathname === "/ui/snapshot/page") {
          const tracksLimit = parsePositiveInt(url.searchParams.get("tracksLimit"), { min: 0, max: 400 });
          const actionsLimit = parsePositiveInt(url.searchParams.get("actionsLimit"), { min: 0, max: 50 });
          void uiBridge
            .invokeRenderer("snapshotPage", {
              ...(tracksLimit !== null ? { tracksLimit } : {}),
              ...(actionsLimit !== null ? { actionsLimit } : {}),
            })
            .then((out) => writeJson(res, out?.ok === false ? 400 : 200, out))
            .catch((e) => writeJson(res, 500, { ok: false, error: "server_error", message: String(e?.message || e) }));
          return;
        }

        if (url.pathname === "/ui/navigate") {
          if (String(req.method || "").toUpperCase() !== "POST") {
            writeJson(res, 405, { ok: false, error: "method_not_allowed" });
            return;
          }
          void readBodyJson(req)
            .then((body) => uiBridge.navigate(body && typeof body === "object" ? body : {}))
            .then((out) => writeJson(res, out?.ok === false ? 400 : 200, out))
            .catch((e) => {
              const msg = String(e?.message || e);
              writeJson(res, msg === "payload_too_large" ? 413 : 400, { ok: false, error: "bad_request", message: msg });
            });
          return;
        }

        if (url.pathname === "/ui/downloads/summary") {
          const downloadsDir = typeof getDownloadsDir === "function" ? getDownloadsDir() : null;
          const limitTracks = parsePositiveInt(url.searchParams.get("limitTracks"), { min: 0, max: 2_000 }) || 250;
          const limitAlbums = parsePositiveInt(url.searchParams.get("limitAlbums"), { min: 0, max: 500 }) || 80;
          const out = summarizeDownloadedTracks({ downloadsDir, limitTracks, limitAlbums });
          writeJson(res, out?.ok === false ? 400 : 200, out);
          return;
        }

        if (url.pathname === "/ui/downloads/playlists") {
          const downloadsDir = typeof getDownloadsDir === "function" ? getDownloadsDir() : null;
          const limit = parsePositiveInt(url.searchParams.get("limit"), { min: 0, max: 500 }) || 120;
          const out = summarizeDownloadedPlaylists({ downloadsDir, limit });
          writeJson(res, out?.ok === false ? 400 : 200, out);
          return;
        }

        if (url.pathname === "/ui/downloads/active") {
          const maxEvents = parsePositiveInt(url.searchParams.get("maxEvents"), { min: 0, max: 500 }) || 120;
          const debugState = typeof getDownloadDebugState === "function" ? getDownloadDebugState({ maxEvents }) : null;
          if (!debugState) {
            writeJson(res, 404, { ok: false, error: "not_available" });
            return;
          }
          writeJson(res, 200, debugState);
          return;
        }

        if (url.pathname === "/ui/snapshot/downloads-local") {
          const limitTracks = parsePositiveInt(url.searchParams.get("limitTracks"), { min: 0, max: 2_000 }) || 250;
          const limitPlaylists = parsePositiveInt(url.searchParams.get("limitPlaylists"), { min: 0, max: 500 }) || 120;
          void uiBridge
            .invokeRenderer("snapshotDownloadsLocal", { limitTracks, limitPlaylists })
            .then((out) => writeJson(res, out?.ok === false ? 400 : 200, out))
            .catch((e) => writeJson(res, 500, { ok: false, error: "server_error", message: String(e?.message || e) }));
          return;
        }

        if (url.pathname === "/ui/action/click") {
          if (String(req.method || "").toUpperCase() !== "POST") {
            writeJson(res, 405, { ok: false, error: "method_not_allowed" });
            return;
          }
          void readBodyJson(req)
            .then((body) => {
              const action = String(body?.action || "").trim();
              const tooltipContains = String(body?.tooltipContains || "").trim();
              const timeoutMs = Math.max(250, Math.min(120_000, Number(body?.timeoutMs) || 10_000));
              return uiBridge.invokeRenderer("clickEntityAction", { action, tooltipContains, timeoutMs });
            })
            .then((out) => writeJson(res, out?.ok === false ? 400 : 200, out))
            .catch((e) => {
              const msg = String(e?.message || e);
              writeJson(res, msg === "payload_too_large" ? 413 : 500, { ok: false, error: "server_error", message: msg });
            });
          return;
        }

        if (url.pathname === "/ui/action/download-playlist") {
          if (String(req.method || "").toUpperCase() !== "POST") {
            writeJson(res, 405, { ok: false, error: "method_not_allowed" });
            return;
          }
          void readBodyJson(req)
            .then((body) => {
              const title = String(body?.title || "My Boy").trim();
              const timeoutMs = Math.max(1_000, Math.min(120_000, Number(body?.timeoutMs) || 30_000));
              return uiBridge.invokeRenderer("downloadBottomPlaylistByTitle", { title, timeoutMs });
            })
            .then((out) => writeJson(res, out?.ok === false ? 400 : 200, out))
            .catch((e) => {
              const msg = String(e?.message || e);
              writeJson(res, msg === "payload_too_large" ? 413 : 500, { ok: false, error: "server_error", message: msg });
            });
          return;
        }

        if (url.pathname === "/ui/diagnose") {
          const expr = url.searchParams.get("expr") || "";
          if (!expr) {
            writeJson(res, 400, { ok: false, error: "missing_expr" });
            return;
          }
          void uiBridge
            .executeRaw(expr)
            .then((out) => writeJson(res, 200, out))
            .catch((e) => writeJson(res, 500, { ok: false, error: "server_error", message: String(e?.message || e) }));
          return;
        }

        writeJson(res, 404, { ok: false, error: "not_found" });
        return;
      }

      writeJson(res, 404, { ok: false, error: "not_found" });
    } catch (e) {
      writeJson(res, 500, { ok: false, error: "server_error", message: String(e) });
    }
  });

  server.listen(port, "127.0.0.1");
  return server;
}

module.exports = { startSessionWebhook };
