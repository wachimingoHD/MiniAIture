import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyIdToken } from "@/lib/auth/firebase-admin";
import { getOrCreateUserDocument } from "@/lib/firestore/users";
import { readBearerToken } from "@/lib/server/request";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = readBearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });

  const user = await verifyIdToken(token);
  if (!user) return NextResponse.json({ error: "Invalid or expired auth token." }, { status: 401 });

  const db = adminFirestore();
  if (!db) {
    return NextResponse.json(
      { error: "Firebase Admin not configured. Set FIREBASE_ADMIN_CREDENTIALS." },
      { status: 500 },
    );
  }

  const doc = await getOrCreateUserDocument(db, { uid: user.uid, email: user.email, displayName: user.name });
  if (doc.plan !== "pro") {
    return NextResponse.json(
      {
        error: "Gallery is available only for Pro users.",
        plan: doc.plan,
        images: [],
      },
      { status: 403 },
    );
  }

  const images = [...(doc.gallery ?? [])]
    .map((image) => {
      const legacy = image as unknown as { createdAt?: unknown; createdAtIso?: unknown };
      const createdAt =
        typeof legacy.createdAt === "string"
          ? legacy.createdAt
          : typeof legacy.createdAtIso === "string"
            ? legacy.createdAtIso
            : typeof legacy.createdAt === "number"
              ? new Date(legacy.createdAt).toISOString()
              : new Date().toISOString();
      return {
        ...image,
        createdAt,
      };
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return NextResponse.json({
    plan: doc.plan,
    count: images.length,
    images,
  });
}
