export function createFoldersApi({ load, save, notify }) {
  const ensureFolders = (state) => {
    if (!state.folders || typeof state.folders !== "object") state.folders = {};
  };

  const createFolder = ({ title } = {}) => {
    const now = Date.now();
    const id = `f_${now}`;
    const folder = {
      id,
      title: String(title || "").trim() || `New Folder`,
      children: [],
      createdAt: now,
      updatedAt: now,
      playedAt: 0,
    };
    const next = load();
    ensureFolders(next);
    next.folders[id] = folder;
    save(next);
    notify();
    return folder;
  };

  const deleteFolder = (id) => {
    const key = String(id || "");
    if (!key) return false;
    const next = load();
    ensureFolders(next);
    if (!next.folders[key]) return false;
    delete next.folders[key];
    save(next);
    notify();
    return true;
  };

  const renameFolder = (id, title) => {
    const key = String(id || "");
    if (!key) return false;
    const next = load();
    ensureFolders(next);
    const f = next.folders[key];
    if (!f) return false;
    f.title = String(title || "").trim() || f.title;
    f.updatedAt = Date.now();
    save(next);
    notify();
    return true;
  };

  const addChildToFolder = (folderId, { type, id } = {}) => {
    const key = String(folderId || "");
    const childType = String(type || "");
    const childId = String(id || "");
    if (!key || !childType || !childId) return false;

    const validTypes = new Set(["customPlaylist", "album", "playlist"]);
    if (!validTypes.has(childType)) return false;

    const next = load();
    ensureFolders(next);
    const f = next.folders[key];
    if (!f) return false;
    if (!Array.isArray(f.children)) f.children = [];

    // Dedupe
    const exists = f.children.some((c) => c.type === childType && String(c.id) === childId);
    if (exists) return false;

    f.children.push({ type: childType, id: childId });
    f.updatedAt = Date.now();
    save(next);
    notify();
    return true;
  };

  const removeChildFromFolder = (folderId, { type, id } = {}) => {
    const key = String(folderId || "");
    const childType = String(type || "");
    const childId = String(id || "");
    if (!key || !childType || !childId) return false;

    const next = load();
    ensureFolders(next);
    const f = next.folders[key];
    if (!f || !Array.isArray(f.children)) return false;

    const before = f.children.length;
    f.children = f.children.filter((c) => !(c.type === childType && String(c.id) === childId));
    if (f.children.length === before) return false;

    f.updatedAt = Date.now();
    save(next);
    notify();
    return true;
  };

  const reorderFolderChildren = (folderId, children) => {
    const key = String(folderId || "");
    if (!key || !Array.isArray(children)) return false;

    const next = load();
    ensureFolders(next);
    const f = next.folders[key];
    if (!f) return false;

    f.children = children
      .filter((c) => c && typeof c === "object" && c.type && c.id)
      .map((c) => ({ type: String(c.type), id: String(c.id) }));
    f.updatedAt = Date.now();
    save(next);
    notify();
    return true;
  };

  const listFolders = () => {
    const state = load();
    ensureFolders(state);
    const items = Object.values(state.folders);
    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return items;
  };

  const getFolder = (id) => {
    const key = String(id || "");
    if (!key) return null;
    const state = load();
    ensureFolders(state);
    return state.folders[key] || null;
  };

  const markFolderPlayed = (id) => {
    const key = String(id || "");
    if (!key) return false;
    const next = load();
    ensureFolders(next);
    const f = next.folders[key];
    if (!f) return false;
    f.playedAt = Date.now();
    save(next);
    notify();
    return true;
  };

  return {
    createFolder,
    deleteFolder,
    renameFolder,
    addChildToFolder,
    removeChildFromFolder,
    reorderFolderChildren,
    listFolders,
    getFolder,
    markFolderPlayed,
  };
}
