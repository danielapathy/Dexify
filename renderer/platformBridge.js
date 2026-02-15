/**
 * Platform bridge — abstracts Electron IPC so the renderer works
 * identically on Electron and Capacitor (or plain web).
 *
 * On Electron: window.auth / window.dz / window.dl / window.app
 *   are injected by preload.js via contextBridge.
 *
 * On Capacitor / web: we fall back to HTTP calls against a
 *   companion server (same machine or LAN). The server URL is
 *   configurable via localStorage or env.
 *
 * Usage:  import { bridge } from "./platformBridge.js";
 *         const session = await bridge.auth.getSession();
 */

// ── Detect runtime ───────────────────────────────────

export const isElectron = typeof window.auth?.getSession === "function";
export const isCapacitor = typeof window.Capacitor !== "undefined";
export const isWeb = !isElectron && !isCapacitor;

// ── HTTP fallback for non-Electron environments ──────

const DEFAULT_SERVER = "http://localhost:36958";

function getServerUrl() {
  try {
    return localStorage.getItem("dexify.serverUrl") || DEFAULT_SERVER;
  } catch {
    return DEFAULT_SERVER;
  }
}

async function rpc(method, params) {
  const url = `${getServerUrl()}/api/rpc`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} failed: ${res.status}`);
  return res.json();
}

// ── Build the bridge object ──────────────────────────

function buildElectronBridge() {
  // On Electron, the preload already exposes everything we need.
  return {
    auth: window.auth,
    deezer: window.deezer,
    dz: window.dz,
    dl: window.dl,
    app: window.app,
    platform: "electron",
  };
}

function buildHttpBridge() {
  // For Capacitor or web, proxy every call through HTTP RPC.
  const makeProxy = (namespace) =>
    new Proxy(
      {},
      {
        get(_, method) {
          if (method === "onSessionChanged" || method === "onEvent") {
            // Event listeners need WebSocket or polling — stub for now.
            return (listener) => {
              // TODO: implement WebSocket event forwarding
              console.warn(`[bridge] ${namespace}.${method} is not yet supported over HTTP`);
              return () => {};
            };
          }
          return (params) => rpc(`${namespace}:${method}`, params);
        },
      },
    );

  return {
    auth: makeProxy("auth"),
    deezer: makeProxy("deezer"),
    dz: makeProxy("dz"),
    dl: makeProxy("dl"),
    app: makeProxy("app"),
    platform: isCapacitor ? "capacitor" : "web",
  };
}

// ── Export ────────────────────────────────────────────

export const bridge = isElectron ? buildElectronBridge() : buildHttpBridge();
