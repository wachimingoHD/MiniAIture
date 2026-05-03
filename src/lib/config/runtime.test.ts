import { beforeEach, describe, expect, it } from "vitest";
import { getRuntimeConfig, getRuntimeConfigWarnings, resetRuntimeConfigForTests } from "@/lib/config/runtime";

describe("runtime config", () => {
  beforeEach(() => {
    delete process.env.PRO_DAILY_CREDITS;
    delete process.env.PRO_MONTHLY_CREDITS;
    delete process.env.REQUIRE_AUTH_FOR_GENERATE;
    delete process.env.STRIPE_CHECKOUT_SUCCESS_URL;
    delete process.env.STRIPE_CHECKOUT_CANCEL_URL;
    resetRuntimeConfigForTests();
  });

  it("uses defaults when env is missing", () => {
    const cfg = getRuntimeConfig();
    expect(cfg.credits.proDaily).toBe(500);
    expect(cfg.security.requireAuthForGenerate).toBe(true);
  });

  it("parses explicit env values", () => {
    process.env.PRO_DAILY_CREDITS = "650";
    process.env.REQUIRE_AUTH_FOR_GENERATE = "false";
    resetRuntimeConfigForTests();
    const cfg = getRuntimeConfig();
    expect(cfg.credits.proDaily).toBe(650);
    expect(cfg.security.requireAuthForGenerate).toBe(false);
  });

  it("emits warnings for malformed urls", () => {
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = "/not-absolute";
    process.env.STRIPE_CHECKOUT_CANCEL_URL = "/not-absolute";
    resetRuntimeConfigForTests();
    const warnings = getRuntimeConfigWarnings();
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });
});
