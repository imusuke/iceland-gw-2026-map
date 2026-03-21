(function () {
  const tripData = window.ICELAND_TRIP_DATA;
  if (!tripData || !Array.isArray(tripData.routeStops)) {
    throw new Error("Trip data is missing.");
  }

  const routeStops = tripData.routeStops;
  const itineraryStart = new Date(tripData.itineraryStart);
  const itineraryEnd = new Date(tripData.itineraryEnd);

  const elements = {
    mapElement: document.querySelector(".map-shell"),
    mapCanvas: document.getElementById("map"),
    fullscreenButton: document.getElementById("fullscreen-button"),
    stepModeToggle: document.getElementById("step-mode-toggle"),
    stepControls: document.getElementById("step-controls"),
    stepProgressLabel: document.getElementById("step-progress-label")
  };

  const stepOverlay = document.createElement("section");
  stepOverlay.className = "floating-panel top-left step-overlay hidden";
  elements.mapElement.appendChild(stepOverlay);

  const state = {
    stepModeEnabled: false,
    currentStepIndex: 0,
    activeSpotIndex: null,
    stepImageRequestId: 0
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
    return new Date(2026, month - 1, day, hours, minutes);
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
    if (stop.officialUrl) {
      links.push(`<a class="map-tooltip-link" href="${stop.officialUrl}" target="_blank" rel="noreferrer">${stop.officialLabel || "公式情報"}</a>`);
    }
    if (stop.wikiTitle) {
      links.push(`<a class="map-tooltip-link" href="https://en.wikipedia.org/wiki/${stop.wikiTitle}" target="_blank" rel="noreferrer">写真と概要</a>`);
    }
    const navHtml = `
      <div class="map-tooltip-nav">
        <button type="button" class="map-control-button" data-step-nav="prev" ${index === 0 ? "disabled" : ""}>戻る</button>
        <button type="button" class="map-control-button" data-step-nav="next" ${index === routeStops.length - 1 ? "disabled" : ""}>次へ</button>
      </div>
    `;

    return [
      '<div class="map-tooltip">',
      `<h3 class="map-tooltip-title">${index + 1}. ${stop.name}</h3>`,
      `<span class="map-tooltip-day">${stop.day}</span>`,
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
      '</div>',
      '</div>',
      "</div>"
    ].join("");
  }

  function hideSpotDetails() {
    state.activeSpotIndex = null;
    hideStepOverlay();
  }

  function showStepOverlay(index) {
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
    stepOverlay.classList.remove("hidden");
    state.activeSpotIndex = index;
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
  }

  function showSpotDetails(index) {
    hideSpotDetails();
    showStepOverlay(index);
  }

  function refreshSpotDetails(index) {
    const entry = markers[index];
    if (!entry) {
      return;
    }

    const isOverlayVisibleForStop = state.activeSpotIndex === index && !stepOverlay.classList.contains("hidden");
    if (isOverlayVisibleForStop) {
      showStepOverlay(index);
    }
  }

  async function loadPhotoForStop(stop, index) {
    if (!stop.wikiTitle || stop.photoUrl) {
      return;
    }

    const requestId = ++state.stepImageRequestId;

    try {
      const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${stop.wikiTitle}`);
      if (!response.ok) {
        return;
      }

      const data = await response.json();
      if (requestId !== state.stepImageRequestId) {
        return;
      }

      stop.photoUrl = data.thumbnail && data.thumbnail.source ? data.thumbnail.source : "";
      refreshSpotDetails(index);
    } catch (_error) {
      stop.photoUrl = stop.photoUrl || "";
    }
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
    const translateStyle = offset && (offset.x !== 0 || offset.y !== 0)
      ? ` style="transform: translate(${offset.x}px, ${offset.y}px);"`
      : "";

    return L.divIcon({
      className: "",
      html: [
        `<div class="map-icon map-icon-${stop.kind || "nature"}"${translateStyle} title="${stop.name}">`,
        `<span>${stop.icon || "•"}</span>`,
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
      }).addTo(map);

      const segmentEntry = { line: segment, index, fromStop: prev, toStop: stop, arrow: null };
      routeSegments.push(segmentEntry);
      updateSegmentArrow(segmentEntry, fallbackLatLngs);
    });
    routeSegments.sort((a, b) => a.index - b.index);
  }

  async function enhanceSegmentLayers() {
    for (const segmentEntry of routeSegments) {
      const latLngs = await fetchRouteGeometry(segmentEntry.fromStop, segmentEntry.toStop);
      if (!latLngs || latLngs.length < 2) {
        continue;
      }

      segmentEntry.line.setLatLngs(latLngs);
      updateSegmentArrow(segmentEntry, latLngs);
      applyVisibility();
    }
  }

  function updateStepControls() {
    elements.stepControls.classList.toggle("hidden", !state.stepModeEnabled);
    elements.stepProgressLabel.textContent = `Step ${state.currentStepIndex + 1} / ${routeStops.length}`;
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

    routeSegments.forEach(({ line, index }) => {
      const visibleByStep =
        !state.stepModeEnabled ||
        index === state.currentStepIndex ||
        index === state.currentStepIndex + 1;
      if (visibleByStep) {
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

  function focusCurrentStep() {
    const current = markers[state.currentStepIndex];
    if (!current) {
      return;
    }

    loadPhotoForStop(current.stop, state.currentStepIndex);
    showSpotDetails(state.currentStepIndex);
  }

  function moveStep(delta) {
    const nextIndex = state.currentStepIndex + delta;
    if (nextIndex < 0 || nextIndex >= routeStops.length) {
      return;
    }

    state.currentStepIndex = nextIndex;
    applyVisibility();
    focusCurrentStep();
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
    elements.stepModeToggle.textContent = state.stepModeEnabled ? "Close Guide" : "Guide";
    elements.stepModeToggle.classList.toggle("active", state.stepModeEnabled);

    if (state.stepModeEnabled) {
      applyVisibility();
      hideSpotDetails();
      focusCurrentStep();
      return;
    }

    hideSpotDetails();
    applyVisibility();
    resetMapView();
  }

  function syncFullscreenLabel() {
    elements.fullscreenButton.textContent =
      document.fullscreenElement === elements.mapElement ? "Exit Fullscreen" : "Fullscreen";
  }

  function attachEvents() {
    elements.stepModeToggle.addEventListener("click", toggleStepMode);
    stepOverlay.addEventListener("click", (event) => {
      event.stopPropagation();
      const navButton = event.target.closest("[data-step-nav]");
      if (navButton) {
        if (navButton.dataset.stepNav === "prev") {
          moveSpot(-1);
        } else if (navButton.dataset.stepNav === "next") {
          moveSpot(1);
        }
        return;
      }

      if (!state.stepModeEnabled) {
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
  }

  function init() {
    createSegmentLayers();
    createMarkers();
    attachEvents();
    syncFullscreenLabel();
    resetMapView();
    applyVisibility();
    window.setTimeout(() => {
      enhanceSegmentLayers();
    }, 50);
  }

  init();
})();
