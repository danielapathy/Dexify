import { withTimeout } from "./timeout.js";

export async function getSessionSafe({ timeoutMs = 2000 } = {}) {
  if (!window.auth?.getSession) return { ok: true, hasARL: false, user: null };
  try {
    const payload = await withTimeout(window.auth.getSession(), timeoutMs, {
      ok: false,
      hasARL: false,
      user: null,
      timeout: true,
    });
    return payload && typeof payload === "object" ? payload : { ok: true, hasARL: false, user: null };
  } catch {
    return { ok: false, hasARL: false, user: null };
  }
}

