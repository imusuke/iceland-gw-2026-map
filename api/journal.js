import { authorizeBasicRequest } from "../lib/basic-auth.js";
import { sendWebResponse, toWebRequest } from "../lib/request-utils.js";
import {
  JOURNAL_BLOB_ACCESS,
  JOURNAL_MAX_COMMENT_LENGTH,
  JOURNAL_MAX_IMAGE_BYTES,
  createJournalEntry,
  deleteJournalEntry,
  isJournalStorageConfigured,
  listJournalEntries,
  normalizeEntryId,
  normalizeSpotId,
  updateJournalEntry
} from "../lib/journal-store.js";

export default async function handler(request, response) {
  const auth = authorizeBasicRequest(request);
  if (!auth.ok) {
    await sendWebResponse(response, auth.response);
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (!isJournalStorageConfigured()) {
    response.status(503).json({
      code: "storage_not_configured",
      error: "Storage is not configured"
    });
    return;
  }

  if (request.method === "GET") {
    await handleListRequest(request, response);
    return;
  }

  if (request.method === "POST") {
    await handleCreateRequest(request, response);
    return;
  }

  if (request.method === "PATCH") {
    await handleUpdateRequest(request, response);
    return;
  }

  if (request.method === "DELETE") {
    await handleDeleteRequest(request, response);
    return;
  }

  response.status(405).json({ code: "method_not_allowed", error: "Method not allowed" });
}

async function handleListRequest(request, response) {
  const spotId = normalizeSpotId(request.query && request.query.spotId);
  if (!spotId) {
    response.status(400).json({ code: "invalid_spot", error: "Spot is invalid" });
    return;
  }

  try {
    const entries = await listJournalEntries(spotId);
    response.status(200).json({
      access: JOURNAL_BLOB_ACCESS,
      entries
    });
  } catch (error) {
    response.status(500).json({
      code: "load_failed",
      detail: error instanceof Error ? error.message : "unknown_error",
      error: "Unable to load journal entries"
    });
  }
}

async function handleCreateRequest(request, response) {
  let formData;

  try {
    const webRequest = await toWebRequest(request);
    formData = await webRequest.formData();
  } catch {
    response.status(400).json({ code: "invalid_form_data", error: "Request body is invalid" });
    return;
  }

  const spotId = normalizeSpotId(readStringField(formData, "spotId"));
  const comment = readStringField(formData, "comment");
  const visitedAt = readStringField(formData, "visitedAt");
  const photoFile = readPhotoField(formData, { required: true });

  if (!spotId) {
    response.status(400).json({ code: "invalid_spot", error: "Spot is invalid" });
    return;
  }

  if (comment.length > JOURNAL_MAX_COMMENT_LENGTH) {
    response.status(400).json({
      code: "comment_too_long",
      error: `Comment must be ${JOURNAL_MAX_COMMENT_LENGTH} characters or fewer`
    });
    return;
  }

  if (!photoFile) {
    response.status(400).json({ code: "missing_image", error: "Image is required" });
    return;
  }

  let imageBuffer;
  try {
    imageBuffer = Buffer.from(await photoFile.arrayBuffer());
  } catch {
    response.status(400).json({ code: "invalid_image", error: "Image data is invalid" });
    return;
  }

  if (!imageBuffer.length) {
    response.status(400).json({ code: "missing_image", error: "Image is required" });
    return;
  }

  if (imageBuffer.length > JOURNAL_MAX_IMAGE_BYTES) {
    response.status(400).json({
      code: "image_too_large",
      error: `Image must be ${Math.round(JOURNAL_MAX_IMAGE_BYTES / 1024 / 1024)}MB or smaller`
    });
    return;
  }

  try {
    const entry = await createJournalEntry({
      spotId,
      comment,
      visitedAt,
      imageBuffer,
      mimeType: photoFile.type || "",
      originalName: photoFile.name || ""
    });

    response.status(201).json({ entry });
  } catch (error) {
    sendJournalErrorResponse(response, error, "Unable to save journal entry");
  }
}

async function handleUpdateRequest(request, response) {
  let formData;

  try {
    const webRequest = await toWebRequest(request);
    formData = await webRequest.formData();
  } catch {
    response.status(400).json({ code: "invalid_form_data", error: "Request body is invalid" });
    return;
  }

  const spotId = normalizeSpotId(readStringField(formData, "spotId"));
  const entryId = normalizeEntryId(readStringField(formData, "entryId"));
  const comment = readStringField(formData, "comment");
  const visitedAt = readStringField(formData, "visitedAt");
  const photoFile = readPhotoField(formData, { required: false });

  if (!spotId) {
    response.status(400).json({ code: "invalid_spot", error: "Spot is invalid" });
    return;
  }

  if (!entryId) {
    response.status(400).json({ code: "invalid_entry", error: "Entry is invalid" });
    return;
  }

  if (comment.length > JOURNAL_MAX_COMMENT_LENGTH) {
    response.status(400).json({
      code: "comment_too_long",
      error: `Comment must be ${JOURNAL_MAX_COMMENT_LENGTH} characters or fewer`
    });
    return;
  }

  let imageBuffer = null;
  if (photoFile) {
    try {
      imageBuffer = Buffer.from(await photoFile.arrayBuffer());
    } catch {
      response.status(400).json({ code: "invalid_image", error: "Image data is invalid" });
      return;
    }

    if (!imageBuffer.length) {
      response.status(400).json({ code: "missing_image", error: "Image is required" });
      return;
    }

    if (imageBuffer.length > JOURNAL_MAX_IMAGE_BYTES) {
      response.status(400).json({
        code: "image_too_large",
        error: `Image must be ${Math.round(JOURNAL_MAX_IMAGE_BYTES / 1024 / 1024)}MB or smaller`
      });
      return;
    }
  }

  try {
    const entry = await updateJournalEntry({
      spotId,
      entryId,
      comment,
      visitedAt,
      imageBuffer,
      mimeType: photoFile ? photoFile.type || "" : "",
      originalName: photoFile ? photoFile.name || "" : ""
    });

    response.status(200).json({ entry });
  } catch (error) {
    sendJournalErrorResponse(response, error, "Unable to update journal entry");
  }
}

async function handleDeleteRequest(request, response) {
  let body;

  try {
    const webRequest = await toWebRequest(request);
    body = await webRequest.json();
  } catch {
    response.status(400).json({ code: "invalid_json", error: "Request body is invalid" });
    return;
  }

  const spotId = normalizeSpotId(body && body.spotId);
  const entryId = normalizeEntryId(body && body.entryId);

  if (!spotId) {
    response.status(400).json({ code: "invalid_spot", error: "Spot is invalid" });
    return;
  }

  if (!entryId) {
    response.status(400).json({ code: "invalid_entry", error: "Entry is invalid" });
    return;
  }

  try {
    const result = await deleteJournalEntry({ spotId, entryId });
    response.status(200).json({ entryId: result.id });
  } catch (error) {
    sendJournalErrorResponse(response, error, "Unable to delete journal entry");
  }
}

function readStringField(formData, fieldName) {
  const value = formData.get(fieldName);
  return typeof value === "string" ? value : "";
}

function readPhotoField(formData, { required }) {
  const value = formData.get("photo");

  if (!value || typeof value === "string") {
    return required ? null : null;
  }

  if (value.size <= 0) {
    return required ? null : null;
  }

  return value;
}

function sendJournalErrorResponse(response, error, defaultMessage) {
  const detail = error instanceof Error ? error.message : "unknown_error";
  const status = isClientErrorCode(detail) ? 400 : 500;

  response.status(status).json({
    code: detail,
    detail,
    error: status === 400 ? "Journal entry is invalid" : defaultMessage
  });
}

function isClientErrorCode(code) {
  return [
    "comment_too_long",
    "entry_not_found",
    "image_too_large",
    "invalid_entry",
    "invalid_image",
    "invalid_image_type",
    "invalid_pathname",
    "invalid_spot",
    "missing_image"
  ].includes(code);
}
