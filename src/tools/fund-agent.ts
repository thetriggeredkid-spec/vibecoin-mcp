import { VersionedTransaction } from "@solana/web3.js";
import { z } from "zod";
import { DEFAULTS, isDryRun } from "../config.js";
import { executeSwap, quoteSolToUsdc } from "../jupiter.js";
import { loadKeypair, readWalletFile } from "../keystore.js";
import { buildCollectCreatorFeeTx } from "../pumpportal.js";
import { EXPLORER, getConnection, getSolBalance, getUsdcBalance, sendSigned } from "../solana.js";
import { APPROVAL_NOTE, defaultWalletName, errText, parsePubkey, requireWallet, sol, text } from "./common.js";

const HONESTY =
  "The USDC budget stays in this wallet under your control. It does NOT auto-pay any provider — " +
  "Anthropic and OpenAI only take fiat cards, and OpenRouter crypto top-ups are a manual web checkout on their site.";

export const fundAgentTool = {
  name: "fund-agent",
  description:
    "One-prompt loop that turns creator fees into an agent budget: optionally collect pending pump.fun fees, " +
    "then swap SOL→USDC via Jupiter (keeping a gas reserve) so the wallet holds a stable budget. " +
    "Preview first (no confirm) — it shows the live quote; call with confirm: true after the user approves. " +
    "Honest by design: the USDC stays in the wallet; it does not auto-pay Anthropic/OpenAI (fiat-only) or OpenRouter.",
  schema: {
    wallet: z.string().optional().describe("Wallet name (default: project directory name)"),
    sol_amount: z.number().positive().optional().describe("SOL to swap (default: everything above the gas reserve)"),
    keep_sol: z.number().min(0).optional().describe("Gas reserve to keep in SOL (default 0.01)"),
    collect_first: z.boolean().optional().describe("Collect pending creator fees before swapping (default true)"),
    slippage_bps: z.number().int().min(1).max(1000).optional().describe("Swap slippage in bps (default 100 = 1%)"),
    confirm: z.boolean().optional().describe("Set true only after the user approved the preview"),
    dry_run: z.boolean().optional().describe("Quote and sign but never execute the swap"),
  },
  async handler(args: {
    wallet?: string;
    sol_amount?: number;
    keep_sol?: number;
    collect_first?: boolean;
    slippage_bps?: number;
    confirm?: boolean;
    dry_run?: boolean;
  }) {
    try {
      const name = args.wallet ?? defaultWalletName();
      requireWallet(name);
      const file = readWalletFile(name);
      const pk = parsePubkey(file.publicKey, "wallet");
      const keep = args.keep_sol ?? DEFAULTS.gasReserveSol;
      const collectFirst = args.collect_first ?? true;
      const conn = getConnection();

      const solBal = await getSolBalance(conn, pk);
      const usdcBal = await getUsdcBalance(conn, pk);
      const swappable = args.sol_amount ?? Math.max(0, solBal - keep);

      if (!args.confirm) {
        if (swappable <= 0.001) {
          return text(`## Fund agent — nothing to swap yet

- Wallet: ${name} (${file.publicKey})
- SOL: ${sol(solBal)} (reserve ${sol(keep)}) · USDC: ${usdcBal.toFixed(2)}
- ${collectFirst ? "Fee collection would run first, but the wallet still needs more SOL than the reserve to swap." : "Nothing above the reserve to swap."}

Earn fees (share your coin!), lower keep_sol, or fund the wallet, then try again.`);
        }
        let quoteLine: string;
        try {
          const q = await quoteSolToUsdc({ taker: pk, sol: swappable, slippageBps: args.slippage_bps ?? DEFAULTS.swapSlippageBps });
          quoteLine = `${sol(swappable)} → ~${(q.outUsdcMinor / 1e6).toFixed(2)} USDC (route: ${q.router}, Jupiter fee ${q.feeBps} bps)`;
        } catch (e) {
          quoteLine = `quote unavailable right now (${e instanceof Error ? e.message : "error"}) — a fresh quote is fetched at execution`;
        }
        return text(`## Fund agent — preview

- Wallet: ${name} (${file.publicKey})
- Balances: ${sol(solBal)} · ${usdcBal.toFixed(2)} USDC
${collectFirst ? "- Step 1: collect pending pump.fun creator fees (network fee only)\n" : ""}- Swap: ${quoteLine}
- Gas reserve kept: ${sol(keep)}

${HONESTY}

${APPROVAL_NOTE}`);
      }

      // ---- confirmed ----
      const lines: string[] = [];
      const kp = await loadKeypair(name);

      if (collectFirst && !isDryRun(args.dry_run)) {
        try {
          const feeTx = await buildCollectCreatorFeeTx({ creator: pk });
          feeTx.sign([kp]);
          const sig = await sendSigned(conn, feeTx);
          lines.push(`- Fees collected: ${EXPLORER.tx(sig)}`);
        } catch (e) {
          lines.push(`- Fee collection skipped (${e instanceof Error ? e.message.slice(0, 120) : "error"})`);
        }
      }

      const freshBal = await getSolBalance(conn, pk);
      const amount = args.sol_amount ?? Math.max(0, freshBal - keep);
      if (amount <= 0.001) {
        throw new Error(`nothing to swap: balance ${sol(freshBal)} minus reserve ${sol(keep)} leaves ≤0.001 SOL`);
      }
      const q = await quoteSolToUsdc({ taker: pk, sol: amount, slippageBps: args.slippage_bps ?? DEFAULTS.swapSlippageBps });
      const tx = VersionedTransaction.deserialize(Buffer.from(q.txBase64, "base64"));
      tx.sign([kp]);

      if (isDryRun(args.dry_run)) {
        return text(`Dry run — swap quoted and signed, NOT executed.\n- Would swap ${sol(amount)} → ~${(q.outUsdcMinor / 1e6).toFixed(2)} USDC (route ${q.router})\n${HONESTY}`);
      }

      const result = await executeSwap({ signedTx: tx, requestId: q.requestId });
      const newUsdc = await getUsdcBalance(conn, pk).catch(() => usdcBal + result.outUsdc);
      lines.push(`- Swapped ${sol(amount)} → ${result.outUsdc.toFixed(2)} USDC (${EXPLORER.tx(result.signature)})`);
      return text(`## Agent budget topped up

${lines.join("\n")}
- USDC budget now: ${newUsdc.toFixed(2)}
- SOL kept for gas: ~${sol(keep)}

${HONESTY}`);
    } catch (e) {
      return errText(e);
    }
  },
};
