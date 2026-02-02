import { makeSkelBlock, makeSkelLine, measureClassTextMetrics } from "./primitives.js";
import { renderPageSkeleton } from "./page.js";

export function renderSearchPopoverSkeleton(container, { rows = 6, metricsEl = null } = {}) {
  container.innerHTML = "";
  const titleMetrics = measureClassTextMetrics("search-suggest__title");
  const subtitleMetrics = measureClassTextMetrics("search-suggest__subtitle");
  const titleH = `${Math.max(12, Math.round(titleMetrics.lineHeight))}px`;
  const subtitleH = `${Math.max(11, Math.round(subtitleMetrics.lineHeight))}px`;

  for (let i = 0; i < rows; i++) {
    const row = document.createElement("div");
    row.className = "search-suggest search-suggest--skeleton";

    const cover = document.createElement("div");
    cover.className = "search-suggest__cover";
    cover.appendChild(makeSkelBlock({ className: "skel--cover" }));

    const main = document.createElement("div");
    main.className = "search-suggest__main";

    const t = document.createElement("div");
    t.className = "search-suggest__title";
    t.appendChild(makeSkelLine({ width: `${58 + (i % 3) * 14}%`, height: titleH }));

    const st = document.createElement("div");
    st.className = "search-suggest__subtitle";
    st.appendChild(makeSkelLine({ width: `${34 + (i % 4) * 12}%`, height: subtitleH }));

    main.appendChild(t);
    main.appendChild(st);

    row.appendChild(cover);
    row.appendChild(main);
    container.appendChild(row);
  }
}

export function renderSearchResultsSkeleton(container, { kind = "all", metricsEl = null } = {}) {
  container.innerHTML = "";
  const sectionTitleMetrics = measureClassTextMetrics("search-tracks__title");
  const rowTitleMetrics = measureClassTextMetrics("search-track__title");
  const rowSubtitleMetrics = measureClassTextMetrics("search-track__subtitle");

  const sectionTitleH = `${Math.max(14, Math.round(sectionTitleMetrics.lineHeight))}px`;
  const rowTitleH = `${Math.max(12, Math.round(rowTitleMetrics.lineHeight))}px`;
  const rowSubtitleH = `${Math.max(11, Math.round(rowSubtitleMetrics.lineHeight))}px`;

  const renderTrackRows = (rows) => {
    const sec = document.createElement("section");
    sec.className = "search-tracks";

    const h2 = document.createElement("h2");
    h2.className = "search-tracks__title";
    h2.textContent = " ";
    h2.appendChild(makeSkelLine({ width: "28%", height: sectionTitleH }));
    sec.appendChild(h2);

    const list = document.createElement("div");
    list.className = "search-tracklist";
    for (let i = 0; i < rows; i++) {
      const row = document.createElement("div");
      row.className = "search-track search-track--skeleton";

      const cover = document.createElement("div");
      cover.className = "search-track__cover";
      cover.appendChild(makeSkelBlock({ className: "skel--cover" }));

      const main = document.createElement("div");
      main.className = "search-track__main";

      const tt = document.createElement("div");
      tt.className = "search-track__title";
      tt.appendChild(makeSkelLine({ width: `${56 + (i % 3) * 14}%`, height: rowTitleH }));

      const sub = document.createElement("div");
      sub.className = "search-track__subtitle";
      sub.appendChild(makeSkelLine({ width: `${34 + (i % 4) * 12}%`, height: rowSubtitleH }));

      main.appendChild(tt);
      main.appendChild(sub);

      const dur = document.createElement("div");
      dur.className = "search-track__duration";
      dur.appendChild(makeSkelLine({ width: "46px", height: rowSubtitleH }));

      row.appendChild(cover);
      row.appendChild(main);
      row.appendChild(dur);
      list.appendChild(row);
    }

    sec.appendChild(list);
    container.appendChild(sec);
  };

  if (kind === "track") {
    renderTrackRows(10);
    return;
  }

  if (kind === "all") {
    renderTrackRows(6);
    renderPageSkeleton(container, { sections: 3, cardsPerSection: 8 });
    return;
  }

  renderPageSkeleton(container, { sections: 2, cardsPerSection: 10 });
}
