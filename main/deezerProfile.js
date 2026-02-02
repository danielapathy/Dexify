const { DEEZER_USER_AGENT } = require("./constants");
const { hasNonEmptyError, fetchJson } = require("./utils");

async function getDeezerUserProfileFromArl(arl) {
  if (typeof arl !== "string" || !arl.trim()) return null;

  const url = new URL("https://www.deezer.com/ajax/gw-light.php");
  url.searchParams.set("api_version", "1.0");
  url.searchParams.set("api_token", "null");
  url.searchParams.set("input", "3");
  url.searchParams.set("method", "deezer.getUserData");

  const { ok, status, json } = await fetchJson(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": DEEZER_USER_AGENT,
        cookie: `arl=${arl}; dz_lang=en;`,
      },
      body: "{}",
    },
    { timeoutMs: 12000 }
  );

  if (!ok) throw new Error(`deezer.getUserData failed (${status})`);
  if (hasNonEmptyError(json?.error)) {
    throw new Error(`deezer.getUserData error: ${JSON.stringify(json.error)}`);
  }

  const user = json?.results?.USER;
  if (!user) return null;

  const pictureId = String(user.USER_PICTURE || "");
  const avatarUrl = pictureId
    ? `https://e-cdns-images.dzcdn.net/images/user/${pictureId}/88x88-000000-80-0-0.jpg`
    : null;

  return {
    id: typeof user.USER_ID === "number" ? user.USER_ID : null,
    name: String(user.BLOG_NAME || user.FIRSTNAME || "Deezer user"),
    pictureId,
    avatarUrl,
  };
}

module.exports = { getDeezerUserProfileFromArl };

