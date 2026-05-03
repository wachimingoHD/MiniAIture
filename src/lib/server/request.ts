import type { NextRequest } from "next/server";

export function readBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim();
}

// Returns the client IP, preferring headers that platforms (Vercel, Cloudflare)
// overwrite at the edge before requests reach our code. These cannot be spoofed
// by the client. Falls back to the configurable forwarded header for self-hosted
// deployments behind a reverse proxy that sets it correctly.
export function getClientIp(req: NextRequest, fallbackHeader = "x-forwarded-for"): string {
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const ip = vercel.split(",")[0]?.trim();
    if (ip) return ip;
  }

  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = req.headers.get(fallbackHeader);
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return "unknown";
}
