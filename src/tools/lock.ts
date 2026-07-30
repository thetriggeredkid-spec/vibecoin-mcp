import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { isDryRun } from "../config.js";
import { loadKeypair, readWalletFile } from "../keystore.js";
import { LOCK_PROOF_URL, buildLockPlan, executeLock } from "../locker.js";
import { listLaunches } from "../registry.js";
import { EXPLORER, getConnection, getTokenBalance } from "../solana.js";
import { APPROVAL_NOTE, defaultWalletName, errText, parsePubkey, requireWallet, text } from "./common.js";

export const lockTool = {
  name: "lock",
  description:
    "Prove you're not dumping: lock a percentage of your own creator-held tokens for a chosen duration via " +
    "Streamflow (third-party on-chain locker) and get a shareable proof link. Irrevocable until the unlock date. " +
    "Preview first (no confirm); call with confirm: true after the user approves. " +
    "Streamflow charges ~0.09-0.16 SOL plus 0.19-0.5% of the locked tokens (their on-chain fee oracle decides).",
  schema: {
    mint: z.string().optional().describe("Token mint to lock (default: your most recent launch)"),
    percent: z.number().min(1).max(100).describe("Percentage of your current token balance to lock"),
    days: z.number().min(1).max(3650).describe("Lock duration in days (e.g. 90, 180, 365)"),
    wallet: z.string().optional().describe("Wallet name (default: project directory name)"),
    confirm: z.boolean().optional().describe("Set true only after the user approved the preview"),
    dry_run: z.boolean().optional().describe("Preview the exact lock parameters without touching the chain"),
  },
  async handler(args: {
    mint?: string;
    percent: number;
    days: number;
    wallet?: string;
    confirm?: boolean;
    dry_run?: boolean;
  }) {
    try {
      const name = args.wallet ?? defaultWalletName();
      requireWallet(name);
      const file = readWalletFile(name);
      const pk = parsePubkey(file.publicKey, "wallet");

      let mint = args.mint;
      if (!mint) {
        const launches = listLaunches().filter((l) => l.creator === file.publicKey);
        if (launches.length === 0) throw new Error("no launches found for this wallet — pass mint explicitly");
        mint = launches[launches.length - 1].mint;
      }
      const mintPk = parsePubkey(mint, "mint");

      const conn = getConnection();
      const balance = await getTokenBalance(conn, pk, mintPk);
      if (balance <= 0) {
        throw new Error(
          `wallet holds 0 of ${mint} — buy some first (a dev buy at launch is the usual way to hold your own coin)`,
        );
      }
      const lockAmount = (balance * args.percent) / 100;
      const plan = buildLockPlan({
        mint,
        recipient: file.publicKey,
        uiAmount: lockAmount,
        decimals: 6, // pump.fun tokens are 6-decimal SPL mints
        days: args.days,
        label: `vibecoin creator lock`,
      });

      if (!args.confirm || isDryRun(args.dry_run)) {
        return text(`## Creator lock — preview${isDryRun(args.dry_run) ? " (dry run)" : ""} — nothing sent

- Token: ${mint}
- Wallet: ${name} (${file.publicKey}) holds ${balance.toLocaleString("en-US")} tokens
- Locking: ${args.percent}% = ${lockAmount.toLocaleString("en-US")} tokens
- Unlocks: ${plan.unlockDate} (${args.days} days) — irrevocable, no early exit, not transferable
- Cost: ~0.09-0.16 SOL + 0.19-0.5% of the locked tokens (Streamflow's on-chain fee oracle)
- Proof link after locking: https://app.streamflow.finance/contract/solana/mainnet/<contract-id>

${APPROVAL_NOTE}`);
      }

      const kp = await loadKeypair(name);
      const { txId, metadataId } = await executeLock(plan, kp);
      return text(`## 🔒 Locked

- ${lockAmount.toLocaleString("en-US")} tokens ($${args.percent}% of your balance) locked until ${plan.unlockDate}
- Proof link (share this): ${LOCK_PROOF_URL(metadataId)}
- Tx: ${EXPLORER.tx(txId)}`);
    } catch (e) {
      return errText(e);
    }
  },
};
