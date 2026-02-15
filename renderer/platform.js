import { updateRangeFill } from "./utils.js";

export function wirePlatformClasses() {
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";

  const isElectron = /\bElectron\/\d+/i.test(ua);
  const isMac = /Mac/i.test(platform) || /Macintosh/i.test(ua);
  const isCapacitor = typeof window.Capacitor !== "undefined";
  const isAndroid = /Android/i.test(ua);

  const root = document.documentElement;
  root.classList.toggle("is-electron", isElectron);
  root.classList.toggle("is-mac", isMac);
  root.classList.toggle("is-capacitor", isCapacitor);
  root.classList.toggle("is-android", isAndroid);
}

export function wireRanges() {
  const ranges = document.querySelectorAll(".range");
  for (const range of ranges) {
    updateRangeFill(range);
    range.addEventListener("input", () => updateRangeFill(range));
  }
}

export function wireChips() {
  const chips = Array.from(document.querySelectorAll(".chip"));
  for (const chip of chips) {
    chip.addEventListener("click", () => {
      for (const c of chips) {
        c.classList.toggle("is-active", c === chip);
        c.setAttribute("aria-selected", c === chip ? "true" : "false");
      }
    });
  }
}

