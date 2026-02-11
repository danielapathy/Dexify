export function createEntitySections({
  registerTrackList,
  downloadBadges,
  formatDuration,
  lib,
  formatRecordTypeLabel,
  formatFansCountText,
}) {
  const buildTrackList = ({ type, entityId, tracks, pageContext, showCovers, showDownloadStatus, limit = 200 }) => {
    const all = Array.isArray(tracks) ? tracks : [];
    const rows = all.slice(0, limit);
    if (rows.length === 0) return null;
    const downloadedTracks = (() => {
      try {
        const st = lib?.load?.() || {};
        return st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
      } catch {
        return {};
      }
    })();
    const isTrackDownloaded = (track, trackId) => {
      if (type === "playlist") {
        const t = track && typeof track === "object" ? track : null;
        if (t && Object.prototype.hasOwnProperty.call(t, "__missing")) return !Boolean(t.__missing);
      }
      const tid = Number(trackId);
      if (!Number.isFinite(tid) || tid <= 0) return false;
      const row = downloadedTracks[String(tid)] && typeof downloadedTracks[String(tid)] === "object" ? downloadedTracks[String(tid)] : null;
      const fileUrl = row?.download?.fileUrl ? String(row.download.fileUrl) : "";
      return Boolean(fileUrl);
    };

    const list = document.createElement("div");
    list.className = `entity-tracks${showCovers ? " entity-tracks--with-covers" : ""}${showDownloadStatus ? " entity-tracks--dl" : ""}`;
    registerTrackList(list, all, { pageContext });

	    let index = 1;
	    for (const t of rows) {
      const row = document.createElement("div");
      row.className = "entity-track";
      row.dataset.trackIndex = String(index - 1);
      const trackId = Number(t?.id || t?.SNG_ID);
      if (Number.isFinite(trackId) && trackId > 0) row.dataset.trackId = String(trackId);
      if (showDownloadStatus) {
        const downloaded = isTrackDownloaded(t, trackId);
        row.dataset.downloaded = downloaded ? "1" : "0";
        if (type === "playlist" || type === "album") row.dataset.selectDisabled = downloaded ? "0" : "1";
      }
	      const albumId = Number(t?.album?.id || t?.ALB_ID || t?.ALBUM_ID || t?.album_id || t?.data?.ALB_ID || 0);
	      if (Number.isFinite(albumId) && albumId > 0) row.dataset.albumId = String(albumId);
	      const artistId = Number(t?.artist?.id || t?.ART_ID || t?.artist_id || t?.data?.ART_ID || 0);
	      if (Number.isFinite(artistId) && artistId > 0) row.dataset.artistId = String(artistId);
      if (!row.dataset.artistId && type === "artist") {
        const fallbackArtistId = Number(entityId);
        if (Number.isFinite(fallbackArtistId) && fallbackArtistId > 0) row.dataset.artistId = String(fallbackArtistId);
      }
      if (!row.dataset.albumId && type === "album") {
        const fallbackAlbumId = Number(entityId);
        if (Number.isFinite(fallbackAlbumId) && fallbackAlbumId > 0) row.dataset.albumId = String(fallbackAlbumId);
      }

      const coverUrl =
        String(
          t?.album?.cover_small ||
            t?.album?.cover_medium ||
            t?.album?.cover ||
            (typeof t?.ALB_PICTURE === "string" && /^[a-f0-9]{32}$/i.test(t.ALB_PICTURE)
              ? `https://cdn-images.dzcdn.net/images/cover/${t.ALB_PICTURE}/100x100-000000-80-0-0.jpg`
              : "") ||
            "",
        ) || "";

      const idx = document.createElement("div");
      idx.className = "entity-track__index";
      const num = document.createElement("span");
      num.className = "entity-track__num";
      num.textContent = String(index++);

      const play = document.createElement("span");
      play.className = "entity-track__hoverPlay";
      play.setAttribute("aria-hidden", "true");
      play.innerHTML = '<i class="ri-play-fill" aria-hidden="true"></i>';

      const viz = document.createElement("span");
      viz.className = "entity-track__viz";
      viz.setAttribute("aria-hidden", "true");
      viz.innerHTML = '<span class="playing-viz"><span></span><span></span><span></span></span>';

      idx.appendChild(num);
      idx.appendChild(play);
      idx.appendChild(viz);

      if (showCovers) {
        const coverWrap = document.createElement("div");
        coverWrap.className = "entity-track__cover";
        const img3 = document.createElement("img");
        img3.alt = "";
        img3.loading = "lazy";
        if (coverUrl) img3.src = coverUrl;
        coverWrap.appendChild(img3);

        row.appendChild(idx);
        row.appendChild(coverWrap);
      } else {
        row.appendChild(idx);
      }

      const main = document.createElement("div");
      main.className = "entity-track__main";
      const titleText = String(t?.title || t?.SNG_TITLE || "");
      const artistText = String(t?.artist?.name || t?.ART_NAME || "");
      const tt = document.createElement("div");
      tt.className = "entity-track__title";
      tt.textContent = titleText || (trackId ? `Track #${trackId}` : "");
      const ta = document.createElement("div");
      ta.className = "entity-track__artist";
      ta.textContent = artistText;
      main.appendChild(tt);
      main.appendChild(ta);
      try {
        const albumId = Number(t?.album?.id || t?.ALB_ID);
        const albumTitle = String(t?.album?.title || t?.ALB_TITLE || "");
        downloadBadges.rememberMeta({
          trackId,
          title: titleText,
          artist: artistText,
          cover: coverUrl,
          albumId: Number.isFinite(albumId) && albumId > 0 ? albumId : null,
          albumTitle,
        });
      } catch {}

      const dur = document.createElement("div");
      dur.className = "entity-track__duration";
      dur.textContent = formatDuration(t?.duration || t?.DURATION || 0);

      row.appendChild(main);
	      const like = document.createElement("button");
      like.type = "button";
      like.className = "entity-track__like";
      like.setAttribute("aria-label", "Like");
      like.innerHTML = `<i class="${lib.isTrackSaved(trackId) ? "ri-heart-fill" : "ri-heart-line"}" aria-hidden="true"></i>`;
      row.appendChild(like);
	      if (showDownloadStatus) {
	        const dl = document.createElement("span");
	        dl.className = "entity-track__download";
	        dl.setAttribute("aria-hidden", "true");
	        dl.innerHTML = '<i class="ri-download-2-line" aria-hidden="true"></i>';
	        row.appendChild(dl);
	      }
      row.appendChild(dur);
      if (showDownloadStatus) {
        try {
          downloadBadges.applyToRow(row);
        } catch {}
      }
      list.appendChild(row);
    }

    return list;
  };

  const renderTrackSection = ({ container, type, entityId, title, tracks, pageContext, showCovers, showDownloadStatus, limit }) => {
    const list = buildTrackList({ type, entityId, tracks, pageContext, showCovers, showDownloadStatus, limit });
    if (!list) return false;
    if (!title) {
      container.appendChild(list);
      return true;
    }

    const section = document.createElement("section");
    section.className = "made-for";
    const header = document.createElement("div");
    header.className = "made-for__header";
    const titles = document.createElement("div");
    titles.className = "made-for__titles";
    const h2 = document.createElement("h2");
    h2.className = "h2 h2--small";
    h2.textContent = title;
    titles.appendChild(h2);
    header.appendChild(titles);
    section.appendChild(header);
    section.appendChild(list);
    container.appendChild(section);
    return true;
  };

  const renderCarouselSection = ({ container, title, items, kind, limit = 18 }) => {
    const rows = Array.isArray(items) ? items.slice(0, limit).filter((x) => x && typeof x === "object" && x.id) : [];
    if (rows.length === 0) return false;

    const section = document.createElement("section");
    section.className = "made-for";
    const header = document.createElement("div");
    header.className = "made-for__header";
    const titles = document.createElement("div");
    titles.className = "made-for__titles";
    const h2 = document.createElement("h2");
    h2.className = "h2 h2--small";
    h2.textContent = title;
    titles.appendChild(h2);
    header.appendChild(titles);
    section.appendChild(header);

    const carousel = document.createElement("div");
    carousel.className = "carousel";
    carousel.setAttribute("role", "list");

    for (const item of rows) {
      const card = document.createElement("a");
      card.className = "big-card";
      card.href = "#";
      card.setAttribute("role", "listitem");

      let target = "";
      let coverUrl = "";
      let titleText = "";
      let subtitleText = "";

      if (kind === "album") {
        target = `/album/${String(item.id)}`;
        coverUrl = String(item?.cover_medium || item?.cover || "");
        titleText = String(item?.title || "Album");
        subtitleText = formatRecordTypeLabel(item?.record_type || item?.recordType, { fallback: "Album" });
      } else if (kind === "playlist") {
        target = `/playlist/${String(item.id)}`;
        coverUrl = String(item?.picture_medium || item?.picture || item?.cover_medium || item?.cover || "");
        titleText = String(item?.title || "Playlist");
        const creator = String(item?.creator?.name || item?.user?.name || "");
        subtitleText = creator ? creator : "Playlist";
      } else if (kind === "artist") {
        target = `/artist/${String(item.id)}`;
        coverUrl = String(item?.picture_medium || item?.picture || "");
        titleText = String(item?.name || "Artist");
        const fans = Number(item?.nb_fan || 0);
        subtitleText = fans > 0 ? formatFansCountText(`${fans} fans`) : "Artist";
      }

      if (target) card.dataset.target = target;

      const cover2 = document.createElement("div");
      cover2.className = "big-card__cover";
      const img2 = document.createElement("img");
      img2.alt = "";
      img2.loading = "lazy";
      if (coverUrl) img2.src = coverUrl;
      cover2.appendChild(img2);

      const t2 = document.createElement("div");
      t2.className = "big-card__title";
      t2.textContent = titleText;
      const st2 = document.createElement("div");
      st2.className = "big-card__subtitle";
      st2.textContent = subtitleText;

      card.appendChild(cover2);
      card.appendChild(t2);
      card.appendChild(st2);
      carousel.appendChild(card);
    }

    section.appendChild(carousel);
    container.appendChild(section);
    return true;
  };

  return { buildTrackList, renderTrackSection, renderCarouselSection };
}
