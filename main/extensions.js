const { session } = require("electron");
const { env } = require("./env");

function parseExtensionDirs(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function loadChromeExtensions() {
  const dirs = [
    ...parseExtensionDirs(env.CHROME_EXTENSIONS),
    ...parseExtensionDirs(env.KEYPASS_EXTENSION_DIR),
    ...parseExtensionDirs(env.KEEPASSXC_EXTENSION_DIR),
  ];
  if (dirs.length === 0) return;

  const target = session.defaultSession;
  for (const dir of dirs) {
    try {
      await target.loadExtension(dir, { allowFileAccess: true });
    } catch {}
  }
}

module.exports = { parseExtensionDirs, loadChromeExtensions };
