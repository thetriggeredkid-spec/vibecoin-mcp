import { ENDPOINTS, LINKS, VIBECOIN_HOME } from "../config.js";
import { listWallets } from "../keystore.js";
import { listLaunches } from "../registry.js";
import { text } from "./common.js";

export const infoTool = {
  name: "info",
  description:
    "Platform overview for vibecoin: what it does, current pump.fun fee structure, config, wallets and links.",
  schema: {},
  async handler() {
    const wallets = listWallets();
    const launches = listLaunches();
    return text(`# vibecoin — launch your vibe coded app on Solana

A thin, non-custodial wrapper over pump.fun via the PumpPortal Local Transaction API.
Transactions are built remotely, signed locally, and submitted to your own RPC. Keys never leave this machine.

## Fees (verified 2026-07-29)
- Creating a coin: free. The optional first dev buy costs ~0.025 SOL in network fees (~0.04 SOL with buffer).
- Bonding-curve trades: 1.25% total — 0.95% pump.fun protocol + 0.30% to you, the creator.
- After graduation (~85 SOL raised, curve sells out) the coin migrates to PumpSwap (0.015 SOL, LP burned).
  Creator fee is then tiered by market cap: up to 0.95% per trade, floor 0.05% above ~$20M mcap.
- PumpPortal charges 0.5% on trades made through its API (applies to dev buys; creating itself is not charged).
- Claim anytime with collect-fees; recycle into an agent budget with fund-agent.

## Tools
wallet · launch · my-coins · collect-fees · fund-agent · lock · info

## This machine
- Config dir: ${VIBECOIN_HOME()}
- RPC: ${ENDPOINTS.rpc}
- Wallets: ${wallets.length === 0 ? "none yet" : wallets.map((w) => `${w.name} (${w.publicKey})`).join(", ")}
- Launches recorded: ${launches.length}

## Links
- Site + registry: ${LINKS.site}
- Projects: ${LINKS.site}/projects
- Docs: ${LINKS.site}/#api`);
  },
};
