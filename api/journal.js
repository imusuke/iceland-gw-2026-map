import { authorizeBasicRequest } from "../lib/basic-auth.js";
import {
  JOURNAL_BLOB_ACCESS,
  JOURNAL_MAX_COMMENT_LENGTH,
  JOURNAL_MAX_IMAGE_BYTES,
  createJournalEntry,
  isJournalStorageConfigured,
  listJournalEntries,
  normalizeSpotId
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
        Allow: "GET, POST, OPTIONS"
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

  return jsonResponse({ code: "method_not_allowed", error: "Method not allowed" }, 405);
}

async function handleListRequest(request) {
  const { searchParams } = new URL(request.url);
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
  let body;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ code: "invalid_json", error: "Request body is invalid" }, 400);
  }

  const spotId = normalizeSpotId(body && body.spotId);
  const comment = typeof body?.comment === "string" ? body.comment : "";
  const mimeType = typeof body?.mimeType === "string" ? body.mimeType : "";
  const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64 : "";
  const originalName = typeof body?.originalName === "string" ? body.originalName : "";
  const visitedAt = typeof body?.visitedAt === "string" ? body.visitedAt : "";

  if (!spotId) {
    return jsonResponse({ code: "invalid_spot", error: "Spot is invalid" }, 400);
  }

  if (!comment.trim()) {
    return jsonResponse({ code: "missing_comment", error: "Comment is required" }, 400);
  }

  if (comment.trim().length > JOURNAL_MAX_COMMENT_LENGTH) {
    return jsonResponse(
      {
        code: "comment_too_long",
        error: `Comment must be ${JOURNAL_MAX_COMMENT_LENGTH} characters or fewer`
      },
      400
    );
  }

  if (!imageBase64) {
    return jsonResponse({ code: "missing_image", error: "Image is required" }, 400);
  }

  let imageBuffer;
  try {
    imageBuffer = Buffer.from(imageBase64, "base64");
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
      mimeType,
      originalName
    });

    return jsonResponse({ entry }, 201);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown_error";
    const status = isClientErrorCode(detail) ? 400 : 500;

    return jsonResponse(
      {
        code: detail,
        detail,
        error: status === 400 ? "Journal entry is invalid" : "Unable to save journal entry"
      },
      status
    );
  }
}

function isClientErrorCode(code) {
  return [
    "comment_too_long",
    "image_too_large",
    "invalid_image_type",
    "invalid_spot",
    "missing_comment",
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
