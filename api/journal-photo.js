import { authorizeBasicRequest } from "../lib/basic-auth.js";
import { getRequestHeader, getRequestUrl } from "../lib/request-utils.js";
import {
  JOURNAL_BLOB_ACCESS,
  getJournalPhoto,
  isJournalStorageConfigured
} from "../lib/journal-store.js";

export default async function handler(request) {
  const auth = authorizeBasicRequest(request);
  if (!auth.ok) {
    return auth.response;
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

  if (request.method !== "GET") {
    return jsonResponse({ code: "method_not_allowed", error: "Method not allowed" }, 405);
  }

  const { searchParams } = new URL(getRequestUrl(request));
  const pathname = searchParams.get("pathname") || "";
  if (!pathname) {
    return jsonResponse({ code: "missing_pathname", error: "Pathname is required" }, 400);
  }

  try {
    const result = await getJournalPhoto(
      pathname,
      getRequestHeader(request, "if-none-match")
    );

    if (!result) {
      return new Response("Not found", { status: 404 });
    }

    if (result.statusCode === 304) {
      return new Response(null, {
        status: 304,
        headers: {
          "Cache-Control": "private, no-cache",
          ETag: result.blob.etag
        }
      });
    }

    return new Response(result.stream, {
      headers: {
        "Cache-Control": JOURNAL_BLOB_ACCESS === "private" ? "private, no-cache" : "public, max-age=300",
        "Content-Type": result.blob.contentType || "image/jpeg",
        ETag: result.blob.etag,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown_error";
    const status = detail === "invalid_pathname" ? 400 : 500;

    return jsonResponse(
      {
        code: detail,
        detail,
        error: status === 400 ? "Pathname is invalid" : "Unable to load photo"
      },
      status
    );
  }
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
