import { z } from "zod";
import { DEFAULTS, isDryRun } from "../config.js";
import { loadKeypair, readWalletFile } from "../keystore.js";
import { buildCollectCreatorFeeTx } from "../pumpportal.js";
import { EXPLORER, getConnection, getSolBalance, sendSigned, simulate } from "../solana.js";
import { APPROVAL_NOTE, defaultWalletName, errText, parsePubkey, requireWallet, sol, text } from "./common.js";

export const collectFeesTool = {
  name: "collect-fees",
  description:
    "Claim your accrued pump.fun creator fees (0.30% of curve trades, tiered after graduation). " +
    "pump.fun pays out across all your coins at once. Preview first (no confirm), then call with confirm: true after " +
    "the user approves.",
  schema: {
    wallet: z.string().optional().describe("Wallet name (default: project directory name)"),
    priority_fee: z.number().min(0).optional().describe("Priority fee in SOL (default 0.00005)"),
    confirm: z.boolean().optional().describe("Set true only after the user approved"),
    dry_run: z.boolean().optional().describe("Build + simulate the claim without sending"),
  },
  async handler(args: { wallet?: string; priority_fee?: number; confirm?: boolean; dry_run?: boolean }) {
    try {
      const name = args.wallet ?? defaultWalletName();
      requireWallet(name);
      const file = readWalletFile(name);
      const pk = parsePubkey(file.publicKey, "wallet");

      if (!args.confirm) {
        return text(`## Collect creator fees — preview

- Wallet: ${name} (${file.publicKey})
- Claims ALL pending pump.fun creator fees for this wallet in one transaction (per-coin selection isn't a thing —
  pump.fun pays everything owed to the creator address at once).
- Cost: network fee only (~${sol(0.000005 + (args.priority_fee ?? DEFAULTS.priorityFee))}). PumpPortal does not charge for fee claims.

${APPROVAL_NOTE}`);
      }

      const conn = getConnection();
      const before = await getSolBalance(conn, pk);
      const tx = await buildCollectCreatorFeeTx({ creator: pk, priorityFee: args.priority_fee });
      const kp = await loadKeypair(name);
      tx.sign([kp]);

      if (isDryRun(args.dry_run)) {
        const sim = await simulate(conn, tx);
        return text(`Dry run — claim built and simulated, NOT sent.\nSimulation: ${sim.ok ? "✓ ok" : `✗ ${sim.err}`}`);
      }

      const sig = await sendSigned(conn, tx);
      const after = await getSolBalance(conn, pk);
      const delta = after - before;
      return text(`## Fees collected

- Claimed: ${delta > 0 ? sol(delta) : `≈0 (nothing pending; tx fee ${sol(Math.abs(delta))})`}
- Balance: ${sol(after)}
- Tx: ${EXPLORER.tx(sig)}

Tip: run fund-agent to convert fees into a USDC budget for your agent.`);
    } catch (e) {
      return errText(e);
    }
  },
};
