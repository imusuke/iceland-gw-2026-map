(function () {
  const tripData = window.ICELAND_TRIP_DATA;
  if (!tripData || !Array.isArray(tripData.routeStops)) {
    throw new Error("Trip data is missing.");
  }

  const shared = window.ICELAND_TRIP_SHARED || {};
  const journalUi = window.ICELAND_TRIP_JOURNAL_UI || {};
  const routeStops = tripData.routeStops;
  const itineraryStart = new Date(tripData.itineraryStart);
  const itineraryEnd = new Date(tripData.itineraryEnd);
  const uiLabels = {
    fullscreen: "全画面",
    exitFullscreen: "全画面終了",
    guide: "ガイド",
    closeGuide: "ガイドを閉じる",
    close: "閉じる",
    openJournal: "旅の記録を開く",
    closeJournal: "旅の記録を閉じる",
    readOnDetailsPage: shared.labels && shared.labels.readOnDetailsPage
      ? shared.labels.readOnDetailsPage
      : "スポット詳細で読む",
    referenceInfo: shared.labels && shared.labels.referenceInfo
      ? shared.labels.referenceInfo
      : "Wikipedia の参考情報",
    tripProgress: shared.labels && typeof shared.labels.tripProgress === "function"
      ? shared.labels.tripProgress
      : (current, total) => `旅程 ${current} / ${total}`
  };
  const buildSpotDetailsPath = typeof shared.buildSpotDetailsPath === "function"
    ? shared.buildSpotDetailsPath
    : (index) => `/spots#spot-${index + 1}`;
  const buildSpotId = typeof shared.buildSpotId === "function"
    ? shared.buildSpotId
    : (index) => `spot-${index + 1}`;
  const loadReferencePhoto = typeof shared.loadReferencePhoto === "function"
    ? shared.loadReferencePhoto
    : async (stop) => stop.photoUrl || "";

  const elements = {
    mapElement: document.querySelector(".map-shell"),
    fullscreenButton: document.getElementById("fullscreen-button"),
    stepModeToggle: document.getElementById("step-mode-toggle"),
    stepControls: document.getElementById("step-controls"),
    stepProgressLabel: document.getElementById("step-progress-label"),
    stepCurrentStop: document.getElementById("step-current-stop"),
    stepCurrentMeta: document.getElementById("step-current-meta"),
    stepCurrentTravel: document.getElementById("step-current-travel"),
    stepCurrentNote: document.getElementById("step-current-note"),
    stepDetailToggle: document.getElementById("step-detail-toggle"),
    stepJournalButton: document.getElementById("step-journal-button"),
    stepPrevButton: document.getElementById("step-prev-button"),
    stepNextButton: document.getElementById("step-next-button")
  };

  const stepOverlay = document.createElement("section");
  stepOverlay.className = "floating-panel top-left step-overlay hidden";
  elements.mapElement.appendChild(stepOverlay);

  const routeStatusPanel = document.createElement("section");
  routeStatusPanel.className = "floating-panel route-status-panel hidden";
  routeStatusPanel.setAttribute("aria-live", "polite");
  elements.mapElement.appendChild(routeStatusPanel);

  const state = {
    stepModeEnabled: false,
    currentStepIndex: 0,
    activeSpotIndex: null,
    stepImageRequestId: 0,
    pendingRouteSegments: 0,
    failedRouteSegments: []
  };

  const map = L.map("map", {
    zoomControl: false,
    scrollWheelZoom: true
  });

  L.control.zoom({
    position: "bottomright"
  }).addTo(map);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  const fullRouteBounds = L.latLngBounds(routeStops.map((stop) => [stop.lat, stop.lng]));
  const markers = [];
  const routeSegments = [];
  const segmentArrows = [];
  const routeGeometryCache = new Map();
  const ROUTE_CACHE_PREFIX = "iceland-route-geometry-v1:";
  const ROUTE_FETCH_CONCURRENCY = 2;
  const compactControlsMediaQuery = typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 700px)")
    : null;

  function parseRequestedSpotIndex() {
    const currentUrl = new URL(window.location.href);
    const spotParam = currentUrl.searchParams.get("spot");
    const hashMatch = currentUrl.hash.match(/^#spot-(\d+)$/);
    const rawIndex = spotParam || (hashMatch ? hashMatch[1] : "");
    const parsedIndex = Number(rawIndex);

    if (!Number.isInteger(parsedIndex) || parsedIndex < 1 || parsedIndex > routeStops.length) {
      return null;
    }

    return parsedIndex - 1;
  }

  function getRouteCacheKey(fromStop, toStop) {
    return `${fromStop.lat},${fromStop.lng}->${toStop.lat},${toStop.lng}`;
  }

  function readCachedRouteGeometry(cacheKey) {
    if (routeGeometryCache.has(cacheKey)) {
      return routeGeometryCache.get(cacheKey);
    }

    try {
      const raw = window.localStorage.getItem(`${ROUTE_CACHE_PREFIX}${cacheKey}`);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length < 2) {
        return null;
      }

      routeGeometryCache.set(cacheKey, parsed);
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function writeCachedRouteGeometry(cacheKey, latLngs) {
    if (!Array.isArray(latLngs) || latLngs.length < 2) {
      return;
    }

    routeGeometryCache.set(cacheKey, latLngs);
    try {
      window.localStorage.setItem(`${ROUTE_CACHE_PREFIX}${cacheKey}`, JSON.stringify(latLngs));
    } catch (_error) {
      // Ignore storage failures and keep the in-memory cache.
    }
  }

  function yieldToBrowser() {
    return new Promise((resolve) => {
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => resolve());
        return;
      }

      window.setTimeout(resolve, 0);
    });
  }

  function scheduleDeferredWork(callback, timeout = 1200) {
    if (typeof callback !== "function") {
      return;
    }

    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => {
        void callback();
      }, { timeout });
      return;
    }

    window.setTimeout(() => {
      void callback();
    }, 180);
  }

  function usesCompactControls() {
    return Boolean(compactControlsMediaQuery && compactControlsMediaQuery.matches);
  }

  function isStepOverlayVisible() {
    return !stepOverlay.classList.contains("hidden");
  }

  function shouldAutoOpenGuideDetails() {
    return false;
  }

  function getGuideToggleLabel() {
    if (!state.stepModeEnabled) {
      return uiLabels.guide;
    }

    return usesCompactControls() ? uiLabels.close : uiLabels.closeGuide;
  }

  function getFullscreenLabel() {
    if (document.fullscreenElement === elements.mapElement) {
      return usesCompactControls() ? uiLabels.close : uiLabels.exitFullscreen;
    }

    return uiLabels.fullscreen;
  }

  function syncControlLabels() {
    elements.stepModeToggle.textContent = getGuideToggleLabel();
    elements.fullscreenButton.textContent = getFullscreenLabel();
  }

  function getStepDetailToggleLabel() {
    if (!isStepOverlayVisible()) {
      return "詳細";
    }

    return usesCompactControls() ? uiLabels.close : "詳細を閉じる";
  }

  function buildStepMetaText(stop) {
    const compact = usesCompactControls();
    const bits = [];

    if (stop.arrivalTime) {
      bits.push(`${compact ? "着" : "到着"} ${stop.arrivalTime}`);
    }

    if (stop.departureTime) {
      bits.push(`${compact ? "発" : "出発"} ${stop.departureTime}`);
    }

    if (stop.stayDuration) {
      bits.push(`${compact ? "滞" : "滞在"} ${stop.stayDuration}`);
    }

    return bits.length > 0 ? bits.join(" / ") : compact ? "時間未設定" : "時間情報は未設定";
  }

  function buildStepTravelText(stop) {
    if (!stop.distanceFromPrev) {
      return usesCompactControls() ? "出発地点" : "旅のスタート地点";
    }

    return `${usesCompactControls() ? "前区間" : "前の区間"} ${stop.distanceFromPrev}${stop.driveTimeFromPrev ? ` / ${stop.driveTimeFromPrev}` : ""}`;
  }

  function buildStepNoteText(stop) {
    const text = String(stop.note || stop.stepHtml || "").trim();
    if (!text) {
      return "このスポットのメモはありません。";
    }

    if (text.length <= 68) {
      return text;
    }

    return `${text.slice(0, 68)}…`;
  }

  async function fetchRouteGeometry(fromStop, toStop) {
    const cacheKey = getRouteCacheKey(fromStop, toStop);
    const cachedGeometry = readCachedRouteGeometry(cacheKey);
    if (cachedGeometry) {
      return cachedGeometry;
    }

    try {
      const url = new URL("/api/route", window.location.origin);
      url.searchParams.set("fromLat", String(fromStop.lat));
      url.searchParams.set("fromLng", String(fromStop.lng));
      url.searchParams.set("toLat", String(toStop.lat));
      url.searchParams.set("toLng", String(toStop.lng));
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (!data || !Array.isArray(data.latLngs) || data.latLngs.length < 2) {
        return null;
      }

      const latLngs = data.latLngs;
      writeCachedRouteGeometry(cacheKey, latLngs);
      return latLngs;
    } catch (_error) {
      return null;
    }
  }

  function buildFallbackSegmentLatLngs(fromStop, toStop) {
    return [
      [fromStop.lat, fromStop.lng],
      [toStop.lat, toStop.lng]
    ];
  }

  function getArrowPlacement(latLngs) {
    if (!Array.isArray(latLngs) || latLngs.length === 0) {
      return null;
    }

    if (latLngs.length === 1) {
      return {
        lat: latLngs[0][0],
        lng: latLngs[0][1],
        angle: 0
      };
    }

    const midIndex = Math.floor((latLngs.length - 1) / 2);
    const start = latLngs[midIndex];
    const end = latLngs[Math.min(midIndex + 1, latLngs.length - 1)];
    const dx = end[1] - start[1];
    const dy = end[0] - start[0];

    return {
      lat: (start[0] + end[0]) / 2,
      lng: (start[1] + end[1]) / 2,
      angle: Math.atan2(dy, dx) * (180 / Math.PI)
    };
  }

  function updateSegmentArrow(segmentEntry, latLngs) {
    const arrowPlacement = getArrowPlacement(latLngs);
    if (!arrowPlacement) {
      return;
    }

    if (!segmentEntry.arrow) {
      const arrowMarker = L.marker(
        [arrowPlacement.lat, arrowPlacement.lng],
        {
          icon: L.divIcon({
            className: "",
            html: `<div class="segment-arrow" style="transform: rotate(${arrowPlacement.angle}deg);">&rarr;</div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          }),
          interactive: false
        }
      ).addTo(map);

      segmentEntry.arrow = arrowMarker;
      segmentArrows.push({ marker: arrowMarker, index: segmentEntry.index });
      segmentArrows.sort((a, b) => a.index - b.index);
      return;
    }

    segmentEntry.arrow.setLatLng([arrowPlacement.lat, arrowPlacement.lng]);
    segmentEntry.arrow.setIcon(L.divIcon({
      className: "",
      html: `<div class="segment-arrow" style="transform: rotate(${arrowPlacement.angle}deg);">&rarr;</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    }));
  }

  function buildStopDateTime(stop) {
    if (!stop.filterDay || !stop.arrivalTime) {
      return null;
    }

    const [month, day] = stop.filterDay.split("/").map(Number);
    const timePart = stop.arrivalTime.replace("翌日 ", "");
    const [hours, minutes] = timePart.split(":").map(Number);
    return new Date(itineraryStart.getFullYear(), month - 1, day, hours, minutes);
  }

  function buildTimelineMeta(stop) {
    const stopDate = buildStopDateTime(stop);
    if (!stopDate || Number.isNaN(stopDate.getTime())) {
      return null;
    }

    const total = itineraryEnd.getTime() - itineraryStart.getTime();
    const elapsed = Math.max(0, Math.min(stopDate.getTime() - itineraryStart.getTime(), total));
    const percent = total > 0 ? (elapsed / total) * 100 : 0;
    const dayIndex = Math.floor((stopDate.getTime() - itineraryStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    const month = stopDate.getMonth() + 1;
    const date = stopDate.getDate();
    const hours = String(stopDate.getHours()).padStart(2, "0");
    const minutes = String(stopDate.getMinutes()).padStart(2, "0");
    const hourBand = stopDate.getHours() + 1;

    return {
      percent,
      label: `旅の${dayIndex}日目の${hourBand}時間目`,
      sublabel: `${month}/${date} ${hours}:${minutes}ごろ`
    };
  }

  function parseDistanceKm(value) {
    if (!value) {
      return 0;
    }

    const normalized = String(value).replace(/約/g, "").replace(/km/g, "").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function buildDistanceMeta(index) {
    const cumulativeDistances = routeStops.map((stop, stopIndex) => {
      let total = 0;
      for (let i = 1; i <= stopIndex; i += 1) {
        total += parseDistanceKm(routeStops[i].distanceFromPrev);
      }
      return total;
    });

    const totalDistance = cumulativeDistances[cumulativeDistances.length - 1] || 0;
    const currentDistance = cumulativeDistances[index] || 0;
    const percent = totalDistance > 0 ? (currentDistance / totalDistance) * 100 : 0;

    return {
      percent,
      currentDistance,
      totalDistance
    };
  }

  function buildDistanceTicks(totalDistance) {
    if (!totalDistance) {
      return [];
    }

    const step = 100;
    const ticks = [];
    for (let km = 0; km <= totalDistance; km += step) {
      ticks.push({
        km,
        percent: (km / totalDistance) * 100
      });
    }

    if (ticks[ticks.length - 1].km !== totalDistance) {
      ticks.push({
        km: totalDistance,
        percent: 100
      });
    }

    return ticks;
  }

  function compactTicks(ticks, maxCount) {
    if (!Array.isArray(ticks) || ticks.length <= maxCount) {
      return ticks || [];
    }

    const lastIndex = ticks.length - 1;
    const selected = new Set([0, lastIndex]);
    const interiorSlots = Math.max(0, maxCount - 2);

    for (let i = 1; i <= interiorSlots; i += 1) {
      const index = Math.round((lastIndex * i) / (interiorSlots + 1));
      if (index > 0 && index < lastIndex) {
        selected.add(index);
      }
    }

    return ticks
      .filter((_tick, index) => selected.has(index))
      .map((tick, index) => ({
        ...tick,
        row: index % 2
      }));
  }

  function formatTimelineEdge(date) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${month}/${day} ${hours}:${minutes}`;
  }

  function buildTimelineTicks() {
    const ticks = [];
    const total = itineraryEnd.getTime() - itineraryStart.getTime();
    const cursor = new Date(itineraryStart);
    cursor.setHours(0, 0, 0, 0);

    while (cursor <= itineraryEnd) {
      if (cursor >= itineraryStart) {
        const offset = cursor.getTime() - itineraryStart.getTime();
        ticks.push({
          percent: total > 0 ? (offset / total) * 100 : 0,
          label: formatTimelineEdge(cursor)
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    if (ticks.length === 0 || ticks[0].label !== formatTimelineEdge(itineraryStart)) {
      ticks.unshift({ percent: 0, label: formatTimelineEdge(itineraryStart) });
    }

    ticks.push({ percent: 100, label: formatTimelineEdge(itineraryEnd) });

    return ticks
      .filter((tick, idx, arr) => idx === 0 || tick.label !== arr[idx - 1].label)
      .map((tick, idx) => ({
        ...tick,
        row: idx % 2
      }));
  }

  function resetMapView() {
    map.fitBounds(fullRouteBounds, {
      padding: [40, 40]
    });
  }

  function createFallbackMapJournalSection() {
    const section = document.createElement("section");
    section.className = "spot-journal spot-journal-compact";
    const note = document.createElement("p");
    note.className = "spot-journal-note";
    note.textContent = "旅の記録を読み込めませんでした。ページを再読み込みしてください。";
    section.append(note);
    return section;
  }

  function syncMapJournalQuickToggle(disclosure) {
    const quickToggle = stepOverlay.querySelector("[data-step-journal-toggle]");
    if (!quickToggle) {
      return;
    }

    const isOpen = Boolean(disclosure && disclosure.open);
    quickToggle.textContent = isOpen ? uiLabels.closeJournal : uiLabels.openJournal;
    quickToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  }

  function openStepOverlayJournal() {
    const disclosure = stepOverlay.querySelector(".map-journal-disclosure");
    if (!disclosure) {
      return;
    }

    if (!disclosure.open) {
      disclosure.open = true;
    }

    syncMapJournalQuickToggle(disclosure);

    const journalSlot = stepOverlay.querySelector("[data-map-journal-slot]");
    if (journalSlot) {
      journalSlot.scrollIntoView({ block: "nearest" });
    }
  }

  function mountMapJournalSection(stop, index) {
    const slot = stepOverlay.querySelector("[data-map-journal-slot]");
    if (!slot) {
      return;
    }

    if (typeof journalUi.createJournalSection !== "function") {
      slot.append(createFallbackMapJournalSection());
      return;
    }

    const disclosure = document.createElement("details");
    disclosure.className = "map-journal-disclosure";
    disclosure.id = "map-tooltip-journal";

    const summary = document.createElement("summary");
    summary.className = "map-journal-toggle";
    summary.innerHTML = `<span>${uiLabels.openJournal}</span><span class="map-journal-toggle-note">必要なときだけ読み込みます</span>`;

    const mount = document.createElement("div");
    let mounted = false;

    const mountJournal = () => {
      if (mounted) {
        return;
      }

      mounted = true;
      mount.append(journalUi.createJournalSection({
        stop,
        index,
        itineraryStart,
        buildSpotId,
        variant: "compact",
        note: "地図を見ながら、この場所の写真やコメントを残せます。"
      }));
    };

    disclosure.addEventListener("toggle", () => {
      if (disclosure.open) {
        mountJournal();
      }
      syncMapJournalQuickToggle(disclosure);
    });

    disclosure.append(summary, mount);
    slot.append(disclosure);
    syncMapJournalQuickToggle(disclosure);
  }

  function buildTooltipHtml(stop, index) {
    const imageClass = stop.photoUrl ? "map-tooltip-photo" : "map-tooltip-photo empty";
    const imageHtml = `<img class="${imageClass}" src="${stop.photoUrl || ""}" alt="${stop.name} の写真" />`;
    const timeline = buildTimelineMeta(stop);
    const timelineTicks = compactTicks(buildTimelineTicks(), 5);
    const distanceMeta = buildDistanceMeta(index);
    const distanceTicks = compactTicks(buildDistanceTicks(distanceMeta.totalDistance), 5);
    const timeHtml = (stop.arrivalTime || stop.departureTime)
      ? `
        <div class="map-tooltip-meta-block">
          <p class="map-tooltip-meta-label">滞在予定</p>
          <p class="map-tooltip-meta-value">到着 ${stop.arrivalTime || "-"}</p>
          <p class="map-tooltip-meta-value">出発 ${stop.departureTime || "-"}</p>
          ${stop.stayDuration ? `<p class="map-tooltip-meta-value">滞在 ${stop.stayDuration}</p>` : ""}
        </div>
      `
      : "";
    const previousDistance = stop.distanceFromPrev
      ? `前のスポットから ${stop.distanceFromPrev}${stop.driveTimeFromPrev ? ` / ${stop.driveTimeFromPrev}` : ""}`
      : "旅のスタート地点";
    const nextStop = routeStops[index + 1];
    const nextDistance = nextStop && nextStop.distanceFromPrev
      ? `次のスポットまで ${nextStop.distanceFromPrev}${nextStop.driveTimeFromPrev ? ` / ${nextStop.driveTimeFromPrev}` : ""}`
      : "ここが最後のスポット";
    const distanceHtml = `
      <div class="map-tooltip-meta-block">
        <p class="map-tooltip-meta-label">移動の目安</p>
        <p class="map-tooltip-meta-value">${previousDistance}</p>
        <p class="map-tooltip-meta-value">${nextDistance}</p>
      </div>
    `;

    const links = [];
    links.push(`<a class="map-tooltip-link map-tooltip-link-strong" href="${buildSpotDetailsPath(index)}">${uiLabels.readOnDetailsPage}</a>`);
    if (stop.officialUrl) {
      links.push(`<a class="map-tooltip-link" href="${stop.officialUrl}" target="_blank" rel="noreferrer">${stop.officialLabel || "公式情報"}</a>`);
    }
    if (stop.wikiTitle) {
      links.push(`<a class="map-tooltip-link" href="https://en.wikipedia.org/wiki/${stop.wikiTitle}" target="_blank" rel="noreferrer">${uiLabels.referenceInfo}</a>`);
    }
    const showOverlayNav = !state.stepModeEnabled;
    const navHtml = showOverlayNav
      ? `
        <div class="map-tooltip-nav">
          <button type="button" class="map-control-button" data-step-nav="prev" ${index === 0 ? "disabled" : ""}>戻る</button>
          <button type="button" class="map-control-button" data-step-nav="next" ${index === routeStops.length - 1 ? "disabled" : ""}>次へ</button>
        </div>
      `
      : "";
    const actionsClassName = showOverlayNav
      ? "map-tooltip-actions"
      : "map-tooltip-actions map-tooltip-actions-single";

    return [
      '<div class="map-tooltip">',
      '<div class="map-tooltip-sticky">',
      '<div class="map-tooltip-heading">',
      '<div class="map-tooltip-title-group">',
      `<h3 class="map-tooltip-title">${index + 1}. ${stop.name}</h3>`,
      `<span class="map-tooltip-day">${stop.day}</span>`,
      "</div>",
      `<button type="button" class="map-control-button map-tooltip-close" data-step-nav="close">${uiLabels.close}</button>`,
      "</div>",
      `<div class="${actionsClassName}">`,
      navHtml,
      `<button type="button" class="map-control-button map-tooltip-journal-quick-toggle" data-step-journal-toggle aria-controls="map-tooltip-journal" aria-expanded="false">${uiLabels.openJournal}</button>`,
      "</div>",
      "</div>",
      '<div class="map-tooltip-main">',
      timeline
        ? `
          <div class="map-tooltip-gauges">
            <div class="map-tooltip-gauge">
              <div class="map-tooltip-gauge-header">
                <p class="map-tooltip-timeline-label">${timeline.label}</p>
                <p class="map-tooltip-timeline-sublabel">${timeline.sublabel}</p>
              </div>
              <div class="map-tooltip-gauge-track">
                <div class="map-tooltip-timeline-bar">
                  <div class="map-tooltip-timeline-fill" style="height: ${timeline.percent.toFixed(1)}%;"></div>
                  ${timelineTicks.map((tick) => `<span class="map-tooltip-timeline-tick" style="bottom: ${tick.percent.toFixed(1)}%;"></span>`).join("")}
                </div>
                <div class="map-tooltip-timeline-edges">
                  ${timelineTicks.map((tick) => `<span class="map-tooltip-timeline-edge timeline-row-${tick.row}" style="bottom: ${tick.percent.toFixed(1)}%;">${tick.label}</span>`).join("")}
                </div>
              </div>
            </div>
            <div class="map-tooltip-gauge">
              <div class="map-tooltip-gauge-header">
                <p class="map-tooltip-distance-label">走行距離 ${distanceMeta.currentDistance.toFixed(0)}km / ${distanceMeta.totalDistance.toFixed(0)}km</p>
              </div>
              <div class="map-tooltip-gauge-track">
                <div class="map-tooltip-distance-bar">
                  <div class="map-tooltip-distance-fill" style="height: ${distanceMeta.percent.toFixed(1)}%;"></div>
                  ${distanceTicks.map((tick) => `<span class="map-tooltip-distance-tick" style="bottom: ${tick.percent.toFixed(1)}%;"></span>`).join("")}
                </div>
                <div class="map-tooltip-distance-edges">
                  ${distanceTicks.map((tick, idx) => `<span class="map-tooltip-distance-edge distance-row-${idx % 2}" style="bottom: ${tick.percent.toFixed(1)}%;">${tick.km}km</span>`).join("")}
                </div>
              </div>
            </div>
          </div>
        `
        : "",
      '<div class="map-tooltip-content">',
      '<div class="map-tooltip-body">',
      imageHtml,
      '<div class="map-tooltip-copy">',
      `<p class="map-tooltip-summary">${stop.note}</p>`,
      `<p class="map-tooltip-detail">${stop.stepHtml || stop.note}</p>`,
      '</div>',
      '</div>',
      `<div class="map-tooltip-meta-grid">${timeHtml}${distanceHtml}</div>`,
      `<div class="map-tooltip-links">${links.join("")}</div>`,
      navHtml,
      '<div class="map-tooltip-journal-slot" data-map-journal-slot></div>',
      '</div>',
      '</div>',
      "</div>"
    ].join("");
  }

  function hideSpotDetails() {
    state.activeSpotIndex = null;
    hideStepOverlay();
  }

  function showStepOverlay(index, options = {}) {
    const { openJournal = false } = options;
    const entry = markers[index];
    if (!entry) {
      return;
    }

    const point = map.latLngToContainerPoint(entry.marker.getLatLng());
    const mapSize = map.getSize();
    const placeOnBottom = point.y < mapSize.y * 0.5;
    const placeLeft = point.x > mapSize.x * 0.62;
    const placeRight = point.x < mapSize.x * 0.38;
    const horizontalMargin = 32;
    const verticalMargin = 32;
    let overlayWidth = Math.max(760, Math.min(1120, mapSize.x - 260));

    if (placeLeft || placeRight) {
      const availableWidth = placeLeft
        ? point.x - horizontalMargin
        : mapSize.x - point.x - horizontalMargin;
      overlayWidth = Math.max(520, Math.min(880, availableWidth));
    }

    stepOverlay.classList.remove(
      "step-overlay-left-side",
      "step-overlay-right-side",
      "step-overlay-top",
      "step-overlay-bottom"
    );

    if (placeLeft) {
      stepOverlay.classList.add("step-overlay-left-side");
    } else if (placeRight) {
      stepOverlay.classList.add("step-overlay-right-side");
    }

    stepOverlay.classList.add(placeOnBottom ? "step-overlay-bottom" : "step-overlay-top");
    stepOverlay.style.width = `${Math.max(320, overlayWidth)}px`;
    stepOverlay.style.maxHeight = `${Math.max(280, mapSize.y - verticalMargin)}px`;
    stepOverlay.innerHTML = buildTooltipHtml(entry.stop, index);
    mountMapJournalSection(entry.stop, index);
    if (openJournal) {
      openStepOverlayJournal();
    }
    stepOverlay.classList.remove("hidden");
    state.activeSpotIndex = index;
    updateStepControls();
  }

  function hideStepOverlay() {
    stepOverlay.classList.add("hidden");
    stepOverlay.classList.remove(
      "step-overlay-left-side",
      "step-overlay-right-side",
      "step-overlay-top",
      "step-overlay-bottom"
    );
    stepOverlay.style.width = "";
    stepOverlay.style.maxHeight = "";
    stepOverlay.innerHTML = "";
    updateStepControls();
  }

  function showSpotDetails(index, options = {}) {
    hideSpotDetails();
    showStepOverlay(index, options);
  }

  function refreshTooltipPhoto(index) {
    const entry = markers[index];
    if (!entry) {
      return;
    }

    const isOverlayVisibleForStop = state.activeSpotIndex === index && !stepOverlay.classList.contains("hidden");
    if (!isOverlayVisibleForStop) {
      return;
    }

    const photoElement = stepOverlay.querySelector(".map-tooltip-photo");
    if (!photoElement) {
      return;
    }

    if (entry.stop.photoUrl) {
      photoElement.src = entry.stop.photoUrl;
      photoElement.classList.remove("empty");
      return;
    }

    photoElement.removeAttribute("src");
    photoElement.classList.add("empty");
  }

  async function loadPhotoForStop(stop, index) {
    if (!stop.wikiTitle || stop.photoUrl) {
      return;
    }

    const requestId = ++state.stepImageRequestId;

    try {
      const photoUrl = await loadReferencePhoto(stop);
      if (requestId !== state.stepImageRequestId) {
        return;
      }

      stop.photoUrl = photoUrl || "";
      refreshTooltipPhoto(index);
    } catch (_error) {
      stop.photoUrl = stop.photoUrl || "";
    }
  }

  function setRouteStatus(kind, title, body) {
    if (!title) {
      routeStatusPanel.classList.add("hidden");
      routeStatusPanel.innerHTML = "";
      return;
    }

    routeStatusPanel.innerHTML = `
      <p class="route-status-label route-status-label-${kind}">${title}</p>
      <p class="route-status-copy">${body}</p>
    `;
    routeStatusPanel.classList.remove("hidden");
  }

  function updateRouteStatusPanel() {
    const totalSegments = routeSegments.length;
    const completedSegments = totalSegments - state.pendingRouteSegments;

    if (state.pendingRouteSegments > 0) {
      setRouteStatus(
        "loading",
        "道路ルートを読み込んでいます",
        `${completedSegments} / ${totalSegments} 区間の道路ルートを確認しています。`
      );
      return;
    }

    if (state.failedRouteSegments.length > 0) {
      setRouteStatus(
        "warning",
        "一部の道路ルートを表示できませんでした",
        `${state.failedRouteSegments.length} 区間は誤解を避けるため直線の代替線を表示せず、道路ルートだけを表示しています。`
      );
      return;
    }

    setRouteStatus("", "", "");
  }

  function distanceMeters(a, b) {
    const toRad = (value) => (value * Math.PI) / 180;
    const earthRadius = 6371000;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h =
      sinLat * sinLat +
      Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
    return 2 * earthRadius * Math.asin(Math.sqrt(h));
  }

  function buildMarkerOffsets() {
    const thresholdMeters = 3500;
    const offsets = routeStops.map(() => ({ x: 0, y: 0 }));
    const consumed = new Set();

    routeStops.forEach((stop, index) => {
      if (consumed.has(index)) {
        return;
      }

      const cluster = [index];
      consumed.add(index);

      for (let i = index + 1; i < routeStops.length; i += 1) {
        if (distanceMeters(stop, routeStops[i]) <= thresholdMeters) {
          cluster.push(i);
          consumed.add(i);
        }
      }

      if (cluster.length === 1) {
        return;
      }

      cluster.forEach((clusterIndex, order) => {
        const angle = (-90 + (360 / cluster.length) * order) * (Math.PI / 180);
        const radius = cluster.length === 2 ? 16 : 20;
        offsets[clusterIndex] = {
          x: Math.round(Math.cos(angle) * radius),
          y: Math.round(Math.sin(angle) * radius)
        };
      });
    });

    return offsets;
  }

  function createMarkerIcon(stop, index, offset) {
    function escapeAttribute(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function getMarkerVariant() {
      const icon = stop && typeof stop.icon === "string" ? stop.icon : "";

      switch (icon) {
        case "✈":
          return "airport";
        case "🌉":
          return "bridge";
        case "🏨":
        case "🏠":
          return "stay";
        case "🏙":
          return "city";
        case "⛰":
          return "mountain";
        case "♨":
          return "hot-spring";
        case "💧":
          return "water";
        case "🥾":
          return "hike";
        case "❄":
          return "snow";
        case "🧊":
          return "ice";
        default:
          break;
      }

      switch (stop.kind) {
        case "airport":
          return "airport";
        case "stay":
          return "stay";
        case "city":
          return "city";
        case "lagoon":
          return "water";
        default:
          return "mountain";
      }
    }

    function getMarkerSvg(variant) {
      switch (variant) {
        case "airport":
          return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13.5 10.4 12 20 5.8l1.6 1.6-6.2 9.6-1.5 7-2.7-5-5-2.7Z"></path></svg>';
        case "bridge":
          return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h16"></path><path d="M6 18v-4a6 6 0 0 1 12 0v4"></path><path d="M9 18v-3"></path><path d="M15 18v-3"></path></svg>';
        case "stay":
          return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20H4Z"></path><path d="M9 20v-5h6v5"></path></svg>';
        case "city":
          return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10l5-2v12"></path><path d="M10 20V5l10 3v12"></path><path d="M7 12h.01"></path><path d="M7 15h.01"></path><path d="M14 10h.01"></path><path d="M17 10h.01"></path><path d="M14 13h.01"></path><path d="M17 13h.01"></path></svg>';
        case "hot-spring":
          return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18c0-2.2 1.8-4 4-4h4c2.2 0 4 1.8 4 4"></path><path d="M7 20h10"></path><path d="M9 10c0-1.6 1.6-2.1 1.6-3.7"></path><path d="M12 9c0-1.6 1.6-2.1 1.6-3.7"></path><path d="M15 10c0-1.6 1.6-2.1 1.6-3.7"></path></svg>';
        case "water":
          return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4c2.8 4 5 6.7 5 9.4A5 5 0 0 1 7 13.4C7 10.7 9.2 8 12 4Z"></path></svg>';
        case "hike":
          return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h3l1 2.5 2.5 1.5-1 2.5-2 .5-1.5 3.5H7.5l1.5-4L7 9l2-4Z"></path><path d="M14.5 14.5 17 20"></path></svg>';
        case "snow":
          return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18"></path><path d="M4.2 7.5 19.8 16.5"></path><path d="M4.2 16.5 19.8 7.5"></path></svg>';
        case "ice":
          return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 8v8l-7 5-7-5V8Z"></path><path d="M12 3v18"></path><path d="M5 8h14"></path></svg>';
        case "mountain":
        default:
          return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19 10.5 9 14 14l2.1-3 3.9 8Z"></path><path d="m9.7 10.3 1.1-1.5 1.1 1.7"></path></svg>';
      }
    }

    const kindClass = stop.kind || "nature";
    const variantClass = getMarkerVariant();
    const translateStyle = offset && (offset.x !== 0 || offset.y !== 0)
      ? ` style="transform: translate(${offset.x}px, ${offset.y}px);"`
      : "";
    const markerTitle = escapeAttribute(stop.name);

    return L.divIcon({
      className: "",
      html: [
        `<div class="map-icon map-icon-${kindClass} map-icon-${variantClass}"${translateStyle} title="${markerTitle}" aria-label="${markerTitle}">`,
        `<span class="map-icon-glyph">${getMarkerSvg(variantClass)}</span>`,
        `<span class="map-icon-number">${index + 1}</span>`,
        "</div>"
      ].join(""),
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
  }

  function createMarkers() {
    const markerOffsets = buildMarkerOffsets();
    routeStops.forEach((stop, index) => {
      const marker = L.marker([stop.lat, stop.lng], {
        icon: createMarkerIcon(stop, index, markerOffsets[index]),
        zIndexOffset: markerOffsets[index]
          ? Math.abs(markerOffsets[index].x) + Math.abs(markerOffsets[index].y)
          : 0
      }).addTo(map);

      marker.on("click", () => {
        if (!state.stepModeEnabled && state.activeSpotIndex === index && !stepOverlay.classList.contains("hidden")) {
          hideSpotDetails();
          return;
        }

        if (state.stepModeEnabled) {
          state.currentStepIndex = index;
          applyVisibility();
        }

        loadPhotoForStop(stop, index);
        showSpotDetails(index);
      });

      markers.push({ marker, stop, index });
    });
  }

  function createSegmentLayers() {
    let pendingSegments = 0;

    routeStops.forEach((stop, index) => {
      if (index === 0) {
        return;
      }

      const prev = routeStops[index - 1];
      const fallbackLatLngs = buildFallbackSegmentLatLngs(prev, stop);
      const segment = L.polyline(fallbackLatLngs, {
        color: "#d97706",
        weight: 5,
        opacity: 0.9,
        lineJoin: "round"
      });

      const segmentEntry = {
        line: segment,
        index,
        fromStop: prev,
        toStop: stop,
        arrow: null,
        isResolved: false
      };

      const cachedLatLngs = readCachedRouteGeometry(getRouteCacheKey(prev, stop));
      if (cachedLatLngs && cachedLatLngs.length >= 2) {
        segment.setLatLngs(cachedLatLngs);
        segmentEntry.isResolved = true;
        updateSegmentArrow(segmentEntry, cachedLatLngs);
      } else {
        pendingSegments += 1;
      }

      routeSegments.push(segmentEntry);
    });
    routeSegments.sort((a, b) => a.index - b.index);
    state.pendingRouteSegments = pendingSegments;
    state.failedRouteSegments = [];
    updateRouteStatusPanel();
  }

  async function enhanceSegmentLayers() {
    const unresolvedSegments = routeSegments.filter((segmentEntry) => !segmentEntry.isResolved);
    if (unresolvedSegments.length === 0) {
      updateRouteStatusPanel();
      return;
    }

    for (let start = 0; start < unresolvedSegments.length; start += ROUTE_FETCH_CONCURRENCY) {
      const batch = unresolvedSegments.slice(start, start + ROUTE_FETCH_CONCURRENCY);

      await Promise.all(batch.map(async (segmentEntry) => {
        const latLngs = await fetchRouteGeometry(segmentEntry.fromStop, segmentEntry.toStop);
        if (latLngs && latLngs.length >= 2) {
          segmentEntry.line.setLatLngs(latLngs);
          segmentEntry.isResolved = true;
          updateSegmentArrow(segmentEntry, latLngs);
        } else if (!state.failedRouteSegments.includes(segmentEntry.index)) {
          state.failedRouteSegments.push(segmentEntry.index);
        }

        state.pendingRouteSegments = Math.max(0, state.pendingRouteSegments - 1);
      }));

      updateRouteStatusPanel();
      applyVisibility();
      await yieldToBrowser();
    }
  }

  function updateStepControls() {
    const currentStop = routeStops[state.currentStepIndex];
    elements.stepControls.classList.toggle("hidden", !state.stepModeEnabled);
    elements.stepProgressLabel.textContent = uiLabels.tripProgress(
      state.currentStepIndex + 1,
      routeStops.length
    );
    elements.stepCurrentStop.textContent = `${currentStop.day} · ${currentStop.name}`;
    elements.stepCurrentMeta.textContent = buildStepMetaText(currentStop);
    elements.stepCurrentTravel.textContent = buildStepTravelText(currentStop);
    elements.stepCurrentNote.textContent = buildStepNoteText(currentStop);
    elements.stepDetailToggle.textContent = getStepDetailToggleLabel();
    elements.stepPrevButton.disabled = state.currentStepIndex <= 0;
    elements.stepNextButton.disabled = state.currentStepIndex >= routeStops.length - 1;
  }

  function applyVisibility() {
    markers.forEach(({ marker, index }) => {
      const visibleByStep = !state.stepModeEnabled || Math.abs(index - state.currentStepIndex) <= 1;
      if (visibleByStep) {
        marker.addTo(map);
      } else {
        marker.remove();
      }
    });

    routeSegments.forEach(({ line, index, isResolved }) => {
      const visibleByStep =
        !state.stepModeEnabled ||
        index === state.currentStepIndex ||
        index === state.currentStepIndex + 1;
      if (isResolved && visibleByStep) {
        line.addTo(map);
      } else {
        line.remove();
      }
    });

    segmentArrows.forEach(({ marker, index }) => {
      const visibleByStep =
        !state.stepModeEnabled ||
        index === state.currentStepIndex ||
        index === state.currentStepIndex + 1;
      if (visibleByStep) {
        marker.addTo(map);
      } else {
        marker.remove();
      }
    });

    updateStepControls();
  }

  function focusCurrentStep(options = {}) {
    const { openDetails = true, openJournal = false } = options;
    const current = markers[state.currentStepIndex];
    if (!current) {
      return;
    }

    map.setView(current.marker.getLatLng(), Math.max(map.getZoom(), 6), {
      animate: false
    });
    loadPhotoForStop(current.stop, state.currentStepIndex);
    if (openDetails) {
      showSpotDetails(state.currentStepIndex, { openJournal });
      return;
    }

    hideSpotDetails();
    updateStepControls();
  }

  function focusSpot(index) {
    const entry = markers[index];
    if (!entry) {
      return;
    }

    state.currentStepIndex = index;
    applyVisibility();
    map.setView(entry.marker.getLatLng(), 8, {
      animate: false
    });
    loadPhotoForStop(entry.stop, index);
    showSpotDetails(index);
  }

  function moveStep(delta) {
    const nextIndex = state.currentStepIndex + delta;
    if (nextIndex < 0 || nextIndex >= routeStops.length) {
      return;
    }

    const keepDetailsOpen = isStepOverlayVisible();
    state.currentStepIndex = nextIndex;
    applyVisibility();
    focusCurrentStep({
      openDetails: keepDetailsOpen
    });
  }

  function moveSpot(delta) {
    const baseIndex = state.stepModeEnabled ? state.currentStepIndex : state.activeSpotIndex;
    if (!Number.isInteger(baseIndex)) {
      return;
    }

    const nextIndex = baseIndex + delta;
    if (nextIndex < 0 || nextIndex >= routeStops.length) {
      return;
    }

    if (state.stepModeEnabled) {
      moveStep(delta);
      return;
    }

    loadPhotoForStop(routeStops[nextIndex], nextIndex);
    showSpotDetails(nextIndex);
  }

  function toggleStepMode() {
    state.stepModeEnabled = !state.stepModeEnabled;
    syncControlLabels();
    elements.stepModeToggle.classList.toggle("active", state.stepModeEnabled);

    if (state.stepModeEnabled) {
      applyVisibility();
      hideSpotDetails();
      focusCurrentStep({
        openDetails: shouldAutoOpenGuideDetails()
      });
      return;
    }

    hideSpotDetails();
    applyVisibility();
    resetMapView();
  }

  function syncFullscreenLabel() {
    syncControlLabels();
  }

  function attachEvents() {
    map.on("click", () => {
      if (!state.stepModeEnabled) {
        hideSpotDetails();
      }
    });

    elements.stepModeToggle.addEventListener("click", toggleStepMode);
    elements.stepDetailToggle.addEventListener("click", () => {
      if (!state.stepModeEnabled) {
        return;
      }

      if (isStepOverlayVisible()) {
        hideSpotDetails();
        return;
      }

      focusCurrentStep({ openDetails: true });
    });

    elements.stepJournalButton.addEventListener("click", () => {
      if (!state.stepModeEnabled) {
        return;
      }

      focusCurrentStep({
        openDetails: true,
        openJournal: true
      });
    });

    elements.stepPrevButton.addEventListener("click", () => {
      if (!state.stepModeEnabled) {
        return;
      }

      moveStep(-1);
    });

    elements.stepNextButton.addEventListener("click", () => {
      if (!state.stepModeEnabled) {
        return;
      }

      moveStep(1);
    });

    stepOverlay.addEventListener("click", (event) => {
      event.stopPropagation();
      const journalToggle = event.target.closest("[data-step-journal-toggle]");
      if (journalToggle) {
        const disclosure = stepOverlay.querySelector(".map-journal-disclosure");
        if (!disclosure) {
          return;
        }

        disclosure.open = !disclosure.open;
        syncMapJournalQuickToggle(disclosure);

        if (disclosure.open) {
          const journalSlot = stepOverlay.querySelector("[data-map-journal-slot]");
          if (journalSlot) {
            journalSlot.scrollIntoView({ block: "nearest" });
          }
        }
        return;
      }

      const navButton = event.target.closest("[data-step-nav]");
      if (!navButton) {
        return;
      }

      if (navButton.dataset.stepNav === "prev") {
        moveSpot(-1);
        return;
      }

      if (navButton.dataset.stepNav === "next") {
        moveSpot(1);
        return;
      }

      if (navButton.dataset.stepNav === "close") {
        hideSpotDetails();
      }
    });

    document.addEventListener("keydown", (event) => {
      const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select") {
        return;
      }

      if (event.key === "Escape") {
        hideSpotDetails();
        return;
      }

      if (!state.stepModeEnabled) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveStep(-1);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveStep(1);
      }
    });

    elements.fullscreenButton.addEventListener("click", async () => {
      try {
        if (document.fullscreenElement === elements.mapElement) {
          await document.exitFullscreen();
          elements.mapElement.classList.remove("map-fullscreen");
        } else {
          elements.mapElement.classList.add("map-fullscreen");
          await elements.mapElement.requestFullscreen();
        }

        setTimeout(() => {
          map.invalidateSize();
          resetMapView();
          syncFullscreenLabel();
        }, 120);
      } catch (_error) {
        elements.mapElement.classList.remove("map-fullscreen");
        syncFullscreenLabel();
      }
    });

    document.addEventListener("fullscreenchange", () => {
      if (document.fullscreenElement !== elements.mapElement) {
        elements.mapElement.classList.remove("map-fullscreen");
      }
      syncFullscreenLabel();
      setTimeout(() => {
        map.invalidateSize();
        resetMapView();
      }, 120);
    });

    if (compactControlsMediaQuery) {
      compactControlsMediaQuery.addEventListener("change", () => {
        syncControlLabels();
      });
    }
  }

  function init() {
    createSegmentLayers();
    createMarkers();
    attachEvents();
    syncFullscreenLabel();
    resetMapView();
    applyVisibility();
    const requestedSpotIndex = parseRequestedSpotIndex();
    if (requestedSpotIndex !== null) {
      focusSpot(requestedSpotIndex);
    }
    scheduleDeferredWork(enhanceSegmentLayers);
  }

  init();
})();
