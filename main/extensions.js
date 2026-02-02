const { session } = require("electron");

function parseExtensionDirs(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function loadChromeExtensions() {
  const dirs = [
    ...parseExtensionDirs(process.env.CHROME_EXTENSIONS),
    ...parseExtensionDirs(process.env.KEYPASS_EXTENSION_DIR),
    ...parseExtensionDirs(process.env.KEEPASSXC_EXTENSION_DIR),
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

