// Notifications store (ES module).
function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  if (n >= 100) return 100;
  return n;
}

function isActiveStatus(status) {
  const s = String(status || "");
  return s === "queued" || s === "downloading" || s === "cancelling";
}

function isTerminalStatus(status) {
  const s = String(status || "");
  return s === "done" || s === "failed" || s === "cancelled";
}

function parseDownloadUuid(uuidRaw) {
  const uuid = String(uuidRaw || "").trim();
  if (!uuid) return null;

  let match = uuid.match(/^album_(\d+)_track_(\d+)_(\d+)/);
  if (match) {
    const albumId = Number(match[1]);
    const trackId = Number(match[2]);
    return {
      uuid,
      kind: "album",
      groupKey: `album:${albumId}`,
      groupPrefix: `album_${albumId}_track_`,
      albumId: Number.isFinite(albumId) ? albumId : null,
      trackId: Number.isFinite(trackId) ? trackId : null,
      bitrate: Number(match[3]),
    };
  }

  match = uuid.match(/^playlist_(\d+)_track_(\d+)_(\d+)/);
  if (match) {
    const playlistId = Number(match[1]);
    const trackId = Number(match[2]);
    return {
      uuid,
      kind: "playlist",
      groupKey: `playlist:${playlistId}`,
      groupPrefix: `playlist_${playlistId}_track_`,
      playlistId: Number.isFinite(playlistId) ? playlistId : null,
      trackId: Number.isFinite(trackId) ? trackId : null,
      bitrate: Number(match[3]),
    };
  }

  match = uuid.match(/^artist_(\d+)_album_(\d+)_track_(\d+)_(\d+)/);
  if (match) {
    const artistId = Number(match[1]);
    const albumId = Number(match[2]);
    const trackId = Number(match[3]);
    return {
      uuid,
      kind: "artist",
      groupKey: `artist:${artistId}:album:${albumId}`,
      groupPrefix: `artist_${artistId}_album_${albumId}_track_`,
      artistId: Number.isFinite(artistId) ? artistId : null,
      albumId: Number.isFinite(albumId) ? albumId : null,
      trackId: Number.isFinite(trackId) ? trackId : null,
      bitrate: Number(match[4]),
    };
  }

  match = uuid.match(/^(?:track|dl)_(\d+)_(\d+)/) || uuid.match(/(?:^|_)track_(\d+)_(\d+)/);
  if (match) {
    const trackId = Number(match[1]);
    return {
      uuid,
      kind: "track",
      groupKey: `track:${trackId}`,
      groupPrefix: null,
      trackId: Number.isFinite(trackId) ? trackId : null,
      bitrate: Number(match[2]),
    };
  }

  return {
    uuid,
    kind: "other",
    groupKey: `uuid:${uuid}`,
    groupPrefix: null,
    trackId: null,
    bitrate: null,
  };
}

function qualityLabelFromBitrate(bitrate) {
  const n = Number(bitrate);
  if (n === 9) return "FLAC";
  if (n === 3) return "MP3 320";
  if (n === 1) return "MP3 128";
  return "Audio";
}

function kindLabelFor(item) {
  const kind = String(item?.kind || "");
  if (kind === "album") return "Album";
  if (kind === "playlist") return "Playlist";
  if (kind === "artist") return "Artist";
  if (kind === "track") return "Song";
  return "Download";
}

function formatRelativeTime(timestamp) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const deltaMs = Date.now() - ts;
  if (!Number.isFinite(deltaMs)) return "";
  const sec = Math.max(0, Math.floor(deltaMs / 1000));
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export { clampPercent, isActiveStatus, isTerminalStatus, parseDownloadUuid, qualityLabelFromBitrate, kindLabelFor, formatRelativeTime };

function getMetaFromStore(lib, trackId) {
  try {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const map = window.__downloadMetaById && typeof window.__downloadMetaById === "object" ? window.__downloadMetaById : null;
    if (!map) return null;
    const meta = map[String(id)];
    return meta && typeof meta === "object" ? meta : null;
  } catch {
    return null;
  }
}

export function createNotificationsStore({
  lib,
  historyKey = "spotify.notifications.history.v1",
  maxHistory = 180,
} = {}) {
  const downloads = new Map();
  const groupPlans = new Map(); // groupKey -> { kind, groupKey, groupPrefix, total, startedAt, title, artist, cover, albumTitle, albumId, playlistId }
  let hydrateDone = false;
  let persistTimer = 0;
  let lastPersistedRaw = "";

  const remove = (uuidRaw) => {
    const uuid = String(uuidRaw || "").trim();
    if (!uuid) return false;
    const prev = downloads.get(uuid);
    if (!prev) return false;
    downloads.delete(uuid);
    if (isTerminalStatus(prev?.status)) schedulePersist();
    return true;
  };

  const prune = () => {
    const active = [];
    const terminal = [];
    for (const item of downloads.values()) {
      if (isActiveStatus(item.status)) active.push(item);
      else if (isTerminalStatus(item.status)) terminal.push(item);
    }
    terminal.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const keepTerminal = terminal.slice(0, maxHistory);

    const next = new Map();
    for (const item of active) next.set(String(item.uuid || ""), item);
    for (const item of keepTerminal) next.set(String(item.uuid || ""), item);
    downloads.clear();
    for (const [k, v] of next.entries()) downloads.set(k, v);

    // Drop stale group plans if we no longer have any corresponding active members.
    // Plans are used to stabilize UI during a running group download; they don't need to persist forever.
    try {
      const activeGroupKeys = new Set();
      for (const item of active) {
        const kind = String(item?.kind || "");
        const groupKey = String(item?.groupKey || "");
        const groupPrefix = item?.groupPrefix ? String(item.groupPrefix) : "";
        const isGroupable = (kind === "album" || kind === "playlist") && groupKey && groupPrefix;
        if (isGroupable) activeGroupKeys.add(groupKey);
      }
      for (const [k, plan] of Array.from(groupPlans.entries())) {
        const startedAt = Number(plan?.startedAt) || 0;
        const tooOld = startedAt > 0 && Date.now() - startedAt > 1000 * 60 * 30; // 30 minutes
        if (!activeGroupKeys.has(k) && tooOld) groupPlans.delete(k);
      }
    } catch {}
  };

  const schedulePersist = () => {
    if (persistTimer) return;
    persistTimer = window.setTimeout(() => {
      persistTimer = 0;
      try {
        const items = Array.from(downloads.values())
          .filter((item) => isTerminalStatus(item.status))
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          .slice(0, maxHistory)
          .map((item) => ({
            uuid: String(item.uuid || ""),
            kind: String(item.kind || "other"),
            groupKey: String(item.groupKey || ""),
            groupPrefix: item.groupPrefix ? String(item.groupPrefix) : null,
            trackId: Number.isFinite(Number(item.trackId)) ? Number(item.trackId) : null,
            albumId: Number.isFinite(Number(item.albumId)) ? Number(item.albumId) : null,
            playlistId: Number.isFinite(Number(item.playlistId)) ? Number(item.playlistId) : null,
            artistId: Number.isFinite(Number(item.artistId)) ? Number(item.artistId) : null,
            status: String(item.status || "done"),
            progress: clampPercent(item.progress) ?? 0,
            bitrate: Number.isFinite(Number(item.bitrate)) ? Number(item.bitrate) : null,
            title: String(item.title || ""),
            artist: String(item.artist || ""),
            cover: String(item.cover || ""),
            albumTitle: String(item.albumTitle || ""),
            updatedAt: Number(item.updatedAt) || Date.now(),
            errorMessage: String(item.errorMessage || ""),
          }));

        const raw = JSON.stringify(items);
        if (raw === lastPersistedRaw) return;
        lastPersistedRaw = raw;
        localStorage.setItem(historyKey, raw);
      } catch {}
    }, 140);
  };

  const loadPersistedHistory = () => {
    let rows = [];
    try {
      const raw = localStorage.getItem(historyKey);
      const parsed = raw ? JSON.parse(raw) : null;
      rows = Array.isArray(parsed) ? parsed : [];
      lastPersistedRaw = raw || "";
    } catch {
      rows = [];
    }

    for (const row of rows) {
      const uuid = String(row?.uuid || "").trim();
      if (!uuid || downloads.has(uuid)) continue;
      const status = String(row?.status || "");
      if (!isTerminalStatus(status)) continue;
      downloads.set(uuid, {
        uuid,
        kind: String(row?.kind || "other"),
        groupKey: String(row?.groupKey || `uuid:${uuid}`),
        groupPrefix: row?.groupPrefix ? String(row.groupPrefix) : null,
        trackId: Number.isFinite(Number(row?.trackId)) ? Number(row.trackId) : null,
        albumId: Number.isFinite(Number(row?.albumId)) ? Number(row.albumId) : null,
        playlistId: Number.isFinite(Number(row?.playlistId)) ? Number(row.playlistId) : null,
        artistId: Number.isFinite(Number(row?.artistId)) ? Number(row.artistId) : null,
        status,
        progress: clampPercent(row?.progress) ?? (status === "done" ? 100 : 0),
        bitrate: Number.isFinite(Number(row?.bitrate)) ? Number(row.bitrate) : null,
        title: String(row?.title || ""),
        artist: String(row?.artist || ""),
        cover: String(row?.cover || ""),
        albumTitle: String(row?.albumTitle || ""),
        updatedAt: Number(row?.updatedAt) || Date.now(),
        errorMessage: String(row?.errorMessage || ""),
      });
    }
  };

  const clearHistory = () => {
    for (const [k, v] of Array.from(downloads.entries())) {
      if (isTerminalStatus(v?.status)) downloads.delete(k);
    }
    try {
      localStorage.removeItem(historyKey);
    } catch {}
    lastPersistedRaw = "";
  };

  const upsertFromEvent = (payload) => {
    const event = String(payload?.event || "");
    const data = payload?.data && typeof payload.data === "object" ? payload.data : {};

    if (event === "downloadGroupPlanned") {
      const groupKey = String(data?.groupKey || "").trim();
      const groupPrefix = String(data?.groupPrefix || "").trim();
      const kind = String(data?.kind || "").trim();
      const total0 = Number(data?.total);
      const total = Number.isFinite(total0) && total0 >= 0 ? total0 : 0;
      if (!groupKey || !groupPrefix || (kind !== "album" && kind !== "playlist")) return { changed: false, uuid: null, event };

      const startedAt0 = Number(data?.startedAt);
      const startedAt = Number.isFinite(startedAt0) && startedAt0 > 0 ? startedAt0 : Date.now();
      const prev = groupPlans.get(groupKey) || null;
      groupPlans.set(groupKey, {
        kind,
        groupKey,
        groupPrefix,
        total,
        startedAt,
        title: String(data?.title || prev?.title || ""),
        artist: String(data?.artist || prev?.artist || ""),
        cover: String(data?.cover || prev?.cover || ""),
        albumTitle: String(data?.albumTitle || prev?.albumTitle || ""),
        albumId: Number.isFinite(Number(data?.albumId)) ? Number(data.albumId) : prev?.albumId || null,
        playlistId: Number.isFinite(Number(data?.playlistId)) ? Number(data.playlistId) : prev?.playlistId || null,
        status: prev?.status ? String(prev.status) : "queued",
      });
      return { changed: true, uuid: groupKey, event };
    }

    if (event === "downloadGroupCancelRequested" || event === "downloadGroupCancelled") {
      const groupKey = String(data?.groupKey || "").trim();
      if (!groupKey) return { changed: false, uuid: null, event };
      const prev = groupPlans.get(groupKey) || null;
      if (!prev) return { changed: true, uuid: groupKey, event };
      const next = { ...prev, status: event === "downloadGroupCancelRequested" ? "cancelling" : "cancelled" };
      groupPlans.set(groupKey, next);
      return { changed: true, uuid: groupKey, event };
    }

    const uuid = String(data?.uuid || "").trim();
    if (!uuid) return { changed: false, uuid: null, event };

    const parsed = parseDownloadUuid(uuid);
    const parsedTrackId = Number(parsed?.trackId);
    const fromDataTrackId = Number(data?.id);
    const trackId =
      Number.isFinite(fromDataTrackId) && fromDataTrackId > 0
        ? fromDataTrackId
        : Number.isFinite(parsedTrackId) && parsedTrackId > 0
          ? parsedTrackId
          : null;

    const meta = trackId ? getMetaFromStore(lib, trackId) : null;
    const prev =
      downloads.get(uuid) || {
        uuid,
        kind: parsed?.kind || "other",
        groupKey: parsed?.groupKey || `uuid:${uuid}`,
        groupPrefix: parsed?.groupPrefix || null,
        trackId: trackId || null,
        albumId: parsed?.albumId || null,
        playlistId: parsed?.playlistId || null,
        artistId: parsed?.artistId || null,
        status: "queued",
        progress: 0,
        bitrate: Number.isFinite(parsed?.bitrate) ? parsed.bitrate : null,
        title: "",
        artist: "",
        cover: "",
        albumTitle: "",
        updatedAt: 0,
        errorMessage: "",
      };

    const prevStatus = String(prev.status || "");
    const prevProgress = clampPercent(prev.progress) ?? 0;
    const prevErr = String(prev.errorMessage || "");

    const next = { ...prev };
    const now = Date.now();
    // Avoid UI churn: progress updates can be very frequent; keep ordering stable by not
    // bumping timestamps on every tick.
    next.updatedAt = event === "updateQueue" ? Number(prev.updatedAt) || now : now;
    if (trackId) next.trackId = trackId;
    if (!next.albumId && Number.isFinite(Number(meta?.albumId))) next.albumId = Number(meta.albumId);
    if (!next.albumTitle && meta?.albumTitle) next.albumTitle = String(meta.albumTitle);
    if (meta?.title) next.title = String(meta.title);
    if (meta?.artist) next.artist = String(meta.artist);
    if (meta?.cover) next.cover = String(meta.cover);

    if (event === "downloadRequested") {
      next.status = "queued";
      next.progress = 0;
      next.errorMessage = "";
      if (!next.title && trackId) next.title = `Track #${trackId}`;
      if (!next.cover && data?.coverUrl) next.cover = String(data.coverUrl);
      if (!next.albumTitle && data?.albumTitle) next.albumTitle = String(data.albumTitle);
    } else if (event === "updateQueue") {
      next.status = "downloading";
      const progress = clampPercent(data?.progress);
      if (progress !== null) next.progress = progress;
      if (data.downloaded || data.alreadyDownloaded) next.progress = 100;
    } else if (event === "downloadCancelRequested") {
      next.status = "cancelling";
    } else if (event === "downloadCancelled") {
      next.status = "cancelled";
      next.progress = next.progress || 0;
    } else if (event === "downloadFinished" || event === "finishDownload") {
      next.status = "done";
      next.progress = 100;
    } else if (event === "downloadFailed") {
      next.status = "failed";
      next.errorMessage = String(data?.message || data?.error || data?.err || "Download failed");
    } else {
      return { changed: false, uuid, event };
    }

    downloads.set(uuid, next);

    const nextStatus = String(next.status || "");
    const nextProgress = clampPercent(next.progress) ?? 0;
    const nextErr = String(next.errorMessage || "");
    const changed = nextStatus !== prevStatus || nextProgress !== prevProgress || nextErr !== prevErr;

    if (isTerminalStatus(nextStatus) && (!isTerminalStatus(prevStatus) || nextStatus !== prevStatus || nextErr !== prevErr)) {
      schedulePersist();
    }
    return { changed, uuid, event };
  };

  const hydrateCompletedDownloads = async () => {
    if (hydrateDone) return;
    hydrateDone = true;
    if (!window.dl?.listDownloads) return;
    try {
      const res = await window.dl.listDownloads();
      const rows = Array.isArray(res?.tracks) ? res.tracks : [];

      // Build set of trackIds already in downloads to avoid duplicates
      const existingTrackIds = new Set();
      for (const item of downloads.values()) {
        const tid = Number(item?.trackId);
        if (Number.isFinite(tid) && tid > 0) existingTrackIds.add(tid);
      }

      for (const row of rows) {
        const track = row?.track && typeof row.track === "object" ? row.track : null;
        const album =
          row?.album && typeof row.album === "object"
            ? row.album
            : track?.album && typeof track.album === "object"
              ? track.album
              : null;

        const trackId = Number(row?.trackId || track?.id || track?.SNG_ID);
        const albumId = Number(row?.albumId || album?.id || album?.ALB_ID || track?.ALB_ID);
        const quality = String(row?.bestQuality || "");
        const qualityBitrate = quality === "flac" ? 9 : quality === "mp3_320" ? 3 : quality === "mp3_128" ? 1 : null;
        const mtime = Number(row?.mtimeMs) || Date.now();
        const uuid = `stored_${Number.isFinite(trackId) ? trackId : "x"}_${quality || "unknown"}_${mtime}`;

        // Skip if we already have this track (by trackId) to prevent duplicates
        if (Number.isFinite(trackId) && trackId > 0 && existingTrackIds.has(trackId)) continue;
        if (downloads.has(uuid)) continue;

        // Mark this trackId as seen
        if (Number.isFinite(trackId) && trackId > 0) existingTrackIds.add(trackId);

        downloads.set(uuid, {
          uuid,
          kind: "track",
          groupKey: Number.isFinite(albumId) && albumId > 0 ? `album:${albumId}` : `uuid:${uuid}`,
          groupPrefix: null,
          trackId: Number.isFinite(trackId) && trackId > 0 ? trackId : null,
          albumId: Number.isFinite(albumId) && albumId > 0 ? albumId : null,
          playlistId: null,
          artistId: null,
          status: "done",
          progress: 100,
          bitrate: Number.isFinite(qualityBitrate) ? qualityBitrate : null,
          title: String(track?.title || track?.SNG_TITLE || `Track #${trackId || "?"}`),
          artist: String(track?.artist?.name || track?.ART_NAME || ""),
          cover: String(
            row?.coverUrl ||
              album?.cover_medium ||
              album?.cover ||
              track?.album?.cover_medium ||
              track?.album?.cover ||
              track?.cover ||
              "",
          ),
          albumTitle: String(album?.title || track?.ALB_TITLE || ""),
          updatedAt: mtime,
          errorMessage: "",
        });
      }
    } catch {}
  };

  const getItems = () => {
    const items = Array.from(downloads.values());
    items.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    return items.slice(0, 120);
  };

	  const getGroupedItems = () => {
	    const items = Array.from(downloads.values());
	    items.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));

	    const groups = new Map(); // groupKey -> { card, members }
	    const out = [];

	    for (const item of items) {
	      const kind = String(item?.kind || "");
	      const groupKey = String(item?.groupKey || "");
	      const groupPrefix = item?.groupPrefix ? String(item.groupPrefix) : "";
	      const isGroupable = (kind === "album" || kind === "playlist") && groupKey && groupPrefix;

	      if (!isGroupable) {
	        out.push(item);
	        continue;
	      }

	      const existing = groups.get(groupKey) || null;
	      if (!existing) {
	        const plan = groupPlans.get(groupKey) || null;
	        const plannedStartedAt = plan && Number.isFinite(Number(plan.startedAt)) ? Number(plan.startedAt) : 0;
	        const base = {
	          uuid: groupKey,
	          kind,
	          groupKey,
	          groupPrefix,
	          trackId: null,
	          albumId: Number.isFinite(Number(item?.albumId)) ? Number(item.albumId) : null,
	          playlistId: Number.isFinite(Number(item?.playlistId)) ? Number(item.playlistId) : null,
	          artistId: null,
	          status: "queued",
	          progress: 0,
	          bitrate: null,
	          title: "",
	          artist: "",
	          cover: "",
	          albumTitle: "",
	          updatedAt: Number(item?.updatedAt) || 0,
	          sortAt: plannedStartedAt || Number(item?.updatedAt) || Date.now(),
	          errorMessage: "",
	          groupUuids: [],
	          groupCount: 0,
	          groupDone: 0,
	        };
	        const entry = { card: base, members: [item] };
	        groups.set(groupKey, entry);
	        out.push(base);
	      } else {
	        existing.members.push(item);
	      }
	    }

	    // Ensure planned groups appear even before the first per-track event arrives.
	    for (const [groupKey, plan] of groupPlans.entries()) {
	      const existing = groups.get(groupKey) || null;
	      if (existing) continue;
	      const kind = String(plan?.kind || "");
	      const groupPrefix = String(plan?.groupPrefix || "");
	      if (!groupKey || !groupPrefix || (kind !== "album" && kind !== "playlist")) continue;
	      const startedAt = Number(plan?.startedAt) || Date.now();
	      const base = {
	        uuid: groupKey,
	        kind,
	        groupKey,
	        groupPrefix,
	        trackId: null,
	        albumId: Number.isFinite(Number(plan?.albumId)) ? Number(plan.albumId) : null,
	        playlistId: Number.isFinite(Number(plan?.playlistId)) ? Number(plan.playlistId) : null,
	        artistId: null,
	        status: String(plan?.status || "queued"),
	        progress: 0,
	        bitrate: null,
	        title: String(plan?.title || ""),
	        artist: String(plan?.artist || ""),
	        cover: String(plan?.cover || ""),
	        albumTitle: String(plan?.albumTitle || ""),
	        updatedAt: startedAt,
	        sortAt: startedAt,
	        errorMessage: "",
	        groupUuids: [],
	        groupCount: Number(plan?.total) || 0,
	        groupDone: 0,
	      };
	      groups.set(groupKey, { card: base, members: [] });
	      out.push(base);
	    }

	    for (const { card, members } of groups.values()) {
	      const plan = groupPlans.get(card.groupKey) || null;
	      const plannedTotal0 = Number(plan?.total);
	      const plannedTotal = Number.isFinite(plannedTotal0) && plannedTotal0 >= 0 ? plannedTotal0 : 0;
	      const total = plannedTotal > 0 ? plannedTotal : members.length;
	      const maxUpdatedAt = members.reduce((acc, m) => Math.max(acc, Number(m?.updatedAt) || 0), 0);
	      const uuids = members.map((m) => String(m?.uuid || "")).filter(Boolean);

	      let sumProgress = 0;
	      let doneCount = 0;
	      let terminalCount = 0;
	      let hasFailed = false;
	      let hasCancelled = false;
	      let hasCancelling = false;
	      let hasDownloading = false;
	      let hasQueued = false;

	      for (const m of members) {
	        const status = String(m?.status || "");
	        const progress = clampPercent(m?.progress) ?? 0;
	        const isDone = status === "done" || progress >= 100;
	        const isTerminal = isTerminalStatus(status) || isDone;
	        if (isDone) doneCount += 1;
	        if (isTerminal) terminalCount += 1;
	        if (status === "failed") hasFailed = true;
	        if (status === "cancelled") hasCancelled = true;
	        if (status === "cancelling") hasCancelling = true;
	        if (status === "downloading") hasDownloading = true;
	        if (status === "queued") hasQueued = true;
	        sumProgress += isDone ? 100 : progress;
	      }

	      const avg = total > 0 ? sumProgress / total : 0;
	      const progress = clampPercent(Math.round(avg)) ?? 0;

	      const planStatus = String(plan?.status || "");
	      const hasActiveMember = members.some((m) => {
	        const status0 = String(m?.status || "");
	        const progress0 = clampPercent(m?.progress) ?? 0;
	        return isActiveStatus(status0) && progress0 < 100;
	      });

	      const effectiveHasCancelling = hasCancelling || planStatus === "cancelling";
	      const effectiveHasCancelled = hasCancelled || planStatus === "cancelled";
	      const isPlanned = plannedTotal > 0;
	      const plannedTerminal = isPlanned ? terminalCount >= plannedTotal : members.length > 0 && terminalCount >= members.length;
	      const plannedRemaining = isPlanned ? terminalCount < plannedTotal : false;
	      const planIsTerminal = isTerminalStatus(planStatus);

	      // Important: do not flip a planned group into a terminal status just because it is temporarily idle
	      // between per-track events. A group is only "done" once *all planned members* are terminal.
	      const shouldBeActive =
	        (!plannedTerminal && hasActiveMember) || (!plannedTerminal && plannedRemaining && !planIsTerminal) || planStatus === "cancelling";

	      const status = effectiveHasCancelled
	        ? "cancelled"
	        : plannedTerminal
	          ? hasFailed
	            ? "failed"
	            : "done"
	          : shouldBeActive
	            ? effectiveHasCancelling
	              ? "cancelling"
	              : hasDownloading
	                ? "downloading"
	                : hasQueued
	                  ? "queued"
	                  : members.length > 0
	                    ? "downloading"
	                    : "queued"
	            : hasFailed
	              ? "failed"
	              : planIsTerminal
	                ? planStatus
	                : "downloading";

	      const firstWithMeta =
	        members.find((m) => (m?.albumTitle || m?.cover || m?.artist || m?.title) && typeof m === "object") || members[0] || plan || {};
	      const planTitle = String(plan?.title || "").trim();
	      const planCover = String(plan?.cover || "").trim();
	      const albumTitle = String(firstWithMeta?.albumTitle || "").trim();
	      const memberCover = String(firstWithMeta?.cover || "").trim();
	      const cover = card.kind === "playlist" ? planCover || memberCover : memberCover || planCover;
	      const artist = String(firstWithMeta?.artist || "").trim();
	      const albumId = Number.isFinite(Number(card.albumId)) ? Number(card.albumId) : null;
	      const playlistId = Number.isFinite(Number(card.playlistId)) ? Number(card.playlistId) : null;

	      const title =
	        card.kind === "album"
	          ? albumTitle || (albumId ? `Album #${albumId}` : "Album")
	          : playlistId
	            ? planTitle || `Playlist #${playlistId}`
	            : "Playlist";

	      card.updatedAt = maxUpdatedAt || card.updatedAt || Number(plan?.startedAt) || Date.now();
	      if (!card.sortAt) card.sortAt = Number(plan?.startedAt) || card.updatedAt || Date.now();
	      if (!isActiveStatus(status) && isTerminalStatus(status)) card.sortAt = card.updatedAt;
	      card.groupUuids = uuids;
	      card.groupCount = total;
	      card.groupDone = doneCount;
	      card.status = status;
	      card.progress = progress;
	      card.title = title || String(plan?.title || "");
	      card.artist = artist || String(plan?.artist || "");
	      card.cover = cover || planCover;
	      card.albumTitle = albumTitle || String(plan?.albumTitle || "");
	      card.errorMessage = hasFailed ? "Download failed" : "";
	    }

	    out.sort((a, b) => (Number(b.sortAt) || Number(b.updatedAt) || 0) - (Number(a.sortAt) || Number(a.updatedAt) || 0));
	    return out.slice(0, 120);
	  };

  const getRecentsCount = () => {
    const seen = new Set();
    let count = 0;
    for (const i of downloads.values()) {
      const status = String(i?.status || "");
      if (!isTerminalStatus(status)) continue;
      const kind = String(i?.kind || "");
      const groupKey = String(i?.groupKey || "");
      const groupPrefix = i?.groupPrefix ? String(i.groupPrefix) : "";
      const isGroupable = (kind === "album" || kind === "playlist") && groupKey && groupPrefix;
      if (isGroupable) {
        if (seen.has(groupKey)) continue;
        seen.add(groupKey);
        count += 1;
      } else {
        count += 1;
      }
    }
    // Include group plans that ended without any per-track entries.
    for (const [k, plan] of groupPlans.entries()) {
      const status = String(plan?.status || "");
      if (!isTerminalStatus(status)) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      count += 1;
    }
    return count;
  };

  const getBadgeCount = () => {
    const seen = new Set();
    let count = 0;
    for (const i of downloads.values()) {
      const status = String(i?.status || "");
      if (!isActiveStatus(status)) continue;
      const kind = String(i?.kind || "");
      const groupKey = String(i?.groupKey || "");
      const groupPrefix = i?.groupPrefix ? String(i.groupPrefix) : "";
      const isGroupable = (kind === "album" || kind === "playlist") && groupKey && groupPrefix;
      if (isGroupable) {
        if (seen.has(groupKey)) continue;
        seen.add(groupKey);
        count += 1;
      } else {
        count += 1;
      }
    }
    for (const [k, plan] of groupPlans.entries()) {
      const status = String(plan?.status || "");
      if (!isActiveStatus(status)) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      count += 1;
    }
    return count;
  };

  return {
    downloads,
    clampPercent,
    isActiveStatus,
    isTerminalStatus,
    parseDownloadUuid,
    qualityLabelFromBitrate,
    kindLabelFor,
    formatRelativeTime,
    loadPersistedHistory,
    hydrateCompletedDownloads,
    upsertFromEvent,
    prune: prune,
    clearHistory,
    remove,
    getItems,
    getGroupedItems,
    getRecentsCount,
    getBadgeCount,
  };
}
