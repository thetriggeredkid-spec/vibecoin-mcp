import { homedir } from "node:os";
import path from "node:path";

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : fallback;
}

export function VIBECOIN_HOME(): string {
  return env("VIBECOIN_HOME", path.join(homedir(), ".vibecoin"));
}
export function WALLETS_DIR(): string {
  return path.join(VIBECOIN_HOME(), "wallets");
}
export function KEYS_DIR(): string {
  return path.join(VIBECOIN_HOME(), "keys");
}
export function LAUNCHES_FILE(): string {
  return path.join(VIBECOIN_HOME(), "launches.json");
}

export const ENDPOINTS = {
  get pumpPortal() {
    return env("VIBECOIN_PUMPPORTAL_URL", "https://pumpportal.fun/api/trade-local");
  },
  get metadataUpload() {
    return env("VIBECOIN_METADATA_URL", "https://vibecoin.fun/api/metadata");
  },
  get registry() {
    return env("VIBECOIN_REGISTRY_URL", "https://vibecoin.fun/api/registry");
  },
  get dexScreener() {
    return env("VIBECOIN_DEXSCREENER_URL", "https://api.dexscreener.com/latest/dex/tokens");
  },
  get jupiterOrder() {
    return env("VIBECOIN_JUPITER_ORDER_URL", "https://api.jup.ag/swap/v2/order");
  },
  get jupiterExecute() {
    return env("VIBECOIN_JUPITER_EXECUTE_URL", "https://api.jup.ag/swap/v2/execute");
  },
  get rpc() {
    return env("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com");
  },
};

/** Same app, always-on origin — used automatically when vibecoin.fun DNS is unreachable. */
export const FALLBACK_ORIGIN = "https://vibecoin-fun.vercel.app";

export function fallbackUrlFor(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "vibecoin.fun" || u.hostname === "www.vibecoin.fun") {
      return `${FALLBACK_ORIGIN}${u.pathname}${u.search}`;
    }
  } catch {
    // not a url — no fallback
  }
  return null;
}

export const MINTS = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};

export const DEFAULTS = {
  priorityFee: 0.00005, // SOL
  slippage: 10, // percent, pump.fun curve moves fast
  pool: "pump",
  gasReserveSol: 0.01,
  swapSlippageBps: 100,
};

export const LINKS = {
  site: "https://vibecoin.fun",
  pumpCoin: (mint: string) => `https://pump.fun/coin/${mint}`,
  project: (mint: string) => `https://vibecoin.fun/projects#${mint}`,
};

export function isDryRun(param?: boolean): boolean {
  if (param !== undefined) return param;
  return process.env.VIBECOIN_DRY_RUN === "1" || process.env.VIBECOIN_DRY_RUN === "true";
}
