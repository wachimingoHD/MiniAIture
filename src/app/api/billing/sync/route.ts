import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyIdToken } from "@/lib/auth/firebase-admin";
import { syncCheckoutSessionToUser } from "@/lib/stripe/subscription-sync";
import { readBearerToken } from "@/lib/server/request";
import { safeErrorMessage } from "@/lib/server/errors";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = readBearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });

  const user = await verifyIdToken(token);
  if (!user) return NextResponse.json({ error: "Invalid or expired auth token." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sessionId =
    body && typeof body === "object" && typeof (body as { sessionId?: unknown }).sessionId === "string"
      ? (body as { sessionId: string }).sessionId.trim()
      : "";
  if (!sessionId.startsWith("cs_")) {
    return NextResponse.json({ error: "Invalid Checkout Session id." }, { status: 400 });
  }

  const db = adminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin not configured." }, { status: 500 });

  try {
    const result = await syncCheckoutSessionToUser(db, sessionId, user.uid);
    if (!result.ok) {
      const status = result.reason === "uid_mismatch" ? 403 : 409;
      return NextResponse.json(
        { error: "Checkout session could not be synchronized.", reason: result.reason },
        { status },
      );
    }
    return NextResponse.json({ ok: true, subscriptionId: result.subscriptionId });
  } catch (err) {
    return NextResponse.json(
      { error: "Checkout synchronization failed.", detail: safeErrorMessage(err, "sync_failed") },
      { status: 500 },
    );
  }
}
