import { normalizeRecordType, readJsonFromLocalStorage, writeJsonToLocalStorage } from "./utils.js";
import { createRecentTracksApi } from "./localLibrary/recentTracksApi.js";
import { createSavedCollectionsApi } from "./localLibrary/savedCollectionsApi.js";
import { createSavedTracksApi } from "./localLibrary/savedTracksApi.js";
import { createCustomPlaylistsApi } from "./localLibrary/customPlaylistsApi.js";
import { createFoldersApi } from "./localLibrary/foldersApi.js";
import { compactTrackJson, coverFromTrack, md5ToCoverUrl } from "./localLibrary/trackModels.js";

const KEY = "spotify.localLibrary.v1";
const CHANGED_EVENT = "local-library:changed";

const defaultState = () => ({
  savedTracks: {},
  downloadedTracks: {},
  savedAlbums: {},
  playlists: {},
  recentTracks: [],
  customPlaylists: {},
  folders: {},
});

export function createLocalLibrary() {
  const load = () => {
    const parsed = readJsonFromLocalStorage(KEY, null);
    if (!parsed || typeof parsed !== "object") return defaultState();
    return {
      ...defaultState(),
      ...parsed,
      savedTracks: parsed.savedTracks && typeof parsed.savedTracks === "object" ? parsed.savedTracks : {},
      downloadedTracks: parsed.downloadedTracks && typeof parsed.downloadedTracks === "object" ? parsed.downloadedTracks : {},
      savedAlbums: parsed.savedAlbums && typeof parsed.savedAlbums === "object" ? parsed.savedAlbums : {},
      playlists: parsed.playlists && typeof parsed.playlists === "object" ? parsed.playlists : {},
      recentTracks: Array.isArray(parsed.recentTracks) ? parsed.recentTracks : [],
      customPlaylists: parsed.customPlaylists && typeof parsed.customPlaylists === "object" ? parsed.customPlaylists : {},
      folders: parsed.folders && typeof parsed.folders === "object" ? parsed.folders : {},
    };
  };

  const save = (next) => writeJsonToLocalStorage(KEY, next);
  const notify = () => window.dispatchEvent(new CustomEvent(CHANGED_EVENT));

  const mutate = (fn) => {
    if (typeof fn !== "function") return false;
    const next = load();
    let dirty = false;
    const markDirty = () => {
      dirty = true;
    };
    try {
      fn(next, { markDirty });
    } catch {
      return false;
    }
    if (!dirty) return false;
    save(next);
    notify();
    return true;
  };

  const savedTracksApi = createSavedTracksApi({
    load,
    save,
    notify,
    compactTrackJson,
    coverFromTrack,
  });

  const savedCollectionsApi = createSavedCollectionsApi({
    load,
    save,
    notify,
    normalizeRecordType,
    md5ToCoverUrl,
  });

  const recentTracksApi = createRecentTracksApi({
    load,
    save,
    notify,
    compactTrackJson,
    coverFromTrack,
  });

  const customPlaylistsApi = createCustomPlaylistsApi({ load, save, notify });
  const foldersApi = createFoldersApi({ load, save, notify });

  return {
    load,
    mutate,
    ...savedTracksApi,
    ...savedCollectionsApi,
    ...recentTracksApi,
    ...customPlaylistsApi,
    ...foldersApi,
  };
}

export function getLocalLibrary() {
  return window.__localLibrary || (window.__localLibrary = createLocalLibrary());
}
