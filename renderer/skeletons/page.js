import { makeSkelBlock, makeSkelLine, measureClassTextMetrics } from "./primitives.js";

export function renderPageSkeleton(container, { sections = 3, cardsPerSection = 10 } = {}) {
  container.innerHTML = "";

  const titleMetrics = measureClassTextMetrics("entity-title");
  const subtitleMetrics = measureClassTextMetrics("entity-subtitle");
  const cardTitleMetrics = measureClassTextMetrics("big-card__title");
  const cardSubtitleMetrics = measureClassTextMetrics("big-card__subtitle");

  const titleH = `${Math.max(18, Math.round(titleMetrics.lineHeight))}px`;
  const subtitleH = `${Math.max(12, Math.round(subtitleMetrics.lineHeight))}px`;
  const cardTitleH = `${Math.max(12, Math.round(cardTitleMetrics.lineHeight))}px`;
  const cardSubtitleH = `${Math.max(11, Math.round(cardSubtitleMetrics.lineHeight))}px`;

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
  title.appendChild(makeSkelLine({ width: "50%", height: titleH }));

  const subtitle = document.createElement("div");
  subtitle.className = "entity-subtitle";
  subtitle.innerHTML = "";
  subtitle.appendChild(makeSkelLine({ width: "30%", height: subtitleH }));

  meta.appendChild(title);
  meta.appendChild(subtitle);

  header.appendChild(cover);
  header.appendChild(meta);
  container.appendChild(header);

  for (let s = 0; s < sections; s++) {
    const section = document.createElement("section");
    section.className = "made-for";

    const head = document.createElement("div");
    head.className = "made-for__header";
    const titles = document.createElement("div");
    titles.className = "made-for__titles";
    const h2 = document.createElement("h2");
    h2.className = "h2 h2--small";
    h2.textContent = " ";
    h2.appendChild(makeSkelLine({ width: `${36 + (s % 3) * 18}%`, height: "14px" }));
    titles.appendChild(h2);
    head.appendChild(titles);
    section.appendChild(head);

    const carousel = document.createElement("div");
    carousel.className = "carousel";
    carousel.setAttribute("role", "list");
    for (let i = 0; i < cardsPerSection; i++) {
      const card = document.createElement("a");
      card.className = "big-card big-card--skeleton";
      card.href = "#";
      card.setAttribute("aria-disabled", "true");

      const c = document.createElement("div");
      c.className = "big-card__cover";
      c.appendChild(makeSkelBlock({ className: "skel--cover" }));

      const t = document.createElement("div");
      t.className = "big-card__title";
      t.appendChild(makeSkelLine({ width: "74%", height: cardTitleH }));
      const st = document.createElement("div");
      st.className = "big-card__subtitle";
      st.appendChild(makeSkelLine({ width: "92%", height: cardSubtitleH }));

      card.appendChild(c);
      card.appendChild(t);
      card.appendChild(st);
      carousel.appendChild(card);
    }
    section.appendChild(carousel);
    container.appendChild(section);
  }
}
