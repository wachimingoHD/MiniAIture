import type { NextRequest } from "next/server";

export function readBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim();
}

export function getClientIp(req: NextRequest, trustedHeader = "x-forwarded-for"): string {
  const forwarded = req.headers.get(trustedHeader);
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
