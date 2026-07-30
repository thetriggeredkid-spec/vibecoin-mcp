import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listLaunches, postToSiteRegistry, recordLaunch, type LaunchRecord } from "../src/registry.js";
import { fetchMarket, fmtUsd } from "../src/market.js";

const rec: LaunchRecord = {
  mint: "MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  name: "Test",
  symbol: "TEST",
  description: "d",
  creator: "CreatorAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  wallet: "proj",
  signature: "sig",
  createdAt: "2026-07-29T00:00:00.000Z",
};

describe("registry", () => {
  beforeEach(() => {
    process.env.VIBECOIN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vibecoin-reg-"));
  });

  it("records and lists launches, deduping by mint", () => {
    expect(listLaunches()).toEqual([]);
    recordLaunch(rec);
    recordLaunch({ ...rec, name: "Updated" });
    const all = listLaunches();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Updated");
  });

  it("never throws when the site registry is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const out = await postToSiteRegistry(rec);
    expect(out.ok).toBe(false);
    expect(out.note).toContain("recorded locally");
    vi.unstubAllGlobals();
  });
});

describe("market", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("picks the highest-liquidity pair", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          pairs: [
            { priceUsd: "1", marketCap: 10, liquidity: { usd: 5 }, volume: { h24: 1 }, url: "low" },
            { priceUsd: "2", marketCap: 20, liquidity: { usd: 50 }, volume: { h24: 2 }, url: "high", priceChange: { h24: -3.2 } },
          ],
        }),
      }),
    );
    const m = await fetchMarket("SomeMint");
    expect(m?.priceUsd).toBe(2);
    expect(m?.marketCapUsd).toBe(20);
    expect(m?.dexUrl).toBe("high");
    expect(m?.priceChange24h).toBe(-3.2);
  });

  it("returns null when no pairs exist yet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pairs: null }) }));
    expect(await fetchMarket("FreshMint")).toBeNull();
  });

  it("formats USD amounts", () => {
    expect(fmtUsd(1234567)).toBe("$1.23M");
    expect(fmtUsd(45600)).toBe("$45.6K");
    expect(fmtUsd(2.5)).toBe("$2.50");
    expect(fmtUsd(0.00123)).toBe("$0.00123");
    expect(fmtUsd(0)).toBe("$0");
    expect(fmtUsd(undefined)).toBe("—");
  });
});
