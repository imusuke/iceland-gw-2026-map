const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

export function getRequestHeader(request, name) {
  const normalizedName = String(name || "").toLowerCase();
  const headers = request && request.headers;

  if (!headers) {
    return "";
  }

  if (typeof headers.get === "function") {
    return headers.get(normalizedName) || "";
  }

  if (Array.isArray(headers)) {
    const match = headers.find(([headerName]) => {
      return String(headerName || "").toLowerCase() === normalizedName;
    });
    return match ? String(match[1] || "") : "";
  }

  return String(headers[normalizedName] || headers[name] || "");
}

export function getRequestUrl(request) {
  const rawUrl = request && typeof request.url === "string" ? request.url : "/";

  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  const host = getRequestHeader(request, "x-forwarded-host") || getRequestHeader(request, "host") || "localhost";
  const protocol = getRequestHeader(request, "x-forwarded-proto") || "https";
  return `${protocol}://${host}${rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`}`;
}

export async function toWebRequest(request) {
  if (request && typeof request.formData === "function" && typeof request.json === "function") {
    return request;
  }

  const method = String((request && request.method) || "GET").toUpperCase();
  const headers = new Headers();

  copyHeadersInto(headers, request && request.headers);

  let body;
  if (!BODYLESS_METHODS.has(method)) {
    body = await readRequestBody(request);
  }

  return new Request(getRequestUrl(request), {
    method,
    headers,
    body,
    duplex: body ? "half" : undefined
  });
}

export async function sendWebResponse(nodeResponse, webResponse) {
  nodeResponse.statusCode = webResponse.status || 200;

  webResponse.headers.forEach((value, key) => {
    nodeResponse.setHeader(key, value);
  });

  const bodyText = await webResponse.text();
  nodeResponse.end(bodyText);
}

async function readRequestBody(request) {
  if (!request) {
    return undefined;
  }

  if (typeof request.arrayBuffer === "function") {
    const buffer = await request.arrayBuffer();
    return new Uint8Array(buffer);
  }

  const chunks = [];

  for await (const chunk of request) {
    chunks.push(normalizeChunk(chunk));
  }

  return chunks.length ? concatChunks(chunks) : undefined;
}

function copyHeadersInto(target, source) {
  if (!source) {
    return;
  }

  if (typeof source.forEach === "function") {
    source.forEach((value, key) => {
      target.set(key, value);
    });
    return;
  }

  if (Array.isArray(source)) {
    source.forEach(([key, value]) => {
      if (key) {
        target.set(key, value);
      }
    });
    return;
  }

  Object.entries(source).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      target.set(key, value.join(", "));
      return;
    }

    if (typeof value !== "undefined") {
      target.set(key, String(value));
    }
  });
}

function normalizeChunk(chunk) {
  if (chunk instanceof Uint8Array) {
    return chunk;
  }

  if (typeof chunk === "string") {
    return new TextEncoder().encode(chunk);
  }

  return new Uint8Array(chunk);
}

function concatChunks(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });

  return merged;
}
