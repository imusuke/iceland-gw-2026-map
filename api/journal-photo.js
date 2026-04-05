import { Readable } from "node:stream";
import { authorizeBasicRequest } from "../lib/basic-auth.js";
import { sendWebResponse } from "../lib/request-utils.js";
import {
  JOURNAL_BLOB_ACCESS,
  getJournalPhoto,
  isJournalStorageConfigured
} from "../lib/journal-store.js";

export default async function handler(request, response) {
  const auth = authorizeBasicRequest(request);
  if (!auth.ok) {
    await sendWebResponse(response, auth.response);
    return;
  }

  response.setHeader("Cache-Control", "no-store");

  if (!isJournalStorageConfigured()) {
    response.status(503).json({
      code: "storage_not_configured",
      error: "Storage is not configured"
    });
    return;
  }

  if (request.method !== "GET") {
    response.status(405).json({ code: "method_not_allowed", error: "Method not allowed" });
    return;
  }

  const pathname = typeof request.query?.pathname === "string" ? request.query.pathname : "";
  if (!pathname) {
    response.status(400).json({ code: "missing_pathname", error: "Pathname is required" });
    return;
  }

  try {
    const result = await getJournalPhoto(pathname, request.headers["if-none-match"]);

    if (!result) {
      response.status(404).send("Not found");
      return;
    }

    if (result.statusCode === 304) {
      response.setHeader("Cache-Control", "private, no-cache");
      response.setHeader("ETag", result.blob.etag);
      response.status(304).end();
      return;
    }

    response.setHeader(
      "Cache-Control",
      JOURNAL_BLOB_ACCESS === "private" ? "private, no-cache" : "public, max-age=300"
    );
    response.setHeader("Content-Type", result.blob.contentType || "image/jpeg");
    response.setHeader("ETag", result.blob.etag);
    response.setHeader("X-Content-Type-Options", "nosniff");

    Readable.fromWeb(result.stream).pipe(response);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown_error";
    const status = detail === "invalid_pathname" ? 400 : 500;

    response.status(status).json({
      code: detail,
      detail,
      error: status === 400 ? "Pathname is invalid" : "Unable to load photo"
    });
  }
}
