import { next } from "@vercel/functions";
import { authorizeBasicRequest } from "./lib/basic-auth.js";

export default function middleware(request) {
  const auth = authorizeBasicRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  return next();
}

export const config = {
  matcher: ["/:path*"]
};
