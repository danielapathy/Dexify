export function wireSidebarCollapse() {
  const content = document.querySelector(".content");
  const button = document.querySelector(".library__collapse");
  if (!content || !button) return;

  const COLLAPSE_KEY = "spotify.sidebarCollapsed";
  const WIDTH_KEY = "spotify.sidebarWidthBeforeCollapse";

  const isCollapsed = () => content.classList.contains("is-sidebar-collapsed");

  const applyCollapsed = (shouldCollapse) => {
    if (shouldCollapse) {
      const styles = getComputedStyle(content);
      const currentWidth = parseFloat(styles.getPropertyValue("--sidebar-width")) || 330;
      localStorage.setItem(WIDTH_KEY, String(currentWidth));

      content.classList.add("is-sidebar-collapsed");
      button.setAttribute("aria-pressed", "true");
    } else {
      content.classList.remove("is-sidebar-collapsed");
      button.setAttribute("aria-pressed", "false");

      const savedWidth = Number(localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(savedWidth) && savedWidth > 120) {
        content.style.setProperty("--sidebar-width", `${Math.round(savedWidth)}px`);
      }
    }
    localStorage.setItem(COLLAPSE_KEY, shouldCollapse ? "1" : "0");
  };

  const saved = localStorage.getItem(COLLAPSE_KEY) === "1";
  applyCollapsed(saved);

  button.addEventListener("click", () => applyCollapsed(!isCollapsed()));
}

