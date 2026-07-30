import { ENDPOINTS } from "./config.js";

export interface MarketData {
  priceUsd?: number;
  marketCapUsd?: number;
  volume24hUsd?: number;
  priceChange24h?: number;
  liquidityUsd?: number;
  dexUrl?: string;
  pairAddress?: string;
  dexId?: string;
}

interface DexPair {
  dexId?: string;
  pairAddress?: string;
  url?: string;
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
}

/** Returns null when DexScreener has no pairs yet (brand-new bonding-curve token). */
export async function fetchMarket(mint: string): Promise<MarketData | null> {
  const res = await fetch(`${ENDPOINTS.dexScreener}/${mint}`);
  if (!res.ok) throw new Error(`DexScreener responded ${res.status}`);
  const body = (await res.json()) as { pairs?: DexPair[] | null };
  const pairs = body.pairs ?? [];
  if (pairs.length === 0) return null;
  const best = pairs.reduce((a, b) => ((a.liquidity?.usd ?? 0) >= (b.liquidity?.usd ?? 0) ? a : b));
  return {
    priceUsd: best.priceUsd !== undefined ? Number(best.priceUsd) : undefined,
    marketCapUsd: best.marketCap ?? best.fdv,
    volume24hUsd: best.volume?.h24,
    priceChange24h: best.priceChange?.h24,
    liquidityUsd: best.liquidity?.usd,
    dexUrl: best.url,
    pairAddress: best.pairAddress,
    dexId: best.dexId,
  };
}

export function fmtUsd(n?: number): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n === 0) return "$0";
  return `$${n.toPrecision(3)}`;
}
