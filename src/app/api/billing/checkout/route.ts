import { NextRequest, NextResponse } from "next/server";
import { verifyIdToken } from "@/lib/auth/firebase-admin";
import { readBearerToken } from "@/lib/server/request";
import { createProCheckoutSession } from "@/lib/stripe/client";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = readBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });
  }
  const user = await verifyIdToken(token);
  if (!user || !user.email) {
    return NextResponse.json({ error: "Invalid token or missing email in auth profile." }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const affiliateCode =
    body && typeof body === "object" && typeof (body as { affiliateCode?: unknown }).affiliateCode === "string"
      ? (body as { affiliateCode: string }).affiliateCode
      : undefined;

  try {
    const url = await createProCheckoutSession({
      uid: user.uid,
      email: user.email,
      affiliateCode,
    });
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
