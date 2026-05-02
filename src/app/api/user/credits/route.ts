import { NextRequest, NextResponse } from "next/server";
import { verifyIdToken } from "@/lib/auth/firebase-admin";

export const runtime = "nodejs";

// Phase 2 endpoint - returns the current user's credit balance.
// TODO[Phase 2]: read user doc from Firestore, apply daily reset if due, return balance.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });
  }
  const user = await verifyIdToken(token);
  if (!user) {
    return NextResponse.json(
      {
        error: "Auth not configured (Phase 2 pending). See src/lib/auth/firebase-admin.ts.",
      },
      { status: 501 },
    );
  }
  return NextResponse.json({ uid: user.uid, message: "Implement Firestore read in Phase 2." });
}
