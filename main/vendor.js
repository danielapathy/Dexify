const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

module.exports = function createVendoredLoaders({ rootDir }) {
  if (!rootDir) throw new Error("createVendoredLoaders: missing rootDir");

  function getVendoredDeezerSdkDistPath() {
    return path.join(rootDir, "deemix-main", "packages", "deezer-sdk", "dist", "index.mjs");
  }

  let deezerSdkModule = null;
  async function loadVendoredDeezerSdk() {
    if (deezerSdkModule) return deezerSdkModule;

    const distPath = getVendoredDeezerSdkDistPath();
    if (!fs.existsSync(distPath)) {
      throw new Error(
        `Vendored deezer-sdk not built. Missing ${distPath}. Run: npm run build:vendor`
      );
    }

    deezerSdkModule = await import(pathToFileURL(distPath).href);
    return deezerSdkModule;
  }

  function getVendoredDeemixLiteDistPath() {
    return path.join(rootDir, "vendor", "dist", "deemix-lite-entry.mjs");
  }

  let deemixLiteModule = null;
  async function loadVendoredDeemixLite() {
    if (deemixLiteModule) return deemixLiteModule;

    const distPath = getVendoredDeemixLiteDistPath();
    if (!fs.existsSync(distPath)) {
      throw new Error(`Vendored deemix lite not built. Missing ${distPath}. Run: npm run build:vendor`);
    }

    deemixLiteModule = await import(pathToFileURL(distPath).href);
    return deemixLiteModule;
  }

  return { loadVendoredDeezerSdk, loadVendoredDeemixLite };
};

