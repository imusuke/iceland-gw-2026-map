(function () {
  const JOURNAL_API_PATH = "/api/journal";
  const JOURNAL_MAX_COMMENT_LENGTH = 600;
  const MAX_IMAGE_DIMENSION = 1600;
  const MAX_UPLOAD_IMAGE_BYTES = 3 * 1024 * 1024;
  const JPEG_QUALITY = 0.82;
  const journalEntriesCache = new Map();
  const fullDateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

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

  function createFieldLabel(inputId, text) {
    const label = createElement("label", "journal-label", text);
    label.htmlFor = inputId;
    return label;
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

  function formatDateTimeLocalInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  function buildVisitedAtDefault(stop, itineraryStart) {
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

  function buildVisitedAtInputValue(value) {
    if (!value) {
      return "";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return formatDateTimeLocalInput(date);
  }

  function replaceFileExtension(filename, nextExtension) {
    const baseName = String(filename || "travel-photo")
      .replace(/\.[^/.]+$/, "")
      .replace(/\s+/g, "-");

    return `${baseName || "travel-photo"}.${nextExtension}`;
  }

  function cloneJournalEntries(entries) {
    return Array.isArray(entries)
      ? entries.map((entry) => ({ ...entry }))
      : [];
  }

  function readCachedJournalEntries(spotId) {
    if (!journalEntriesCache.has(spotId)) {
      return null;
    }

    return cloneJournalEntries(journalEntriesCache.get(spotId));
  }

  function writeCachedJournalEntries(spotId, entries) {
    journalEntriesCache.set(spotId, cloneJournalEntries(entries));
  }

  function upsertCachedJournalEntry(spotId, entry) {
    const currentEntries = cloneJournalEntries(journalEntriesCache.get(spotId) || []);
    const nextEntries = currentEntries.filter((currentEntry) => currentEntry.id !== entry.id);
    nextEntries.unshift({ ...entry });
    writeCachedJournalEntries(spotId, nextEntries);
  }

  function removeCachedJournalEntry(spotId, entryId) {
    const currentEntries = cloneJournalEntries(journalEntriesCache.get(spotId) || []);
    writeCachedJournalEntries(
      spotId,
      currentEntries.filter((entry) => entry.id !== entryId)
    );
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

  async function normalizeImageForUpload(file) {
    const source = await loadImageSource(file);
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    const longestSide = Math.max(width, height);
    const scale = longestSide > MAX_IMAGE_DIMENSION ? MAX_IMAGE_DIMENSION / longestSide : 1;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");

    try {
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

      return {
        blob,
        fileName: replaceFileExtension(file.name || "travel-photo.jpg", "jpg")
      };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      if (typeof source.close === "function") {
        source.close();
      }
    }
  }

  function buildJournalFormData({ spotId, entryId, comment, visitedAt, photo }) {
    const formData = new FormData();
    formData.set("spotId", spotId);
    formData.set("comment", comment || "");
    formData.set("visitedAt", visitedAt || "");

    if (entryId) {
      formData.set("entryId", entryId);
    }

    if (photo && photo.blob) {
      formData.append("photo", photo.blob, photo.fileName || "travel-photo.jpg");
    }

    return formData;
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
    if (!text) {
      return {};
    }

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

    if (code === "invalid_entry" || code === "entry_not_found") {
      return "この旅の記録が見つかりませんでした。再読み込みしてからもう一度試してください。";
    }

    if (code === "invalid_pathname") {
      return "写真の読み込み先が正しくありません。";
    }

    return typeof payload?.error === "string" && payload.error
      ? payload.error
      : "通信に失敗しました。";
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

  function renderJournalEmptyState(container, message) {
    container.textContent = "";
    const empty = createElement("div", "journal-empty");
    const emptyTitle = createElement("p", "journal-empty-title", "まだ旅の記録はありません");
    const emptyBody = createElement("p", "journal-empty-copy", message);
    empty.append(emptyTitle, emptyBody);
    container.append(empty);
  }

  function findJournalEntryCard(container, entryId) {
    return Array.from(container.querySelectorAll(".journal-entry")).find((element) => {
      return element.dataset.entryId === entryId;
    });
  }

  function removeJournalEntryCard(container, entryId) {
    const currentCard = findJournalEntryCard(container, entryId);
    if (currentCard) {
      currentCard.remove();
    }

    if (!container.querySelector(".journal-entry")) {
      renderJournalEmptyState(container, "まだ記録はありません。最初の1枚を残せます。");
    }
  }

  function prependJournalEntry(container, entry, spotId, status) {
    const currentEmpty = container.querySelector(".journal-empty");
    if (currentEmpty) {
      currentEmpty.remove();
    }

    container.prepend(createJournalEntryCard(entry, { entryList: container, spotId, status }));
  }

  function replaceJournalEntryCard(container, entry, spotId, status) {
    const currentCard = findJournalEntryCard(container, entry.id);
    const nextCard = createJournalEntryCard(entry, {
      entryList: container,
      spotId,
      status
    });

    if (currentCard) {
      currentCard.replaceWith(nextCard);
      return;
    }

    prependJournalEntry(container, entry, spotId, status);
  }

  async function submitJournalEntryUpdate({ entry, context, editForm, setEditMode }) {
    const selectedFile = editForm.photoInput.files && editForm.photoInput.files[0];
    const comment = editForm.commentInput.value.trim();
    const visitedAt = editForm.visitedInput.value
      ? new Date(editForm.visitedInput.value).toISOString()
      : "";

    editForm.fieldset.disabled = true;
    editForm.submitButton.textContent = "更新しています…";

    try {
      let normalizedImage = null;
      if (selectedFile) {
        setJournalStatus(editForm.status, "写真を整えています…", "loading");
        normalizedImage = await normalizeImageForUpload(selectedFile);
      }

      setJournalStatus(editForm.status, "旅の記録を更新しています…", "loading");
      const payload = await requestJson(JOURNAL_API_PATH, {
        method: "PATCH",
        body: buildJournalFormData({
          spotId: context.spotId,
          entryId: entry.id,
          comment,
          visitedAt,
          photo: normalizedImage
        })
      });

      upsertCachedJournalEntry(context.spotId, payload.entry);
      replaceJournalEntryCard(context.entryList, payload.entry, context.spotId, context.status);
      setJournalStatus(context.status, "旅の記録を更新しました。", "success");
      setEditMode(false);
    } catch (error) {
      setJournalStatus(
        editForm.status,
        error instanceof Error && error.message
          ? error.message
          : "旅の記録を更新できませんでした。",
        "error"
      );
    } finally {
      editForm.fieldset.disabled = false;
      editForm.submitButton.textContent = "更新する";
    }
  }

  async function deleteJournalEntryRecord({ context, deleteButton, editButton, entry }) {
    const confirmed = window.confirm("この旅の記録を削除しますか？");
    if (!confirmed) {
      return;
    }

    deleteButton.disabled = true;
    editButton.disabled = true;
    setJournalStatus(context.status, "旅の記録を削除しています…", "loading");

    try {
      await requestJson(JOURNAL_API_PATH, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          spotId: context.spotId,
          entryId: entry.id
        })
      });

      removeCachedJournalEntry(context.spotId, entry.id);
      removeJournalEntryCard(context.entryList, entry.id);
      setJournalStatus(context.status, "旅の記録を削除しました。", "success");
    } catch (error) {
      setJournalStatus(
        context.status,
        error instanceof Error && error.message
          ? error.message
          : "旅の記録を削除できませんでした。",
        "error"
      );
      deleteButton.disabled = false;
      editButton.disabled = false;
    }
  }

  function buildJournalEditForm(entry) {
    const panel = createElement("div", "journal-edit-panel");
    panel.hidden = true;

    const form = createElement("form", "journal-edit-form");
    form.noValidate = true;

    const fieldset = createElement("fieldset", "journal-fieldset journal-edit-fieldset");
    const grid = createElement("div", "journal-form-grid");

    const photoField = createElement("div", "journal-field");
    const photoLabel = createFieldLabel(`edit-photo-${entry.id}`, "写真を差し替える");
    const photoInput = document.createElement("input");
    photoInput.className = "journal-input";
    photoInput.id = `edit-photo-${entry.id}`;
    photoInput.name = "photo";
    photoInput.type = "file";
    photoInput.accept = "image/*";
    const photoHint = createElement(
      "p",
      "journal-input-hint",
      "差し替えるときだけ写真を選んでください。"
    );
    photoField.append(photoLabel, photoInput, photoHint);

    const visitedField = createElement("div", "journal-field");
    const visitedLabel = createFieldLabel(`edit-visited-${entry.id}`, "訪問した日時");
    const visitedInput = document.createElement("input");
    visitedInput.className = "journal-input";
    visitedInput.id = `edit-visited-${entry.id}`;
    visitedInput.name = "visitedAt";
    visitedInput.type = "datetime-local";
    visitedInput.value = buildVisitedAtInputValue(entry.visitedAt);
    const visitedHint = createElement(
      "p",
      "journal-input-hint",
      "空にすると日時なしとして保存します。"
    );
    visitedField.append(visitedLabel, visitedInput, visitedHint);

    grid.append(photoField, visitedField);

    const commentField = createElement("div", "journal-field");
    const commentLabel = createFieldLabel(`edit-comment-${entry.id}`, "コメント（任意）");
    const commentInput = document.createElement("textarea");
    commentInput.className = "journal-textarea";
    commentInput.id = `edit-comment-${entry.id}`;
    commentInput.name = "comment";
    commentInput.maxLength = JOURNAL_MAX_COMMENT_LENGTH;
    commentInput.rows = 4;
    commentInput.placeholder = "コメントは空でも保存できます。";
    commentInput.value = entry.comment || "";
    const commentHint = createElement(
      "p",
      "journal-input-hint",
      `${JOURNAL_MAX_COMMENT_LENGTH}文字まで。コメントを消して保存することもできます。`
    );
    commentField.append(commentLabel, commentInput, commentHint);

    const actions = createElement("div", "journal-form-actions");
    const submitButton = createElement("button", "journal-submit journal-submit-secondary", "更新する");
    submitButton.type = "submit";
    const cancelButton = createElement("button", "journal-entry-button", "キャンセル");
    cancelButton.type = "button";
    const helper = createElement(
      "p",
      "journal-submit-note",
      "写真の差し替え、コメント修正、日時変更ができます。"
    );
    actions.append(submitButton, cancelButton, helper);

    const status = createElement("p", "journal-status journal-edit-status");

    fieldset.append(grid, commentField, actions);
    form.append(fieldset, status);
    panel.append(form);

    return {
      panel,
      form,
      fieldset,
      photoInput,
      visitedInput,
      commentInput,
      submitButton,
      cancelButton,
      status
    };
  }

  function createJournalEntryCard(entry, context) {
    const article = createElement("article", "journal-entry");
    article.dataset.entryId = entry.id;
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

    if (entry.updatedAt && entry.updatedAt !== entry.uploadedAt) {
      const updated = createElement(
        "p",
        "journal-entry-updated",
        `更新: ${formatJournalDateTime(entry.updatedAt, "更新日時不明")}`
      );
      meta.append(updated);
    }

    const comment = createElement(
      "p",
      entry.comment ? "journal-entry-comment" : "journal-entry-comment journal-entry-comment-empty",
      entry.comment || "コメントなし"
    );

    const actions = createElement("div", "journal-entry-actions");
    const editButton = createElement("button", "journal-entry-button", "編集");
    editButton.type = "button";
    const deleteButton = createElement(
      "button",
      "journal-entry-button journal-entry-button-danger",
      "削除"
    );
    deleteButton.type = "button";
    actions.append(editButton, deleteButton);

    const editForm = buildJournalEditForm(entry);

    function setEditMode(open) {
      editForm.panel.hidden = !open;
      editButton.textContent = open ? "閉じる" : "編集";

      if (!open) {
        editForm.commentInput.value = entry.comment || "";
        editForm.visitedInput.value = buildVisitedAtInputValue(entry.visitedAt);
        editForm.photoInput.value = "";
        setJournalStatus(editForm.status, "", "idle");
      }
    }

    editButton.addEventListener("click", () => {
      setEditMode(editForm.panel.hidden);
    });

    editForm.cancelButton.addEventListener("click", () => {
      setEditMode(false);
    });

    editForm.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitJournalEntryUpdate({
        entry,
        context,
        editForm,
        setEditMode
      });
    });

    deleteButton.addEventListener("click", async () => {
      await deleteJournalEntryRecord({
        context,
        deleteButton,
        editButton,
        entry
      });
    });

    body.append(meta, comment, actions, editForm.panel);
    article.append(image, body);

    return article;
  }

  function renderJournalEntries(container, entries, spotId, status) {
    container.textContent = "";
    entries.forEach((entry) => {
      container.append(createJournalEntryCard(entry, { entryList: container, spotId, status }));
    });
  }

  async function loadJournalEntries(spotId, form, status, entryList) {
    const cachedEntries = readCachedJournalEntries(spotId);
    if (cachedEntries) {
      setJournalFormEnabled(form, true);
      if (cachedEntries.length === 0) {
        renderJournalEmptyState(entryList, "まだ記録はありません。最初の1枚を残せます。");
        setJournalStatus(status, "まだ記録はありません。", "idle");
        return;
      }

      renderJournalEntries(entryList, cachedEntries, spotId, status);
      setJournalStatus(status, `${cachedEntries.length}件の記録があります。`, "success");
      return;
    }

    setJournalStatus(status, "記録を読み込んでいます…", "loading");

    try {
      const payload = await requestJson(`${JOURNAL_API_PATH}?spotId=${encodeURIComponent(spotId)}`, {
        method: "GET",
        cache: "no-store"
      });

      setJournalFormEnabled(form, true);

      if (!Array.isArray(payload.entries) || payload.entries.length === 0) {
        writeCachedJournalEntries(spotId, []);
        renderJournalEmptyState(entryList, "まだ記録はありません。最初の1枚を残せます。");
        setJournalStatus(status, "まだ記録はありません。", "idle");
        return;
      }

      writeCachedJournalEntries(spotId, payload.entries);
      renderJournalEntries(entryList, payload.entries, spotId, status);
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
    itineraryStart,
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

    setJournalFormEnabled(form, false);
    submitButton.textContent = "保存しています…";

    try {
      setJournalStatus(status, "写真を整えています…", "loading");
      const normalizedImage = await normalizeImageForUpload(selectedFile);
      const visitedAt = visitedInput.value ? new Date(visitedInput.value).toISOString() : "";
      const formData = buildJournalFormData({
        spotId,
        comment,
        visitedAt,
        photo: normalizedImage
      });

      setJournalStatus(status, "旅の記録を保存しています…", "loading");
      const payload = await requestJson(JOURNAL_API_PATH, {
        method: "POST",
        body: formData
      });

      upsertCachedJournalEntry(spotId, payload.entry);
      prependJournalEntry(entryList, payload.entry, spotId, status);
      form.reset();
      visitedInput.value = buildVisitedAtDefault(stop, itineraryStart);
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

  function createJournalForm({ stop, spotId, itineraryStart, status, entryList }) {
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
    visitedInput.value = buildVisitedAtDefault(stop, itineraryStart);
    const visitedHint = createElement(
      "p",
      "journal-input-hint",
      "あとから見返したときに、その日の流れが分かりやすくなります。"
    );
    visitedField.append(visitedLabel, visitedInput, visitedHint);

    grid.append(photoField, visitedField);

    const commentField = createElement("div", "journal-field");
    const commentLabel = createFieldLabel(`comment-${spotId}`, "コメント（任意）");
    const commentInput = document.createElement("textarea");
    commentInput.className = "journal-textarea";
    commentInput.id = `comment-${spotId}`;
    commentInput.name = "comment";
    commentInput.maxLength = JOURNAL_MAX_COMMENT_LENGTH;
    commentInput.rows = 4;
    commentInput.placeholder = "この場所で印象に残ったことや、その場の空気を書き残せます。空でも保存できます。";
    const commentHint = createElement(
      "p",
      "journal-input-hint",
      `${JOURNAL_MAX_COMMENT_LENGTH}文字まで。改行もそのまま残ります。`
    );
    commentField.append(commentLabel, commentInput, commentHint);

    const actions = createElement("div", "journal-form-actions");
    const submitButton = createElement("button", "journal-submit journal-submit-primary", "記録を保存する");
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
        itineraryStart,
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

  function createJournalSection(options) {
    const {
      stop,
      index,
      itineraryStart,
      buildSpotId,
      title = "旅の記録",
      note = "写真だけでも残せます。コメントは任意で、あとから編集や削除もできます。",
      variant = "default"
    } = options || {};

    const safeBuildSpotId = typeof buildSpotId === "function"
      ? buildSpotId
      : (spotIndex, currentStop) => (
        currentStop && typeof currentStop.id === "string"
          ? currentStop.id
          : `spot-${spotIndex + 1}`
      );
    const spotId = safeBuildSpotId(index, stop);
    const section = createElement("section", "spot-journal");
    if (variant === "compact") {
      section.classList.add("spot-journal-compact");
    }

    const header = createElement("div", "spot-journal-header");
    const titleElement = createElement("h3", "spot-journal-title", title);
    const noteElement = createElement("p", "spot-journal-note", note);
    header.append(titleElement, noteElement);

    const entryList = createElement("div", "journal-entry-list");
    const status = createElement("p", "journal-status", "記録を読み込んでいます...");
    const form = createJournalForm({ stop, spotId, itineraryStart, status, entryList });

    section.append(header, form, status, entryList);
    void loadJournalEntries(spotId, form, status, entryList);

    return section;
  }

  window.ICELAND_TRIP_JOURNAL_UI = {
    createJournalSection
  };
})();
