import { clearLibraryMotionStyles } from "../motion.js";

export const className = "library-view-compact-grid";

export function apply({ list }) {
  clearLibraryMotionStyles(list);
}

