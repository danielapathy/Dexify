import { getLocalLibrary } from "../localLibrary.js";

export function wireCreateMenu() {
  const btn = document.querySelector('.library__actions [aria-label="Create"]');
  if (!btn) return;

  let menuEl = null;
  let open = false;

  const close = () => {
    if (!open || !menuEl) return;
    open = false;
    menuEl.classList.add("is-closing");
    setTimeout(() => {
      menuEl.classList.remove("is-closing");
      menuEl.hidden = true;
    }, 150);
  };

  const buildMenu = () => {
    if (menuEl) return menuEl;
    menuEl = document.createElement("div");
    menuEl.className = "create-menu";
    menuEl.hidden = true;
    menuEl.setAttribute("role", "menu");
    menuEl.dataset.dbg = "create-menu";
    menuEl.dataset.dbgType = "menu";
    menuEl.dataset.dbgDesc = "Create new playlist or folder menu";

    const items = [
      {
        icon: "ri-music-2-fill",
        label: "Playlist",
        desc: "Create a playlist with songs",
        dbg: "create-playlist",
        action: () => {
          const lib = getLocalLibrary();
          const p = lib.createCustomPlaylist();
          close();
          window.__spotifyNav?.navigate?.({ name: "customPlaylist", id: p.id });
        },
      },
      {
        icon: "ri-folder-3-fill",
        label: "Folder",
        desc: "Organise your playlists",
        dbg: "create-folder",
        action: () => {
          const lib = getLocalLibrary();
          lib.createFolder();
          close();
        },
      },
    ];

    for (const item of items) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "create-menu__item";
      row.setAttribute("role", "menuitem");
      row.dataset.dbg = item.dbg;
      row.dataset.dbgType = "button";
      row.dataset.dbgDesc = item.label;
      row.innerHTML = `
        <span class="create-menu__icon"><i class="${item.icon}" aria-hidden="true"></i></span>
        <span class="create-menu__text">
          <span class="create-menu__label">${item.label}</span>
          <span class="create-menu__desc">${item.desc}</span>
        </span>
      `;
      row.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        item.action();
      });
      menuEl.appendChild(row);
    }

    document.body.appendChild(menuEl);
    return menuEl;
  };

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    buildMenu();
    if (open) {
      close();
    } else {
      open = true;
      menuEl.hidden = false;
      menuEl.classList.remove("is-closing");
      
      // Position menu below button
      const rect = btn.getBoundingClientRect();
      menuEl.style.left = `${rect.left}px`;
      menuEl.style.top = `${rect.bottom + 8}px`;
    }
  });

  document.addEventListener("click", (e) => {
    if (!open) return;
    if (menuEl?.contains(e.target) || btn.contains(e.target)) return;
    close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) close();
  });
}
