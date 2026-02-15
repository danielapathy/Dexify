function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function buildItem({ label, icon, rightIcon, disabled, danger, onClick }) {
  return { label, icon, rightIcon, disabled: Boolean(disabled), danger: Boolean(danger), onClick };
}

export function createMenuRoot() {
  const root = document.createElement("div");
  root.id = "contextMenu";
  root.className = "context-menu";
  root.hidden = true;
  root.tabIndex = -1;
  document.body.appendChild(root);
  return root;
}

export function renderMenu(root, items) {
  const rows = Array.isArray(items) ? items : [];
  root.innerHTML = "";

  const panel = document.createElement("div");
  panel.className = "context-menu__panel";

  for (const item of rows) {
    if (!item) continue;
    if (item.kind === "sep") {
      const sep = document.createElement("div");
      sep.className = "context-menu__sep";
      panel.appendChild(sep);
      continue;
    }

    // Submenu items open a side-by-side flyout panel
    if (item.submenu && typeof item.buildSubmenu === "function") {
      const wrapper = document.createElement("div");
      wrapper.className = "context-menu__submenu-wrap";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "context-menu__item context-menu__item--submenu";
      btn.innerHTML = `
        <span class="context-menu__icon">${item.icon ? `<i class="${item.icon}" aria-hidden="true"></i>` : ""}</span>
        <span class="context-menu__label">${String(item.label || "")}</span>
        <span class="context-menu__right"><i class="ri-arrow-right-s-line" aria-hidden="true"></i></span>
      `;
      const dbgTag = String(item.dbgTag || item.label || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      btn.dataset.dbg = `ctx-${dbgTag}`;
      btn.dataset.dbgType = "context-menu-item";
      btn.dataset.dbgDesc = String(item.label || "");

      const subPanel = document.createElement("div");
      subPanel.className = "context-menu__subpanel";
      subPanel.hidden = true;

      let subBuilt = false;
      const showSub = () => {
        if (!subBuilt) {
          subBuilt = true;
          try { item.buildSubmenu(subPanel, root); } catch {}
        }
        subPanel.hidden = false;
        btn.classList.add("is-expanded");
        // Position: try right side, fall back to left
        requestAnimationFrame(() => {
          const panelRect = panel.getBoundingClientRect();
          const subRect = subPanel.getBoundingClientRect();
          const vw = window.innerWidth || 800;
          if (panelRect.right + subRect.width + 4 > vw) {
            subPanel.classList.add("is-left");
            subPanel.classList.remove("is-right");
          } else {
            subPanel.classList.add("is-right");
            subPanel.classList.remove("is-left");
          }
        });
      };
      const hideSub = () => {
        subPanel.hidden = true;
        btn.classList.remove("is-expanded");
      };

      let hoverTimer = 0;
      let leaveTimer = 0;
      const clearTimers = () => { clearTimeout(hoverTimer); clearTimeout(leaveTimer); hoverTimer = 0; leaveTimer = 0; };

      wrapper.addEventListener("mouseenter", () => {
        clearTimers();
        hoverTimer = setTimeout(showSub, 80);
      });
      wrapper.addEventListener("mouseleave", () => {
        clearTimers();
        leaveTimer = setTimeout(hideSub, 200);
      });
      subPanel.addEventListener("mouseenter", () => { clearTimers(); });
      subPanel.addEventListener("mouseleave", () => {
        clearTimers();
        leaveTimer = setTimeout(hideSub, 200);
      });
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearTimers();
        if (subPanel.hidden) showSub();
        else hideSub();
      });

      wrapper.appendChild(btn);
      wrapper.appendChild(subPanel);
      panel.appendChild(wrapper);
      continue;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `context-menu__item${item.danger ? " is-danger" : ""}`;
    btn.disabled = Boolean(item.disabled);
    btn.innerHTML = `
      <span class="context-menu__icon">${item.icon ? `<i class="${item.icon}" aria-hidden="true"></i>` : ""}</span>
      <span class="context-menu__label">${String(item.label || "")}</span>
      <span class="context-menu__right">${item.rightIcon ? `<i class="${item.rightIcon}" aria-hidden="true"></i>` : ""}</span>
    `;

    const dbgTag = String(item.dbgTag || item.label || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    btn.dataset.dbg = `ctx-${dbgTag}`;
    btn.dataset.dbgType = "context-menu-item";
    btn.dataset.dbgDesc = String(item.label || "");
    if (item.dbgId) btn.dataset.dbgId = String(item.dbgId);

    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Always close immediately; never leave the menu "stuck open" while long
      // tasks (downloads, FS scans, etc) run.
      hideMenu(root);
      if (typeof item.onClick !== "function") return;
      try {
        const res = item.onClick();
        if (res && typeof res.then === "function") {
          res.catch(() => {});
        }
      } catch {}
    });

    panel.appendChild(btn);
  }

  root.appendChild(panel);
}

export function positionMenu(root, { x, y }) {
  const pad = 10;
  root.style.left = "0px";
  root.style.top = "0px";
  root.hidden = false;

  const panel = root.querySelector(".context-menu__panel");
  const rect = panel?.getBoundingClientRect?.();
  const w = rect?.width || 280;
  const h = rect?.height || 200;
  const vw = window.innerWidth || 800;
  const vh = window.innerHeight || 600;

  const left = clamp(Math.round(x), pad, Math.max(pad, vw - w - pad));
  const top = clamp(Math.round(y), pad, Math.max(pad, vh - h - pad));
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
}

let isAnimatingClose = false;

export function hideMenu(root, animate = true) {
  if (root.hidden) return;
  if (isAnimatingClose) return;

  if (animate) {
    isAnimatingClose = true;
    root.classList.add("is-closing");
    setTimeout(() => {
      root.classList.remove("is-closing");
      root.hidden = true;
      root.style.removeProperty("left");
      root.style.removeProperty("top");
      root.innerHTML = "";
      isAnimatingClose = false;
    }, 150);
  } else {
    root.hidden = true;
    root.style.removeProperty("left");
    root.style.removeProperty("top");
    root.innerHTML = "";
  }
}

export function isMenuAnimating() {
  return isAnimatingClose;
}

export function isOpen(root) {
  return !root.hidden;
}
