import { clearLibraryMotionStyles } from "../motion.js";

export const className = "library-view-default-grid";

export function apply({ list }) {
  clearLibraryMotionStyles(list);
}

