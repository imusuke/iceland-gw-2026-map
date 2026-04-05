(function () {
  const tripData = window.ICELAND_TRIP_DATA;
  if (!tripData || !Array.isArray(tripData.routeStops)) {
    throw new Error("Trip data is missing.");
  }

  const JOURNAL_API_PATH = "/api/journal";
  const JOURNAL_MAX_COMMENT_LENGTH = 600;
  const MAX_IMAGE_DIMENSION = 1800;
  const MAX_UPLOAD_IMAGE_BYTES = 3.5 * 1024 * 1024;
  const JPEG_QUALITY = 0.84;
  const routeStops = tripData.routeStops;
  const itineraryStart = new Date(tripData.itineraryStart);
  const itineraryEnd = new Date(tripData.itineraryEnd);
  const fullDateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
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

  function formatJournalDateTime(value, fallback) {
    if (!value) {
      return fallback;
    }

    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
      return fallback;
    }

    return fullDateTimeFormatter.format(parsedDate);
  }

  function buildMapPath(index) {
    return `/map?spot=${index + 1}`;
  }

  function buildSpotId(index) {
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

  function createJournalSection(stop, index) {
    const spotId = buildSpotId(index);
    const section = createElement("section", "spot-journal");
    const header = createElement("div", "spot-journal-header");
    const title = createElement("h3", "spot-journal-title", "旅の記録");
    const note = createElement(
      "p",
      "spot-journal-note",
      "写真1枚とコメントを追加できます。画像は自動で縮小して保存されます。"
    );
    header.append(title, note);

    const entryList = createElement("div", "journal-entry-list");
    const status = createElement("p", "journal-status", "記録を読み込んでいます...");
    const form = createJournalForm({ stop, spotId, status, entryList });

    section.append(header, form, status, entryList);
    void loadJournalEntries(spotId, form, status, entryList);

    return section;
  }

  function createJournalForm({ stop, spotId, status, entryList }) {
    const form = createElement("form", "journal-form");
    form.noValidate = true;
    form.dataset.spotId = spotId;

    const fieldset = createElement("fieldset", "journal-fieldset");

    const grid = createElement("div", "journal-form-grid");
    const photoField = createElement("div", "journal-field");
    const photoLabel = createFieldLabel(`photo-${spotId}`, "写真");
    const photoInput = document.createElement("input");
    photoInput.className = "journal-input";
    photoInput.id = `photo-${spotId}`;
    photoInput.name = "photo";
    photoInput.type = "file";
    photoInput.accept = "image/*";
    photoInput.required = true;
    const photoHint = createElement(
      "p",
      "journal-input-hint",
      "スマホ写真も自動で軽くして保存します。"
    );
    photoField.append(photoLabel, photoInput, photoHint);

    const visitedField = createElement("div", "journal-field");
    const visitedLabel = createFieldLabel(`visited-${spotId}`, "訪問した日時");
    const visitedInput = document.createElement("input");
    visitedInput.className = "journal-input";
    visitedInput.id = `visited-${spotId}`;
    visitedInput.name = "visitedAt";
    visitedInput.type = "datetime-local";
    visitedInput.value = buildVisitedAtDefault(stop);
    const visitedHint = createElement(
      "p",
      "journal-input-hint",
      "あとから見返したときに、その日の流れが分かりやすくなります。"
    );
    visitedField.append(visitedLabel, visitedInput, visitedHint);

    grid.append(photoField, visitedField);

    const commentField = createElement("div", "journal-field");
    const commentLabel = createFieldLabel(`comment-${spotId}`, "コメント");
    const commentInput = document.createElement("textarea");
    commentInput.className = "journal-textarea";
    commentInput.id = `comment-${spotId}`;
    commentInput.name = "comment";
    commentInput.required = true;
    commentInput.maxLength = JOURNAL_MAX_COMMENT_LENGTH;
    commentInput.rows = 4;
    commentInput.placeholder = "この場所で印象に残ったことや、その場の空気を書き残せます。";
    const commentHint = createElement(
      "p",
      "journal-input-hint",
      `${JOURNAL_MAX_COMMENT_LENGTH}文字まで。改行もそのまま残ります。`
    );
    commentField.append(commentLabel, commentInput, commentHint);

    const actions = createElement("div", "journal-form-actions");
    const submitButton = createElement("button", "action-button primary journal-submit", "記録を保存する");
    submitButton.type = "submit";
    const helper = createElement(
      "p",
      "journal-submit-note",
      "保存後はこのスポットの下に旅の記録として並びます。"
    );
    actions.append(submitButton, helper);

    fieldset.append(grid, commentField, actions);
    form.append(fieldset);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitJournalEntry({
        stop,
        spotId,
        form,
        fieldset,
        photoInput,
        visitedInput,
        commentInput,
        status,
        entryList,
        submitButton
      });
    });

    return form;
  }

  async function loadJournalEntries(spotId, form, status, entryList) {
    setJournalStatus(status, "記録を読み込んでいます…", "loading");

    try {
      const payload = await requestJson(`${JOURNAL_API_PATH}?spotId=${encodeURIComponent(spotId)}`, {
        method: "GET",
        cache: "no-store"
      });

      setJournalFormEnabled(form, true);

      if (!Array.isArray(payload.entries) || payload.entries.length === 0) {
        renderJournalEmptyState(entryList, "まだ記録はありません。最初の1枚を残せます。");
        setJournalStatus(status, "まだ記録はありません。", "idle");
        return;
      }

      renderJournalEntries(entryList, payload.entries);
      setJournalStatus(status, `${payload.entries.length}件の記録があります。`, "success");
    } catch (error) {
      const code = error instanceof Error ? error.code || error.message : "";
      const isStorageNotReady = code === "storage_not_configured";
      renderJournalEmptyState(
        entryList,
        isStorageNotReady
          ? "Vercel Blob の設定後に、このスポットへ写真とコメントを残せます。"
          : "記録の読み込みに失敗しました。しばらくしてから再読み込みしてください。"
      );
      setJournalStatus(
        status,
        isStorageNotReady
          ? "旅の記録機能はまだ有効化されていません。"
          : "記録を読み込めませんでした。",
        isStorageNotReady ? "idle" : "error"
      );
      setJournalFormEnabled(form, !isStorageNotReady);
    }
  }

  async function submitJournalEntry({
    stop,
    spotId,
    form,
    fieldset,
    photoInput,
    visitedInput,
    commentInput,
    status,
    entryList,
    submitButton
  }) {
    const selectedFile = photoInput.files && photoInput.files[0];
    const comment = commentInput.value.trim();

    if (!selectedFile) {
      setJournalStatus(status, "写真を選んでください。", "error");
      photoInput.focus();
      return;
    }

    if (!comment) {
      setJournalStatus(status, "コメントを入力してください。", "error");
      commentInput.focus();
      return;
    }

    setJournalFormEnabled(form, false);
    submitButton.textContent = "保存しています…";

    try {
      setJournalStatus(status, "写真を整えています…", "loading");
      const normalizedImage = await normalizeImageForUpload(selectedFile);
      const imageBase64 = await blobToBase64(normalizedImage.blob);
      const visitedAt = visitedInput.value ? new Date(visitedInput.value).toISOString() : "";

      setJournalStatus(status, "旅の記録を保存しています…", "loading");
      const payload = await requestJson(JOURNAL_API_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          comment,
          imageBase64,
          mimeType: normalizedImage.blob.type,
          originalName: selectedFile.name,
          spotId,
          visitedAt
        })
      });

      prependJournalEntry(entryList, payload.entry);
      form.reset();
      visitedInput.value = buildVisitedAtDefault(stop);
      setJournalStatus(status, "旅の記録を保存しました。", "success");
    } catch (error) {
      setJournalStatus(
        status,
        error instanceof Error && error.message
          ? error.message
          : "旅の記録を保存できませんでした。",
        "error"
      );
    } finally {
      fieldset.disabled = false;
      submitButton.textContent = "記録を保存する";
    }
  }

  async function normalizeImageForUpload(file) {
    const source = await loadImageSource(file);
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    const longestSide = Math.max(width, height);
    const scale = longestSide > MAX_IMAGE_DIMENSION ? MAX_IMAGE_DIMENSION / longestSide : 1;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("画像を処理できませんでした。");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(source, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (outputBlob) => {
          if (!outputBlob) {
            reject(new Error("画像の圧縮に失敗しました。"));
            return;
          }
          resolve(outputBlob);
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    });

    if (blob.size > MAX_UPLOAD_IMAGE_BYTES) {
      throw new Error("写真が大きすぎます。もう少し小さい画像を選んでください。");
    }

    return { blob };
  }

  async function loadImageSource(file) {
    if ("createImageBitmap" in window) {
      try {
        return await createImageBitmap(file);
      } catch {
        // Fall back to HTMLImageElement below.
      }
    }

    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("画像を開けませんでした。"));
      };
      image.src = url;
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        const separatorIndex = result.indexOf(",");
        resolve(separatorIndex >= 0 ? result.slice(separatorIndex + 1) : result);
      };
      reader.onerror = () => {
        reject(new Error("画像データを読み取れませんでした。"));
      };
      reader.readAsDataURL(blob);
    });
  }

  async function requestJson(url, options) {
    const response = await fetch(url, options);
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      const error = new Error(getJournalApiMessage(payload));
      error.code = payload.code || payload.detail || payload.error || "request_failed";
      throw error;
    }

    return payload;
  }

  async function readJsonPayload(response) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        return await response.json();
      } catch {
        return {};
      }
    }

    const text = await response.text();
    return { error: text };
  }

  function getJournalApiMessage(payload) {
    const code = payload && (payload.code || payload.detail || payload.error || "");

    if (code === "storage_not_configured") {
      return "旅の記録機能はまだ有効化されていません。";
    }

    if (code === "invalid_spot") {
      return "スポット情報を読み取れませんでした。";
    }

    if (code === "missing_comment") {
      return "コメントを入力してください。";
    }

    if (code === "comment_too_long") {
      return `${JOURNAL_MAX_COMMENT_LENGTH}文字以内でコメントを入力してください。`;
    }

    if (code === "missing_image" || code === "invalid_image") {
      return "写真を選び直してください。";
    }

    if (code === "invalid_image_type") {
      return "この画像形式は保存できません。別の写真を選んでください。";
    }

    if (code === "image_too_large") {
      return "写真が大きすぎます。もう少し小さい画像を選んでください。";
    }

    if (code === "load_failed") {
      return "旅の記録を読み込めませんでした。";
    }

    if (code === "invalid_pathname") {
      return "写真の読み込み先が正しくありません。";
    }

    return typeof payload?.error === "string" && payload.error
      ? payload.error
      : "通信に失敗しました。";
  }

  function renderJournalEntries(container, entries) {
    container.textContent = "";
    entries.forEach((entry) => {
      container.append(createJournalEntryCard(entry));
    });
  }

  function prependJournalEntry(container, entry) {
    const currentEmpty = container.querySelector(".journal-empty");
    if (currentEmpty) {
      currentEmpty.remove();
    }

    container.prepend(createJournalEntryCard(entry));
  }

  function renderJournalEmptyState(container, message) {
    container.textContent = "";
    const empty = createElement("div", "journal-empty");
    const emptyTitle = createElement("p", "journal-empty-title", "まだ旅の記録はありません");
    const emptyBody = createElement("p", "journal-empty-copy", message);
    empty.append(emptyTitle, emptyBody);
    container.append(empty);
  }

  function createJournalEntryCard(entry) {
    const article = createElement("article", "journal-entry");
    const image = createElement("img", "journal-entry-photo");
    image.alt = "旅の記録写真";
    image.loading = "lazy";
    image.decoding = "async";
    image.src = entry.photoUrl;

    const body = createElement("div", "journal-entry-body");
    const meta = createElement("div", "journal-entry-meta");
    const visited = createElement(
      "p",
      "journal-entry-date",
      `訪問: ${formatJournalDateTime(entry.visitedAt, "日時未設定")}`
    );
    const saved = createElement(
      "p",
      "journal-entry-saved",
      `保存: ${formatJournalDateTime(entry.uploadedAt, "保存日時不明")}`
    );
    meta.append(visited, saved);

    const comment = createElement("p", "journal-entry-comment", entry.comment);
    body.append(meta, comment);
    article.append(image, body);

    return article;
  }

  function setJournalStatus(element, message, tone) {
    element.textContent = message;
    element.dataset.tone = tone;
  }

  function setJournalFormEnabled(form, enabled) {
    const fieldset = form.querySelector("fieldset");
    if (fieldset) {
      fieldset.disabled = !enabled;
    }
  }

  function createFieldLabel(inputId, text) {
    const label = createElement("label", "journal-label", text);
    label.htmlFor = inputId;
    return label;
  }

  function buildVisitedAtDefault(stop) {
    const year = itineraryStart.getFullYear();
    const parts = String(stop.filterDay || "").split("/");
    const month = Number(parts[0]);
    const day = Number(parts[1]);

    if (!month || !day) {
      return "";
    }

    const timeMatch = String(stop.arrivalTime || "").match(/(\d{1,2}):(\d{2})/);
    const hours = timeMatch ? Number(timeMatch[1]) : 12;
    const minutes = timeMatch ? Number(timeMatch[2]) : 0;
    const date = new Date(year, month - 1, day, hours, minutes);

    return formatDateTimeLocalInput(date);
  }

  function formatDateTimeLocalInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  function createSpotCard(stop, index) {
    const article = createElement("article", "spot-card");
    article.id = buildSpotId(index);

    const header = createElement("header", "spot-card-header");
    const headerCopy = createElement("div", "spot-card-copy");
    const stepLabel = createElement("p", "spot-step-label", `Spot ${index + 1}`);
    const title = createElement("h2", "spot-title", stop.name);
    const day = createElement("p", "spot-day", stop.day);
    headerCopy.append(stepLabel, title, day);

    const actions = createElement("div", "spot-actions");
    actions.append(
      createLink("action-button primary", buildMapPath(index), "このスポットを地図で見る"),
      createLink("action-button secondary", "/map", "地図へ戻る")
    );

    header.append(headerCopy, actions);

    const body = createElement("div", "spot-card-body");
    const figure = createPhotoFrame(stop);

    const content = createElement("div", "spot-content");
    const summaryLabel = createElement("p", "content-kicker", "旅程メモ");
    const summary = createElement("p", "spot-summary", stop.note);
    const detailLabel = createElement("p", "content-kicker", "成り立ちと見どころ");
    const detail = createElement("p", "spot-detail-copy", stop.stepHtml || stop.note);
    const terrainLabel = stop.terrainHtml
      ? createElement("p", "content-kicker", "地形の形成")
      : null;
    const terrain = stop.terrainHtml
      ? createElement("p", "spot-detail-copy", stop.terrainHtml)
      : null;
    const historyLabel = stop.historyHtml
      ? createElement("p", "content-kicker", "歴史の背景")
      : null;
    const history = stop.historyHtml
      ? createElement("p", "spot-detail-copy spot-history-copy", stop.historyHtml)
      : null;

    const meta = createElement("div", "spot-meta");
    appendMetaItem(meta, "到着", stop.arrivalTime);
    appendMetaItem(meta, "出発", stop.departureTime);
    appendMetaItem(meta, "滞在", stop.stayDuration);
    appendMetaItem(
      meta,
      "前のスポットから",
      stop.distanceFromPrev
        ? `${stop.distanceFromPrev}${stop.driveTimeFromPrev ? ` / ${stop.driveTimeFromPrev}` : ""}`
        : "スタート地点"
    );

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

    content.append(summaryLabel, summary, detailLabel, detail);
    if (terrainLabel && terrain) {
      content.append(terrainLabel, terrain);
    }
    if (historyLabel && history) {
      content.append(historyLabel, history);
    }
    content.append(meta, links, createJournalSection(stop, index));
    body.append(figure, content);
    article.append(header, body);

    return article;
  }

  function renderSpotIndex(stops) {
    stops.forEach((stop, index) => {
      const link = createLink("spot-index-link", `#${buildSpotId(index)}`, stop.name);
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
      const count = createElement("p", "day-group-count", `${group.stops.length}件`);
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
