const TRACKLISTS = new WeakMap();

export function registerTrackList(listEl, tracks, { pageContext } = {}) {
  const el = listEl && listEl.nodeType === 1 ? listEl : null;
  if (!el) return;
  const rows = Array.isArray(tracks) ? tracks : [];
  TRACKLISTS.set(el, { tracks: rows, pageContext: String(pageContext || "") });
  el.dataset.cmTracklist = "1";
}

export function getTrackListInfoFromRow(row) {
  const r = row && row.nodeType === 1 ? row : null;
  if (!r) return null;
  const listEl = r.closest?.('[data-cm-tracklist="1"]');
  if (!listEl) return null;
  return TRACKLISTS.get(listEl) || null;
}

export function resolveTrackListFromRow(row) {
  const info = getTrackListInfoFromRow(row);
  const idx = Number(row?.dataset?.trackIndex);
  const tracks = Array.isArray(info?.tracks) ? info.tracks : [];
  const index = Number.isFinite(idx) && idx >= 0 ? idx : -1;
  return { tracks, index, pageContext: String(info?.pageContext || "") };
}
