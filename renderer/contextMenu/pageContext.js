export function resolvePageContext() {
  const route = window.__navRoute && typeof window.__navRoute === "object" ? window.__navRoute : null;
  const name = String(route?.name || "").trim();
  if (name === "customPlaylist") {
    return { type: "customPlaylist", id: String(route?.id || "") };
  }
  if (name === "folder") {
    return { type: "folder", id: String(route?.id || "") };
  }
  if (name === "entity") {
    const entityType = String(route?.entityType || "").trim();
    return entityType || "entity";
  }
  if (name === "page") {
    const page = String(route?.page || "").trim();
    return page ? `page:${page}` : "page";
  }
  if (name) return name;
  return "unknown";
}

export function refreshDownloadsIfVisible() {
  try {
    if (String(window.__navRoute?.name || "") !== "downloads") return;
    window.__spotifyNav?.navigate?.({ name: "downloads", refresh: true, scrollTop: 0 }, { replace: true });
  } catch {}
}

export function refreshLikedIfVisible() {
  try {
    if (String(window.__navRoute?.name || "") !== "liked") return;
    window.__spotifyNav?.navigate?.({ name: "liked", refresh: true, scrollTop: 0 }, { replace: true });
  } catch {}
}
