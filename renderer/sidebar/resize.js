import { clamp } from "../utils.js";

export function wireSidebarResize() {
  const content = document.querySelector(".content");
  const splitter = document.querySelector(".splitter");
  if (!content || !splitter) return;

  const WIDTH_KEY = "spotify.sidebarWidth";
  const MIN_SIDEBAR = 300;
  const MIN_MAIN = 520;

  const applyWidth = (width) => {
    const nextWidth = Math.round(width);
    content.style.setProperty("--sidebar-width", `${nextWidth}px`);
    localStorage.setItem(WIDTH_KEY, String(nextWidth));
  };

  const saved = Number(localStorage.getItem(WIDTH_KEY));
  if (Number.isFinite(saved) && saved >= MIN_SIDEBAR) applyWidth(saved);

  const computeMaxWidth = () => {
    const rect = content.getBoundingClientRect();
    const styles = getComputedStyle(content);
    const paddingLeft = parseFloat(styles.paddingLeft) || 0;
    const paddingRight = parseFloat(styles.paddingRight) || 0;
    const paneGap = splitter.getBoundingClientRect().width || 0;
    const available = rect.width - paddingLeft - paddingRight - paneGap;
    return Math.max(MIN_SIDEBAR, available - MIN_MAIN);
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;

    splitter.setPointerCapture(event.pointerId);
    splitter.classList.add("is-dragging");
    document.documentElement.classList.add("is-resizing");

    const contentRect = content.getBoundingClientRect();
    const styles = getComputedStyle(content);
    const paddingLeft = parseFloat(styles.paddingLeft) || 0;
    const gridLeft = contentRect.left + paddingLeft;

    const startX = event.clientX;
    const splitterRect = splitter.getBoundingClientRect();
    const startWidth = splitterRect.left - gridLeft;
    const maxWidth = computeMaxWidth();

    const onPointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const nextWidth = clamp(startWidth + dx, MIN_SIDEBAR, maxWidth);
      content.style.setProperty("--sidebar-width", `${Math.round(nextWidth)}px`);
    };

    const onPointerUp = () => {
      splitter.classList.remove("is-dragging");
      document.documentElement.classList.remove("is-resizing");

      const styles2 = getComputedStyle(content);
      const currentWidth = parseFloat(styles2.getPropertyValue("--sidebar-width")) || startWidth;
      applyWidth(currentWidth);

      splitter.removeEventListener("pointermove", onPointerMove);
      splitter.removeEventListener("pointerup", onPointerUp);
      splitter.removeEventListener("pointercancel", onPointerUp);
    };

    splitter.addEventListener("pointermove", onPointerMove);
    splitter.addEventListener("pointerup", onPointerUp);
    splitter.addEventListener("pointercancel", onPointerUp);
  };

  splitter.addEventListener("pointerdown", onPointerDown);

  splitter.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();

    const styles = getComputedStyle(content);
    const currentWidth = parseFloat(styles.getPropertyValue("--sidebar-width")) || MIN_SIDEBAR;
    const delta = event.shiftKey ? 48 : 16;
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const nextWidth = clamp(currentWidth + direction * delta, MIN_SIDEBAR, computeMaxWidth());
    applyWidth(nextWidth);
  });
}

