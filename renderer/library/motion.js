export function clearLibraryMotionStyles(list) {
  if (!list) return;

  try {
    const existingExit = list.querySelector(".library-exit-layer");
    existingExit?.remove?.();
  } catch {}

  const items = Array.from(list.querySelectorAll(".library-item"));
  for (const it of items) {
    it.classList.remove("is-enter");
    it.style.transition = "";
    it.style.transform = "";
  }
}
