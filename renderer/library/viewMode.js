import * as defaultView from "./views/default.js";
import * as compactView from "./views/compact.js";
import * as compactGridView from "./views/compactGrid.js";
import * as defaultGridView from "./views/defaultGrid.js";

export const LIBRARY_VIEW_STORAGE_KEY = "spotify.libraryView";

const viewByMode = {
  default: defaultView,
  compact: compactView,
  "compact-grid": compactGridView,
  "default-grid": defaultGridView,
};

export function normalizeLibraryViewMode(mode) {
  const m = String(mode || "");
  if (m === "compact" || m === "compact-grid" || m === "default-grid") return m;
  return "default";
}

export function getLibraryViewMode() {
  try {
    return normalizeLibraryViewMode(localStorage.getItem(LIBRARY_VIEW_STORAGE_KEY) || "default");
  } catch {
    return "default";
  }
}

export function isLibraryGridViewMode(mode) {
  return mode === "compact-grid" || mode === "default-grid";
}

export function applyLibraryViewMode({ contentRoot, list, mode }) {
  if (!contentRoot) return;
  const resolvedMode = normalizeLibraryViewMode(mode || getLibraryViewMode());
  const allClassNames = Object.values(viewByMode).map((v) => v.className).filter(Boolean);
  for (const c of allClassNames) contentRoot.classList.remove(c);

  const view = viewByMode[resolvedMode] || defaultView;
  if (view.className) contentRoot.classList.add(view.className);
  try {
    view.apply?.({ contentRoot, list, mode: resolvedMode });
  } catch {}
}

