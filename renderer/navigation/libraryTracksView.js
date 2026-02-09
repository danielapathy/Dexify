function resolveTrackCoverUrl(track) {
  return (
    String(track?.album?.cover_small || track?.album?.cover_medium || track?.album?.cover || "") ||
    (typeof track?.ALB_PICTURE === "string" && /^[a-f0-9]{32}$/i.test(track.ALB_PICTURE)
      ? `https://cdn-images.dzcdn.net/images/cover/${track.ALB_PICTURE}/100x100-000000-80-0-0.jpg`
      : "")
  );
}

export function renderLibraryHeader({ container, title, subtitleText, gradientCss, iconClass }) {
  const header = document.createElement("div");
  header.className = "entity-header";

  const coverEl = document.createElement("div");
  coverEl.className = "entity-cover";
  coverEl.style.background = gradientCss;
  coverEl.innerHTML = `<div style="height:100%;display:grid;place-items:center;"><i class="${iconClass}" style="font-size:46px;color:rgba(255,255,255,0.94)"></i></div>`;

  const meta = document.createElement("div");
  meta.className = "entity-meta";
  const h1 = document.createElement("div");
  h1.className = "entity-title";
  h1.textContent = String(title || "");
  const sub = document.createElement("div");
  sub.className = "entity-subtitle";
  sub.textContent = String(subtitleText || "");
  meta.appendChild(h1);
  meta.appendChild(sub);

  header.appendChild(coverEl);
  header.appendChild(meta);
  container.appendChild(header);
  return { header, subtitleEl: sub };
}

export function renderLibraryEmptyCallout({ container, title, description }) {
  const empty = document.createElement("div");
  empty.className = "empty-callout";
  empty.innerHTML =
    '<div class="empty-callout__icon"><i class="ri-emotion-happy-line" aria-hidden="true"></i></div>' +
    `<div class="empty-callout__text"><strong>${String(title || "")}</strong><br/>${String(description || "")}</div>`;
  container.appendChild(empty);
}

export function buildLibraryTrackList({ tracks, pageContext, formatDuration, lib, registerTrackList, likeAriaLabel }) {
  const list = document.createElement("div");
  list.className = "entity-tracks entity-tracks--with-covers";
  registerTrackList(list, tracks, { pageContext });

  let i = 0;
  for (const t of tracks) {
    const row = document.createElement("div");
    row.className = "entity-track";
    row.dataset.trackIndex = String(i);
    const trackId = Number(t?.id || t?.SNG_ID);
    if (Number.isFinite(trackId) && trackId > 0) row.dataset.trackId = String(trackId);
    const albumId = Number(t?.album?.id || t?.ALB_ID || t?.ALBUM_ID || t?.album_id || t?.data?.ALB_ID || 0);
    if (Number.isFinite(albumId) && albumId > 0) row.dataset.albumId = String(albumId);
    const artistId = Number(t?.artist?.id || t?.ART_ID || t?.artist_id || t?.data?.ART_ID || 0);
    if (Number.isFinite(artistId) && artistId > 0) row.dataset.artistId = String(artistId);

    const idx = document.createElement("div");
    idx.className = "entity-track__index";
    const num = document.createElement("span");
    num.className = "entity-track__num";
    num.textContent = String(i + 1);

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

    const coverWrap = document.createElement("div");
    coverWrap.className = "entity-track__cover";
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    const coverUrl = resolveTrackCoverUrl(t);
    if (coverUrl) img.src = coverUrl;
    coverWrap.appendChild(img);

    const main = document.createElement("div");
    main.className = "entity-track__main";
    const tt = document.createElement("div");
    tt.className = "entity-track__title";
    tt.textContent = String(t?.title || t?.SNG_TITLE || "");
    const ta = document.createElement("div");
    ta.className = "entity-track__artist";
    ta.textContent = String(t?.artist?.name || t?.ART_NAME || "");
    main.appendChild(tt);
    main.appendChild(ta);

    const dur = document.createElement("div");
    dur.className = "entity-track__duration";
    dur.textContent = formatDuration(t?.duration || t?.DURATION || 0);

    row.appendChild(idx);
    row.appendChild(coverWrap);
    row.appendChild(main);

    const like = document.createElement("button");
    like.type = "button";
    like.className = "entity-track__like";
    like.setAttribute("aria-label", String(likeAriaLabel || "Like"));
    like.innerHTML = `<i class="${lib.isTrackSaved(trackId) ? "ri-heart-fill" : "ri-heart-line"}" aria-hidden="true"></i>`;
    row.appendChild(like);
    row.appendChild(dur);
    list.appendChild(row);
    i++;
  }

  return list;
}
