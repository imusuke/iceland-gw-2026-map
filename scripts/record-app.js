(function () {
  const recordData = window.ICELAND_TRAVEL_RECORD;
  if (!recordData || !Array.isArray(recordData.days)) {
    throw new Error("旅の実記録データを読み込めませんでした。");
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
    photosUnit: "\u679a",
    slideshowOpen: "\u30b9\u30e9\u30a4\u30c9\u30b7\u30e7\u30fc\u3067\u898b\u308b",
    slideshowPrev: "\u524d\u3078",
    slideshowNext: "\u6b21\u3078",
    slideshowClose: "\u9589\u3058\u308b",
    slideshowCounter: "{current} / {total}",
    slideshowDayPrefix: "\u64ae\u5f71\u65e5 ",
    slideshowUnavailable: "\u5199\u771f\u304c\u3042\u308a\u307e\u305b\u3093\u3002"
  };

  const state = {
    entries: [],
    activeSlideIndex: 0
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
    navRecord: document.getElementById("record-nav-record"),
    openSlideshow: document.getElementById("record-open-slideshow"),
    slideshow: document.getElementById("record-slideshow"),
    slideshowKicker: document.getElementById("record-slideshow-kicker"),
    slideshowCounter: document.getElementById("record-slideshow-counter"),
    slideshowPrev: document.getElementById("record-slideshow-prev"),
    slideshowNext: document.getElementById("record-slideshow-next"),
    slideshowClose: document.getElementById("record-slideshow-close"),
    slideshowImage: document.getElementById("record-slideshow-image"),
    slideshowMeta: document.getElementById("record-slideshow-meta"),
    slideshowTitle: document.getElementById("record-slideshow-title"),
    slideshowNote: document.getElementById("record-slideshow-note"),
    slideshowBackground: document.getElementById("record-slideshow-background"),
    slideshowBackgroundTitle: document.getElementById("record-slideshow-background-title"),
    slideshowBackgroundCopy: document.getElementById("record-slideshow-background-copy")
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

  function clearElement(target) {
    while (target.firstChild) {
      target.removeChild(target.firstChild);
    }
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

  function fillRichText(target, text) {
    clearElement(target);
    appendRichText(target, text);
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
    elements.openSlideshow.textContent = ui.slideshowOpen;
    elements.slideshowPrev.textContent = ui.slideshowPrev;
    elements.slideshowNext.textContent = ui.slideshowNext;
    elements.slideshowClose.textContent = ui.slideshowClose;
  }

  function renderDayJump(day) {
    const link = createLink("action-button secondary", `#${day.id}`, `${day.label} ${day.date}`);
    elements.recordDayJumps.append(link);
  }

  function renderMetaChips(target, entry) {
    if (entry.time) {
      target.append(createElement("span", "record-card-time", entry.time));
    }
    target.append(createElement("span", "record-card-category", parseVariant(entry.filename || entry.image)));
  }

  function openSlideshow(index) {
    if (!state.entries.length) {
      return;
    }

    renderSlideshow(index);
    elements.slideshow.hidden = false;
    elements.slideshow.setAttribute("aria-hidden", "false");
    document.body.classList.add("record-slideshow-open");
    elements.slideshowClose.focus();
  }

  function closeSlideshow() {
    elements.slideshow.hidden = true;
    elements.slideshow.setAttribute("aria-hidden", "true");
    document.body.classList.remove("record-slideshow-open");
  }

  function moveSlideshow(delta) {
    const nextIndex = state.activeSlideIndex + delta;
    if (nextIndex < 0 || nextIndex >= state.entries.length) {
      return;
    }
    renderSlideshow(nextIndex);
  }

  function renderEntry(entry, slideIndex) {
    const article = createElement("article", "record-card");

    const figure = createElement("figure", "record-card-figure");
    const figureButton = createElement("button", "record-card-figure-link");
    figureButton.type = "button";
    figureButton.style.setProperty("--record-thumb-image", `url("${entry.image}")`);
    figureButton.setAttribute("aria-label", `${entry.title || ui.navRecord} ${ui.slideshowOpen}`);
    figureButton.addEventListener("click", () => {
      openSlideshow(slideIndex);
    });

    const image = createElement("img", "record-card-image");
    image.src = entry.image;
    image.alt = entry.imageAlt || entry.title;
    image.loading = "lazy";
    image.decoding = "async";
    figureButton.append(image);
    figure.append(figureButton);

    const meta = createElement("div", "record-card-meta");
    renderMetaChips(meta, entry);

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
      const slideEntry = {
        ...entry,
        dayId: day.id,
        dayLabel: day.label,
        dayDate: day.date,
        dayTitle: day.title
      };
      const slideIndex = state.entries.push(slideEntry) - 1;
      grid.append(renderEntry(slideEntry, slideIndex));
    });

    section.append(header, grid);
    elements.recordDays.append(section);
  }

  function renderSlideshow(index) {
    const entry = state.entries[index];
    if (!entry) {
      return;
    }

    state.activeSlideIndex = index;
    elements.slideshowKicker.textContent = `${ui.slideshowDayPrefix}${entry.dayLabel} ${entry.dayDate}`;
    elements.slideshowCounter.textContent = ui.slideshowCounter
      .replace("{current}", String(index + 1))
      .replace("{total}", String(state.entries.length));
    elements.slideshowImage.src = entry.image;
    elements.slideshowImage.alt = entry.imageAlt || entry.title || ui.slideshowUnavailable;
    elements.slideshowTitle.textContent = entry.title || ui.navRecord;

    clearElement(elements.slideshowMeta);
    renderMetaChips(elements.slideshowMeta, entry);

    fillRichText(elements.slideshowNote, entry.note || ui.noteFallback);

    if (entry.background) {
      elements.slideshowBackground.hidden = false;
      elements.slideshowBackgroundTitle.textContent = ui.backgroundLabel;
      fillRichText(elements.slideshowBackgroundCopy, entry.background);
    } else {
      elements.slideshowBackground.hidden = true;
      clearElement(elements.slideshowBackgroundCopy);
    }

    elements.slideshowPrev.disabled = index <= 0;
    elements.slideshowNext.disabled = index >= state.entries.length - 1;
  }

  function bindSlideshowEvents() {
    elements.openSlideshow.addEventListener("click", () => {
      openSlideshow(0);
    });

    elements.slideshowPrev.addEventListener("click", () => {
      moveSlideshow(-1);
    });

    elements.slideshowNext.addEventListener("click", () => {
      moveSlideshow(1);
    });

    elements.slideshowClose.addEventListener("click", closeSlideshow);

    elements.slideshow.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (target.dataset.recordClose === "true") {
        closeSlideshow();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (elements.slideshow.hidden) {
        return;
      }
      if (event.key === "Escape") {
        closeSlideshow();
      } else if (event.key === "ArrowLeft") {
        moveSlideshow(-1);
      } else if (event.key === "ArrowRight") {
        moveSlideshow(1);
      }
    });
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

    elements.openSlideshow.disabled = state.entries.length === 0;
    bindSlideshowEvents();
  }

  init();
})();
