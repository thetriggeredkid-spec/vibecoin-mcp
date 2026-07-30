import { z } from "zod";
import { DEFAULTS, isDryRun } from "../config.js";
import { createWallet, listWallets, loadKeypair, readWalletFile } from "../keystore.js";
import {
  EXPLORER,
  buildSolTransfer,
  getConnection,
  getSolBalance,
  getUsdcBalance,
  sendSigned,
  simulate,
} from "../solana.js";
import { APPROVAL_NOTE, defaultWalletName, errText, parsePubkey, requireWallet, sol, text } from "./common.js";

export const walletTool = {
  name: "wallet",
  description:
    "Manage the project's local encrypted Solana wallet: create, status, balance, or transfer SOL. " +
    "Wallets are encrypted at rest (scrypt + AES-256-GCM); the password is auto-generated and stored in the macOS Keychain " +
    "(or a 0600 key file), so no interactive step is ever needed. Transfers require a preview + explicit user approval " +
    "(call once without confirm, show the preview, then call again with confirm: true).",
  schema: {
    action: z.enum(["create", "status", "balance", "transfer"]).describe("What to do"),
    name: z.string().optional().describe("Wallet name — defaults to the current project directory name"),
    password: z
      .string()
      .optional()
      .describe("Optional password override. Discouraged: prefer the auto-generated stored password or VIBECOIN_WALLET_PASSWORD"),
    to: z.string().optional().describe("Transfer only: recipient Solana address"),
    sol: z.number().positive().optional().describe("Transfer only: amount of SOL to send"),
    confirm: z.boolean().optional().describe("Transfer only: set true only after the user approved the preview"),
    dry_run: z.boolean().optional().describe("Transfer only: build and simulate but never send"),
  },
  async handler(args: {
    action: "create" | "status" | "balance" | "transfer";
    name?: string;
    password?: string;
    to?: string;
    sol?: number;
    confirm?: boolean;
    dry_run?: boolean;
  }) {
    try {
      const name = args.name ?? defaultWalletName();
      switch (args.action) {
        case "create": {
          const { publicKey, passwordMode } = await createWallet(name, args.password);
          const modeNote = {
            keychain: "auto-generated password stored in your macOS Keychain (service: vibecoin)",
            keyfile: "auto-generated password stored in ~/.vibecoin/keys (file mode 0600)",
            env: "encrypted with the password from VIBECOIN_WALLET_PASSWORD",
            param: "encrypted with the password you provided (it will be required for every future action)",
          }[passwordMode];
          return text(`Created wallet "${name}".

- Address: ${publicKey}
- Encryption: ${modeNote}
- Explorer: ${EXPLORER.addr(publicKey)}

Fund it by sending SOL to the address above. Launching a coin needs ~0.03 SOL plus any dev buy you want.
This wallet is fresh and unlinked to your identity — pseudonymous by default.`);
        }
        case "status": {
          const wallets = listWallets();
          if (wallets.length === 0) {
            return text(`No wallets yet. Create one with wallet {action: "create"} — or just run launch; it auto-creates one per project.`);
          }
          const conn = getConnection();
          const lines = await Promise.all(
            wallets.map(async (w) => {
              let bal = "balance unavailable (RPC unreachable)";
              try {
                const s = await getSolBalance(conn, parsePubkey(w.publicKey, "wallet"));
                const u = await getUsdcBalance(conn, parsePubkey(w.publicKey, "wallet"));
                bal = `${sol(s)} · ${u.toFixed(2)} USDC`;
              } catch {
                // keep placeholder
              }
              return `- ${w.name}: ${w.publicKey}\n  ${bal} · created ${w.createdAt.slice(0, 10)}`;
            }),
          );
          return text(`Wallets on this machine:\n\n${lines.join("\n")}`);
        }
        case "balance": {
          requireWallet(name);
          const file = readWalletFile(name);
          const conn = getConnection();
          const pk = parsePubkey(file.publicKey, "wallet");
          const s = await getSolBalance(conn, pk);
          const u = await getUsdcBalance(conn, pk);
          return text(`Wallet "${name}" (${file.publicKey})

- SOL: ${sol(s)}
- USDC: ${u.toFixed(2)}
- Explorer: ${EXPLORER.addr(file.publicKey)}`);
        }
        case "transfer": {
          if (!args.to || !args.sol) throw new Error('transfer needs "to" and "sol"');
          requireWallet(name);
          const dest = parsePubkey(args.to, "recipient");
          const file = readWalletFile(name);
          const conn = getConnection();
          const from = parsePubkey(file.publicKey, "wallet");
          const balance = await getSolBalance(conn, from);
          const feeEst = 0.000005 + DEFAULTS.priorityFee;
          if (!args.confirm) {
            return text(`## Transfer preview — nothing sent yet

- From: ${name} (${file.publicKey}) — balance ${sol(balance)}
- To: ${dest.toBase58()}
- Amount: ${sol(args.sol)}
- Est. network fee: ~${sol(feeEst)}
- Balance after: ~${sol(balance - args.sol - feeEst)}

${APPROVAL_NOTE}`);
          }
          if (balance < args.sol + feeEst) {
            throw new Error(`insufficient balance: have ${sol(balance)}, need ~${sol(args.sol + feeEst)}`);
          }
          const kp = await loadKeypair(name, args.password);
          const tx = await buildSolTransfer(conn, from, dest, args.sol);
          tx.sign([kp]);
          if (isDryRun(args.dry_run)) {
            const sim = await simulate(conn, tx);
            return text(`Dry run — transaction built and simulated, NOT sent.\nSimulation: ${sim.ok ? "ok" : `failed (${sim.err})`}`);
          }
          const sig = await sendSigned(conn, tx);
          return text(`Sent ${sol(args.sol)} to ${dest.toBase58()}.\n\n- Signature: ${sig}\n- Explorer: ${EXPLORER.tx(sig)}`);
        }
      }
    } catch (e) {
      return errText(e);
    }
  },
};
