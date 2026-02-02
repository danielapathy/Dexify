import { makeSkelBlock, makeSkelLine, measureClassTextMetrics } from "./primitives.js";

export function renderEntitySkeleton(container, { rows = 12, withActions = true } = {}) {
  container.innerHTML = "";

  const titleMetrics = measureClassTextMetrics("entity-title");
  const subtitleMetrics = measureClassTextMetrics("entity-subtitle");
  const trackTitleMetrics = measureClassTextMetrics("entity-track__title");
  const trackArtistMetrics = measureClassTextMetrics("entity-track__artist");

  const titleH = `${Math.max(18, Math.round(titleMetrics.lineHeight))}px`;
  const subtitleH = `${Math.max(12, Math.round(subtitleMetrics.lineHeight))}px`;
  const trackTitleH = `${Math.max(12, Math.round(trackTitleMetrics.lineHeight))}px`;
  const trackArtistH = `${Math.max(11, Math.round(trackArtistMetrics.lineHeight))}px`;

  const header = document.createElement("div");
  header.className = "entity-header";

  const cover = document.createElement("div");
  cover.className = "entity-cover";
  cover.appendChild(makeSkelBlock({ className: "skel--cover" }));

  const meta = document.createElement("div");
  meta.className = "entity-meta";

  const title = document.createElement("div");
  title.className = "entity-title";
  title.innerHTML = "";
  title.appendChild(makeSkelLine({ width: "62%", height: titleH, className: "skel-line--entityTitle" }));

  const subtitle = document.createElement("div");
  subtitle.className = "entity-subtitle";
  subtitle.innerHTML = "";
  subtitle.appendChild(makeSkelLine({ width: "44%", height: subtitleH }));

  meta.appendChild(title);
  meta.appendChild(subtitle);

  if (withActions) {
    const actions = document.createElement("div");
    actions.className = "entity-actions";
    const pill1 = makeSkelLine({ width: "118px", height: "36px" });
    pill1.style.borderRadius = "999px";
    const pill2 = makeSkelLine({ width: "96px", height: "36px" });
    pill2.style.borderRadius = "999px";
    actions.appendChild(pill1);
    actions.appendChild(pill2);
    meta.appendChild(actions);
  }

  header.appendChild(cover);
  header.appendChild(meta);
  container.appendChild(header);

  const list = document.createElement("div");
  list.className = "entity-tracks";

  for (let i = 0; i < rows; i++) {
    const row = document.createElement("div");
    row.className = "entity-track entity-track--skeleton";

    const idx = document.createElement("div");
    idx.className = "entity-track__index";
    const dot = makeSkelBlock({ width: "18px", height: "18px", className: "skel-round" });
    idx.appendChild(dot);

    const main = document.createElement("div");
    main.className = "entity-track__main";

    const tt = document.createElement("div");
    tt.className = "entity-track__title";
    tt.appendChild(makeSkelLine({ width: `${40 + (i % 4) * 12}%`, height: trackTitleH }));

    const ta = document.createElement("div");
    ta.className = "entity-track__artist";
    ta.appendChild(makeSkelLine({ width: `${26 + (i % 5) * 10}%`, height: trackArtistH }));

    main.appendChild(tt);
    main.appendChild(ta);

    const like = document.createElement("div");
    like.className = "entity-track__like";
    like.appendChild(makeSkelBlock({ width: "18px", height: "18px", className: "skel-round" }));

    const dur = document.createElement("div");
    dur.className = "entity-track__duration";
    dur.appendChild(makeSkelLine({ width: "44px", height: trackArtistH }));

    row.appendChild(idx);
    row.appendChild(main);
    row.appendChild(like);
    row.appendChild(dur);
    list.appendChild(row);
  }

  container.appendChild(list);
}
