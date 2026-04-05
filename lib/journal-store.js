import { del, get, list, put } from "@vercel/blob";

export const JOURNAL_BLOB_ACCESS =
  process.env.JOURNAL_BLOB_ACCESS === "private" ? "private" : "public";

export const JOURNAL_MAX_COMMENT_LENGTH = 600;
export const JOURNAL_MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;

const JOURNAL_RECORD_LIMIT = 200;

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

export function normalizeEntryId(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9-]{8,}$/.test(normalized) ? normalized : "";
}

export async function listJournalEntries(spotId) {
  const normalizedSpotId = normalizeSpotId(spotId);
  if (!normalizedSpotId) {
    throw new Error("invalid_spot");
  }

  const result = await list({
    prefix: buildEntryPrefix(normalizedSpotId),
    limit: JOURNAL_RECORD_LIMIT
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

  const normalizedComment = normalizeComment(comment);
  if (normalizedComment.length > JOURNAL_MAX_COMMENT_LENGTH) {
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
  const entryId = crypto.randomUUID();
  const photo = await uploadJournalPhoto({
    imageBuffer,
    entryId,
    mimeType: normalizedMimeType,
    originalName,
    spotId: normalizedSpotId,
    timestamp: uploadedAt
  });

  const record = buildStoredEntryRecord({
    id: entryId,
    spotId: normalizedSpotId,
    comment: normalizedComment,
    visitedAt,
    uploadedAt,
    updatedAt: uploadedAt,
    photoName: photo.photoName,
    photoPathname: photo.photoPathname
  });

  const recordPathname = buildRecordPathname(normalizedSpotId, uploadedAt, entryId);
  await writeJournalRecord(recordPathname, record);

  return hydrateJournalEntry(record);
}

export async function updateJournalEntry({
  spotId,
  entryId,
  comment,
  visitedAt,
  imageBuffer,
  mimeType,
  originalName
}) {
  const normalizedSpotId = normalizeSpotId(spotId);
  const normalizedEntryId = normalizeEntryId(entryId);
  if (!normalizedSpotId) {
    throw new Error("invalid_spot");
  }
  if (!normalizedEntryId) {
    throw new Error("invalid_entry");
  }

  const currentRecord = await findJournalRecord(normalizedSpotId, normalizedEntryId);
  const normalizedComment = normalizeComment(comment);
  if (normalizedComment.length > JOURNAL_MAX_COMMENT_LENGTH) {
    throw new Error("comment_too_long");
  }

  let nextPhotoPathname = currentRecord.entry.photoPathname;
  let nextPhotoName = currentRecord.entry.photoName;
  let uploadedPhotoPathname = "";

  try {
    if (imageBuffer != null) {
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

      const uploadedPhoto = await uploadJournalPhoto({
        imageBuffer,
        entryId: normalizedEntryId,
        mimeType: normalizedMimeType,
        originalName,
        spotId: normalizedSpotId,
        timestamp: new Date().toISOString()
      });

      uploadedPhotoPathname = uploadedPhoto.photoPathname;
      nextPhotoPathname = uploadedPhoto.photoPathname;
      nextPhotoName = uploadedPhoto.photoName;
    }

    const updatedAt = new Date().toISOString();
    const nextRecord = buildStoredEntryRecord({
      id: currentRecord.entry.id,
      spotId: normalizedSpotId,
      comment: normalizedComment,
      visitedAt,
      uploadedAt: currentRecord.entry.uploadedAt || updatedAt,
      updatedAt,
      photoName: nextPhotoName,
      photoPathname: nextPhotoPathname
    });

    await writeJournalRecord(currentRecord.recordPathname, nextRecord, {
      allowOverwrite: true
    });

    if (
      uploadedPhotoPathname &&
      currentRecord.entry.photoPathname &&
      currentRecord.entry.photoPathname !== uploadedPhotoPathname
    ) {
      await safeDeleteBlobs([currentRecord.entry.photoPathname]);
    }

    return hydrateJournalEntry(nextRecord);
  } catch (error) {
    if (uploadedPhotoPathname) {
      await safeDeleteBlobs([uploadedPhotoPathname]);
    }

    throw error;
  }
}

export async function deleteJournalEntry({ spotId, entryId }) {
  const normalizedSpotId = normalizeSpotId(spotId);
  const normalizedEntryId = normalizeEntryId(entryId);
  if (!normalizedSpotId) {
    throw new Error("invalid_spot");
  }
  if (!normalizedEntryId) {
    throw new Error("invalid_entry");
  }

  const currentRecord = await findJournalRecord(normalizedSpotId, normalizedEntryId);
  const pathnames = [currentRecord.recordPathname];

  if (currentRecord.entry.photoPathname) {
    pathnames.push(currentRecord.entry.photoPathname);
  }

  await del(pathnames);

  return { id: currentRecord.entry.id };
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

function buildStoredEntryRecord({
  id,
  spotId,
  comment,
  visitedAt,
  uploadedAt,
  updatedAt,
  photoName,
  photoPathname
}) {
  return {
    id,
    spotId: normalizeSpotId(spotId),
    comment: normalizeComment(comment),
    visitedAt: normalizeVisitedAt(visitedAt),
    uploadedAt: typeof uploadedAt === "string" ? uploadedAt : "",
    updatedAt: typeof updatedAt === "string" ? updatedAt : "",
    photoName: typeof photoName === "string" && photoName ? photoName : "travel-photo.jpg",
    photoPathname: typeof photoPathname === "string" ? photoPathname : ""
  };
}

function hydrateJournalEntry(entry) {
  const photoPathname = typeof entry.photoPathname === "string" ? entry.photoPathname : "";

  return {
    id: normalizeEntryId(entry.id) || crypto.randomUUID(),
    spotId: normalizeSpotId(entry.spotId),
    comment: normalizeComment(entry.comment),
    visitedAt: normalizeVisitedAt(entry.visitedAt),
    uploadedAt: typeof entry.uploadedAt === "string" ? entry.uploadedAt : "",
    updatedAt:
      typeof entry.updatedAt === "string" && entry.updatedAt
        ? entry.updatedAt
        : typeof entry.uploadedAt === "string"
          ? entry.uploadedAt
          : "",
    photoName: typeof entry.photoName === "string" ? entry.photoName : "travel-photo.jpg",
    photoPathname,
    photoUrl: photoPathname
      ? `/api/journal-photo?pathname=${encodeURIComponent(photoPathname)}`
      : ""
  };
}

async function findJournalRecord(spotId, entryId) {
  const result = await list({
    prefix: buildEntryPrefix(spotId),
    limit: JOURNAL_RECORD_LIMIT
  });

  const directMatch = (result.blobs || []).find((blob) => {
    return blob.pathname.endsWith(`-${entryId}.json`);
  });

  if (directMatch) {
    const text = await readBlobText(directMatch.pathname);
    return {
      entry: hydrateJournalEntry(JSON.parse(text)),
      recordPathname: directMatch.pathname
    };
  }

  for (const blob of result.blobs || []) {
    try {
      const text = await readBlobText(blob.pathname);
      const parsed = JSON.parse(text);
      const hydrated = hydrateJournalEntry(parsed);
      if (hydrated.id === entryId) {
        return {
          entry: hydrated,
          recordPathname: blob.pathname
        };
      }
    } catch {
      // Ignore malformed records while searching.
    }
  }

  throw new Error("entry_not_found");
}

async function uploadJournalPhoto({
  imageBuffer,
  entryId,
  mimeType,
  originalName,
  spotId,
  timestamp
}) {
  const extension = extensionFromMimeType(mimeType);
  const safeName = sanitizeFilename(originalName || `journal-photo.${extension}`);
  const normalizedTimestamp = String(timestamp || new Date().toISOString()).replaceAll(":", "-");
  const photoPathname = `journals/${spotId}/photos/${normalizedTimestamp}-${entryId}.${extension}`;

  await put(photoPathname, imageBuffer, {
    access: JOURNAL_BLOB_ACCESS,
    addRandomSuffix: false,
    contentType: mimeType
  });

  return {
    photoName: safeName,
    photoPathname
  };
}

async function writeJournalRecord(pathname, record, options = {}) {
  await put(pathname, JSON.stringify(record, null, 2), {
    access: JOURNAL_BLOB_ACCESS,
    addRandomSuffix: false,
    allowOverwrite: options.allowOverwrite === true,
    contentType: "application/json"
  });
}

async function safeDeleteBlobs(pathnames) {
  if (!Array.isArray(pathnames) || pathnames.length === 0) {
    return;
  }

  try {
    await del(pathnames);
  } catch {
    // Cleanup should not hide the main update/delete result.
  }
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

function buildRecordPathname(spotId, uploadedAt, entryId) {
  const timestamp = String(uploadedAt || new Date().toISOString()).replaceAll(":", "-");
  return `journals/${spotId}/entries/${timestamp}-${entryId}.json`;
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

function normalizeComment(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function sanitizeFilename(filename) {
  const cleaned = String(filename || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned || "travel-photo.jpg";
}

function isJournalPhotoPathname(pathname) {
  return /^journals\/spot-[1-9]\d*\/photos\/[a-zA-Z0-9._:-]+\.(jpg|jpeg|png|webp)$/.test(
    pathname || ""
  );
}
