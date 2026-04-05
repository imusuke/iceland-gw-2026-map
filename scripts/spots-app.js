(function () {
  const tripData = window.ICELAND_TRIP_DATA;
  if (!tripData || !Array.isArray(tripData.routeStops)) {
    throw new Error("Trip data is missing.");
  }

  const routeStops = tripData.routeStops;
  const itineraryStart = new Date(tripData.itineraryStart);
  const itineraryEnd = new Date(tripData.itineraryEnd);
  const elements = {
    tripPeriod: document.getElementById("trip-period"),
    spotCount: document.getElementById("spot-count"),
    spotIndexList: document.getElementById("spot-index-list"),
    spotGroups: document.getElementById("spot-groups")
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

  function formatDateTimeLabel(date) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${month}/${day} ${hours}:${minutes}`;
  }

  function buildMapPath(index) {
    return `/map?spot=${index + 1}`;
  }

  function buildSpotAnchor(index) {
    return `spot-${index + 1}`;
  }

  function groupStopsByDay(stops) {
    const groups = [];
    let currentGroup = null;

    stops.forEach((stop, index) => {
      if (!currentGroup || currentGroup.key !== stop.filterDay) {
        currentGroup = {
          key: stop.filterDay,
          stops: []
        };
        groups.push(currentGroup);
      }

      currentGroup.stops.push({ stop, index });
    });

    return groups;
  }

  function appendMetaItem(container, label, value) {
    if (!value) {
      return;
    }

    const item = createElement("div", "spot-meta-item");
    const labelElement = createElement("p", "spot-meta-label", label);
    const valueElement = createElement("p", "spot-meta-value", value);
    item.append(labelElement, valueElement);
    container.append(item);
  }

  function createPhotoFrame(stop) {
    const frame = createElement("figure", "spot-figure");
    const image = createElement("img", "spot-image");
    image.alt = `${stop.name} の参考写真`;
    image.loading = "lazy";
    image.decoding = "async";

    const fallback = createElement("div", "spot-image-fallback");
    fallback.textContent = stop.icon || "•";

    frame.append(image, fallback);

    if (!stop.wikiTitle) {
      frame.classList.add("is-empty");
      return frame;
    }

    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${stop.wikiTitle}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Summary request failed: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        const photoUrl = data && data.thumbnail && data.thumbnail.source ? data.thumbnail.source : "";
        if (!photoUrl) {
          frame.classList.add("is-empty");
          return;
        }

        image.src = photoUrl;
        image.classList.add("is-ready");
      })
      .catch(() => {
        frame.classList.add("is-empty");
      });

    return frame;
  }

  function createSpotCard(stop, index) {
    const article = createElement("article", "spot-card");
    article.id = buildSpotAnchor(index);

    const header = createElement("header", "spot-card-header");
    const headerCopy = createElement("div", "spot-card-copy");
    const stepLabel = createElement("p", "spot-step-label", `Spot ${index + 1}`);
    const title = createElement("h2", "spot-title", stop.name);
    const day = createElement("p", "spot-day", stop.day);
    headerCopy.append(stepLabel, title, day);

    const actions = createElement("div", "spot-actions");
    actions.append(
      createLink("action-button primary", buildMapPath(index), "このスポットを地図で見る"),
      createLink("action-button secondary", "/map", "マップ全体へ")
    );

    header.append(headerCopy, actions);

    const body = createElement("div", "spot-card-body");
    const figure = createPhotoFrame(stop);

    const content = createElement("div", "spot-content");
    const summaryLabel = createElement("p", "content-kicker", "旅程メモ");
    const summary = createElement("p", "spot-summary", stop.note);
    const detailLabel = createElement("p", "content-kicker", "成り立ちと見どころ");
    const detail = createElement("p", "spot-detail-copy", stop.stepHtml || stop.note);

    const meta = createElement("div", "spot-meta");
    appendMetaItem(meta, "到着", stop.arrivalTime);
    appendMetaItem(meta, "出発", stop.departureTime);
    appendMetaItem(meta, "滞在", stop.stayDuration);
    appendMetaItem(meta, "前のスポットから", stop.distanceFromPrev ? `${stop.distanceFromPrev}${stop.driveTimeFromPrev ? ` / ${stop.driveTimeFromPrev}` : ""}` : "旅のスタート地点");

    const links = createElement("div", "spot-links");
    if (stop.officialUrl) {
      const officialLink = createLink("spot-link", stop.officialUrl, stop.officialLabel || "公式情報");
      officialLink.target = "_blank";
      officialLink.rel = "noreferrer";
      links.append(officialLink);
    }

    if (stop.wikiTitle) {
      const wikiLink = createLink("spot-link", `https://en.wikipedia.org/wiki/${stop.wikiTitle}`, "写真と概要");
      wikiLink.target = "_blank";
      wikiLink.rel = "noreferrer";
      links.append(wikiLink);
    }

    content.append(summaryLabel, summary, detailLabel, detail, meta, links);
    body.append(figure, content);
    article.append(header, body);

    return article;
  }

  function renderSpotIndex(stops) {
    stops.forEach((stop, index) => {
      const link = createLink("spot-index-link", `#${buildSpotAnchor(index)}`, stop.name);
      const badge = createElement("span", "spot-index-number", String(index + 1));
      const copy = createElement("span", "spot-index-copy");
      const day = createElement("span", "spot-index-day", stop.day);
      const name = createElement("span", "spot-index-name", stop.name);
      copy.append(day, name);
      link.textContent = "";
      link.append(badge, copy);
      elements.spotIndexList.append(link);
    });
  }

  function renderSpotGroups(groups) {
    groups.forEach((group) => {
      const section = createElement("section", "day-group");
      const header = createElement("header", "day-group-header");
      const title = createElement("h2", "day-group-title", `${group.key} のスポット`);
      const count = createElement("p", "day-group-count", `${group.stops.length} 件`);
      header.append(title, count);
      section.append(header);

      group.stops.forEach(({ stop, index }) => {
        section.append(createSpotCard(stop, index));
      });

      elements.spotGroups.append(section);
    });
  }

  function init() {
    elements.tripPeriod.textContent = `${formatDateTimeLabel(itineraryStart)} - ${formatDateTimeLabel(itineraryEnd)}`;
    elements.spotCount.textContent = `${routeStops.length} スポット`;
    renderSpotIndex(routeStops);
    renderSpotGroups(groupStopsByDay(routeStops));
  }

  init();
})();
