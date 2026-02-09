const fs = require("node:fs");
const path = require("node:path");

const { safeJsonParse } = require("../utils");

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return safeJsonParse(raw);
  } catch {
    return null;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmp = `${filePath}.tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function listDirents(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

module.exports = {
  readJson,
  ensureDir,
  writeJsonAtomic,
  safeStat,
  listDirents,
};

