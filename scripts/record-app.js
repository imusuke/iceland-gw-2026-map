(function () {
  const recordData = window.ICELAND_TRAVEL_RECORD;
  if (!recordData || !Array.isArray(recordData.days)) {
    throw new Error("Travel record data is missing.");
  }

  const elements = {
    recordLead: document.getElementById("record-lead"),
    recordPeriod: document.getElementById("record-period"),
    recordDayCount: document.getElementById("record-day-count"),
    recordHighlightCount: document.getElementById("record-highlight-count"),
    recordNote: document.getElementById("record-note"),
    recordDayJumps: document.getElementById("record-day-jumps"),
    recordDays: document.getElementById("record-days")
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

  function renderDayJump(day) {
    const link = createLink("action-button secondary", `#${day.id}`, `${day.label} ${day.date}`);
    elements.recordDayJumps.append(link);
  }

  function renderEntry(entry) {
    const article = createElement("article", "record-card");

    const figure = createElement("figure", "record-card-figure");
    const image = createElement("img", "record-card-image");
    image.src = entry.image;
    image.alt = entry.imageAlt || entry.title;
    image.loading = "lazy";
    image.decoding = "async";
    figure.append(image);

    const meta = createElement("div", "record-card-meta");
    meta.append(
      createElement("span", "record-card-time", entry.time),
      createElement("span", "record-card-category", entry.category)
    );

    const title = createElement("h3", "record-card-title", entry.title);
    const body = createElement("div", "record-card-body");
    body.append(
      createElement("p", "record-card-copy", entry.note),
      createElement("p", "record-card-background", entry.background)
    );

    article.append(figure, meta, title, body);

    if (Array.isArray(entry.links) && entry.links.length > 0) {
      const links = createElement("div", "record-card-links");
      entry.links.forEach((item) => {
        links.append(createLink("record-link", item.href, item.label));
      });
      article.append(links);
    }

    return article;
  }

  function renderDay(day) {
    const section = createElement("section", "record-day-section");
    section.id = day.id;

    const header = createElement("div", "record-day-header");
    header.append(
      createElement("p", "record-day-kicker", `${day.label} ${day.date}`),
      createElement("h2", "record-day-title", day.title),
      createElement("p", "record-day-summary", day.summary)
    );

    const grid = createElement("div", "record-entry-grid");
    day.entries.forEach((entry) => {
      grid.append(renderEntry(entry));
    });

    section.append(header, grid);
    elements.recordDays.append(section);
  }

  function init() {
    const highlightCount = recordData.days.reduce((total, day) => total + day.entries.length, 0);
    elements.recordLead.textContent = recordData.lead;
    elements.recordPeriod.textContent = `記録期間 ${recordData.period}`;
    elements.recordDayCount.textContent = `${recordData.days.length} 日分のハイライト`;
    elements.recordHighlightCount.textContent = `${highlightCount} 枚の写真メモ`;
    elements.recordNote.textContent = recordData.note;

    recordData.days.forEach((day) => {
      renderDayJump(day);
      renderDay(day);
    });
  }

  init();
})();
