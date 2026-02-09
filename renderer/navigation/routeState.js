export function getInitialRouteName({ hasAuth, offlineMode }) {
  try {
    const params = new URLSearchParams(String(window?.location?.search || ""));
    const raw = String(params.get("startRoute") || "").trim();
    const allowed = new Set(["home", "notifications", "downloads", "liked", "settings", "search"]);
    if (allowed.has(raw)) return raw;
  } catch {}
  if (hasAuth) return "home";
  return offlineMode ? "home" : "signedOut";
}

export function getRouteKey(route) {
  const name = String(route?.name || "home");
  if (name === "entity") return `entity:${String(route?.entityType || "")}:${String(route?.id || "")}`;
  if (name === "search") return `search:${String(route?.q || "")}:${String(route?.filter || "")}`;
  if (name === "page") return `page:${String(route?.page || "")}`;
  if (name === "settings") return "settings";
  if (name === "notifications") return "notifications";
  if (name === "liked") return "liked";
  if (name === "downloads") return "downloads";
  if (name === "signedOut") return "signedOut";
  return "home";
}

export function createHomeRoute({ hasAuth, offlineMode, refresh = false, scrollTop = 0 } = {}) {
  return { name: getInitialRouteName({ hasAuth, offlineMode }), refresh: Boolean(refresh), scrollTop: Number(scrollTop) || 0 };
}
