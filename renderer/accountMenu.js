export function wireAccountMenu() {
  const root = document.querySelector("[data-account]");
  const button = document.getElementById("accountBtn");
  const menu = document.getElementById("accountMenu");
  const avatar = document.getElementById("accountAvatar");
  const menuAvatar = document.getElementById("accountMenuAvatar");
  const nameEl = document.getElementById("accountName");
  const statusEl = document.getElementById("accountStatus");
  const connectBtn = menu?.querySelector('[data-action="auth-login"]');
  const settingsBtn = menu?.querySelector('[data-action="open-settings"]');
  const disconnectBtn = menu?.querySelector('[data-action="auth-logout"]');

  if (!root || !button || !menu || !avatar || !menuAvatar || !nameEl || !statusEl || !connectBtn || !disconnectBtn) return;

  const defaultAvatarUrl = avatar.getAttribute("src") || "";

  const getNameParts = (value) =>
    String(value || "")
      .trim()
      .split(/\s+/g)
      .filter(Boolean);

  const getInitials = (fullName) => {
    const parts = getNameParts(fullName);
    if (parts.length === 0) return "??";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const hashToHue = (value) => {
    const s = String(value || "");
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    }
    return hash % 360;
  };

  const buildInitialsAvatarDataUrl = (fullName) => {
    const initials = getInitials(fullName);
    const hue = hashToHue(fullName);
    const bg = `hsl(${hue} 55% 42%)`;
    const fg = "rgba(255,255,255,0.92)";

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88" viewBox="0 0 88 88">
      <rect width="88" height="88" rx="44" fill="${bg}"/>
      <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
        font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"
        font-size="30" font-weight="700" fill="${fg}" letter-spacing="1">${initials}</text>
    </svg>`;

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };

  // Register with global dropdown system
  if (!window.__dropdownMenus) window.__dropdownMenus = new Set();

  const closeAllDropdowns = (except) => {
    for (const closeFunc of window.__dropdownMenus) {
      if (closeFunc !== except) closeFunc();
    }
  };

  let isAnimating = false;

  const setOpen = (open) => {
    button.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      menu.hidden = false;
      menu.classList.add("is-opening");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          menu.classList.remove("is-opening");
          menu.focus?.();
        });
      });
    } else {
      if (menu.hidden) return;
      isAnimating = true;
      menu.classList.add("is-closing");
      setTimeout(() => {
        menu.classList.remove("is-closing");
        menu.hidden = true;
        isAnimating = false;
      }, 150);
    }
  };

  const isOpen = () => !menu.hidden && !isAnimating;

  const close = () => setOpen(false);
  window.__dropdownMenus.add(close);

  const setBusy = (busy) => {
    connectBtn.disabled = busy;
    disconnectBtn.disabled = busy;
  };

  const setProfile = (payload) => {
    const hasARL = Boolean(payload?.hasARL);
    const user = payload?.user && typeof payload.user === "object" ? payload.user : null;

    connectBtn.hidden = hasARL;
    disconnectBtn.hidden = !hasARL;

    if (!hasARL) {
      nameEl.textContent = "Guest";
      statusEl.textContent = window.auth ? "Not logged in" : "Login available in Electron only";
      avatar.src = defaultAvatarUrl;
      menuAvatar.src = defaultAvatarUrl;
      return;
    }

    const displayName = String(user?.name || "Deezer user");
    nameEl.textContent = displayName;
    statusEl.textContent = "Logged in";

    const src = String(user?.avatarUrl || "") || buildInitialsAvatarDataUrl(displayName);
    avatar.src = src;
    menuAvatar.src = src;
  };

  const setError = (message) => {
    statusEl.textContent = String(message || "Login failed");
  };

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isOpen()) {
      setOpen(false);
      return;
    }
    closeAllDropdowns(close);
    setOpen(true);
  });

  document.addEventListener("click", (event) => {
    if (!isOpen()) return;
    if (root.contains(event.target)) return;
    close();
  });

  document.addEventListener("keydown", (event) => {
    if (!isOpen()) return;
    if (event.key === "Escape") close();
  });

  connectBtn.addEventListener("click", async () => {
    if (!window.auth) {
      setError("available in Electron only");
      return;
    }

    setBusy(true);
    setError("connecting…");
    try {
      const result = await window.auth.login();
      if (!result?.ok) {
        setError(result?.message || result?.error || "login failed");
        return;
      }
      setProfile({ hasARL: Boolean(result?.hasARL) });
      close();
    } finally {
      setBusy(false);
    }
  });

  settingsBtn?.addEventListener?.("click", () => {
    window.__spotifyNav?.navigate?.({ name: "settings" });
    close();
  });

  disconnectBtn.addEventListener("click", async () => {
    if (!window.auth) return;

    setBusy(true);
    try {
      await window.auth.logout();
      setProfile({ hasARL: false });
      close();
    } finally {
      setBusy(false);
    }
  });

  if (!window.auth) {
    connectBtn.disabled = true;
    setProfile({ hasARL: false });
    return;
  }

  window.auth.onSessionChanged?.((payload) => setProfile(payload));

  setBusy(true);
  window.auth
    .getSession()
    .then((payload) => setProfile(payload))
    .catch(() => setProfile({ hasARL: false }))
    .finally(() => setBusy(false));
}
