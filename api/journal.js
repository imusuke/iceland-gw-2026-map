import { authorizeBasicRequest } from "../lib/basic-auth.js";
import { getRequestUrl, toWebRequest } from "../lib/request-utils.js";
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

export default async function handler(request) {
  const auth = authorizeBasicRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        Allow: "GET, POST, PATCH, DELETE, OPTIONS"
      }
    });
  }

  if (!isJournalStorageConfigured()) {
    return jsonResponse(
      {
        code: "storage_not_configured",
        error: "Storage is not configured"
      },
      503
    );
  }

  if (request.method === "GET") {
    return handleListRequest(request);
  }

  if (request.method === "POST") {
    return handleCreateRequest(request);
  }

  if (request.method === "PATCH") {
    return handleUpdateRequest(request);
  }

  if (request.method === "DELETE") {
    return handleDeleteRequest(request);
  }

  return jsonResponse({ code: "method_not_allowed", error: "Method not allowed" }, 405);
}

async function handleListRequest(request) {
  const { searchParams } = new URL(getRequestUrl(request));
  const spotId = normalizeSpotId(searchParams.get("spotId"));
  if (!spotId) {
    return jsonResponse({ code: "invalid_spot", error: "Spot is invalid" }, 400);
  }

  try {
    const entries = await listJournalEntries(spotId);
    return jsonResponse({
      access: JOURNAL_BLOB_ACCESS,
      entries
    });
  } catch (error) {
    return jsonResponse(
      {
        code: "load_failed",
        detail: error instanceof Error ? error.message : "unknown_error",
        error: "Unable to load journal entries"
      },
      500
    );
  }
}

async function handleCreateRequest(request) {
  let formData;
  const webRequest = await toWebRequest(request);

  try {
    formData = await webRequest.formData();
  } catch {
    return jsonResponse({ code: "invalid_form_data", error: "Request body is invalid" }, 400);
  }

  const spotId = normalizeSpotId(readStringField(formData, "spotId"));
  const comment = readStringField(formData, "comment");
  const visitedAt = readStringField(formData, "visitedAt");
  const photoFile = readPhotoField(formData, { required: true });

  if (!spotId) {
    return jsonResponse({ code: "invalid_spot", error: "Spot is invalid" }, 400);
  }

  if (comment.length > JOURNAL_MAX_COMMENT_LENGTH) {
    return jsonResponse(
      {
        code: "comment_too_long",
        error: `Comment must be ${JOURNAL_MAX_COMMENT_LENGTH} characters or fewer`
      },
      400
    );
  }

  if (!photoFile) {
    return jsonResponse({ code: "missing_image", error: "Image is required" }, 400);
  }

  let imageBuffer;
  try {
    imageBuffer = Buffer.from(await photoFile.arrayBuffer());
  } catch {
    return jsonResponse({ code: "invalid_image", error: "Image data is invalid" }, 400);
  }

  if (!imageBuffer.length) {
    return jsonResponse({ code: "missing_image", error: "Image is required" }, 400);
  }

  if (imageBuffer.length > JOURNAL_MAX_IMAGE_BYTES) {
    return jsonResponse(
      {
        code: "image_too_large",
        error: `Image must be ${Math.round(JOURNAL_MAX_IMAGE_BYTES / 1024 / 1024)}MB or smaller`
      },
      400
    );
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

    return jsonResponse({ entry }, 201);
  } catch (error) {
    return createJournalErrorResponse(error, "Unable to save journal entry");
  }
}

async function handleUpdateRequest(request) {
  let formData;
  const webRequest = await toWebRequest(request);

  try {
    formData = await webRequest.formData();
  } catch {
    return jsonResponse({ code: "invalid_form_data", error: "Request body is invalid" }, 400);
  }

  const spotId = normalizeSpotId(readStringField(formData, "spotId"));
  const entryId = normalizeEntryId(readStringField(formData, "entryId"));
  const comment = readStringField(formData, "comment");
  const visitedAt = readStringField(formData, "visitedAt");
  const photoFile = readPhotoField(formData, { required: false });

  if (!spotId) {
    return jsonResponse({ code: "invalid_spot", error: "Spot is invalid" }, 400);
  }

  if (!entryId) {
    return jsonResponse({ code: "invalid_entry", error: "Entry is invalid" }, 400);
  }

  if (comment.length > JOURNAL_MAX_COMMENT_LENGTH) {
    return jsonResponse(
      {
        code: "comment_too_long",
        error: `Comment must be ${JOURNAL_MAX_COMMENT_LENGTH} characters or fewer`
      },
      400
    );
  }

  let imageBuffer = null;
  if (photoFile) {
    try {
      imageBuffer = Buffer.from(await photoFile.arrayBuffer());
    } catch {
      return jsonResponse({ code: "invalid_image", error: "Image data is invalid" }, 400);
    }

    if (!imageBuffer.length) {
      return jsonResponse({ code: "missing_image", error: "Image is required" }, 400);
    }

    if (imageBuffer.length > JOURNAL_MAX_IMAGE_BYTES) {
      return jsonResponse(
        {
          code: "image_too_large",
          error: `Image must be ${Math.round(JOURNAL_MAX_IMAGE_BYTES / 1024 / 1024)}MB or smaller`
        },
        400
      );
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

    return jsonResponse({ entry });
  } catch (error) {
    return createJournalErrorResponse(error, "Unable to update journal entry");
  }
}

async function handleDeleteRequest(request) {
  let body;
  const webRequest = await toWebRequest(request);

  try {
    body = await webRequest.json();
  } catch {
    return jsonResponse({ code: "invalid_json", error: "Request body is invalid" }, 400);
  }

  const spotId = normalizeSpotId(body && body.spotId);
  const entryId = normalizeEntryId(body && body.entryId);

  if (!spotId) {
    return jsonResponse({ code: "invalid_spot", error: "Spot is invalid" }, 400);
  }

  if (!entryId) {
    return jsonResponse({ code: "invalid_entry", error: "Entry is invalid" }, 400);
  }

  try {
    const result = await deleteJournalEntry({ spotId, entryId });
    return jsonResponse({ entryId: result.id });
  } catch (error) {
    return createJournalErrorResponse(error, "Unable to delete journal entry");
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

function createJournalErrorResponse(error, defaultMessage) {
  const detail = error instanceof Error ? error.message : "unknown_error";
  const status = isClientErrorCode(detail) ? 400 : 500;

  return jsonResponse(
    {
      code: detail,
      detail,
      error: status === 400 ? "Journal entry is invalid" : defaultMessage
    },
    status
  );
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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
