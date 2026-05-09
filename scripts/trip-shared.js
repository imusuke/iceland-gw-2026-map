(function () {
  const wikiSummaryCache = new Map();

  const labels = {
    referenceInfo: "Wikipedia の参考情報",
    readOnDetailsPage: "スポット詳細で読む",
    openSpotOnMap: "この場所をマップで開く",
    overviewMap: "ルートマップ全体",
    tripProgress: (current, total) => `旅程 ${current} / ${total}`,
    spotBadge: (index) => `スポット ${index}`
  };

  function buildSpotId(stopOrIndex, maybeIndex) {
    if (stopOrIndex && typeof stopOrIndex === "object" && typeof stopOrIndex.id === "string") {
      return stopOrIndex.id;
    }

    const index = typeof stopOrIndex === "number" ? stopOrIndex : maybeIndex;
    return `spot-${index + 1}`;
  }

  function buildSpotDetailsPath(stopOrIndex, maybeIndex) {
    return `/spots#${buildSpotId(stopOrIndex, maybeIndex)}`;
  }

  function buildSpotMapPath(stopOrIndex, maybeIndex) {
    return `/map?spot=${encodeURIComponent(buildSpotId(stopOrIndex, maybeIndex))}`;
  }

  async function fetchWikiSummary(wikiTitle) {
    if (!wikiTitle) {
      return null;
    }

    if (!wikiSummaryCache.has(wikiTitle)) {
      wikiSummaryCache.set(
        wikiTitle,
        fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${wikiTitle}`)
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Summary request failed: ${response.status}`);
            }

            return response.json();
          })
          .catch(() => null)
      );
    }

    return wikiSummaryCache.get(wikiTitle);
  }

  async function loadReferencePhoto(stop) {
    if (!stop || !stop.wikiTitle) {
      return "";
    }

    if (stop.photoUrl) {
      return stop.photoUrl;
    }

    const summary = await fetchWikiSummary(stop.wikiTitle);
    const photoUrl = summary && summary.thumbnail && summary.thumbnail.source
      ? summary.thumbnail.source
      : "";

    stop.photoUrl = photoUrl;
    return photoUrl;
  }

  window.ICELAND_TRIP_SHARED = {
    labels,
    buildSpotId,
    buildSpotDetailsPath,
    buildSpotMapPath,
    loadReferencePhoto
  };
})();
