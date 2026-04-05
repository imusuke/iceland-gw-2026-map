import { get, list, put } from "@vercel/blob";

export const JOURNAL_BLOB_ACCESS =
  process.env.JOURNAL_BLOB_ACCESS === "private" ? "private" : "public";

export const JOURNAL_MAX_COMMENT_LENGTH = 600;
export const JOURNAL_MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;

export function isJournalStorageConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function normalizeSpotId(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().toLowerCase();
  return /^spot-[1-9]\d*$/.test(normalized) ? normalized : "";
}

export async function listJournalEntries(spotId) {
  const normalizedSpotId = normalizeSpotId(spotId);
  if (!normalizedSpotId) {
    throw new Error("invalid_spot");
  }

  const result = await list({
    prefix: buildEntryPrefix(normalizedSpotId),
    limit: 200
  });

  const entries = await Promise.all(
    (result.blobs || []).map(async (blob) => {
      try {
        const text = await readBlobText(blob.pathname);
        const parsed = JSON.parse(text);
        return hydrateJournalEntry(parsed);
      } catch {
        return null;
      }
    })
  );

  return entries
    .filter(Boolean)
    .sort((left, right) => {
      return Date.parse(right.uploadedAt || "") - Date.parse(left.uploadedAt || "");
    });
}

export async function createJournalEntry({
  spotId,
  comment,
  visitedAt,
  imageBuffer,
  mimeType,
  originalName
}) {
  const normalizedSpotId = normalizeSpotId(spotId);
  if (!normalizedSpotId) {
    throw new Error("invalid_spot");
  }

  const trimmedComment = typeof comment === "string" ? comment.trim() : "";
  if (!trimmedComment) {
    throw new Error("missing_comment");
  }

  if (trimmedComment.length > JOURNAL_MAX_COMMENT_LENGTH) {
    throw new Error("comment_too_long");
  }

  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new Error("missing_image");
  }

  if (imageBuffer.length > JOURNAL_MAX_IMAGE_BYTES) {
    throw new Error("image_too_large");
  }

  const normalizedMimeType = normalizeMimeType(mimeType);
  if (!normalizedMimeType) {
    throw new Error("invalid_image_type");
  }

  const now = new Date();
  const uploadedAt = now.toISOString();
  const timestamp = uploadedAt.replaceAll(":", "-");
  const entryId = crypto.randomUUID();
  const extension = extensionFromMimeType(normalizedMimeType);
  const safeName = sanitizeFilename(originalName || `journal-photo.${extension}`);

  const photoPathname = `journals/${normalizedSpotId}/photos/${timestamp}-${entryId}.${extension}`;
  const photo = await put(photoPathname, imageBuffer, {
    access: JOURNAL_BLOB_ACCESS,
    addRandomSuffix: false,
    contentType: normalizedMimeType
  });

  const entry = hydrateJournalEntry({
    id: entryId,
    spotId: normalizedSpotId,
    comment: trimmedComment,
    visitedAt: normalizeVisitedAt(visitedAt),
    uploadedAt,
    photoName: safeName,
    photoPathname,
    photoUrl: JOURNAL_BLOB_ACCESS === "public" ? photo.url : ""
  });

  const recordPathname = `journals/${normalizedSpotId}/entries/${timestamp}-${entryId}.json`;
  await put(recordPathname, JSON.stringify(entry, null, 2), {
    access: JOURNAL_BLOB_ACCESS,
    addRandomSuffix: false,
    contentType: "application/json"
  });

  return entry;
}

export async function getJournalPhoto(pathname, ifNoneMatch) {
  if (!isJournalPhotoPathname(pathname)) {
    throw new Error("invalid_pathname");
  }

  return get(pathname, {
    access: JOURNAL_BLOB_ACCESS,
    ifNoneMatch: ifNoneMatch || undefined
  });
}

function hydrateJournalEntry(entry) {
  const photoPathname = typeof entry.photoPathname === "string" ? entry.photoPathname : "";
  const photoUrl = photoPathname
    ? `/api/journal-photo?pathname=${encodeURIComponent(photoPathname)}`
    : "";

  return {
    id: typeof entry.id === "string" ? entry.id : crypto.randomUUID(),
    spotId: normalizeSpotId(entry.spotId),
    comment: typeof entry.comment === "string" ? entry.comment : "",
    visitedAt: normalizeVisitedAt(entry.visitedAt),
    uploadedAt: typeof entry.uploadedAt === "string" ? entry.uploadedAt : "",
    photoName: typeof entry.photoName === "string" ? entry.photoName : "travel-photo.jpg",
    photoPathname,
    photoUrl
  };
}

async function readBlobText(pathname) {
  const result = await get(pathname, { access: JOURNAL_BLOB_ACCESS });
  if (!result || !result.stream) {
    throw new Error("blob_not_found");
  }

  return new Response(result.stream).text();
}

function buildEntryPrefix(spotId) {
  return `journals/${spotId}/entries/`;
}

function normalizeMimeType(value) {
  if (value === "image/jpeg" || value === "image/png" || value === "image/webp") {
    return value;
  }

  return "";
}

function extensionFromMimeType(mimeType) {
  if (mimeType === "image/png") {
    return "png";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  return "jpg";
}

function normalizeVisitedAt(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
}

function isJournalPhotoPathname(pathname) {
  return /^journals\/spot-[1-9]\d*\/photos\/[a-zA-Z0-9._:-]+\.(jpg|jpeg|png|webp)$/.test(
    pathname || ""
  );
}
