(function () {
  const recordData = window.ICELAND_TRAVEL_RECORD;
  if (!recordData || !Array.isArray(recordData.photos)) {
    throw new Error("Travel record data is missing.");
  }

  const ui = {
    documentTitle: "\u30a2\u30a4\u30b9\u30e9\u30f3\u30c9 GW 2026 \u65c5\u306e\u5b9f\u8a18\u9332",
    eyebrow: "\u65c5\u306e\u5b9f\u8a18\u9332",
    title: "\u30a2\u30a4\u30b9\u30e9\u30f3\u30c9\u65c5\u306e\u5199\u771f\u30ae\u30e3\u30e9\u30ea\u30fc",
    lead: "\u64ae\u5f71\u3057\u305f\u5199\u771f\u3092\u65e5\u3054\u3068\u306b\u3059\u3079\u3066\u4e26\u3079\u305f\u30ae\u30e3\u30e9\u30ea\u30fc\u3067\u3059\u3002\u5143\u30e1\u30e2\u306e\u672c\u6587\u306f\u6574\u5099\u4e2d\u3067\u3059\u304c\u3001\u65c5\u306e\u6d41\u308c\u306f\u5199\u771f\u304b\u3089\u305f\u3069\u308c\u308b\u3088\u3046\u306b\u3057\u3066\u3044\u307e\u3059\u3002",
    noteEyebrow: "\u3053\u306e\u30da\u30fc\u30b8\u306b\u3064\u3044\u3066",
    noteTitle: "\u65c5\u3067\u64ae\u3063\u305f\u5199\u771f\u3092\u3059\u3079\u3066\u63b2\u8f09\u3057\u3066\u3044\u307e\u3059",
    note: "\u5199\u771f\u306f\u64ae\u5f71\u6642\u523b\u9806\u3067\u3059\u3002\u30d1\u30ce\u30e9\u30de\u3068\u30e2\u30fc\u30b7\u30e7\u30f3\u30d5\u30a9\u30c8\u3082\u3001\u8868\u793a\u3067\u304d\u308b JPEG \u7248\u3092\u305d\u306e\u307e\u307e\u8f09\u305b\u3066\u3044\u307e\u3059\u3002",
    navMap: "\u30eb\u30fc\u30c8\u30de\u30c3\u30d7",
    navSpots: "\u30b9\u30dd\u30c3\u30c8\u8a73\u7d30",
    navHistory: "\u30a2\u30a4\u30b9\u30e9\u30f3\u30c9\u53f2",
    navRecord: "\u65c5\u306e\u5b9f\u8a18\u9332",
    periodPrefix: "\u64ae\u5f71\u671f\u9593 ",
    daySuffix: " \u65e5\u5206",
    photoSuffix: " \u679a\u306e\u5199\u771f",
    photoLabel: "\u5199\u771f",
    panoLabel: "\u30d1\u30ce\u30e9\u30de",
    mpLabel: "\u30e2\u30fc\u30b7\u30e7\u30f3\u30d5\u30a9\u30c8",
    shotLabel: "\u306b\u64ae\u5f71\u3057\u305f\u5199\u771f",
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

  const dayMeta = {
    "2026-04-30": {
      id: "day-1",
      label: "\u0031\u65e5\u76ee",
      date: "4/30",
      title: "\u30ec\u30a4\u30ad\u30e3\u30cd\u30b9\u534a\u5cf6\u304b\u3089\u30ec\u30a4\u30ad\u30e3\u30d3\u30af\u3078",
      summary: "\u5230\u7740\u5f8c\u306e\u7a7a\u6e2f\u5468\u8fba\u89b3\u5149\u3068\u3001\u30ec\u30a4\u30ad\u30e3\u30d3\u30af\u5e02\u5185\u3067\u306e\u6700\u521d\u306e\u4e00\u65e5\u3067\u3059\u3002"
    },
    "2026-05-01": {
      id: "day-2",
      label: "\u0032\u65e5\u76ee",
      date: "5/1",
      title: "\u30b4\u30fc\u30eb\u30c7\u30f3\u30b5\u30fc\u30af\u30eb\u3092\u5357\u4e0b",
      summary: "\u30b7\u30f3\u30af\u30f4\u30a7\u30c8\u30ea\u30eb\u3001\u30b2\u30a4\u30b7\u30fc\u30eb\u3001\u30b0\u30c8\u30eb\u30d5\u30a9\u30b9\u3092\u5de1\u3063\u305f\u65e5\u306e\u5199\u771f\u3067\u3059\u3002"
    },
    "2026-05-02": {
      id: "day-3",
      label: "\u0033\u65e5\u76ee",
      date: "5/2",
      title: "\u5357\u6d77\u5cb8\u304b\u3089\u6c37\u6cb3\u6e56\u65b9\u9762\u3078",
      summary: "\u5ce1\u8c37\u3001\u6c37\u6cb3\u3001\u6c37\u6cb3\u6e56\u3078\u5411\u304b\u3046\u9053\u4e2d\u306e\u666f\u8272\u3092\u307e\u3068\u3081\u3066\u3044\u307e\u3059\u3002"
    },
    "2026-05-03": {
      id: "day-4",
      label: "\u0034\u65e5\u76ee",
      date: "5/3",
      title: "\u30b9\u30ab\u30d5\u30bf\u30d5\u30a7\u30c3\u30c8\u30eb\u3068\u30f4\u30a3\u30fc\u30af",
      summary: "\u6c37\u6cb3\u30a6\u30a9\u30fc\u30af\u306e\u3042\u3068\u3001\u5357\u5cb8\u306e\u666f\u89b3\u3092\u898b\u306a\u304c\u3089\u30f4\u30a3\u30fc\u30af\u3078\u623b\u3063\u305f\u4e00\u65e5\u3067\u3059\u3002"
    },
    "2026-05-04": {
      id: "day-5",
      label: "\u0035\u65e5\u76ee",
      date: "5/4",
      title: "\u5357\u6d77\u5cb8\u3092\u5de1\u3063\u3066\u30ec\u30a4\u30ad\u30e3\u30d3\u30af\u3078\u623b\u308b",
      summary: "\u9ed2\u7802\u6d77\u5cb8\u3084\u6edd\u3092\u5de1\u308a\u306a\u304c\u3089\u3001\u9996\u90fd\u3078\u623b\u308b\u307e\u3067\u306e\u5199\u771f\u3092\u4e26\u3079\u3066\u3044\u307e\u3059\u3002"
    },
    "2026-05-05": {
      id: "day-6",
      label: "\u0036\u65e5\u76ee",
      date: "5/5",
      title: "\u65e9\u671d\u306e\u51fa\u767a\u3068\u5e30\u8def",
      summary: "\u30b1\u30d7\u30e9\u30f4\u30a3\u30fc\u30af\u7a7a\u6e2f\u3092\u767a\u3063\u3066\u3001\u65e5\u672c\u3078\u623b\u308b\u307e\u3067\u306e\u5199\u771f\u3067\u3059\u3002"
    }
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

  function parsePhoto(filename) {
    const match = filename.match(/^PXL_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\d*(?:\.(PANO|MP))?\.(jpg|jpeg|png|webp)$/i);
    if (!match) {
      return null;
    }

    const [, year, month, day, hour, minute, second, variant] = match;
    const dateKey = `${year}-${month}-${day}`;
    const variantKey = variant ? variant.toUpperCase() : "PHOTO";
    const typeLabel = variantKey === "PANO"
      ? ui.panoLabel
      : variantKey === "MP"
        ? ui.mpLabel
        : ui.photoLabel;

    return {
      filename,
      src: `/assets/record/${filename}`,
      dateKey,
      time: `${hour}:${minute}`,
      timestamp: `${hour}${minute}${second}`,
      typeLabel
    };
  }

  function renderDayJump(day) {
    const link = createLink("action-button secondary", `#${day.id}`, `${day.label} ${day.date}`);
    elements.recordDayJumps.append(link);
  }

  function renderEntry(entry, index) {
    const article = createElement("article", "record-card");

    const figure = createElement("figure", "record-card-figure");
    const figureLink = createLink("record-card-figure-link", entry.src, "");
    figureLink.target = "_blank";
    figureLink.rel = "noreferrer";

    const image = createElement("img", "record-card-image");
    image.src = entry.src;
    image.alt = `${entry.dayLabel} ${entry.time} ${ui.shotLabel} ${index + 1}`;
    image.loading = "lazy";
    image.decoding = "async";
    figureLink.append(image);
    figure.append(figureLink);

    const meta = createElement("div", "record-card-meta");
    meta.append(
      createElement("span", "record-card-time", entry.time),
      createElement("span", "record-card-category", entry.typeLabel)
    );

    const filename = createElement("p", "record-card-filename", entry.filename);

    article.append(figure, meta, filename);
    return article;
  }

  function renderDay(day) {
    const section = createElement("section", "record-day-section");
    section.id = day.id;

    const header = createElement("div", "record-day-header");
    header.append(
      createElement("p", "record-day-kicker", `${day.label} ${day.date}`),
      createElement("h2", "record-day-title", day.title),
      createElement("p", "record-day-summary", day.summary),
      createElement("p", "record-day-count", `${day.photos.length}${ui.photosUnit}`)
    );

    const grid = createElement("div", "record-entry-grid");
    day.photos.forEach((entry, index) => {
      grid.append(renderEntry(entry, index));
    });

    section.append(header, grid);
    elements.recordDays.append(section);
  }

  function buildDays() {
    const grouped = new Map();

    recordData.photos
      .map(parsePhoto)
      .filter(Boolean)
      .sort((left, right) => {
        if (left.dateKey !== right.dateKey) {
          return left.dateKey.localeCompare(right.dateKey);
        }
        return left.timestamp.localeCompare(right.timestamp);
      })
      .forEach((photo) => {
        if (!grouped.has(photo.dateKey)) {
          grouped.set(photo.dateKey, []);
        }
        grouped.get(photo.dateKey).push(photo);
      });

    return Object.entries(dayMeta)
      .map(([dateKey, meta]) => {
        const photos = grouped.get(dateKey) || [];
        return {
          ...meta,
          photos: photos.map((photo) => ({
            ...photo,
            dayLabel: meta.label
          }))
        };
      })
      .filter((day) => day.photos.length > 0);
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

  function init() {
    initStaticCopy();

    const days = buildDays();
    const photoCount = days.reduce((total, day) => total + day.photos.length, 0);

    elements.recordPeriod.textContent = `${ui.periodPrefix}${recordData.period || "2026/4/30 - 5/5"}`;
    elements.recordDayCount.textContent = `${days.length}${ui.daySuffix}`;
    elements.recordHighlightCount.textContent = `${photoCount}${ui.photoSuffix}`;

    days.forEach((day) => {
      renderDayJump(day);
      renderDay(day);
    });
  }

  init();
})();
