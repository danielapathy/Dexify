const path = require("node:path");

function createDownloadLibraryPaths({ downloadsDir, toIdString, normalizeQuality }) {
  const rootDir = path.join(String(downloadsDir || ""), "library");
  const albumsRoot = path.join(rootDir, "albums");
  const playlistsRoot = path.join(rootDir, "playlists");
  const orphansRoot = path.join(rootDir, "orphans");
  const stagingRoot = path.join(rootDir, "__staging");
  const dbPath = path.join(rootDir, "db.json");

  const getPaths = () => ({ rootDir, albumsRoot, playlistsRoot, orphansRoot, stagingRoot, dbPath });
  const getAlbumDir = (albumId) => path.join(albumsRoot, toIdString(albumId) || "0");
  const getAlbumJsonPath = (albumId) => path.join(getAlbumDir(albumId), "album.json");
  const getAlbumCoverPath = (albumId) => path.join(getAlbumDir(albumId), "cover.jpg");
  const getTrackDir = ({ albumId, trackId }) => path.join(getAlbumDir(albumId), "tracks", toIdString(trackId) || "0");
  const getTrackQualityDir = ({ albumId, trackId, quality }) =>
    path.join(getTrackDir({ albumId, trackId }), normalizeQuality(quality) || "unknown");
  const getTrackJsonPath = ({ albumId, trackId, quality }) => path.join(getTrackQualityDir({ albumId, trackId, quality }), "track.json");
  const stageDirForUuid = (_uuid) => path.join(stagingRoot, `job_${Date.now()}_${Math.random().toString(16).slice(2)}`);

  return {
    rootDir,
    albumsRoot,
    playlistsRoot,
    orphansRoot,
    stagingRoot,
    dbPath,
    getPaths,
    getAlbumDir,
    getAlbumJsonPath,
    getAlbumCoverPath,
    getTrackDir,
    getTrackQualityDir,
    getTrackJsonPath,
    stageDirForUuid,
  };
}

module.exports = { createDownloadLibraryPaths };
