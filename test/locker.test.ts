import { describe, expect, it } from "vitest";
import { LOCK_PROOF_URL, buildLockPlan } from "../src/locker.js";

describe("buildLockPlan", () => {
  const base = {
    mint: "MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    recipient: "CreatorAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    uiAmount: 1_000_000,
    decimals: 6,
    days: 90,
    label: "vibecoin creator lock",
    now: 1_753_000_000_000,
  };

  it("encodes streamflow's irrevocable lock recipe", () => {
    const p = buildLockPlan(base);
    expect(p.start).toBe(p.cliff);
    expect(p.start).toBe(Math.floor(base.now / 1000) + 90 * 86400);
    expect(p.amountRaw).toBe(1_000_000_000_000n);
    expect(p.cliffAmountRaw).toBe(p.amountRaw - 1n);
    expect(p.period).toBe(1);
    expect(p.amountPerPeriodRaw).toBe(1n);
    expect(p.recipient).toBe(base.recipient);
    expect(p.tokenId).toBe(base.mint);
  });

  it("rejects zero and dust amounts", () => {
    expect(() => buildLockPlan({ ...base, uiAmount: 0 })).toThrow(/positive/);
    expect(() => buildLockPlan({ ...base, uiAmount: 0.0000001 })).toThrow(/too small/);
  });

  it("rejects sub-day durations and formats the proof url", () => {
    expect(() => buildLockPlan({ ...base, days: 0.5 })).toThrow(/at least 1 day/);
    expect(LOCK_PROOF_URL("abc123")).toBe("https://app.streamflow.finance/contract/solana/mainnet/abc123");
  });
});
