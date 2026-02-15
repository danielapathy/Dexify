export function createLibraryItemElement({
  category,
  title,
  subtitle,
  subtitlePinned,
  imageUrl,
  entityType,
  entityId,
  isActive,
  route,
  trackId,
  sortTitle,
  sortCreator,
  sortRecent,
  sortAdded,
  searchMeta,
  customPlaylistId,
  folderId,
}) {
  const a = document.createElement("a");
  a.className = `library-item${isActive ? " is-active" : ""}`;
  a.href = "#";
  a.setAttribute("role", "listitem");

  a.dataset.category = category;
  if (entityType) a.dataset.entityType = entityType;
  if (entityId) a.dataset.entityId = String(entityId);
  if (route) a.dataset.route = String(route);
  if (trackId) a.dataset.trackId = String(trackId);
  if (customPlaylistId) a.dataset.customPlaylistId = String(customPlaylistId);
  if (folderId) a.dataset.folderId = String(folderId);

  a.dataset.dbg = "sidebar-item";
  a.dataset.dbgType = "sidebar-item";
  a.dataset.dbgId = String(customPlaylistId || folderId || entityId || route || trackId || "");
  a.dataset.dbgDesc = String(title || "");

  a.dataset.sortTitle = sortTitle;
  a.dataset.sortCreator = sortCreator;
  a.dataset.sortRecent = sortRecent;
  a.dataset.sortAdded = sortAdded;
  a.dataset.searchMeta = searchMeta;

  const isFolder = category === "folder" || route === "folder";
  const isCustomPlaylist = Boolean(customPlaylistId);
  const hasImage = String(imageUrl || "").trim();
  
  const cover = document.createElement("div");
  cover.className = `cover${
    route === "liked" ? " cover--liked" : route === "downloads" ? " cover--downloads" : isFolder ? " cover--folder" : (isCustomPlaylist && !hasImage) ? " cover--custom-playlist" : category === "artist" ? " cover--artist" : ""
  }`;
  cover.setAttribute("aria-hidden", "true");

  if (route === "liked" || route === "downloads") {
    const icon = document.createElement("i");
    icon.className = route === "liked" ? "ri-heart-fill cover__icon" : "ri-download-2-fill cover__icon";
    icon.setAttribute("aria-hidden", "true");
    cover.appendChild(icon);
  } else if (isFolder) {
    const icon = document.createElement("i");
    icon.className = "ri-folder-3-fill cover__icon";
    icon.setAttribute("aria-hidden", "true");
    cover.appendChild(icon);
  } else if (isCustomPlaylist && !hasImage) {
    const icon = document.createElement("i");
    icon.className = "ri-music-2-fill cover__icon";
    icon.setAttribute("aria-hidden", "true");
    cover.appendChild(icon);
  } else {
    const img = document.createElement("img");
    img.className = "cover--img";
    img.alt = "";
    if (hasImage) img.src = hasImage;
    cover.appendChild(img);
  }

  const play = document.createElement("span");
  play.className = "cover__play";
  play.setAttribute("aria-hidden", "true");
  const playIcon = document.createElement("i");
  playIcon.className = "ri-play-fill cover__playIcon cover__playIcon--play";
  playIcon.setAttribute("aria-hidden", "true");
  play.appendChild(playIcon);
  const pauseIcon = document.createElement("i");
  pauseIcon.className = "ri-pause-fill cover__playIcon cover__playIcon--pause";
  pauseIcon.setAttribute("aria-hidden", "true");
  play.appendChild(pauseIcon);
  cover.appendChild(play);

  const viz = document.createElement("span");
  viz.className = "cover__viz";
  viz.setAttribute("aria-hidden", "true");
  viz.innerHTML = '<span class="playing-viz"><span></span><span></span><span></span></span>';
  cover.appendChild(viz);

  const meta = document.createElement("div");
  meta.className = "library-item__meta";
  const titleEl = document.createElement("div");
  titleEl.className = "library-item__title";
  titleEl.textContent = String(title || "");
  const subtitleEl = document.createElement("div");
  subtitleEl.className = "library-item__subtitle";
  if (subtitlePinned) {
    const pinIcon = document.createElement("i");
    pinIcon.className = "ri-pushpin-fill pin-icon";
    pinIcon.setAttribute("aria-hidden", "true");
    subtitleEl.appendChild(pinIcon);
    subtitleEl.appendChild(document.createTextNode(" "));
  }
  subtitleEl.appendChild(document.createTextNode(String(subtitle || "")));

  meta.appendChild(titleEl);
  meta.appendChild(subtitleEl);
  a.appendChild(cover);
  a.appendChild(meta);

  if (isFolder) {
    a.style.gridTemplateColumns = "56px 1fr auto";
    const chevron = document.createElement("button");
    chevron.type = "button";
    chevron.className = "library-item__chevron";
    chevron.setAttribute("aria-label", "Toggle folder");
    chevron.innerHTML = '<i class="ri-arrow-down-s-line" aria-hidden="true"></i>';
    a.appendChild(chevron);
  }

  return a;
}
