(function () {
  const recordData = window.ICELAND_TRAVEL_RECORD;
  if (!recordData || !Array.isArray(recordData.days)) {
    throw new Error("旅の実記録データが見つかりません。");
  }

  const ui = {
    documentTitle: "\u30a2\u30a4\u30b9\u30e9\u30f3\u30c9 GW 2026 \u65c5\u306e\u5b9f\u8a18\u9332",
    eyebrow: "\u65c5\u306e\u5b9f\u8a18\u9332",
    title: "\u30a2\u30a4\u30b9\u30e9\u30f3\u30c9\u65c5\u306e\u5199\u771f\u3068\u30b3\u30e1\u30f3\u30c8",
    lead: "\u5143\u30e1\u30e2\u306b\u6b8b\u3057\u305f\u30b3\u30e1\u30f3\u30c8\u3068\u5199\u771f\u3092\u3001\u65e5\u3054\u3068\u306b\u8aad\u307f\u8fd4\u305b\u308b\u3088\u3046\u306b\u307e\u3068\u3081\u3066\u3044\u307e\u3059\u3002",
    noteEyebrow: "\u3053\u306e\u30da\u30fc\u30b8\u306b\u3064\u3044\u3066",
    noteTitle: "\u5199\u771f\u3068\u305d\u306e\u3068\u304d\u306e\u30e1\u30e2\u3092\u4e00\u7dd2\u306b\u6b8b\u3057\u3066\u3044\u307e\u3059",
    note: "\u4e00\u90e8\u306e\u5199\u771f\u306f\u5143\u30e1\u30e2\u306b\u500b\u5225\u30b3\u30e1\u30f3\u30c8\u304c\u306a\u304f\u3001\u73fe\u5728\u306f\u5199\u771f\u306e\u307f\u306e\u63b2\u8f09\u3067\u3059\u3002",
    navMap: "\u30eb\u30fc\u30c8\u30de\u30c3\u30d7",
    navSpots: "\u30b9\u30dd\u30c3\u30c8\u8a73\u7d30",
    navHistory: "\u30a2\u30a4\u30b9\u30e9\u30f3\u30c9\u53f2",
    navRecord: "\u65c5\u306e\u5b9f\u8a18\u9332",
    periodPrefix: "\u64ae\u5f71\u671f\u9593 ",
    daySuffix: " \u65e5\u5206",
    photoSuffix: " \u679a\u306e\u8a18\u9332",
    noteFallback: "\u3053\u306e\u5199\u771f\u306b\u306f\u307e\u3060\u500b\u5225\u30b3\u30e1\u30f3\u30c8\u304c\u3042\u308a\u307e\u305b\u3093\u3002",
    backgroundLabel: "\u80cc\u666f\u30e1\u30e2",
    photosUnit: "\u679a"
  };

  const elements = {
    recordEyebrow: document.getElementById("record-eyebrow"),
    recordTitle: document.getElementById("record-title"),
    recordLead: document.getElementById("record-lead"),
    recordPeriod: document.getElementById("record-period"),
    recordDayCount: document.getElementById("record-day-count"),
    recordHighlightCount: document.getElementById("record-highlight-count"),
    recordNoteEyebrow: document.getElementById("record-note-eyebrow"),
    recordNoteTitle: document.getElementById("record-note-title"),
    recordNote: document.getElementById("record-note"),
    recordDayJumps: document.getElementById("record-day-jumps"),
    recordDays: document.getElementById("record-days"),
    navMap: document.getElementById("record-nav-map"),
    navSpots: document.getElementById("record-nav-spots"),
    navHistory: document.getElementById("record-nav-history"),
    navRecord: document.getElementById("record-nav-record")
  };

  function createElement(tagName, className, textContent) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (typeof textContent === "string") {
      element.textContent = textContent;
    }
    return element;
  }

  function createLink(className, href, textContent) {
    const link = createElement("a", className, textContent);
    link.href = href;
    return link;
  }

  function appendInlineMarkdown(target, text) {
    const source = String(text || "");
    const parts = source.split(/(\*\*[^*]+\*\*)/g);

    parts.forEach((part) => {
      if (!part) {
        return;
      }

      const strongMatch = part.match(/^\*\*([\s\S]+)\*\*$/);
      if (strongMatch) {
        const strong = document.createElement("strong");
        strong.textContent = strongMatch[1];
        target.append(strong);
        return;
      }

      target.append(document.createTextNode(part));
    });
  }

  function appendRichText(target, text) {
    const lines = String(text || "").split(/\r?\n/);

    lines.forEach((line, index) => {
      appendInlineMarkdown(target, line);
      if (index < lines.length - 1) {
        target.append(document.createElement("br"));
      }
    });
  }

  function parseVariant(filename) {
    const match = filename.match(/(?:\.(PANO|MP))?\.(jpg|jpeg|png|webp)$/i);
    const variant = match && match[1] ? match[1].toUpperCase() : "PHOTO";
    if (variant === "PANO") {
      return "\u30d1\u30ce\u30e9\u30de";
    }
    if (variant === "MP") {
      return "\u30e2\u30fc\u30b7\u30e7\u30f3\u30d5\u30a9\u30c8";
    }
    return "\u5199\u771f";
  }

  function initStaticCopy() {
    document.title = ui.documentTitle;
    elements.recordEyebrow.textContent = ui.eyebrow;
    elements.recordTitle.textContent = ui.title;
    elements.recordLead.textContent = ui.lead;
    elements.recordNoteEyebrow.textContent = ui.noteEyebrow;
    elements.recordNoteTitle.textContent = ui.noteTitle;
    elements.recordNote.textContent = ui.note;
    elements.navMap.textContent = ui.navMap;
    elements.navSpots.textContent = ui.navSpots;
    elements.navHistory.textContent = ui.navHistory;
    elements.navRecord.textContent = ui.navRecord;
  }

  function renderDayJump(day) {
    const link = createLink("action-button secondary", `#${day.id}`, `${day.label} ${day.date}`);
    elements.recordDayJumps.append(link);
  }

  function renderEntry(entry) {
    const article = createElement("article", "record-card");

    const figure = createElement("figure", "record-card-figure");
    const figureLink = createLink("record-card-figure-link", entry.image, "");
    figureLink.target = "_blank";
    figureLink.rel = "noreferrer";

    const image = createElement("img", "record-card-image");
    image.src = entry.image;
    image.alt = entry.imageAlt || entry.title;
    image.loading = "lazy";
    image.decoding = "async";
    figureLink.append(image);
    figure.append(figureLink);

    const meta = createElement("div", "record-card-meta");
    if (entry.time) {
      meta.append(createElement("span", "record-card-time", entry.time));
    }
    meta.append(createElement("span", "record-card-category", parseVariant(entry.filename || entry.image)));

    const title = createElement("h3", "record-card-title", entry.title || ui.navRecord);
    const body = createElement("div", "record-card-body");
    const note = createElement("p", "record-card-copy");
    appendRichText(note, entry.note || ui.noteFallback);
    body.append(note);

    if (entry.background) {
      const background = createElement("p", "record-card-background");
      const label = createElement("strong", "record-card-background-label", `${ui.backgroundLabel}: `);
      background.append(label);
      appendRichText(background, entry.background);
      body.append(background);
    }

    article.append(figure, meta, title, body);
    return article;
  }

  function renderDay(day) {
    const section = createElement("section", "record-day-section");
    section.id = day.id;

    const header = createElement("div", "record-day-header");
    header.append(
      createElement("p", "record-day-kicker", `${day.label} ${day.date}`),
      createElement("h2", "record-day-title", day.title),
      createElement("p", "record-day-summary", day.summary || ""),
      createElement("p", "record-day-count", `${day.entries.length}${ui.photosUnit}`)
    );

    const grid = createElement("div", "record-entry-grid");
    day.entries.forEach((entry) => {
      grid.append(renderEntry(entry));
    });

    section.append(header, grid);
    elements.recordDays.append(section);
  }

  function init() {
    initStaticCopy();

    const photoCount = recordData.days.reduce((sum, day) => sum + day.entries.length, 0);
    elements.recordPeriod.textContent = `${ui.periodPrefix}${recordData.period || "2026/4/30 - 5/5"}`;
    elements.recordDayCount.textContent = `${recordData.days.length}${ui.daySuffix}`;
    elements.recordHighlightCount.textContent = `${photoCount}${ui.photoSuffix}`;

    recordData.days.forEach((day) => {
      renderDayJump(day);
      renderDay(day);
    });
  }

  init();
})();
