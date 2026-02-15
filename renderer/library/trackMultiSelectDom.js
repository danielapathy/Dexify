export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function getMainScrollEl() {
  return document.querySelector(".main__scroll");
}

export function getActiveContext() {
  const name = String(window.__navRoute?.name || "");
  if (name === "liked" || name === "downloads") return name;
  if (name === "customPlaylist") return "customPlaylist";
  if (name === "entity") {
    const entityType = String(window.__navRoute?.entityType || "").trim();
    if (entityType === "album") return "album";
    if (entityType === "playlist") return "playlist";
  }
  return null;
}

export function findActiveTrackList(entityView) {
  if (!entityView) return null;
  // Prefer the track list inside the currently active entity page to avoid
  // picking up a stale list from a page that is still animating out.
  const activePage = entityView.querySelector('.entity-page.is-active');
  if (activePage) {
    const list = activePage.querySelector('.entity-tracks[data-cm-tracklist="1"]');
    if (list) return list;
  }
  return entityView.querySelector('.entity-tracks[data-cm-tracklist="1"]');
}

export function ensureBar(entityView) {
  const host = getMainScrollEl() || (entityView && entityView.nodeType === 1 ? entityView : null);
  if (!host) return null;

  const existing = host?.querySelector?.(".track-select-dock");
  if (existing) return existing;

  const dock = document.createElement("div");
  dock.className = "track-select-dock";
  dock.setAttribute("aria-hidden", "true");
  try {
    dock.inert = true;
  } catch {}

  const bar = document.createElement("div");
  bar.className = "track-select-bar";
  bar.innerHTML = `
    <div class="track-select-bar__left">
      <span class="track-select-bar__count">0 selected</span>
    </div>
    <div class="track-select-bar__right">
      <button type="button" class="track-select-bar__btn track-select-bar__btn--secondary" data-action="cancel">
        Cancel
      </button>
      <button type="button" class="track-select-bar__btn track-select-bar__btn--primary" data-action="primary">
        Action
      </button>
    </div>
  `;

  dock.appendChild(bar);
  host.prepend(dock);
  return dock;
}

export function ensureDockPosition(entityView, dock) {
  const d = dock && dock.nodeType === 1 ? dock : null;
  if (!d) return;

  // Keep the selection bar outside the tracklist DOM so it behaves like a floating
  // sticky header and does not participate in list layout.
  const host = getMainScrollEl() || (entityView && entityView.nodeType === 1 ? entityView : null);
  if (!host) return;
  if (d.parentNode !== host) host.prepend(d);
}

export function updateHeaderCount(entityView, count) {
  const sub = entityView?.querySelector?.(".entity-subtitle");
  if (!sub) return;
  if (!Number.isFinite(count)) return;
  sub.textContent = `${count} songs`;
}

export function setCheckboxState(row, checked) {
  const r = row && row.nodeType === 1 ? row : null;
  if (!r) return;
  const btn = r.querySelector(".entity-track__check");
  if (btn) {
    btn.setAttribute("aria-checked", checked ? "true" : "false");
  }
  r.classList.toggle("is-selected", Boolean(checked));
}

export function ensureRowCheckbox(row) {
  const r = row && row.nodeType === 1 ? row : null;
  if (!r) return null;
  const idx = r.querySelector(".entity-track__index");
  if (!idx) return null;
  const existing = idx.querySelector(".entity-track__check");
  if (existing) return existing;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "entity-track__check";
  btn.tabIndex = -1;
  btn.setAttribute("role", "checkbox");
  btn.setAttribute("aria-checked", "false");
  btn.setAttribute("aria-label", "Select track");
  btn.innerHTML = '<i class="ri-check-line" aria-hidden="true"></i>';
  idx.appendChild(btn);
  return btn;
}

export function applyRipple(row, event) {
  const r = row && row.nodeType === 1 ? row : null;
  if (!r) return;

  const rect = r.getBoundingClientRect();
  const clientX = Number(event?.clientX);
  const clientY = Number(event?.clientY);
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || rect.width <= 0 || rect.height <= 0) return;

  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const d1 = Math.hypot(x, y);
  const d2 = Math.hypot(rect.width - x, y);
  const d3 = Math.hypot(x, rect.height - y);
  const d4 = Math.hypot(rect.width - x, rect.height - y);
  const radius = Math.max(d1, d2, d3, d4);
  const size = Math.ceil(radius * 2 + 6);
  const left = Math.round(x - size / 2);
  const top = Math.round(y - size / 2);

  const ripple = document.createElement("span");
  ripple.className = "track-ripple";
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${left}px`;
  ripple.style.top = `${top}px`;

  try {
    const prev = r.querySelector(".track-ripple");
    prev?.remove?.();
  } catch {}

  r.appendChild(ripple);
  requestAnimationFrame(() => ripple.classList.add("is-anim"));
  setTimeout(() => {
    try {
      ripple.remove();
    } catch {}
  }, 700);
}
