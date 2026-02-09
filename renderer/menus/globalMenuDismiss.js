function isElement(node) {
  return Boolean(node && node.nodeType === 1);
}

export function wireGlobalMenuDismissal() {
  if (window.__globalMenuDismissalWired) return;
  window.__globalMenuDismissalWired = true;

  if (!window.__dropdownMenus) window.__dropdownMenus = new Set();

  const menuSurfaceSelector = [
    "#contextMenu",
    "#accountMenu",
    ".library-recents-menu",
    ".downloads-dropdown-menu",
    ".player-audio-popover",
  ].join(", ");

  const menuTriggerSelector = [
    "[aria-haspopup='menu']",
    "#accountBtn",
    "#playerAudioSettingsBtn",
    "button.recents",
  ].join(", ");

  const closeAll = () => {
    const set = window.__dropdownMenus;
    if (!set || typeof set[Symbol.iterator] !== "function") return;
    for (const fn of Array.from(set)) {
      if (typeof fn !== "function") continue;
      try {
        fn();
      } catch {}
    }
  };

  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event?.target;
      if (!isElement(target)) return;

      if (target.closest(menuSurfaceSelector)) return;
      if (target.closest(menuTriggerSelector)) return;

      closeAll();
    },
    true,
  );
}
