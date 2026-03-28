import { next } from "@vercel/functions";

const AUTH_REALM = "2026-iceland";

export default function middleware(request) {
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPassword = process.env.BASIC_AUTH_PASSWORD;

  if (!expectedUser || !expectedPassword) {
    return new Response("Basic authentication is not configured.", {
      status: 500,
      headers: {
        "Cache-Control": "no-store"
      }
    });
  }

  const credentials = parseBasicAuthHeader(
    request.headers.get("authorization")
  );

  if (
    !credentials ||
    credentials.user !== expectedUser ||
    credentials.password !== expectedPassword
  ) {
    return new Response("Authentication required.", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": `Basic realm="${AUTH_REALM}", charset="UTF-8"`
      }
    });
  }

  return next();
}

function parseBasicAuthHeader(headerValue) {
  if (!headerValue || !headerValue.startsWith("Basic ")) {
    return null;
  }

  try {
    const decodedValue = atob(headerValue.slice(6));
    const separatorIndex = decodedValue.indexOf(":");

    if (separatorIndex < 0) {
      return null;
    }

    return {
      user: decodedValue.slice(0, separatorIndex),
      password: decodedValue.slice(separatorIndex + 1)
    };
  } catch {
    return null;
  }
}

export const config = {
  matcher: ["/:path*"]
};
