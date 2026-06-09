import { NextResponse } from "next/server";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { getProPriceSnapshot } from "@/lib/stripe/client";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const cfg = getRuntimeConfig();
  let proPrice = null;
  try {
    proPrice = await getProPriceSnapshot();
  } catch {
    proPrice = null;
  }

  return NextResponse.json({
    credits: {
      freeDaily: cfg.credits.freeDaily,
      proDaily: cfg.credits.proDaily,
      proMonthly: cfg.credits.proMonthly,
    },
    proPrice,
  });
}
