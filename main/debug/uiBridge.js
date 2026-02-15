function createUiBridge({ getMainWindow, uiDebugEnabled }) {
  const enabled = Boolean(uiDebugEnabled);

  const withMainWindow = () => {
    if (!enabled) return { ok: false, error: "ui_debug_disabled" };
    const win = getMainWindow?.();
    if (!win || win.isDestroyed?.()) return { ok: false, error: "no_window" };
    const wc = win.webContents;
    if (!wc || wc.isDestroyed?.()) return { ok: false, error: "no_webcontents" };
    return { ok: true, win, wc };
  };

  const invokeRenderer = async (method, params) => {
    const allowed = new Set([
      "isReady",
      "snapshotHome",
      "snapshotLibrary",
      "snapshotNowPlaying",
      "snapshotPage",
      "navigate",
      "findBottomPlaylistByTitle",
      "openBottomPlaylistByTitle",
      "clickEntityAction",
      "downloadBottomPlaylistByTitle",
      "snapshotDownloadsLocal",
      "queryElements",
      "getElement",
      "clickElement",
      "typeIntoElement",
      "hoverElement",
      "waitForElement",
      "snapshotContextMenu",
      "dismissContextMenu",
      "inspectLayout",
      "captureScreenState",
      "snapshotCustomPlaylists",
      "snapshotFolders",
      "snapshotCustomPlaylistView",
      "seedTestData",
      "clearTestData",
      "toggleFolderExpand",
      "snapshotLibraryOrder",
    ]);
    const name = String(method || "");
    if (!allowed.has(name)) return { ok: false, error: "method_not_allowed" };

    const mw = withMainWindow();
    if (!mw.ok) return mw;

    try {
      const payload = params && typeof params === "object" ? params : {};
      const expr =
        "(async () => {\n" +
        "  try {\n" +
        "    const api = window.__dexifyUiDebug;\n" +
        "    if (!api) return { ok: false, error: 'not_available' };\n" +
        "    const fn = api[" +
        JSON.stringify(name) +
        "];\n" +
        "    if (typeof fn !== 'function') return { ok: false, error: 'not_available' };\n" +
        "    const res = fn(" +
        JSON.stringify(payload) +
        ");\n" +
        "    return (res && typeof res.then === 'function') ? await res : res;\n" +
        "  } catch (e) {\n" +
        "    return { ok: false, error: 'renderer_error', message: String(e && e.message ? e.message : e) };\n" +
        "  }\n" +
        "})()";

      const res = await mw.wc.executeJavaScript(expr, true);
      if (res && typeof res === "object") return res;
      return { ok: true, value: res };
    } catch (e) {
      return { ok: false, error: "execute_failed", message: String(e?.message || e) };
    }
  };

  const waitReady = async ({ timeoutMs = 25_000, pollMs = 200 } = {}) => {
    const timeout = Math.max(0, Math.min(120_000, Number(timeoutMs) || 25_000));
    const poll = Math.max(50, Math.min(2_000, Number(pollMs) || 200));
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const res = await invokeRenderer("isReady", {});
      if (res?.ok && res?.ready) return { ok: true, state: res };
      await new Promise((r) => setTimeout(r, poll));
    }
    const last = await invokeRenderer("isReady", {});
    return { ok: false, error: "timeout", last: last && typeof last === "object" ? last : null };
  };

  const validateRoute = (route) => {
    const r = route && typeof route === "object" ? route : null;
    if (!r) return { ok: false, error: "bad_request" };
    const name = String(r.name || "").trim();
    const allowed = new Set(["home", "signedOut", "search", "entity", "page", "settings", "notifications", "liked", "downloads"]);
    if (!allowed.has(name)) return { ok: false, error: "route_not_allowed" };
    if (name === "entity") {
      const entityType = String(r.entityType || "").trim();
      const id = String(r.id || "").trim();
      if (!entityType || !id) return { ok: false, error: "bad_request" };
    }
    if (name === "search") {
      const q = String(r.q || "").trim();
      if (!q) return { ok: false, error: "bad_request" };
    }
    return { ok: true, route: r };
  };

  const navigate = async ({ route, options } = {}) => {
    const vr = validateRoute(route);
    if (!vr.ok) return vr;
    const opts = options && typeof options === "object" ? options : undefined;
    return invokeRenderer("navigate", { route: vr.route, ...(opts ? { options: opts } : {}) });
  };

  const executeRaw = async (expr) => {
    const mw = withMainWindow();
    if (!mw.ok) return mw;
    try {
      const res = await mw.wc.executeJavaScript(String(expr), true);
      if (res && typeof res === "object") return res;
      return { ok: true, value: res };
    } catch (e) {
      return { ok: false, error: "execute_failed", message: String(e?.message || e) };
    }
  };

  return {
    enabled,
    invokeRenderer,
    waitReady,
    navigate,
    executeRaw,
  };
}

module.exports = { createUiBridge };
